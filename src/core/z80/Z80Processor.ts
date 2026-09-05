/**
 * Z80 CPU コア。Z80dotNet と同一挙動を狙った内製実装で、
 * - 全命令セット (公式 + 主要な未文書命令: IXH/IXL 系、SLL、DDCB の RES/SET レジスタロード)
 * - 命令ごとの実 T-state 積算 (TStatesElapsedSinceReset)
 * - HALT 検出 (HALT 実行で停止、以降は NOP として 4T ずつ消費)
 * - 16bit ポート空間 (UseExtendedPortsSpace 相当)
 * を提供する。割り込み線 (INT/NMI) は本プロジェクトでは未使用のため実装対象外。
 *
 * Based on Z80dotNet (https://github.com/Konamiman/Z80dotNet) originally written by Konamiman.
 * Copyright (C) 2014 Konamiman, www.konamiman.com.
 * 本ファイルは Z80dotNet の LICENSE.txt 条項 (著作権 / 許諾表示の保持、改変の明示) に従って改変したものである。
 * TypeScript 移植にあたり構造を変更している (Z80Processor.cs / Z80InstructionExecutor 相当)。
 * 挙動仕様 (フラグの未文書ビットや INI 系の H/C/P/V 不変等) は Z80dotNet の README
 * (The undocumented Z80 documented 準拠の記載) に従う。
 */
import type { Z80MemoryBus, Z80PortBus } from './Z80Bus';
import { Z80Registers } from './Z80Registers';

/** F レジスタのフラグビット。 */
const FlagCF = 0x01;
const FlagNF = 0x02;
const FlagPF = 0x04;
const Flag3 = 0x08;
const FlagHF = 0x10;
const Flag5 = 0x20;
const FlagZF = 0x40;
const FlagSF = 0x80;

/** 命令下位 3bit の 8bit レジスタインデックス。 */
const RegB = 0;
const RegC = 1;
const RegD = 2;
const RegE = 3;
const RegH = 4;
const RegL = 5;
const RegHlMem = 6;
const RegA = 7;

/** ビット数 1 の個数が偶数なら 1 (奇偶パリティ)。 */
const ParityTable = buildParityTable();

function buildParityTable(): Uint8Array {
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    let ones = 0;
    for (let temp = value; temp !== 0; temp >>= 1) {
      ones += temp & 1;
    }

    table[value] = (ones & 1) ^ 1;
  }

  return table;
}

/** 符号付き 8bit に解釈する。 */
function asSignedByte(value: number): number {
  return (value << 24) >> 24;
}

/** DD/FD プレフィックスで定義済みのオペコード (Z80dotNet のテーブルと同一)。 */
const XyInstructionOpcodes: ReadonlySet<number> = new Set<number>([
  0x09, 0x19, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e,
  0x34, 0x35, 0x36, 0x39,
  0x44, 0x45, 0x46, 0x4c, 0x4d, 0x4e, 0x54, 0x55, 0x56, 0x5c, 0x5d, 0x5e,
  0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f,
  0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77, 0x7c, 0x7d, 0x7e,
  0x84, 0x85, 0x86, 0x8c, 0x8d, 0x8e,
  0x94, 0x95, 0x96, 0x9c, 0x9d, 0x9e,
  0xa4, 0xa5, 0xa6, 0xac, 0xad, 0xae,
  0xb4, 0xb5, 0xb6, 0xbc, 0xbd, 0xbe,
  0xe1, 0xe3, 0xe5, 0xe9, 0xf9,
]);

/**
 * Z80 プロセッサ本体。
 * `memory` / `portsSpace` は使用前にバス実装を設定する。
 */
export class Z80Processor {
  /** 接続するメモリバス (使用前に設定すること)。 */
  memory!: Z80MemoryBus;

  /** 接続する I/O ポートバス (使用前に設定すること)。 */
  portsSpace!: Z80PortBus;

  /** true で 16bit ポート番号を有効化 (false では下位 8bit のみ使用)。 */
  useExtendedPortsSpace = false;

  readonly registers = new Z80Registers();

  private halted = false;

  /** 今実行した命令が HALT か (命令完了時に halted へ反映)。 */
  private haltExecuted = false;

  private tStatesSinceReset = 0;

  /** DD/FD プレフィックス実行中か (8bit レジスタ抽象の H/L 差し替え用)。 */
  private isXyMode = false;

  /** DD/FD 命令の (XY+d) 参照用ディスプレースメント (事前フェッチ済み)。 */
  private xyDisplacement = 0;

  get isHalted(): boolean {
    return this.halted;
  }

  get tStatesElapsedSinceReset(): number {
    return this.tStatesSinceReset;
  }

  /** リセットする (IFF / PC / AF / SP / IM をクリア、T-state を 0 に戻す)。 */
  reset(): void {
    this.registers.iff1 = false;
    this.registers.iff2 = false;
    this.registers.pc = 0;
    this.registers.af = 0xffff;
    this.registers.sp = 0xffff;
    this.registers.interruptMode = 0;

    this.halted = false;
    this.haltExecuted = false;
    this.tStatesSinceReset = 0;
    this.isXyMode = false;
    this.xyDisplacement = 0;
  }

  /**
   * 次の 1 命令を実行し、消費 T-state を返す。
   * HALT 状態ではメモリフェッチせず NOP (4T) として動く。
   */
  executeNextInstruction(): number {
    let cycles: number;
    if (this.halted) {
      cycles = 4;
    } else {
      cycles = this.executeNextOpcode();
      if (this.haltExecuted) {
        this.halted = true;
        this.haltExecuted = false;
      }
    }

    this.tStatesSinceReset += cycles;
    return cycles;
  }

  // --- フェッチ / メモリ / ポート ---

  private incR(): void {
    this.registers.r = (this.registers.r & 0x80) | ((this.registers.r + 1) & 0x7f);
  }

  private fetchOpcode(): number {
    const value = this.readMemory8(this.registers.pc);
    this.registers.pc = (this.registers.pc + 1) & 0xffff;
    return value;
  }

  /** PC を進めずに次のオペコードバイトを覗き見する (DD/FD プレフィックス用)。 */
  private peekOpcode(): number {
    return this.readMemory8(this.registers.pc);
  }

  private fetchWord(): number {
    const low = this.fetchOpcode();
    const high = this.fetchOpcode();
    return ((high << 8) | low) & 0xffff;
  }

  private readMemory8(address: number): number {
    return this.memory.read(address & 0xffff) & 0xff;
  }

  private writeMemory8(address: number, value: number): void {
    this.memory.write(address & 0xffff, value & 0xff);
  }

  private readMemoryWord(address: number): number {
    const low = this.readMemory8(address);
    const high = this.readMemory8(address + 1);
    return ((high << 8) | low) & 0xffff;
  }

  private writeMemoryWord(address: number, value: number): void {
    this.writeMemory8(address, value & 0xff);
    this.writeMemory8(address + 1, (value >> 8) & 0xff);
  }

  private resolvePort(low: number, high: number): number {
    return this.useExtendedPortsSpace ? ((high << 8) | low) & 0xffff : low;
  }

  private readPort(low: number, high: number): number {
    return this.portsSpace.read(this.resolvePort(low, high)) & 0xff;
  }

  private writePort(low: number, high: number, value: number): void {
    this.portsSpace.write(this.resolvePort(low, high), value & 0xff);
  }

  // --- フラグ / 汎用ヘルパ ---

  private setFlag(mask: number, on: boolean): void {
    this.registers.f = on ? this.registers.f | mask : this.registers.f & ~mask;
  }

  private flagOn(mask: number): boolean {
    return (this.registers.f & mask) !== 0;
  }

  /** F3 / F5 を value の bit3 / bit5 に揃える。 */
  private setFlags3and5From(value: number): void {
    this.registers.f = (this.registers.f & ~(Flag3 | Flag5)) | (value & (Flag3 | Flag5));
  }

  /** PUSH と同じ順序 (高位 → 低位) でスタックに書く。 */
  private push16(value: number): void {
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.writeMemory8(this.registers.sp, (value >> 8) & 0xff);
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.writeMemory8(this.registers.sp, value & 0xff);
  }

  private pop16(): number {
    const value = this.readMemoryWord(this.registers.sp);
    this.registers.sp = (this.registers.sp + 2) & 0xffff;
    return value;
  }

  private callTo(address: number): void {
    this.push16(this.registers.pc);
    this.registers.pc = address & 0xffff;
  }

  private retFrom(): void {
    this.registers.pc = this.readMemoryWord(this.registers.sp);
    this.registers.sp = (this.registers.sp + 2) & 0xffff;
  }

  /** 条件コード (0=NZ, 1=Z, 2=NC, 3=C) の真偽。 */
  private conditionByIndex(y: number): boolean {
    switch (y) {
      case 0:
        return !this.flagOn(FlagZF);
      case 1:
        return this.flagOn(FlagZF);
      case 2:
        return !this.flagOn(FlagCF);
      default:
        return this.flagOn(FlagCF);
    }
  }

  /** DD/FD モードで参照するインデックスレジスタ値。 */
  private xyRegister(): number {
    return this.isXyMode ? this.registers.ix : this.registers.iy;
  }

  private setXyRegister(value: number): void {
    if (this.isXyMode) {
      this.registers.ix = value & 0xffff;
    } else {
      this.registers.iy = value & 0xffff;
    }
  }

  /**
   * 8bit レジスタ抽象の読み出し。
   * index 4 / 5 は DD/FD モードでは IXH/IXL (IYH/IYL)、
   * index 6 は (HL) (DD/FD モードでは事前フェッチ済み d の (XY+d)) を指す。
   */
  private readReg8(index: number): number {
    switch (index) {
      case RegB:
        return this.registers.b;
      case RegC:
        return this.registers.c;
      case RegD:
        return this.registers.d;
      case RegE:
        return this.registers.e;
      case RegH:
        return this.isXyMode ? this.registers.ixh : this.registers.h;
      case RegL:
        return this.isXyMode ? this.registers.ixl : this.registers.l;
      case RegHlMem:
        return this.readMemory8(
          this.isXyMode ? (this.xyRegister() + this.xyDisplacement) & 0xffff : this.registers.hl,
        );
      default:
        return this.registers.a;
    }
  }

  /** {@link readReg8} の書き込み側。 */
  private writeReg8(index: number, value: number): void {
    switch (index) {
      case RegB:
        this.registers.b = value & 0xff;
        break;
      case RegC:
        this.registers.c = value & 0xff;
        break;
      case RegD:
        this.registers.d = value & 0xff;
        break;
      case RegE:
        this.registers.e = value & 0xff;
        break;
      case RegH:
        if (this.isXyMode) {
          this.registers.ixh = value;
        } else {
          this.registers.h = value & 0xff;
        }

        break;
      case RegL:
        if (this.isXyMode) {
          this.registers.ixl = value;
        } else {
          this.registers.l = value & 0xff;
        }

        break;
      case RegHlMem:
        this.writeMemory8(
          this.isXyMode ? (this.xyRegister() + this.xyDisplacement) & 0xffff : this.registers.hl,
          value,
        );
        break;
      default:
        this.registers.a = value & 0xff;
        break;
    }
  }

  // --- 命令ディスパッチ ---

  private executeNextOpcode(): number {
    const opcode = this.fetchOpcode();
    switch (opcode) {
      case 0xcb:
        return this.executeCbInstruction();
      case 0xdd:
        return this.executeXyInstruction(true);
      case 0xed:
        return this.executeEdInstruction();
      case 0xfd:
        return this.executeXyInstruction(false);
      default:
        return this.executeMainInstruction(opcode);
    }
  }

  /**
   * メイン命令 (プレフィックス以外) を実行する。
   * 0x40-0xBF の LD / ALU は 8bit レジスタ抽象で DD/FD モードと共用する。
   */
  private executeMainInstruction(opcode: number): number {
    this.incR();
    this.isXyMode = false;

    if (opcode < 0x40) {
      return this.executeMainLow(opcode);
    }

    if (opcode < 0x80) {
      if (opcode === 0x76) {
        // HALT
        this.haltExecuted = true;
        return 4;
      }

      const y = (opcode >> 3) & 7;
      const z = opcode & 7;
      this.writeReg8(y, this.readReg8(z));
      return y === RegHlMem || z === RegHlMem ? 7 : 4;
    }

    if (opcode < 0xc0) {
      const value = this.readReg8(opcode & 7);
      switch ((opcode >> 3) & 7) {
        case 0:
          this.addA(value, false);
          break;
        case 1:
          this.addA(value, true);
          break;
        case 2:
          this.subA(value, false, false);
          break;
        case 3:
          this.subA(value, true, false);
          break;
        case 4:
          this.andA(value);
          break;
        case 5:
          this.xorA(value);
          break;
        case 6:
          this.orA(value);
          break;
        default:
          this.subA(value, false, true);
          break;
      }

      return (opcode & 7) === RegHlMem ? 7 : 4;
    }

    return this.executeMainHigh(opcode);
  }

  /** メイン命令 0x00-0x3F。 */
  private executeMainLow(opcode: number): number {
    switch (opcode) {
      case 0x00: // NOP
        return 4;
      case 0x01: // LD BC,nn
        this.registers.bc = this.fetchWord();
        return 10;
      case 0x02: // LD (BC),A
        this.writeMemory8(this.registers.bc, this.registers.a);
        return 7;
      case 0x03: // INC BC
        this.registers.bc = (this.registers.bc + 1) & 0xffff;
        return 6;
      case 0x04: // INC B
        return this.incReg8(RegB);
      case 0x05: // DEC B
        return this.decReg8(RegB);
      case 0x06: // LD B,n
        this.registers.b = this.fetchOpcode();
        return 7;
      case 0x07: // RLCA
        return this.rotateAccumulator(0);
      case 0x08: // EX AF,AF'
        this.exchangeAf();
        return 4;
      case 0x09: // ADD HL,BC
        return this.addIntoHl(this.registers.bc);
      case 0x0a: // LD A,(BC)
        this.registers.a = this.readMemory8(this.registers.bc);
        return 7;
      case 0x0b: // DEC BC
        this.registers.bc = (this.registers.bc - 1) & 0xffff;
        return 6;
      case 0x0c: // INC C
        return this.incReg8(RegC);
      case 0x0d: // DEC C
        return this.decReg8(RegC);
      case 0x0e: // LD C,n
        this.registers.c = this.fetchOpcode();
        return 7;
      case 0x0f: // RRCA
        return this.rotateAccumulator(1);
      case 0x10: // DJNZ d
        return this.djnz();
      case 0x11: // LD DE,nn
        this.registers.de = this.fetchWord();
        return 10;
      case 0x12: // LD (DE),A
        this.writeMemory8(this.registers.de, this.registers.a);
        return 7;
      case 0x13: // INC DE
        this.registers.de = (this.registers.de + 1) & 0xffff;
        return 6;
      case 0x14: // INC D
        return this.incReg8(RegD);
      case 0x15: // DEC D
        return this.decReg8(RegD);
      case 0x16: // LD D,n
        this.registers.d = this.fetchOpcode();
        return 7;
      case 0x17: // RLA
        return this.rotateAccumulator(2);
      case 0x18: // JR d
        return this.jumpRelative();
      case 0x19: // ADD HL,DE
        return this.addIntoHl(this.registers.de);
      case 0x1a: // LD A,(DE)
        this.registers.a = this.readMemory8(this.registers.de);
        return 7;
      case 0x1b: // DEC DE
        this.registers.de = (this.registers.de - 1) & 0xffff;
        return 6;
      case 0x1c: // INC E
        return this.incReg8(RegE);
      case 0x1d: // DEC E
        return this.decReg8(RegE);
      case 0x1e: // LD E,n
        this.registers.e = this.fetchOpcode();
        return 7;
      case 0x1f: // RRA
        return this.rotateAccumulator(3);
      default:
        return this.executeMainLowHigh(opcode);
    }
  }

  /** メイン命令 0x20-0x3F。 */
  private executeMainLowHigh(opcode: number): number {
    switch (opcode) {
      case 0x20: // JR NZ,d
        return this.jumpRelativeIf(this.conditionByIndex(0));
      case 0x21: // LD HL,nn
        this.registers.hl = this.fetchWord();
        return 10;
      case 0x22: // LD (nn),HL
        this.writeMemoryWord(this.fetchWord(), this.registers.hl);
        return 16;
      case 0x23: // INC HL
        this.registers.hl = (this.registers.hl + 1) & 0xffff;
        return 6;
      case 0x24: // INC H
        return this.incReg8(RegH);
      case 0x25: // DEC H
        return this.decReg8(RegH);
      case 0x26: // LD H,n
        this.registers.h = this.fetchOpcode();
        return 7;
      case 0x27: // DAA
        return this.daa();
      case 0x28: // JR Z,d
        return this.jumpRelativeIf(this.conditionByIndex(1));
      case 0x29: // ADD HL,HL
        return this.addIntoHl(this.registers.hl);
      case 0x2a: // LD HL,(nn)
        this.registers.hl = this.readMemoryWord(this.fetchWord());
        return 16;
      case 0x2b: // DEC HL
        this.registers.hl = (this.registers.hl - 1) & 0xffff;
        return 6;
      case 0x2c: // INC L
        return this.incReg8(RegL);
      case 0x2d: // DEC L
        return this.decReg8(RegL);
      case 0x2e: // LD L,n
        this.registers.l = this.fetchOpcode();
        return 7;
      case 0x2f: // CPL
        this.registers.a ^= 0xff;
        this.setFlag(FlagHF, true);
        this.setFlag(FlagNF, true);
        this.setFlags3and5From(this.registers.a);
        return 4;
      case 0x30: // JR NC,d
        return this.jumpRelativeIf(this.conditionByIndex(2));
      case 0x31: // LD SP,nn
        this.registers.sp = this.fetchWord();
        return 10;
      case 0x32: // LD (nn),A
        this.writeMemory8(this.fetchWord(), this.registers.a);
        return 13;
      case 0x33: // INC SP
        this.registers.sp = (this.registers.sp + 1) & 0xffff;
        return 6;
      case 0x34: // INC (HL)
        return this.incMemoryAt(this.registers.hl);
      case 0x35: // DEC (HL)
        return this.decMemoryAt(this.registers.hl);
      case 0x36: // LD (HL),n
        this.writeMemory8(this.registers.hl, this.fetchOpcode());
        return 10;
      case 0x37: // SCF
        this.registers.f = (this.registers.f & 0xed) | FlagCF;
        this.setFlags3and5From(this.registers.a);
        return 4;
      case 0x38: // JR C,d
        return this.jumpRelativeIf(this.conditionByIndex(3));
      case 0x39: // ADD HL,SP
        return this.addIntoHl(this.registers.sp);
      case 0x3a: // LD A,(nn)
        this.registers.a = this.readMemory8(this.fetchWord());
        return 13;
      case 0x3b: // DEC SP
        this.registers.sp = (this.registers.sp - 1) & 0xffff;
        return 6;
      case 0x3c: // INC A
        return this.incReg8(RegA);
      case 0x3d: // DEC A
        return this.decReg8(RegA);
      case 0x3e: // LD A,n
        this.registers.a = this.fetchOpcode();
        return 7;
      default: // 0x3F: CCF
        this.setFlag(FlagNF, false);
        this.setFlag(FlagHF, this.flagOn(FlagCF));
        this.setFlag(FlagCF, !this.flagOn(FlagCF));
        this.setFlags3and5From(this.registers.a);
        return 4;
    }
  }

  /** メイン命令 0xC0-0xFF。 */
  private executeMainHigh(opcode: number): number {
    switch (opcode) {
      case 0xc0: // RET NZ
        return this.returnIf(this.conditionByIndex(0));
      case 0xc1: // POP BC
        this.registers.bc = this.pop16();
        return 10;
      case 0xc2: // JP NZ,nn
        return this.jumpToIf(this.conditionByIndex(0));
      case 0xc3: // JP nn
        this.registers.pc = this.fetchWord();
        return 10;
      case 0xc4: // CALL NZ,nn
        return this.callIf(this.conditionByIndex(0));
      case 0xc5: // PUSH BC
        this.push16(this.registers.bc);
        return 11;
      case 0xc6: // ADD A,n
        this.addA(this.fetchOpcode(), false);
        return 7;
      case 0xc7: // RST 00h
        return this.rst(0x00);
      case 0xc8: // RET Z
        return this.returnIf(this.conditionByIndex(1));
      case 0xc9: // RET
        this.retFrom();
        return 10;
      case 0xca: // JP Z,nn
        return this.jumpToIf(this.conditionByIndex(1));
      case 0xcc: // CALL Z,nn
        return this.callIf(this.conditionByIndex(1));
      case 0xcd: // CALL nn
        this.callTo(this.fetchWord());
        return 17;
      case 0xce: // ADC A,n
        this.addA(this.fetchOpcode(), true);
        return 7;
      case 0xcf: // RST 08h
        return this.rst(0x08);
      case 0xd0: // RET NC
        return this.returnIf(this.conditionByIndex(2));
      case 0xd1: // POP DE
        this.registers.de = this.pop16();
        return 10;
      case 0xd2: // JP NC,nn
        return this.jumpToIf(this.conditionByIndex(2));
      case 0xd3: // OUT (n),A
        this.writePort(this.fetchOpcode(), this.registers.a, this.registers.a);
        return 11;
      case 0xd4: // CALL NC,nn
        return this.callIf(this.conditionByIndex(2));
      case 0xd5: // PUSH DE
        this.push16(this.registers.de);
        return 11;
      case 0xd6: // SUB n
        this.subA(this.fetchOpcode(), false, false);
        return 7;
      case 0xd7: // RST 10h
        return this.rst(0x10);
      case 0xd8: // RET C
        return this.returnIf(this.conditionByIndex(3));
      case 0xd9: // EXX
        this.exx();
        return 4;
      case 0xda: // JP C,nn
        return this.jumpToIf(this.conditionByIndex(3));
      case 0xdb: // IN A,(n)
        this.registers.a = this.readPort(this.fetchOpcode(), this.registers.a);
        return 11;
      case 0xdc: // CALL C,nn
        return this.callIf(this.conditionByIndex(3));
      case 0xde: // SBC A,n
        this.subA(this.fetchOpcode(), true, false);
        return 7;
      default:
        return this.executeMainHighHigh(opcode);
    }
  }

  /** メイン命令 0xE0-0xFF。 */
  private executeMainHighHigh(opcode: number): number {
    switch (opcode) {
      case 0xe0: // RET PO
        return this.returnIf(!this.flagOn(FlagPF));
      case 0xe1: // POP HL
        this.registers.hl = this.pop16();
        return 10;
      case 0xe2: // JP PO,nn
        return this.jumpToIf(!this.flagOn(FlagPF));
      case 0xe3: // EX (SP),HL
        return this.exchangeWithStack();
      case 0xe4: // CALL PO,nn
        return this.callIf(!this.flagOn(FlagPF));
      case 0xe5: // PUSH HL
        this.push16(this.registers.hl);
        return 11;
      case 0xe6: // AND n
        this.andA(this.fetchOpcode());
        return 7;
      case 0xe7: // RST 20h
        return this.rst(0x20);
      case 0xe8: // RET PE
        return this.returnIf(!this.flagOn(FlagPF));
      case 0xe9: // JP (HL)
        this.registers.pc = this.registers.hl;
        return 4;
      case 0xea: // JP PE,nn
        return this.jumpToIf(!this.flagOn(FlagPF));
      case 0xeb: // EX DE,HL
        this.exchangeDeHl();
        return 4;
      case 0xec: // CALL PE,nn
        return this.callIf(!this.flagOn(FlagPF));
      case 0xee: // XOR n
        this.xorA(this.fetchOpcode());
        return 7;
      case 0xef: // RST 28h
        return this.rst(0x28);
      case 0xf0: // RET P
        return this.returnIf(!this.flagOn(FlagSF));
      case 0xf1: // POP AF
        this.registers.af = this.pop16();
        return 10;
      case 0xf2: // JP P,nn
        return this.jumpToIf(!this.flagOn(FlagSF));
      case 0xf3: // DI
        this.registers.iff1 = false;
        this.registers.iff2 = false;
        return 4;
      case 0xf4: // CALL P,nn
        return this.callIf(!this.flagOn(FlagSF));
      case 0xf5: // PUSH AF
        this.push16(this.registers.af);
        return 11;
      case 0xf6: // OR n
        this.orA(this.fetchOpcode());
        return 7;
      case 0xf7: // RST 30h
        return this.rst(0x30);
      case 0xf8: // RET M
        return this.returnIf(this.flagOn(FlagSF));
      case 0xf9: // LD SP,HL
        this.registers.sp = this.registers.hl;
        return 6;
      case 0xfa: // JP M,nn
        return this.jumpToIf(this.flagOn(FlagSF));
      case 0xfb: // EI
        this.registers.iff1 = true;
        this.registers.iff2 = true;
        return 4;
      case 0xfc: // CALL M,nn
        return this.callIf(this.flagOn(FlagSF));
      case 0xfe: // CP n
        this.subA(this.fetchOpcode(), false, true);
        return 7;
      default: // 0xFF: RST 38h
        return this.rst(0x38);
    }
  }

  // --- CB 命令 (ロテート / シフト / BIT / RES / SET) ---

  private executeCbInstruction(): number {
    this.incR();
    this.incR();
    this.isXyMode = false;

    const opcode = this.fetchOpcode();
    const y = (opcode >> 3) & 7;
    const z = opcode & 7;

    if (opcode < 0x40) {
      // ロテート / シフト (z=6 は (HL))
      const value = this.readReg8(z);
      const result = this.rotateValue(y, value);
      this.writeReg8(z, result);
      return z === RegHlMem ? 15 : 8;
    }

    if (opcode < 0x80) {
      // BIT b,r
      const bitValue = (this.readReg8(z) >> y) & 1;
      this.setFlag(FlagZF, bitValue === 0);
      this.setFlag(FlagPF, bitValue === 0);
      this.setFlag(FlagSF, false);
      this.setFlag(FlagHF, true);
      this.setFlag(FlagNF, false);
      return z === RegHlMem ? 12 : 8;
    }

    // RES / SET (z=6 は (HL))
    const value = this.readReg8(z);
    const bitMask = 1 << y;
    const result =
      opcode < 0xc0 ? value & ~bitMask : value | bitMask;
    this.writeReg8(z, result & 0xff);
    return z === RegHlMem ? 15 : 8;
  }

  /**
   * CB のロテート / シフト (kind: 0=RLC, 1=RRC, 2=RL, 3=RR,
   * 4=SLA, 5=SRA, 6=SLL (未文書), 7=SRL)。
   */
  private rotateValue(kind: number, value: number): number {
    const carry = this.flagOn(FlagCF) ? 1 : 0;
    let result: number;
    let carryOut: boolean;
    switch (kind) {
      case 0: // RLC
        result = ((value << 1) | (value >> 7)) & 0xff;
        carryOut = (value & 0x80) !== 0;
        break;
      case 1: // RRC
        result = ((value >> 1) | (value << 7)) & 0xff;
        carryOut = (value & 0x01) !== 0;
        break;
      case 2: // RL
        result = ((value << 1) | carry) & 0xff;
        carryOut = (value & 0x80) !== 0;
        break;
      case 3: // RR
        result = ((value >> 1) | (carry << 7)) & 0xff;
        carryOut = (value & 0x01) !== 0;
        break;
      case 4: // SLA
        result = (value << 1) & 0xff;
        carryOut = (value & 0x80) !== 0;
        break;
      case 5: // SRA
        result = ((value >> 1) | (value & 0x80)) & 0xff;
        carryOut = (value & 0x01) !== 0;
        break;
      case 6: // SLL (未文書: 左シフトして LSB=1)
        result = ((value << 1) | 0x01) & 0xff;
        carryOut = (value & 0x80) !== 0;
        break;
      default: // SRL
        result = (value >> 1) & 0xff;
        carryOut = (value & 0x01) !== 0;
        break;
    }

    this.setFlag(FlagCF, carryOut);
    this.setFlag(FlagHF, false);
    this.setFlag(FlagNF, false);
    this.setFlags3and5From(result);
    this.setFlag(FlagSF, (result & 0x80) !== 0);
    this.setFlag(FlagZF, result === 0);
    this.setFlag(FlagPF, ParityTable[result] !== 0);
    return result;
  }

  /** メイン命令の A 専用ロテート (0=RLCA, 1=RRCA, 2=RLA, 3=RRA)。SF/ZF/PF は不変。 */
  private rotateAccumulator(kind: number): number {
    const a = this.registers.a;
    const carry = this.flagOn(FlagCF) ? 1 : 0;
    let result: number;
    let carryOut: boolean;
    switch (kind) {
      case 0: // RLCA
        result = ((a << 1) | (a >> 7)) & 0xff;
        carryOut = (a & 0x80) !== 0;
        break;
      case 1: // RRCA
        result = ((a >> 1) | (a << 7)) & 0xff;
        carryOut = (a & 0x01) !== 0;
        break;
      case 2: // RLA
        result = ((a << 1) | carry) & 0xff;
        carryOut = (a & 0x80) !== 0;
        break;
      default: // RRA
        result = ((a >> 1) | (carry << 7)) & 0xff;
        carryOut = (a & 0x01) !== 0;
        break;
    }

    this.registers.a = result;
    this.setFlag(FlagCF, carryOut);
    this.setFlag(FlagHF, false);
    this.setFlag(FlagNF, false);
    this.setFlags3and5From(result);
    return 4;
  }

  // --- ED 命令 (I/O / 16bit 演算 / NEG / IM / ブロック転送) ---

  private executeEdInstruction(): number {
    this.incR();
    this.incR();
    this.isXyMode = false;

    const opcode = this.fetchOpcode();
    const y = (opcode >> 3) & 7;
    const z = opcode & 7;

    if (opcode >= 0x40 && opcode <= 0x7f) {
      switch (z) {
        case 0: // IN r,(C) — y=6 は IN F,(C)
          return this.inFromC(y === RegHlMem ? -1 : y);
        case 1: // OUT (C),r — y=6 は OUT (C),0
          this.outToC(y);
          return 12;
        case 2: // SBC HL,rr (y 偶数) / ADC HL,rr (y 奇数)
          return this.sbcAdcHl(this.registerPairByIndex(y >> 1), (y & 1) === 0);
        case 3: { // LD (nn),rr / LD rr,(nn)
          const address = this.fetchWord();
          if ((y & 1) === 0) {
            this.writeMemoryWord(address, this.registerPairByIndex(y >> 1));
          } else {
            this.setRegisterPairByIndex(y >> 1, this.readMemoryWord(address));
          }

          return 20;
        }

        case 4: // NEG
          return this.neg();
        case 5: // RETN / RETI
          this.retFrom();
          this.registers.iff1 = this.registers.iff2;
          return 14;
        case 6: // IM 0 / 1 / 2
          this.registers.interruptMode =
            y === 0 || y === 1 || y === 4 || y === 5 ? 0 : y === 2 || y === 6 ? 1 : 2;
          return 8;
        default: // z=7: LD I,A / LD R,A / LD A,I / LD A,R / RRD / RLD / NOP2
          switch (y) {
            case 0: // LD I,A
              this.registers.i = this.registers.a;
              return 9;
            case 1: // LD R,A
              this.registers.r = this.registers.a;
              return 9;
            case 2: // LD A,I
              return this.loadAFromIr(this.registers.i);
            case 3: // LD A,R
              return this.loadAFromIr(this.registers.r);
            case 4: // RRD
              return this.rotateDecimal(true);
            case 5: // RLD
              return this.rotateDecimal(false);
            default: // NOP2 (未定義扱い)
              return 8;
          }
      }
    }

    if (opcode >= 0xa0 && opcode <= 0xbf) {
      switch (opcode) {
        case 0xa0:
          return this.blockLoad(1, false);
        case 0xa8:
          return this.blockLoad(-1, false);
        case 0xb0:
          return this.blockLoad(1, true);
        case 0xb8:
          return this.blockLoad(-1, true);
        case 0xa1:
          return this.blockCompare(1, false);
        case 0xa9:
          return this.blockCompare(-1, false);
        case 0xb1:
          return this.blockCompare(1, true);
        case 0xb9:
          return this.blockCompare(-1, true);
        case 0xa2:
          return this.blockIn(1, false);
        case 0xaa:
          return this.blockIn(-1, false);
        case 0xb2:
          return this.blockIn(1, true);
        case 0xba:
          return this.blockIn(-1, true);
        case 0xa3:
          return this.blockOut(1, false);
        case 0xab:
          return this.blockOut(-1, false);
        case 0xb3:
          return this.blockOut(1, true);
        default: // 0xBB: OTDR
          return this.blockOut(-1, true);
      }
    }

    // 未定義 ED 命令は 8T の NOP (2 バイト目はフェッチ済み)
    return 8;
  }

  /** IN r,(C) / IN F,(C) (index = -1)。CF は不変。 */
  private inFromC(index: number): number {
    const value = this.readPort(this.registers.c, this.registers.b);
    if (index >= 0) {
      this.writeReg8(index, value);
    }

    this.setFlag(FlagSF, (value & 0x80) !== 0);
    this.setFlag(FlagZF, value === 0);
    this.setFlag(FlagHF, false);
    this.setFlag(FlagNF, false);
    this.setFlag(FlagPF, ParityTable[value] !== 0);
    this.setFlags3and5From(value);
    return 12;
  }

  /** OUT (C),r / OUT (C),0 (index = RegHlMem)。 */
  private outToC(index: number): void {
    const value = index === RegHlMem ? 0 : this.readReg8(index);
    this.writePort(this.registers.c, this.registers.b, value);
  }

  /** 16bit レジスタペア (0=BC, 1=DE, 2=HL, 3=SP) の読み出し。 */
  private registerPairByIndex(index: number): number {
    switch (index) {
      case 0:
        return this.registers.bc;
      case 1:
        return this.registers.de;
      case 2:
        return this.registers.hl;
      default:
        return this.registers.sp;
    }
  }

  /** 16bit レジスタペア (0=BC, 1=DE, 2=HL, 3=SP) への書き込み。 */
  private setRegisterPairByIndex(index: number, value: number): void {
    switch (index) {
      case 0:
        this.registers.bc = value & 0xffff;
        break;
      case 1:
        this.registers.de = value & 0xffff;
        break;
      case 2:
        this.registers.hl = value & 0xffff;
        break;
      default:
        this.registers.sp = value & 0xffff;
        break;
    }
  }

  /** ADC HL,rr (subtract = false) / SBC HL,rr (subtract = true)。SF/ZF はここでのみ設定する。 */
  private sbcAdcHl(value: number, subtract: boolean): number {
    const oldValue = this.registers.hl;
    const carry = this.flagOn(FlagCF) ? 1 : 0;
    const newValueInt = subtract ? oldValue - value - carry : oldValue + value + carry;
    const newValue = newValueInt & 0xffff;
    this.registers.hl = newValue;

    const halfCarry = ((oldValue ^ newValue ^ value) & 0x1000) !== 0;
    const carryOut = newValueInt < 0 || newValueInt > 0xffff;
    const overflow =
      subtract
        ? ((oldValue ^ value) & (oldValue ^ newValue) & 0x8000) !== 0
        : (((oldValue ^ value ^ 0x8000) & (value ^ newValue)) & 0x8000) !== 0;

    this.registers.f =
      ((newValue & 0x8000) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (halfCarry ? FlagHF : 0) |
      (carryOut ? FlagCF : 0) |
      (overflow ? FlagPF : 0) |
      (subtract ? FlagNF : 0) |
      (((newValue >> 8) & 0xff) & (Flag3 | Flag5));
    return 15;
  }

  /** LD A,I / LD A,R。PV は IFF2 に従う。 */
  private loadAFromIr(value: number): number {
    this.registers.a = value & 0xff;
    const iff2 = this.registers.iff2;
    this.registers.f =
      ((value & 0x80) !== 0 ? FlagSF : 0) |
      (value === 0 ? FlagZF : 0) |
      (iff2 ? FlagPF : 0) |
      (value & (Flag3 | Flag5));
    return 9;
  }

  /** NEG。 */
  private neg(): number {
    const oldValue = this.registers.a;
    const newValue = (-oldValue) & 0xff;
    this.registers.a = newValue;
    this.registers.f =
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (((oldValue ^ newValue) & 0x10) !== 0 ? FlagHF : 0) |
      (oldValue === 0x80 ? FlagPF : 0) |
      FlagNF |
      (oldValue !== 0 ? FlagCF : 0) |
      (newValue & (Flag3 | Flag5));
    return 8;
  }

  /** RRD (right = true) / RLD。 */
  private rotateDecimal(right: boolean): number {
    const address = this.registers.hl;
    const aValue = this.registers.a;
    const contents = this.readMemory8(address);
    let newA: number;
    let newContents: number;
    if (right) {
      newA = (aValue & 0xf0) | (contents & 0x0f);
      newContents = ((contents >> 4) & 0x0f) | ((aValue << 4) & 0xf0);
    } else {
      newA = (aValue & 0xf0) | ((contents >> 4) & 0x0f);
      newContents = ((contents << 4) & 0xf0) | (aValue & 0x0f);
    }

    this.registers.a = newA;
    this.writeMemory8(address, newContents);
    this.registers.f =
      ((newA & 0x80) !== 0 ? FlagSF : 0) |
      (newA === 0 ? FlagZF : 0) |
      (ParityTable[newA] !== 0 ? FlagPF : 0) |
      (newA & (Flag3 | Flag5));
    return 18;
  }

  // --- ED ブロック転送 / 検索 / I/O 命令 ---

  /** LDI / LDD / LDIR / LDDR。 */
  private blockLoad(step: number, repeated: boolean): number {
    const value = this.readMemory8(this.registers.hl);
    this.writeMemory8(this.registers.de, value);
    this.registers.hl = (this.registers.hl + step) & 0xffff;
    this.registers.de = (this.registers.de + step) & 0xffff;
    const counter = (this.registers.bc - 1) & 0xffff;
    this.registers.bc = counter;

    // HF = NF = 0、PF = (BC != 0)、F3/F5 = (value + A) の bit3 / bit1
    const valuePlusA = (value + this.registers.a) & 0xff;
    this.registers.f =
      (this.registers.f & (FlagSF | FlagZF | FlagCF)) |
      (counter !== 0 ? FlagPF : 0) |
      ((valuePlusA & 0x08) !== 0 ? Flag3 : 0) |
      ((valuePlusA & 0x02) !== 0 ? Flag5 : 0);

    if (repeated && counter !== 0) {
      this.registers.pc = (this.registers.pc - 2) & 0xffff;
      return 21;
    }

    return 16;
  }

  /** CPI / CPD / CPIR / CPDR。 */
  private blockCompare(step: number, repeated: boolean): number {
    const value = this.readMemory8(this.registers.hl);
    const oldValue = this.registers.a;
    const newValue = (oldValue - value) & 0xff;
    this.registers.hl = (this.registers.hl + step) & 0xffff;
    const counter = (this.registers.bc - 1) & 0xffff;
    this.registers.bc = counter;

    const halfCarry = ((oldValue ^ newValue ^ value) & 0x10) !== 0;
    // F3/F5 は (new - HF) の bit3 / bit1
    const flags3and5Source = (newValue - (halfCarry ? FlagHF : 0)) & 0xff;
    this.registers.f =
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (halfCarry ? FlagHF : 0) |
      (counter !== 0 ? FlagPF : 0) |
      FlagNF |
      ((flags3and5Source & 0x08) !== 0 ? Flag3 : 0) |
      ((flags3and5Source & 0x02) !== 0 ? Flag5 : 0);

    if (repeated && counter !== 0 && newValue !== 0) {
      this.registers.pc = (this.registers.pc - 2) & 0xffff;
      return 21;
    }

    return 16;
  }

  /** INI / IND / INIR / INDR。H / C / P/V は不変 (Z80dotNet 仕様)。 */
  private blockIn(step: number, repeated: boolean): number {
    const value = this.readPort(this.registers.c, this.registers.b);
    this.writeMemory8(this.registers.hl, value);
    this.registers.hl = (this.registers.hl + step) & 0xffff;
    const counter = (this.registers.b - 1) & 0xff;
    this.registers.b = counter;

    this.setFlag(FlagZF, counter === 0);
    this.setFlag(FlagNF, true);
    this.setFlag(FlagSF, (counter & 0x80) !== 0);
    this.setFlags3and5From(counter);

    if (repeated && counter !== 0) {
      this.registers.pc = (this.registers.pc - 2) & 0xffff;
      return 21;
    }

    return 16;
  }

  /** OUTI / OUTD / OTIR / OTDR。H / C / P/V は不変 (Z80dotNet 仕様)。 */
  private blockOut(step: number, repeated: boolean): number {
    const value = this.readMemory8(this.registers.hl);
    this.writePort(this.registers.c, this.registers.b, value);
    this.registers.hl = (this.registers.hl + step) & 0xffff;
    const counter = (this.registers.b - 1) & 0xff;
    this.registers.b = counter;

    this.setFlag(FlagZF, counter === 0);
    this.setFlag(FlagNF, true);
    this.setFlag(FlagSF, (counter & 0x80) !== 0);
    this.setFlags3and5From(counter);

    if (repeated && counter !== 0) {
      this.registers.pc = (this.registers.pc - 2) & 0xffff;
      return 21;
    }

    return 16;
  }

  // --- 8bit ALU / INC / DEC / DAA ---

  /** ADD A,r / ADC A,r。 */
  private addA(value: number, withCarry: boolean): void {
    const oldValue = this.registers.a;
    const carry = withCarry && this.flagOn(FlagCF) ? 1 : 0;
    const newValueInt = oldValue + value + carry;
    const newValue = newValueInt & 0xff;
    this.registers.a = newValue;

    this.registers.f =
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (((oldValue ^ newValue ^ value) & 0x10) !== 0 ? FlagHF : 0) |
      (newValueInt > 0xff ? FlagCF : 0) |
      ((((oldValue ^ value ^ 0x80) & (value ^ newValue)) & 0x80) !== 0 ? FlagPF : 0) |
      (newValue & (Flag3 | Flag5));
  }

  /** SUB / SBC / CP (compareOnly = true で CP)。 */
  private subA(value: number, withCarry: boolean, compareOnly: boolean): void {
    const oldValue = this.registers.a;
    const carry = withCarry && this.flagOn(FlagCF) ? 1 : 0;
    const newValueInt = oldValue - value - carry;
    const newValue = newValueInt & 0xff;
    if (!compareOnly) {
      this.registers.a = newValue;
    }

    this.registers.f =
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (((oldValue ^ newValue ^ value) & 0x10) !== 0 ? FlagHF : 0) |
      (newValueInt < 0 ? FlagCF : 0) |
      ((((oldValue ^ value) & (oldValue ^ newValue)) & 0x80) !== 0 ? FlagPF : 0) |
      FlagNF |
      // CP は F3/F5 がオペランド側から立つ
      ((compareOnly ? value : newValue) & (Flag3 | Flag5));
  }

  private andA(value: number): void {
    const newValue = this.registers.a & value;
    this.registers.a = newValue;
    this.registers.f =
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      FlagHF |
      (ParityTable[newValue] !== 0 ? FlagPF : 0) |
      (newValue & (Flag3 | Flag5));
  }

  private xorA(value: number): void {
    const newValue = (this.registers.a ^ value) & 0xff;
    this.registers.a = newValue;
    this.orXorFlags(newValue);
  }

  private orA(value: number): void {
    const newValue = (this.registers.a | value) & 0xff;
    this.registers.a = newValue;
    this.orXorFlags(newValue);
  }

  private orXorFlags(newValue: number): void {
    this.registers.f =
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (ParityTable[newValue] !== 0 ? FlagPF : 0) |
      (newValue & (Flag3 | Flag5));
  }

  /** INC 後の共通フラグ更新 (CF は保持)。 */
  private setIncFlags(newValue: number): void {
    this.registers.f =
      (this.registers.f & FlagCF) |
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      ((newValue & 0x0f) === 0 ? FlagHF : 0) |
      (newValue === 0x80 ? FlagPF : 0) |
      (newValue & (Flag3 | Flag5));
  }

  private incReg8(index: number): number {
    const newValue = (this.readReg8(index) + 1) & 0xff;
    this.writeReg8(index, newValue);
    this.setIncFlags(newValue);
    return 4;
  }

  private decReg8(index: number): number {
    const newValue = (this.readReg8(index) - 1) & 0xff;
    this.writeReg8(index, newValue);
    this.registers.f =
      (this.registers.f & FlagCF) |
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      ((newValue & 0x0f) === 0x0f ? FlagHF : 0) |
      (newValue === 0x7f ? FlagPF : 0) |
      FlagNF |
      (newValue & (Flag3 | Flag5));
    return 4;
  }

  private incMemoryAt(address: number): number {
    const newValue = (this.readMemory8(address) + 1) & 0xff;
    this.writeMemory8(address, newValue);
    this.setIncFlags(newValue);
    return 11;
  }

  private decMemoryAt(address: number): number {
    const newValue = (this.readMemory8(address) - 1) & 0xff;
    this.writeMemory8(address, newValue);
    this.registers.f =
      (this.registers.f & FlagCF) |
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      ((newValue & 0x0f) === 0x0f ? FlagHF : 0) |
      (newValue === 0x7f ? FlagPF : 0) |
      FlagNF |
      (newValue & (Flag3 | Flag5));
    return 11;
  }

  /** DAA (MAME 由来のアルゴリズム、NF は不変)。 */
  private daa(): number {
    const oldValue = this.registers.a;
    let newValue = oldValue;
    const subtracting = this.flagOn(FlagNF);

    if (this.flagOn(FlagHF) || (oldValue & 0x0f) > 9) {
      newValue = (newValue + (subtracting ? -0x06 : 0x06)) & 0xff;
    }

    if (this.flagOn(FlagCF) || oldValue > 0x99) {
      newValue = (newValue + (subtracting ? -0x60 : 0x60)) & 0xff;
    }

    this.registers.a = newValue;
    this.registers.f =
      (this.flagOn(FlagCF) || oldValue > 0x99 ? FlagCF : 0) |
      (((oldValue ^ newValue) & 0x10) !== 0 ? FlagHF : 0) |
      ((newValue & 0x80) !== 0 ? FlagSF : 0) |
      (newValue === 0 ? FlagZF : 0) |
      (ParityTable[newValue] !== 0 ? FlagPF : 0) |
      (this.registers.f & FlagNF) |
      (newValue & (Flag3 | Flag5));
    return 4;
  }

  /** ADD HL,rr。SF / ZF / PF は保持。 */
  private addIntoHl(value: number): number {
    const oldValue = this.registers.hl;
    const newValueInt = oldValue + value;
    const newValue = newValueInt & 0xffff;
    this.registers.hl = newValue;

    this.registers.f =
      (this.registers.f & (FlagSF | FlagZF | FlagPF)) |
      (((oldValue ^ newValue ^ value) & 0x1000) !== 0 ? FlagHF : 0) |
      (newValueInt > 0xffff ? FlagCF : 0) |
      (((newValue >> 8) & 0xff) & (Flag3 | Flag5));
    return 11;
  }

  // --- ジャンプ / コール / EX ---

  /** JP cc,nn (不成立でも 10T)。 */
  private jumpToIf(condition: boolean): number {
    const address = this.fetchWord();
    if (condition) {
      this.registers.pc = address;
    }

    return 10;
  }

  /** JR d (無条件)。 */
  private jumpRelative(): number {
    const offset = this.fetchOpcode();
    this.registers.pc = (this.registers.pc + asSignedByte(offset)) & 0xffff;
    return 12;
  }

  /** JR cc,d (不成立 7T / 成立 12T)。 */
  private jumpRelativeIf(condition: boolean): number {
    const offset = this.fetchOpcode();
    if (!condition) {
      return 7;
    }

    this.registers.pc = (this.registers.pc + asSignedByte(offset)) & 0xffff;
    return 12;
  }

  /** RET cc (不成立 5T / 成立 11T)。 */
  private returnIf(condition: boolean): number {
    if (!condition) {
      return 5;
    }

    this.retFrom();
    return 11;
  }

  /** CALL cc,nn (不成立 10T / 成立 17T)。 */
  private callIf(condition: boolean): number {
    const address = this.fetchWord();
    if (!condition) {
      return 10;
    }

    this.callTo(address);
    return 17;
  }

  /** RST p。 */
  private rst(address: number): number {
    this.push16(this.registers.pc);
    this.registers.pc = address;
    return 11;
  }

  /** DJNZ d (B が 0 になったら 8T / それ以外 13T)。 */
  private djnz(): number {
    const offset = this.fetchOpcode();
    const oldValue = this.registers.b;
    this.registers.b = (oldValue - 1) & 0xff;
    if (oldValue === 1) {
      return 8;
    }

    this.registers.pc = (this.registers.pc + asSignedByte(offset)) & 0xffff;
    return 13;
  }

  private exchangeAf(): void {
    const temp = this.registers.af;
    this.registers.af = this.registers.alternate.af;
    this.registers.alternate.af = temp;
  }

  private exchangeDeHl(): void {
    const temp = this.registers.de;
    this.registers.de = this.registers.hl;
    this.registers.hl = temp;
  }

  /** EX (SP),HL。 */
  private exchangeWithStack(): number {
    const sp = this.registers.sp;
    const temp = this.readMemoryWord(sp);
    this.writeMemoryWord(sp, this.registers.hl);
    this.registers.hl = temp;
    return 19;
  }

  private exx(): void {
    const alt = this.registers.alternate;
    const tempBc = this.registers.bc;
    const tempDe = this.registers.de;
    const tempHl = this.registers.hl;
    this.registers.bc = alt.bc;
    this.registers.de = alt.de;
    this.registers.hl = alt.hl;
    alt.bc = tempBc;
    alt.de = tempDe;
    alt.hl = tempHl;
  }

  // --- DD / FD 命令 (IX / IY) ---

  /** DD / FD プレフィックスを処理する (isIx = DD か FD か)。 */
  private executeXyInstruction(isIx: boolean): number {
    this.incR();
    this.isXyMode = isIx;

    const opcode = this.peekOpcode();
    if (opcode === 0xcb) {
      this.incR();
      this.fetchOpcode(); // 0xCB を消費
      this.xyDisplacement = asSignedByte(this.fetchOpcode());
      const cbOpcode = this.fetchOpcode();
      const cycles = this.executeXyCbInstruction(cbOpcode);
      this.isXyMode = false;
      return cycles;
    }

    if (XyInstructionOpcodes.has(opcode)) {
      this.incR();
      this.fetchOpcode();
      const cycles = this.executeXyCore(opcode);
      this.isXyMode = false;
      return cycles;
    }

    // 未定義オペコード: 2 バイト目をフェッチせず NOP (4T) として扱う
    this.isXyMode = false;
    return 4;
  }

  /** DD/FD 命令の (XY+d) 実アドレス (d は事前フェッチ済み)。 */
  private xyAddress(): number {
    return (this.xyRegister() + this.xyDisplacement) & 0xffff;
  }

  /** ADD XY,rr。 */
  private addIntoXy(value: number): number {
    const oldValue = this.xyRegister();
    const newValueInt = oldValue + value;
    const newValue = newValueInt & 0xffff;
    this.setXyRegister(newValue);

    this.registers.f =
      (this.registers.f & (FlagSF | FlagZF | FlagPF)) |
      (((oldValue ^ newValue ^ value) & 0x1000) !== 0 ? FlagHF : 0) |
      (newValueInt > 0xffff ? FlagCF : 0) |
      (((newValue >> 8) & 0xff) & (Flag3 | Flag5));
    return 15;
  }

  /** DD/FD 命令本体 (定義済みオペコードのみ)。 */
  private executeXyCore(opcode: number): number {
    const y = (opcode >> 3) & 7;
    const z = opcode & 7;

    if (opcode < 0x40) {
      switch (opcode) {
        case 0x09: // ADD XY,BC
          return this.addIntoXy(this.registerPairByIndex(0));
        case 0x19: // ADD XY,DE
          return this.addIntoXy(this.registerPairByIndex(1));
        case 0x21: // LD XY,nn
          this.setXyRegister(this.fetchWord());
          return 10;
        case 0x22: // LD (nn),XY
          this.writeMemoryWord(this.fetchWord(), this.xyRegister());
          return 20;
        case 0x23: // INC XY
          this.setXyRegister((this.xyRegister() + 1) & 0xffff);
          return 10;
        case 0x24: // INC XYH (未文書)
          return this.incReg8(RegH);
        case 0x25: // DEC XYH (未文書)
          return this.decReg8(RegH);
        case 0x26: // LD XYH,n (未文書)
          this.writeReg8(RegH, this.fetchOpcode());
          return 11;
        case 0x29: // ADD XY,XY
          return this.addIntoXy(this.xyRegister());
        case 0x2a: // LD XY,(nn)
          this.setXyRegister(this.readMemoryWord(this.fetchWord()));
          return 20;
        case 0x2b: // DEC XY
          this.setXyRegister((this.xyRegister() - 1) & 0xffff);
          return 10;
        case 0x2c: // INC XYL (未文書)
          return this.incReg8(RegL);
        case 0x2d: // DEC XYL (未文書)
          return this.decReg8(RegL);
        case 0x2e: // LD XYL,n (未文書)
          this.writeReg8(RegL, this.fetchOpcode());
          return 11;
        case 0x34: { // INC (XY+d)
          this.xyDisplacement = asSignedByte(this.fetchOpcode());
          const address = this.xyAddress();
          const newValue = (this.readMemory8(address) + 1) & 0xff;
          this.writeMemory8(address, newValue);
          this.setIncFlags(newValue);
          return 23;
        }

        case 0x35: { // DEC (XY+d)
          this.xyDisplacement = asSignedByte(this.fetchOpcode());
          const address = this.xyAddress();
          const newValue = (this.readMemory8(address) - 1) & 0xff;
          this.writeMemory8(address, newValue);
          this.registers.f =
            (this.registers.f & FlagCF) |
            ((newValue & 0x80) !== 0 ? FlagSF : 0) |
            (newValue === 0 ? FlagZF : 0) |
            ((newValue & 0x0f) === 0x0f ? FlagHF : 0) |
            (newValue === 0x7f ? FlagPF : 0) |
            FlagNF |
            (newValue & (Flag3 | Flag5));
          return 23;
        }

        case 0x36: { // LD (XY+d),n
          this.xyDisplacement = asSignedByte(this.fetchOpcode());
          const address = this.xyAddress();
          this.writeMemory8(address, this.fetchOpcode());
          return 19;
        }

        default: // 0x39: ADD XY,SP
          return this.addIntoXy(this.registers.sp);
      }
    }

    if (opcode < 0x80) {
      // LD 系: (XY+d) を参照する場合はディスプレースメントを事前フェッチ
      if (y === RegHlMem || z === RegHlMem) {
        this.xyDisplacement = asSignedByte(this.fetchOpcode());
      }

      this.writeReg8(y, this.readReg8(z));
      return z === RegHlMem || y === RegHlMem ? 19 : 8;
    }

    if (opcode < 0xc0) {
      // ALU A,XH / XYL / (XY+d)
      if (z === RegHlMem) {
        this.xyDisplacement = asSignedByte(this.fetchOpcode());
      }

      const value = this.readReg8(z);
      switch ((opcode >> 3) & 7) {
        case 0:
          this.addA(value, false);
          break;
        case 1:
          this.addA(value, true);
          break;
        case 2:
          this.subA(value, false, false);
          break;
        case 3:
          this.subA(value, true, false);
          break;
        case 4:
          this.andA(value);
          break;
        case 5:
          this.xorA(value);
          break;
        case 6:
          this.orA(value);
          break;
        default:
          this.subA(value, false, true);
          break;
      }

      return z === RegHlMem ? 19 : 8;
    }

    switch (opcode) {
      case 0xe1: // POP XY
        this.setXyRegister(this.pop16());
        return 14;
      case 0xe3: { // EX (SP),XY
        const sp = this.registers.sp;
        const temp = this.readMemoryWord(sp);
        this.writeMemoryWord(sp, this.xyRegister());
        this.setXyRegister(temp);
        return 23;
      }

      case 0xe5: // PUSH XY
        this.push16(this.xyRegister());
        return 15;
      case 0xe9: // JP (XY)
        this.registers.pc = this.xyRegister();
        return 8;
      default: // 0xF9: LD SP,XY
        this.registers.sp = this.xyRegister();
        return 10;
    }
  }

  /** DDCB / FDCB 命令 (ロテート / BIT / RES / SET + 未文書レジスタロード)。 */
  private executeXyCbInstruction(opcode: number): number {
    const y = (opcode >> 3) & 7;
    const z = opcode & 7;
    const address = this.xyAddress();
    this.isXyMode = false; // 未文書のレジスタロードはメインレジスタ (H/L 含む) に行く

    if (opcode < 0x40) {
      const result = this.rotateValue(y, this.readMemory8(address));
      this.writeMemory8(address, result);
      if (z !== RegHlMem) {
        this.writeReg8(z, result);
      }

      return 23;
    }

    if (opcode < 0x80) {
      // BIT b,(XY+d): F3/F5 は不変 (Z80dotNet 仕様)
      const bitValue = (this.readMemory8(address) >> y) & 1;
      this.setFlag(FlagZF, bitValue === 0);
      this.setFlag(FlagPF, bitValue === 0);
      this.setFlag(FlagSF, false);
      this.setFlag(FlagHF, true);
      this.setFlag(FlagNF, false);
      return 20;
    }

    const bitMask = 1 << y;
    const value = this.readMemory8(address);
    const result = opcode < 0xc0 ? value & ~bitMask : value | bitMask;
    this.writeMemory8(address, result & 0xff);
    if (z !== RegHlMem) {
      this.writeReg8(z, result & 0xff);
    }

    return 23;
  }
}

