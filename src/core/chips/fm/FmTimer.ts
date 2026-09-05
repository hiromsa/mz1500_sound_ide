/**
 * FM 音源のタイマーモジュール (Timer A/B、オーバーフローステータス、CSM 対応)。
 * (移植元: fmgen fmtimer.cpp → MzSound.Player/Chips/Fm/FmTimer.cs)
 */
export abstract class FmTimer {
  protected status = 0;

  protected regtc = 0;

  private readonly regta: number[] = [0, 0];

  private timera = 0;

  private timeraCount = 0;

  private timerb = 0;

  private timerbCount = 0;

  private prescaler = 0;

  constructor() {
    this.timera = 0;
    this.timerb = 0;
  }

  /** タイマカウンタをクリアする (リセット)。 */
  reset(): void {
    this.timeraCount = 0;
    this.timerbCount = 0;
  }

  /**
   * 両タイマを指定チップクロック数だけ進める。
   * @returns タイマオーバーフロー (イベント) が発生したら true。
   */
  count(clocks: number): boolean {
    let event = false;

    if (this.timeraCount !== 0) {
      this.timeraCount -= clocks;
      if (this.timeraCount <= 0) {
        event = true;
        this.timerA();
        while (this.timeraCount <= 0) {
          this.timeraCount += this.timera * this.prescaler;
        }

        if ((this.regtc & 4) !== 0) {
          this.setStatus(1);
        }
      }
    }

    if (this.timerbCount !== 0) {
      this.timerbCount -= clocks;
      if (this.timerbCount <= 0) {
        event = true;
        while (this.timerbCount <= 0) {
          this.timerbCount += this.timerb * this.prescaler;
        }

        if ((this.regtc & 8) !== 0) {
          this.setStatus(2);
        }
      }
    }

    return event;
  }

  /** 次のタイマオーバーフローまでのチップクロック数 (0: 両方停止中)。 */
  getNextEvent(): number {
    if (this.timeraCount > 0 && this.timerbCount > 0) {
      return Math.min(this.timeraCount, this.timerbCount);
    }

    if (this.timeraCount > 0) {
      return this.timeraCount;
    }

    if (this.timerbCount > 0) {
      return this.timerbCount;
    }

    return 0;
  }

  protected setTimerPrescaler(prescaler: number): void {
    this.prescaler = prescaler;
  }

  protected setTimerA(addr: number, data: number): void {
    this.regta[addr & 1] = data;
    this.timera = 1024 - ((this.regta[0] << 2) + (this.regta[1] & 3));
  }

  protected setTimerB(data: number): void {
    this.timerb = (256 - data) << 4;
  }

  protected setTimerControl(data: number): void {
    const changes = this.regtc ^ data;
    this.regtc = data;

    if ((data & 0x10) !== 0) {
      this.resetStatus(1);
    }

    if ((data & 0x20) !== 0) {
      this.resetStatus(2);
    }

    if ((changes & 0x01) !== 0) {
      this.timeraCount = (data & 1) !== 0 ? this.timera * this.prescaler : 0;
    }

    if ((changes & 0x02) !== 0) {
      this.timerbCount = (data & 2) !== 0 ? this.timerb * this.prescaler : 0;
    }
  }

  protected abstract setStatus(bits: number): void;

  protected abstract resetStatus(bits: number): void;

  /** Timer A オーバーフロー時に呼ばれる。OPM では CSM キーコントロールを実装。 */
  protected timerA(): void {}
}