/**
 * Z80 サウンドドライバの内蔵実行環境。
 * 64KB RAM + MZ-1500 相当の音源 I/O (DCSG x2 = F2h/F3h/E9h、BEEP 8253 = E004h/E007h、
 * ビデオステータス = E008h、YM2151 = 0708h/0709h) を内製 Z80 コアへ接続し、
 * 1 フレーム (1/60 秒 = 59,659T) ずつドライバを実行する。
 * フレーム同期は実機互換で E008h bit7 (H-BLANK) ポーリング (フレーム末尾をブランキング扱い)。
 * (移植元: MzSound.Player/Driver/Z80DriverMachine.cs)
 */
import { ChipBank } from '../chips/ChipBank';
import { DcsgChip } from '../chips/DcsgChip';
import type { Z80MemoryBus, Z80PortBus } from '../z80/Z80Bus';
import { Z80Processor } from '../z80/Z80Processor';
import { Z80DriverImage } from './Z80DriverImage';

/**
 * SN76489AN の 1 バイトラッチ/データ形式をデコードして DcsgChip へ展開する。
 * (C# 版 Z80DriverMachine.DcsgLatch 相当)
 */
class DcsgLatch {
  private latchIndex = 0;

  private readonly fine = [0, 0, 0];

  private readonly coarse = [0, 0, 0];

  write(chip: DcsgChip, value: number): void {
    if ((value & 0x80) !== 0) {
      this.latchIndex = (value >> 4) & 7;
      switch (this.latchIndex) {
        case 0:
        case 2:
        case 4: {
          const channel = this.latchIndex >> 1;
          this.fine[channel] = value & 0x0f;
          chip.setTonePeriod(channel, (this.coarse[channel] << 4) | this.fine[channel]);
          break;
        }

        case 1:
        case 3:
        case 5:
        case 7:
          chip.setAttenuation(this.latchIndex >> 1, value & 0x0f);
          break;

        case 6:
          chip.setNoiseControl((value & 0x04) !== 0, value & 0x03);
          break;
      }
    } else if (this.latchIndex === 0 || this.latchIndex === 2 || this.latchIndex === 4) {
      const channel = this.latchIndex >> 1;
      this.coarse[channel] = value & 0x3f;
      chip.setTonePeriod(channel, (this.coarse[channel] << 4) | this.fine[channel]);
    }
  }
}

/** トレース 1 ステップ (traceSteps の戻り要素)。 */
export interface DriverTraceStep {
  pc: number;

  opcode: number;

  hl: number;
}

/** 指定アドレスへの書き込み観察結果 (traceWritesTo の戻り要素)。 */
export interface DriverWriteTrace {
  pc: number;

  value: number;

  step: number;
}

/**
 * Z80 サウンドドライバの内蔵実行環境。
 * (C# 版 Z80DriverMachine 相当)
 */
export class Z80DriverMachine {
  /** 1 フレームの T 状態数 (3,579,545Hz / 60)。 */
  static readonly FrameTStates = 59659;

  /**
   * フレーム先頭のブランキング期間 (20 スキャンライン分)。
   * E008h bit7 はこの期間のみ 0 になり、1 -> 0 エッジ (= 演奏フレームの開始) の直後に
   * ドライバは残り FrameTStates - BlankTStates を使って 17ch の処理を行える。
   * (注意: ドライバのブート (ワーク / FM 初期化) は 1-2 フレームかかる場合がある。
   * 統合環境は CB_STATUS の STAT_PLAY (bit0) が立つまで RunFrame を繰り返して待つこと)
   */
  static readonly BlankTStates = 4560;

  /** 制御ブロック: CB_STATUS (bit0 演奏中 / bit1 L ループ / bit7 停止要求)。 */
  static readonly CbStatusAddress = 0xf800;

  /** 制御ブロック: CB_PTRS (17ch x 2B、現在データオフセット)。 */
  static readonly CbPtrsAddress = 0xf808;

  /** 64KB RAM (バス実装から参照するため公開)。 */
  readonly ram = new Uint8Array(0x10000);

  /** 接続する音源チップ一式 (バス実装から参照するため公開)。 */
  readonly chips: ChipBank;

  private readonly processor = new Z80Processor();

  private readonly psg1Latch = new DcsgLatch();

  private readonly psg2Latch = new DcsgLatch();

  private frameStart = 0;

  private beepControl = 0x36;

  private beepWriteCount = 0;

  private beepLow = 0;

  /** YM2151 アドレスラッチ (0708h)。バス実装から参照するため公開。 */
  fmAddress = 0;

  private finished = false;

  constructor(chips: ChipBank) {
    this.chips = chips;
    this.processor.memory = new DriverMemoryBus(this);
    this.processor.portsSpace = new DriverPortBus(this);
    // YM2151 (0708h/0709h) のように 16 ビットポート番号を使うため有効化
    // (既定は 8 ビットモードで bc 下位 8bit のみがポートアドレスになる)
    this.processor.useExtendedPortsSpace = true;
  }

  /** ドライバが HALT した (演奏終了 or 停止要求)。 */
  get isFinished(): boolean {
    return this.finished;
  }

  /** 制御ブロック CB_STATUS の値。 */
  get status(): number {
    return this.ram[Z80DriverMachine.CbStatusAddress];
  }

  /** 制御ブロックのフレームカウンタ。 */
  get frameCounter(): number {
    return this.ram[0xf801] | (this.ram[0xf802] << 8);
  }

  /** テスト / デバッグ用: 現在の PC。 */
  get programCounter(): number {
    return this.processor.registers.pc;
  }

  /** テスト / デバッグ用: CPU が HALT 状態か。 */
  get isHalted(): boolean {
    return this.processor.isHalted;
  }

  /** ドライバをロードして演奏を開始する。 */
  load(image: Z80DriverImage, musicData: Uint8Array, loop: boolean): void {
    this.ram.fill(0);
    this.ram.set(image.binary, Z80DriverImage.LoadAddress);
    const copyLength = Math.min(musicData.length, 0x10000 - image.musicDataAddress);
    this.ram.set(musicData.subarray(0, copyLength), image.musicDataAddress);
    if (loop) {
      this.ram[Z80DriverMachine.CbStatusAddress] |= 0x02; // STAT_LOOP
    }

    this.processor.reset();
    this.processor.registers.pc = Z80DriverImage.LoadAddress;
    this.finished = false;
    this.frameStart = 0;
  }

  /** 1 フレーム分 (59,659T) ドライバを実行する。 */
  runFrame(): void {
    if (this.finished) {
      return;
    }

    const target = this.processor.tStatesElapsedSinceReset + Z80DriverMachine.FrameTStates;
    this.frameStart = this.processor.tStatesElapsedSinceReset;
    while (this.processor.tStatesElapsedSinceReset < target && !this.processor.isHalted) {
      this.processor.executeNextInstruction();
    }

    if (this.processor.isHalted) {
      this.finished = true;
    }
  }

  /** 演奏位置ハイライト用: トラックの現在データオフセット。 */
  getTrackOffset(trackIndex: number): number {
    const address = Z80DriverMachine.CbPtrsAddress + trackIndex * 2;
    return this.ram[address] | (this.ram[address + 1] << 8);
  }

  /** テスト / デバッグ用: RAM 読み出し。 */
  peekMemory(address: number): number {
    return this.ram[address & 0xffff];
  }

  /** テスト / デバッグ用: 指定命令数だけ実行し、(実行前 PC, オペコード, HL) の履歴を返す。 */
  traceSteps(count: number): DriverTraceStep[] {
    this.frameStart = this.processor.tStatesElapsedSinceReset;
    const trace: DriverTraceStep[] = [];
    for (let i = 0; i < count && !this.processor.isHalted; i++) {
      const pc = this.processor.registers.pc;
      const opcode = this.ram[pc & 0xffff];
      this.processor.executeNextInstruction();
      trace.push({ pc, opcode, hl: this.processor.registers.hl });
    }

    return trace;
  }

  /** テスト / デバッグ用: 指定アドレスへの書き込みを観察する (PC, 値) のリスト。 */
  traceWritesTo(address: number, maxSteps: number): DriverWriteTrace[] {
    const results: DriverWriteTrace[] = [];
    let before = this.ram[address & 0xffff];
    for (let step = 0; step < maxSteps && !this.processor.isHalted; step++) {
      this.processor.executeNextInstruction();
      const after = this.ram[address & 0xffff];
      if (after !== before) {
        results.push({ pc: this.processor.registers.pc, value: after, step });
        before = after;
      }
    }

    return results;
  }

  // --- 以下はバス実装 (DriverMemoryBus / DriverPortBus) から呼ばれるため公開 ---

  /** フレーム内のブランキング状態 (E008h bit7 に反映)。フレーム先頭のみブランキング。 */
  get isBlanking(): boolean {
    return this.processor.tStatesElapsedSinceReset - this.frameStart < Z80DriverMachine.BlankTStates;
  }

  /** 音源ポートへ書き込む (下位 8bit でデコード: F2h / F3h / E9h)。 */
  writePsgData(address: number, value: number): void {
    switch (address & 0xff) {
      case 0xf2:
        this.psg1Latch.write(this.chips.psg1, value);
        break;
      case 0xf3:
        this.psg2Latch.write(this.chips.psg2, value);
        break;
      case 0xe9:
        this.psg1Latch.write(this.chips.psg1, value);
        this.psg2Latch.write(this.chips.psg2, value);
        break;
    }
  }

  /** 8253 Ch.0 コントロール (E007h) の書き込み。 */
  writeBeepControl(value: number): void {
    this.beepControl = value;
    this.beepWriteCount = 0;
  }

  /** 8253 Ch.0 カウンタ (E004h) の書き込み (LSB -> MSB 順)。 */
  writeBeepCount(value: number): void {
    if ((this.beepControl & 0x30) === 0x30) {
      if (this.beepWriteCount === 0) {
        this.beepLow = value;
        this.beepWriteCount = 1;
      } else {
        this.chips.beep.setCounter(this.beepLow | (value << 8));
        this.beepWriteCount = 0;
      }
    } else if ((this.beepControl & 0x30) === 0x10) {
      this.chips.beep.setCounter(value);
    }
  }
}

/** 64KB RAM + メモリマップド I/O (E004h-E008h) のバス。 */
class DriverMemoryBus implements Z80MemoryBus {
  private readonly machine: Z80DriverMachine;

  constructor(machine: Z80DriverMachine) {
    this.machine = machine;
  }

  read(address: number): number {
    address &= 0xffff;
    if (address === 0xe008) {
      // bit7: H-BLANK (0 = ブランキング中)、bit0: テンポ信号、bit1-6: ジョイスティック (未接続)
      return (this.machine.isBlanking ? 0x00 : 0x80) | 0x7e;
    }

    return this.machine.ram[address];
  }

  write(address: number, value: number): void {
    address &= 0xffff;
    switch (address) {
      case 0xe004:
        this.machine.writeBeepCount(value);
        break;
      case 0xe007:
        this.machine.writeBeepControl(value);
        break;
      case 0xe008:
        this.machine.chips.beep.setGate((value & 0x01) !== 0);
        break;
      default:
        this.machine.ram[address] = value;
        break;
    }
  }
}

/** I/O バス: PSG x2 (下位 8bit) + YM2151 (0708h/0709h)。 */
class DriverPortBus implements Z80PortBus {
  private readonly machine: Z80DriverMachine;

  constructor(machine: Z80DriverMachine) {
    this.machine = machine;
  }

  read(_port: number): number {
    return 0xff;
  }

  write(address: number, value: number): void {
    switch (address & 0xffff) {
      case 0x0708:
        this.machine.fmAddress = value & 0xff;
        break;
      case 0x0709:
        this.machine.chips.fm.setReg(this.machine.fmAddress, value);
        break;
      default:
        this.machine.writePsgData(address, value);
        break;
    }
  }
}
