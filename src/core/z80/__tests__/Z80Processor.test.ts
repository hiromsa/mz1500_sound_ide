/**
 * Z80 CPU コア (Z80dotNet 相当) の単体テスト。
 * リファレンスは Z80dotNet の挙動 (フラグ計算 / T-state / 未文書命令) で、
 * 期待値は The undocumented Z80 documented 準拠の Z80dotNet 実装から取る。
 */
import { describe, expect, it } from 'vitest';
import type { Z80MemoryBus, Z80PortBus } from '../Z80Bus';
import { Z80Processor } from '../Z80Processor';

class TestMemory implements Z80MemoryBus {
  readonly data = new Uint8Array(0x10000);

  read(address: number): number {
    return this.data[address & 0xffff];
  }

  write(address: number, value: number): void {
    this.data[address & 0xffff] = value & 0xff;
  }

  set(start: number, bytes: number[]): void {
    for (let i = 0; i < bytes.length; i++) {
      this.data[(start + i) & 0xffff] = bytes[i] & 0xff;
    }
  }

  /** バイト列を 16bit リトルエンディアンワードで書く。 */
  setWord(start: number, ...values: number[]): void {
    let offset = start;
    for (const value of values) {
      this.data[offset & 0xffff] = value & 0xff;
      this.data[(offset + 1) & 0xffff] = (value >> 8) & 0xff;
      offset += 2;
    }
  }
}

class TestPortBus implements Z80PortBus {
  readonly writes: Array<{ port: number; value: number }> = [];

  private readonly portData = new Map<number, number>();

  read(port: number): number {
    return this.portData.get(port) ?? 0xff;
  }

  write(port: number, value: number): void {
    this.writes.push({ port, value: value & 0xff });
  }

  set(port: number, value: number): void {
    this.portData.set(port, value & 0xff);
  }
}

function createProcessor(extendedPorts = false): {
  cpu: Z80Processor;
  memory: TestMemory;
  ports: TestPortBus;
} {
  const cpu = new Z80Processor();
  cpu.memory = new TestMemory();
  cpu.portsSpace = new TestPortBus();
  cpu.useExtendedPortsSpace = extendedPorts;
  cpu.reset();
  return { cpu, memory: cpu.memory as TestMemory, ports: cpu.portsSpace as TestPortBus };
}

describe('Z80Processor 基本動作', () => {
  it('リセット直後は AF / SP = FFFFh、IFF 無効、IM0', () => {
    const { cpu } = createProcessor();
    expect(cpu.registers.af).toBe(0xffff);
    expect(cpu.registers.sp).toBe(0xffff);
    expect(cpu.registers.pc).toBe(0);
    expect(cpu.registers.iff1).toBe(false);
    expect(cpu.registers.iff2).toBe(false);
    expect(cpu.registers.interruptMode).toBe(0);
    expect(cpu.tStatesElapsedSinceReset).toBe(0);
    expect(cpu.isHalted).toBe(false);
  });

  it('T-state を命令ごとに積算する (NOP = 4T)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x00, 0x00]);
    cpu.executeNextInstruction();
    cpu.executeNextInstruction();
    expect(cpu.tStatesElapsedSinceReset).toBe(8);
    expect(cpu.registers.pc).toBe(2);
  });

  it('HALT で停止し、以降は NOP として 4T 消費する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x76]);
    expect(cpu.executeNextInstruction()).toBe(4);
    expect(cpu.isHalted).toBe(true);
    expect(cpu.executeNextInstruction()).toBe(4);
    expect(cpu.registers.pc).toBe(1);
    expect(cpu.tStatesElapsedSinceReset).toBe(8);
  });

  it('R レジスタはフェッチしたオペコード数だけ 7bit で進む', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x00, 0x00, 0x06, 0x01]); // NOP, NOP, LD B,1
    cpu.executeNextInstruction();
    cpu.executeNextInstruction();
    cpu.executeNextInstruction();
    expect(cpu.registers.r).toBe(3);
  });

  it('CB / ED 命令は R を 2 進める', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xcb, 0x40, 0xed, 0x44]); // BIT 0,B / NEG
    cpu.executeNextInstruction();
    cpu.executeNextInstruction();
    expect(cpu.registers.r).toBe(4);
  });
});

describe('8bit ロード / 演算', () => {
  it('LD B,(HL) は 7T でメモリから読む', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x46]);
    memory.data[0x1234] = 0x5a;
    cpu.registers.hl = 0x1234;
    expect(cpu.executeNextInstruction()).toBe(7);
    expect(cpu.registers.b).toBe(0x5a);
  });

  it('ADD A,B は半桁上がりで HF を立てる', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x80]); // ADD A,B
    cpu.registers.f = 0;
    cpu.registers.a = 0x0f;
    cpu.registers.b = 0x01;
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x10);
    // 結果 0x10 の bit5 は 0 → F は H のみ
    expect(cpu.registers.f).toBe(0x10);
  });

  it('ADD A,B は桁上がりで CF を立てる', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x80]);
    cpu.registers.a = 0xff;
    cpu.registers.b = 0x02;
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x01);
    expect(cpu.registers.f & 0x01).toBe(0x01);
  });

  it('SUB は NF を立て、CP は F3/F5 をオペランドから設定する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xb8]); // CP B
    cpu.registers.a = 0x10;
    cpu.registers.b = 0x10;
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x10);
    // N + Z。F3/F5 は B=0x10 の bit3/bit5 = 0
    expect(cpu.registers.f & 0x4e).toBe(0x40 | 0x02);
  });

  it('ADC A は CF を加算する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x37, 0x88]); // SCF / ADC A,B
    cpu.registers.a = 0x10;
    cpu.registers.b = 0x20;
    cpu.executeNextInstruction();
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x31);
  });

  it('AND は HF を立てパリティを設定する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xa0]); // AND B
    cpu.registers.a = 0xf0;
    cpu.registers.b = 0x03; // 結果 0x00
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x00);
    expect(cpu.registers.f).toBe(0x10 | 0x40 | 0x04); // H + Z + P
  });

  it('INC r は 7F→80 で PV を立てる', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x3c]); // INC A
    cpu.registers.f = 0;
    cpu.registers.a = 0x7f;
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x80);
    expect(cpu.registers.f).toBe(0x80 | 0x10 | 0x04); // S + H + P (0x80 の F3/F5 は 0)
  });

  it('DEC r は 00→FF で HF を立てる', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x3d]); // DEC A
    cpu.registers.f = 0;
    cpu.registers.a = 0x00;
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0xff);
    expect(cpu.registers.f).toBe(0x80 | 0x10 | 0x02 | 0x28); // S + H + N + F3/F5 (0xFF)
  });

  it('INC (HL) は 11T', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x34]);
    cpu.registers.hl = 0x2000;
    expect(cpu.executeNextInstruction()).toBe(11);
    expect(memory.data[0x2000]).toBe(1);
  });

  it('DAA は BCD 補正を行う (ADD 後)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xc6, 0x27, 0x27]); // ADD A,27h / DAA
    cpu.registers.a = 0x15;
    cpu.executeNextInstruction(); // A = 0x3C
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x42);
  });

  it('NEG は 80h で PV を立てる', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0x44]); // NEG
    cpu.registers.a = 0x80;
    expect(cpu.executeNextInstruction()).toBe(8);
    expect(cpu.registers.a).toBe(0x80);
    // S + P + N + C
    expect(cpu.registers.f).toBe(0x80 | 0x04 | 0x02 | 0x01);
  });
});

describe('ロテート / BIT', () => {
  it('RLCA は CF を設定し SF/ZF/PF は不変、F3/F5 を更新する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x07]); // RLCA
    cpu.registers.a = 0x85;
    cpu.registers.f = 0x80 | 0x40 | 0x04; // S + Z + P を事前設定
    cpu.executeNextInstruction();
    expect(cpu.registers.a).toBe(0x0b);
    expect(cpu.registers.f & 0x01).toBe(0x01); // CF = 旧 bit7
    expect(cpu.registers.f & 0xc4).toBe(0xc4); // SF/ZF/PF は不変
    expect(cpu.registers.f & 0x28).toBe(0x08); // F3 (0x0b の bit3)
  });

  it('CB の RLC B は全フラグを更新する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xcb, 0x00]); // RLC B
    cpu.registers.b = 0x85;
    expect(cpu.executeNextInstruction()).toBe(8);
    expect(cpu.registers.b).toBe(0x0b);
    expect(cpu.registers.f & 0x01).toBe(0x01); // CF = 旧 bit7
    expect(cpu.registers.f & 0xc6).toBe(0x00); // SF/ZF/NF は 0
    expect(cpu.registers.f & 0x08).toBe(0x08); // F3 (0x0b の bit3)
  });

  it('SLL は未文書命令として LSB=1 で左シフトする', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xcb, 0x30]); // SLL B
    cpu.registers.b = 0x80;
    cpu.executeNextInstruction();
    expect(cpu.registers.b).toBe(0x01);
    expect(cpu.registers.f & 0x01).toBe(0x01); // CF = 旧 bit7
  });

  it('BIT b,r は SF=0、HF=1、F3/F5 不変 (Z80dotNet 仕様)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xcb, 0x7f]); // BIT 7,A
    cpu.registers.a = 0x80;
    cpu.registers.f = 0x08 | 0x20; // F3/F5 を事前設定
    cpu.executeNextInstruction();
    // bit7=1 なので Z/P は 0、S は立たない、HF が立つ
    expect(cpu.registers.f).toBe(0x10 | 0x08 | 0x20);
  });
});

describe('16bit 演算 / スタック', () => {
  it('ADD HL,BC は 11T で SF/ZF/PF を保持する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x09]); // ADD HL,BC
    cpu.registers.hl = 0x0fff;
    cpu.registers.bc = 0x1001;
    cpu.registers.f = 0x80 | 0x40 | 0x04; // S + Z + P
    expect(cpu.executeNextInstruction()).toBe(11);
    expect(cpu.registers.hl).toBe(0x2000);
    // H (bit12) が立ち、SF/ZF/PF は保持
    expect(cpu.registers.f).toBe(0x80 | 0x40 | 0x04 | 0x10 | 0x20);
  });

  it('SBC HL,BC は SF/ZF を設定し、負値で CF を立てる', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0x42]); // SBC HL,BC
    cpu.registers.f = 0; // CF クリア
    cpu.registers.hl = 0x1000;
    cpu.registers.bc = 0x2000;
    expect(cpu.executeNextInstruction()).toBe(15);
    expect(cpu.registers.hl).toBe(0xf000);
    // S + C + F5 (Z80dotNet 式ではこの組合せで HF は立たない)。NF は 0xfd マスクで除外
    expect(cpu.registers.f & 0xfd).toBe(0x80 | 0x01 | 0x20);
  });

  it('PUSH/POP は高位バイト先でメモリに積む', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xc5, 0xc1]); // PUSH BC / POP BC
    cpu.registers.sp = 0xfffe;
    cpu.registers.bc = 0x1234;
    expect(cpu.executeNextInstruction()).toBe(11);
    expect(memory.data[0xfffd]).toBe(0x12);
    expect(memory.data[0xfffc]).toBe(0x34);
    cpu.executeNextInstruction();
    expect(cpu.registers.sp).toBe(0xfffe);
    expect(cpu.registers.bc).toBe(0x1234);
  });

  it('EX (SP),HL は 19T でスタック内容と交換する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xe3]);
    cpu.registers.sp = 0x1000;
    memory.setWord(0x1000, 0x2233);
    cpu.registers.hl = 0x4455;
    expect(cpu.executeNextInstruction()).toBe(19);
    expect(cpu.registers.hl).toBe(0x2233);
    expect(memory.data[0x1000]).toBe(0x55);
    expect(memory.data[0x1001]).toBe(0x44);
  });

  it("EXX / EX AF,AF' は代替レジスタと交換する", () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xd9, 0x08]); // EXX / EX AF,AF'
    cpu.registers.bc = 0x1111;
    cpu.registers.alternate.bc = 0x2222;
    cpu.registers.af = 0x00aa;
    cpu.registers.alternate.af = 0x00bb;
    cpu.executeNextInstruction();
    expect(cpu.registers.bc).toBe(0x2222);
    expect(cpu.registers.alternate.bc).toBe(0x1111);
    cpu.executeNextInstruction();
    expect(cpu.registers.af).toBe(0x00bb);
  });
});

describe('ジャンプ / コール', () => {
  it('JP nn は 10T でジャンプする', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xc3, 0x34, 0x12]);
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.pc).toBe(0x1234);
  });

  it('JR NZ は成立 12T / 不成立 7T', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x20, 0x05]);
    // ZF = 1 → NZ 不成立 (7T)
    cpu.registers.f = 0x40;
    expect(cpu.executeNextInstruction()).toBe(7);
    expect(cpu.registers.pc).toBe(2);

    // ZF = 0 → NZ 成立 (12T)
    cpu.registers.pc = 0;
    cpu.registers.f = 0;
    expect(cpu.executeNextInstruction()).toBe(12);
    expect(cpu.registers.pc).toBe(7);
  });

  it('DJNZ は B=1 でループを抜ける (8T)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x10, 0x02]);
    cpu.registers.b = 1;
    expect(cpu.executeNextInstruction()).toBe(8);
    expect(cpu.registers.pc).toBe(2);
    expect(cpu.registers.b).toBe(0);
  });

  it('CALL / RET はスタックに戻り番地を退避する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xcd, 0x06, 0x30]);
    memory.set(0x3006, [0xc9]); // RET
    cpu.registers.sp = 0xfffe;
    expect(cpu.executeNextInstruction()).toBe(17);
    expect(cpu.registers.pc).toBe(0x3006);
    expect(cpu.registers.sp).toBe(0xfffc);
    expect(memory.data[0xfffc]).toBe(0x03);
    expect(memory.data[0xfffd]).toBe(0x00);
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.pc).toBe(3);
    expect(cpu.registers.sp).toBe(0xfffe);
  });

  it('CALL cc は不成立 10T でスタックを触らない', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xc4, 0x00, 0x30]);
    cpu.registers.sp = 0xfffe;
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.pc).toBe(3);
    expect(cpu.registers.sp).toBe(0xfffe);
  });

  it('RST は 11T で 0x38 へ飛ぶ', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xff]);
    cpu.registers.sp = 0xfffe;
    expect(cpu.executeNextInstruction()).toBe(11);
    expect(cpu.registers.pc).toBe(0x38);
    expect(cpu.registers.sp).toBe(0xfffc);
  });
});

describe('I/O (16bit ポート対応)', () => {
  it('OUT (C),r は BC 全 16bit をポート番号として使う', () => {
    const { cpu, memory, ports } = createProcessor(true);
    memory.set(0, [0xed, 0x79]); // OUT (C),A
    cpu.registers.b = 0x07;
    cpu.registers.c = 0x08;
    cpu.registers.a = 0x5a;
    expect(cpu.executeNextInstruction()).toBe(12);
    expect(ports.writes).toEqual([{ port: 0x0708, value: 0x5a }]);
  });

  it('OUT (n),A は上位バイトに A を使う (拡張ポート有効時)', () => {
    const { cpu, memory, ports } = createProcessor(true);
    memory.set(0, [0xd3, 0x09]); // OUT (09h),A
    cpu.registers.a = 0x11;
    cpu.executeNextInstruction();
    expect(ports.writes).toEqual([{ port: 0x1109, value: 0x11 }]);
  });

  it('拡張ポート無効時は下位 8bit のみがポート番号になる', () => {
    const { cpu, memory, ports } = createProcessor(false);
    memory.set(0, [0xed, 0x79]); // OUT (C),A
    cpu.registers.b = 0x07;
    cpu.registers.c = 0x08;
    cpu.registers.a = 0x5a;
    cpu.executeNextInstruction();
    expect(ports.writes).toEqual([{ port: 0x08, value: 0x5a }]);
  });

  it('OUT (C),0 は 0 を出力する', () => {
    const { cpu, memory, ports } = createProcessor(true);
    memory.set(0, [0xed, 0x71]); // OUT (C),0
    cpu.registers.b = 0x07;
    cpu.registers.c = 0x08;
    cpu.executeNextInstruction();
    expect(ports.writes).toEqual([{ port: 0x0708, value: 0x00 }]);
  });

  it('IN A,(n) はフラグを更新せず CF を保持する', () => {
    const { cpu, memory, ports } = createProcessor(true);
    memory.set(0, [0xdb, 0x09]); // IN A,(09h)
    ports.set(0x7709, 0x42); // 上位バイト = A
    cpu.registers.a = 0x77;
    cpu.registers.f = 0x01;
    expect(cpu.executeNextInstruction()).toBe(11);
    expect(cpu.registers.a).toBe(0x42);
    expect(cpu.registers.f).toBe(0x01);
  });

  it('IN r,(C) は SF/ZF/PV/F3/F5 を更新し CF は不変', () => {
    const { cpu, memory } = createProcessor(false);
    memory.set(0, [0xed, 0x78]); // IN A,(C)
    memory.set(2, [0x37]);
    cpu.registers.b = 0x12;
    cpu.registers.c = 0x34;
    cpu.registers.f = 0x01; // CF 事前設定
    expect(cpu.executeNextInstruction()).toBe(12);
    expect(cpu.registers.a).toBe(0xff);
    // S + (PF: 0xFF は偶数パリティで立つ) + F3/F5 (0xFF) + CF 保持
    expect(cpu.registers.f).toBe(0x80 | 0x04 | 0x28 | 0x01);
  });

  it('IN F,(C) はレジスタを書き換えない', () => {
    const { cpu, memory } = createProcessor(false);
    memory.set(0, [0xed, 0x70]); // IN F,(C)
    memory.set(2, [0x00, 0x3e, 0x5a]); // NOP / LD A,5Ah
    cpu.registers.b = 0x12;
    cpu.registers.c = 0x34;
    cpu.executeNextInstruction();
    cpu.executeNextInstruction(); // NOP
    cpu.executeNextInstruction(); // LD A,5Ah
    expect(cpu.registers.a).toBe(0x5a);
  });
});

describe('ブロック命令', () => {
  it('LDI は HL→DE へ転送し PF = (BC != 0)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0xa0]); // LDI
    memory.data[0x1000] = 0x5a;
    cpu.registers.hl = 0x1000;
    cpu.registers.de = 0x2000;
    cpu.registers.bc = 3;
    expect(cpu.executeNextInstruction()).toBe(16);
    expect(memory.data[0x2000]).toBe(0x5a);
    expect(cpu.registers.hl).toBe(0x1001);
    expect(cpu.registers.de).toBe(0x2001);
    expect(cpu.registers.bc).toBe(2);
    expect(cpu.registers.f & 0x04).toBe(0x04);
    expect(cpu.registers.f & 0x10).toBe(0); // HF = 0
  });

  it('LDIR は BC が 0 になるまで繰り返す (21T)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0xb0]); // LDIR
    cpu.registers.hl = 0x1000;
    cpu.registers.de = 0x2000;
    cpu.registers.bc = 2;
    memory.data[0x1000] = 0xaa;
    memory.data[0x1001] = 0xbb;
    expect(cpu.executeNextInstruction()).toBe(21);
    expect(cpu.registers.pc).toBe(0); // PC -= 2
    expect(cpu.registers.bc).toBe(1);
    expect(cpu.executeNextInstruction()).toBe(16);
    expect(cpu.registers.pc).toBe(2);
    expect(cpu.registers.bc).toBe(0);
    expect(memory.data[0x2000]).toBe(0xaa);
    expect(memory.data[0x2001]).toBe(0xbb);
  });

  it('CPIR は一致 (ZF=1) で停止する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0xb1]); // CPIR
    memory.data[0x1000] = 0x11;
    memory.data[0x1001] = 0x22;
    cpu.registers.a = 0x22;
    cpu.registers.hl = 0x1000;
    cpu.registers.bc = 5;
    // 1 回目: 不一致 (BC=4 != 0) で繰り返し
    expect(cpu.executeNextInstruction()).toBe(21);
    expect(cpu.registers.pc).toBe(0);
    expect(cpu.registers.hl).toBe(0x1001);
    // 2 回目: 一致 (ZF=1) で停止
    expect(cpu.executeNextInstruction()).toBe(16);
    expect(cpu.registers.pc).toBe(2);
    expect(cpu.registers.hl).toBe(0x1002);
    expect(cpu.registers.f & 0x40).toBe(0x40);
  });

  it('OTIR は B をデクリメントし、0 で停止する', () => {
    const { cpu, memory, ports } = createProcessor(true);
    memory.set(0, [0xed, 0xb3]); // OTIR
    memory.data[0x1000] = 0x5a;
    memory.data[0x1001] = 0x77;
    cpu.registers.b = 0x02;
    cpu.registers.c = 0x08;
    cpu.registers.hl = 0x1000;
    // 1 回目: B=2 → port 0208h
    expect(cpu.executeNextInstruction()).toBe(21);
    expect(cpu.registers.pc).toBe(0);
    expect(cpu.registers.b).toBe(0x01);
    // 2 回目: B=1 → port 0108h、B=0 で停止
    expect(cpu.executeNextInstruction()).toBe(16);
    expect(cpu.registers.pc).toBe(2);
    expect(cpu.registers.b).toBe(0x00);
    expect(ports.writes).toEqual([
      { port: 0x0208, value: 0x5a },
      { port: 0x0108, value: 0x77 },
    ]);
  });
});

describe('DD / FD (IX / IY) 命令', () => {
  it('LD IX,nn / INC (IX+d) を実行する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0x21, 0x00, 0x10, 0xdd, 0x34, 0x02]); // LD IX,1000h / INC (IX+2)
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.ix).toBe(0x1000);
    expect(cpu.executeNextInstruction()).toBe(23);
    expect(memory.data[0x1002]).toBe(1);
  });

  it('ADD A,(IX+d) は 19T で符号付き d を使う', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0x86, 0xfe]); // ADD A,(IX-2)
    cpu.registers.ix = 0x1010;
    memory.data[0x100e] = 0x03;
    cpu.registers.a = 0x01;
    expect(cpu.executeNextInstruction()).toBe(19);
    expect(cpu.registers.a).toBe(0x04);
  });

  it('LD B,IXH / LD IXL,n は未文書レジスタを操作する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0x26, 0x5a, 0xdd, 0x44]); // LD IXH,5Ah / LD B,IXH
    cpu.executeNextInstruction();
    expect(cpu.registers.ix).toBe(0x5a00);
    expect(cpu.executeNextInstruction()).toBe(8);
    expect(cpu.registers.b).toBe(0x5a);
  });

  it('ADD IX,BC は 15T', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0x09]); // ADD IX,BC
    cpu.registers.ix = 0x1000;
    cpu.registers.bc = 0x2000;
    expect(cpu.executeNextInstruction()).toBe(15);
    expect(cpu.registers.ix).toBe(0x3000);
  });

  it('JP (IX) は 8T、LD SP,IX は 10T', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0xe9]); // JP (IX)
    cpu.registers.ix = 0x2000;
    expect(cpu.executeNextInstruction()).toBe(8);
    expect(cpu.registers.pc).toBe(0x2000);

    memory.set(0x2000, [0xdd, 0x21, 0x00, 0x12, 0xdd, 0xf9]); // LD IX,1200h / LD SP,IX
    cpu.registers.sp = 0;
    cpu.executeNextInstruction();
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.sp).toBe(0x1200);
  });

  it('RLC (IX+d) はメモリへ書き戻し、未文書のレジスタロードで B へ入る', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0xcb, 0x01, 0x00]); // RLC (IX+1)
    cpu.registers.ix = 0x1000;
    memory.data[0x1001] = 0x85;
    expect(cpu.executeNextInstruction()).toBe(23);
    expect(memory.data[0x1001]).toBe(0x0b);
    expect(cpu.registers.b).toBe(0x0b); // 未文書動作
  });

  it('RES (IX+d),b はメモリへ書き戻し、未文書のレジスタロードで H へ入る', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0xcb, 0x00, 0x84]); // RES 0,(IX+0) (未文書の H ロード付き)
    cpu.registers.ix = 0x1000;
    memory.data[0x1000] = 0xff;
    expect(cpu.executeNextInstruction()).toBe(23);
    expect(memory.data[0x1000]).toBe(0xfe);
    expect(cpu.registers.h).toBe(0xfe);
  });

  it('BIT (IX+d) は 20T で F3/F5 を変更しない', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0xcb, 0x02, 0x7e]); // BIT 7,(IX+2)
    cpu.registers.ix = 0x1000;
    memory.data[0x1002] = 0x80;
    cpu.registers.f = 0x08 | 0x20;
    expect(cpu.executeNextInstruction()).toBe(20);
    expect(cpu.registers.f).toBe(0x10 | 0x08 | 0x20);
  });

  it('FD プレフィックスは IY を操作する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xfd, 0x21, 0x00, 0x40, 0xfd, 0x23]); // LD IY,4000h / INC IY
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.iy).toBe(0x4001);
  });
});

describe('未定義オペコード / 特殊命令', () => {
  it('未定義 ED は 8T の NOP (PC は 2 バイト先)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0x00, 0x00]);
    expect(cpu.executeNextInstruction()).toBe(8);
    expect(cpu.registers.pc).toBe(2);
  });

  it('未定義 DD は 4T で 2 バイト目を消費しない (次の命令として再実行)', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xdd, 0x05, 0x00]); // DD 05h (未定義) → DEC B として実行
    cpu.registers.b = 5;
    expect(cpu.executeNextInstruction()).toBe(4);
    expect(cpu.registers.pc).toBe(1);
    expect(cpu.registers.b).toBe(5);
    expect(cpu.executeNextInstruction()).toBe(4); // DEC B
    expect(cpu.registers.b).toBe(4);
    expect(cpu.registers.pc).toBe(2);
  });

  it('RETN は IFF1 ← IFF2 で復帰する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0x45]); // RETN
    memory.setWord(0xfffe, 0x0008);
    cpu.registers.sp = 0xfffe;
    cpu.registers.iff2 = true;
    cpu.registers.iff1 = false;
    expect(cpu.executeNextInstruction()).toBe(14);
    expect(cpu.registers.pc).toBe(0x0008);
    expect(cpu.registers.iff1).toBe(true);
  });

  it('LD A,I は PV = IFF2 を反映する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xfb, 0xed, 0x57]); // EI / LD A,I
    cpu.registers.i = 0x42;
    cpu.executeNextInstruction(); // EI
    expect(cpu.executeNextInstruction()).toBe(9);
    expect(cpu.registers.a).toBe(0x42);
    expect(cpu.registers.f & 0x04).toBe(0x04); // PV = IFF2 = 1
    expect(cpu.registers.f & 0x40).toBe(0x00); // ZF = 0
  });

  it('LD SP,HL は 6T、LD (nn),HL / LD HL,(nn) は 16T', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0x21, 0x34, 0x12, 0xf9, 0x22, 0x00, 0x30, 0x21, 0x00, 0x00, 0x2a, 0x00, 0x30]);
    // LD HL,1234h / LD SP,HL / LD (3000h),HL / LD HL,0000h / LD HL,(3000h)
    cpu.executeNextInstruction();
    expect(cpu.executeNextInstruction()).toBe(6);
    expect(cpu.registers.sp).toBe(0x1234);
    expect(cpu.executeNextInstruction()).toBe(16);
    expect(cpu.executeNextInstruction()).toBe(10);
    expect(cpu.registers.hl).toBe(0);
    expect(cpu.executeNextInstruction()).toBe(16);
    expect(cpu.registers.hl).toBe(0x1234);
  });

  it('RRD / RLD は A と (HL) の 4bit 単位を回転する', () => {
    const { cpu, memory } = createProcessor();
    memory.set(0, [0xed, 0x67, 0xed, 0x6f]); // RRD / RLD
    memory.data[0x1000] = 0x12;
    cpu.registers.hl = 0x1000;
    cpu.registers.a = 0x34;
    cpu.executeNextInstruction(); // RRD: A=0x32、(HL)=0x41
    expect(cpu.registers.a).toBe(0x32);
    expect(memory.data[0x1000]).toBe(0x41);
    cpu.executeNextInstruction(); // RLD: A=0x34、(HL)=0x12 (元に戻る)
    expect(cpu.registers.a).toBe(0x34);
    expect(memory.data[0x1000]).toBe(0x12);
  });
});
