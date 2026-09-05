/**
 * MZ-1500 のオプション YM2151 (OPM) FM サウンドボード (MZ-1E14 相当)。
 * CPU はリファレンスエミュレータ (Common Source Code Project の MZ-1500 ビルド) と
 * 同様に I/O ポート 0708h (アドレス) / 0709h (データ・ステータス) 経由でチップへ
 * アクセスする。ボードの既定クロックは 4MHz。タイマは標本粒度で進み、レジスタ
 * 書き込みは 8 マイクロ秒の busy フラグを報告する (リファレンスと同一)。
 * IRQ 出力はイベントとして上がるが CPU の INT ラインには接続されない
 * (リファレンスビルドでも未接続)。
 * (移植元: MzSound.Player/Chips/Fm/Ym2151.cs + Ym2151.Ports.cs を 1 モジュールへ統合)
 */
import type { ISoundChip, StereoSampleBuffer } from './ISoundChip';
import { Opm } from './Opm';

/** CSP MZ-1500 ビルドのリファレンスチップクロック (X1 相当)。 */
export const ReferenceClockHz = 4000000;

/** 標準の NTSC 3.58MHz チップクロック。 */
export const StandardClockHz = 3579545;

const ChipClockFixedBits = 20;

export class Ym2151 implements ISoundChip {
  private readonly opm = new Opm();

  private readonly cpuClockHz: number;

  private readonly busyTStates: number;

  private readonly registerWritten = new Uint8Array(0x100);

  private readonly registerData = new Uint8Array(0x100);

  private address = 0;

  private clockProvider: (() => number) | null = null;

  private chipClockHzValue = ReferenceClockHz;

  /** 現在のチップクロック (Hz)。 */
  get chipClock(): number {
    return this.chipClockHzValue;
  }

  /** CPU クロック (Hz) — busy 期間計算の基底。 */
  get cpuClock(): number {
    return this.cpuClockHz;
  }

  private sampleRateHz = 0;

  private chipClockAccum = 0; // 1<<20 固定小数点のチップクロック

  private chipClocksPerSample = 0; // 同じく出力標本ごとの値

  private busyStartTState = 0;

  private busy = false;

  private irq = false;

  private irqChangedHandler: ((irq: boolean) => void) | null = null;

  /** ボードが実装されているか (ポートが応答し、チップがミックスされる)。 */
  enabled = true;

  get name(): string {
    return 'YM2151 (OPM)';
  }

  /** レジスタ書き込み後の busy 期間 (CPU T 状態数、8 マイクロ秒)。 */
  get busyPeriodTStates(): number {
    return this.busyTStates;
  }

  constructor(cpuClockHz: number) {
    this.cpuClockHz = cpuClockHz;
    // リファレンス実装: 8 マイクロ秒
    this.busyTStates = Math.ceil((cpuClockHz * 8.0) / 1_000_000.0);
  }

  /**
   * 現在の CPU T 状態カウンタを供給する (busy フラグ用)。
   * マシンは CPU 構築後にこれを接続する。
   */
  setClockProvider(provider: () => number): void {
    this.clockProvider = provider;
  }

  /** IRQ 出力の立ち上がり/立ち下がりごとに呼ばれるハンドラを設定する。 */
  setIrqChanged(handler: (irq: boolean) => void): void {
    this.irqChangedHandler = handler;
  }

  /**
   * チップクロックを変更する (例: 4MHz リファレンス vs 3.58MHz 標準)。
   * ピッチとタイマレートがそれに応じて変わる。動作中のドライバは
   * (実機の水晶交換のように) サウンドを再プログラムする必要がある。
   */
  setChipClock(clockHz: number): boolean {
    if (clockHz <= 0) {
      return false;
    }

    this.chipClockHzValue = clockHz;
    if (this.sampleRateHz > 0) {
      this.opm.setRate(clockHz, this.sampleRateHz);
      this.chipClocksPerSample = computeChipClocksPerSample(clockHz, this.sampleRateHz);
    }

    return true;
  }

  // -------------------------------------------------- ポートアクセス (Ports)

  /** アドレス (レジスタ選択) ポート (0708h) へ書き込む。 */
  writeAddress(value: number): void {
    this.address = value;
  }

  /** データポート (0709h) へ書き込む: ラッチされたレジスタをプログラムする。 */
  writeData(value: number): void {
    this.setRegister(this.address, value);
    this.updateInterrupt();
    this.busy = true;
    this.busyStartTState = this.currentTState();
  }

  /**
   * ステータスポート (0709h) を読む: タイマフラグと、レジスタ書き込みが
   * 処理中の間 (8 マイクロ秒) の busy ビット。
   */
  readStatus(): number {
    this.updateInterrupt();
    let status = this.opm.readStatus() & ~0x80;
    if (this.busy) {
      // FIXME (リファレンス ym2151.cpp): 正確な busy 期間は不明。
      // リファレンス実装は 8 マイクロ秒を使用している。
      if (this.currentTState() - this.busyStartTState < this.busyTStates) {
        status |= 0x80;
      }

      this.busy = false;
    }

    return status;
  }

  /** レジスタへ最後に書き込んだ値を読み戻す (デバッグ用)。未書き込みなら null。 */
  tryGetRegister(register: number): { present: boolean; value: number } | null {
    const written = register < 0x100 && this.registerWritten[register] !== 0;
    if (!written) {
      return null;
    }

    return { present: true, value: this.registerData[register] };
  }

  /** レジスタへ直接書き込む (シーケンサ / ドライバエミュレーションパス)。 */
  setReg(register: number, value: number): void {
    this.setRegister(register, value);
  }

  /** FM チャンネルをミュート / ミュート解除する (bit 0-7 = channel 0-7)。 */
  setChannelMask(mask: number): void {
    this.opm.setChannelMask(mask);
  }

  /** 内部タイマを手動で進める (リファレンスの update_count に相当)。 */
  advanceChipClocks(clocks: number): void {
    if (clocks > 0) {
      this.opm.count(clocks);
      this.updateInterrupt();
    }
  }

  /** @inheritdoc ISoundChip */
  initialize(sampleRateHz: number): void {
    this.sampleRateHz = sampleRateHz;
    this.opm.init(this.chipClockHzValue, sampleRateHz);
    this.chipClocksPerSample = computeChipClocksPerSample(this.chipClockHzValue, sampleRateHz);
    this.chipClockAccum = 0;
  }

  /** @inheritdoc ISoundChip */
  reset(): void {
    this.opm.reset();
    this.registerWritten.fill(0);
    this.registerData.fill(0);
    this.busy = false;
    this.updateInterrupt();
  }

  /** @inheritdoc ISoundChip */
  mix(buffer: StereoSampleBuffer, sampleCount: number): void {
    for (let i = 0; i < sampleCount; i++) {
      // 内部タイマ (および CSM キーオン) を標本粒度で進め、
      // その後ちょうど 1 出力標本をレンダリングする。
      this.chipClockAccum += this.chipClocksPerSample;
      const clocks = Math.floor(this.chipClockAccum / (1 << ChipClockFixedBits));
      if (clocks > 0) {
        this.chipClockAccum -= clocks * (1 << ChipClockFixedBits);
        this.opm.count(clocks);
        this.updateInterrupt();
      }

      this.opm.mix(buffer, i * 2, 1);
    }
  }

  private setRegister(register: number, value: number): void {
    if (register >= 0x100) {
      return;
    }

    this.opm.setReg(register, value);
    this.registerWritten[register] = 1;
    this.registerData[register] = value;
  }

  private updateInterrupt(): void {
    const value = this.opm.readIRQ();
    if (value === this.irq) {
      return;
    }

    this.irq = value;
    this.irqChangedHandler?.(value);
  }

  private currentTState(): number {
    return this.clockProvider?.() ?? 0;
  }
}

function computeChipClocksPerSample(clockHz: number, rateHz: number): number {
  return Math.floor((clockHz * (1 << ChipClockFixedBits) + Math.floor(rateHz / 2)) / rateHz);
}