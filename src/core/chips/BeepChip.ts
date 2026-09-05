/**
 * BEEP (Intel 8253 PIT Ch.0) 相当の音源エミュレーション。
 * 入力クロックは PHI/16 = 894,886.25Hz、mode 3 (矩形波) を想定。
 * 音量段階は実機にないため ON/OFF ゲートのみ (PC0 マスク相当)。
 * (移植元: MzSound.Player/Chips/BeepChip.cs)
 */
export class BeepChip {
  static readonly ClockHz = 894886.25;

  private counter = 0;

  private gate = false;

  private phase = 0;

  private gain = 1.0;

  /** 8253 カウンタ値 (1-65535) を設定する。 */
  setCounter(counter: number): void {
    this.counter = Math.min(Math.max(counter, 0), 65535);
  }

  /** ゲート (PC0 SOUNDMSK 相当) を設定する。 */
  setGate(on: boolean): void {
    this.gate = on;
    if (!on) {
      this.phase = 0;
    }
  }

  /** UI ミキサーのチャンネルゲイン (0-1) を設定する。 */
  setChannelGain(gain: number): void {
    this.gain = Math.min(Math.max(gain, 0), 1);
  }

  /** 検証 / デバッグ用: カウンタ値。 */
  get counterValue(): number {
    return this.counter;
  }

  /** 検証 / デバッグ用: ゲート状態。 */
  get isGateOn(): boolean {
    return this.gate;
  }

  /** 出力周波数 (Hz)。 */
  get frequency(): number {
    return this.counter > 0 ? BeepChip.ClockHz / this.counter : 0;
  }

  /** 1 標本分を合成する (-1 〜 +1)。 */
  renderSample(sampleRate: number): number {
    if (!this.gate || this.counter <= 0) {
      return 0;
    }

    const freq = this.frequency;
    if (freq <= 0 || freq >= sampleRate / 2) {
      return 0;
    }

    this.phase += freq / sampleRate;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
    }

    return (this.phase < 0.5 ? 1 : -1) * 0.5 * this.gain;
  }

  /** VU 表示用のレベル (0-1)。 */
  get currentLevel(): number {
    return this.gate && this.counter > 0 ? 0.5 * this.gain : 0;
  }
}
