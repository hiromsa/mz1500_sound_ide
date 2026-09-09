/**
 * MZ-1500 のサウンドデバイス一式。
 * PSG1 = L チャンネル (F2h)、PSG2 = R チャンネル (F3h)、BEEP = 8253 Ch.0、
 * FM = YM2151 (OPM ボード)。
 * (移植元: MzSound.Player/Chips/ChipBank.cs)
 */
import { BeepChip } from './BeepChip';
import { DcsgChip } from './DcsgChip';
import { Ym2151 } from './fm/Ym2151';

const FmChannelCount = 8;

export class ChipBank {
  /** 初期ゲイン = 1 (鳴る状態)。 */
  private readonly fmChannelGains: number[] = [1, 1, 1, 1, 1, 1, 1, 1];

  private fmMuteMask = 0;

  readonly psg1 = new DcsgChip();

  readonly psg2 = new DcsgChip();

  readonly beep = new BeepChip();

  /** YM2151 (OPM) — fmgen 由来のエミュレーション (Mz1500.Core より移植)。 */
  readonly fm = new Ym2151(DcsgChip.ClockHz);

  /**
   * FM チャンネルのゲイン (UI ミキサー用)。
   * 0 でミュート (channel mask)、それ以外は TL トリム値としてシーケンサから参照される。
   */
  setFmGain(channel: number, gain: number): void {
    this.fmChannelGains[channel] = Math.min(Math.max(gain, 0), 1);

    let mask = 0;
    for (let i = 0; i < FmChannelCount; i++) {
      if (this.fmChannelGains[i] <= 0.001) {
        mask |= 1 << i;
      }
    }

    this.fmMuteMask = mask;
    this.fm.setChannelMask(mask);
  }

  /** FM チャンネルの TL 追加減衰量 (0-127)。フェーダー音量を TL へ反映する。 */
  getFmTrim(channel: number): number {
    return Math.round((1 - Math.min(Math.max(this.fmChannelGains[channel], 0), 1)) * 127);
  }

  /** FM チャンネルの VU レベル (0-1)。Key On 状態と TL から算出する簡易実装。 */
  getFmLevel(channel: number): number {
    if (this.fmChannelGains[channel] <= 0.001) {
      return 0;
    }

    // KEYON ($08) は全チャンネル共有レジスタのため、チャンネル毎に追跡した
    // キーオン状態を使う (書き戻し値の参照では最後に操作した 1 ch しか判定できない)
    if (!this.fm.isKeyOn(channel)) {
      return 0;
    }

    // シーケンサは 4 op 同一 TL を書くため op0 を代表値として読む
    const tl = this.fm.tryGetRegister(0x60 + channel);
    if (tl === null) {
      return 0;
    }

    return Math.min(Math.max(1.0 - tl.value / 127.0, 0), 1) * this.fmChannelGains[channel];
  }

  /** 検証 / デバッグ用: 現在の FM ミュートマスク。 */
  get currentFmMuteMask(): number {
    return this.fmMuteMask;
  }

  /**
   * 全チップを即時消音する。
   * 部分再生 (Z80 ドライバモード) の範囲終端処理で、ドライバのワークメモリを
   * 操作せずに確実に無音へ遷移させるために使用する。
   */
  silenceAll(): void {
    for (const chip of [this.psg1, this.psg2]) {
      for (let channel = 0; channel < DcsgChip.ChannelCount; channel++) {
        chip.setAttenuation(channel, 15);
      }
    }

    this.beep.setGate(false);

    // FM 全チャンネルの Key Off (slot bits = 0 のチャンネル指定レジスタ)
    for (let channel = 0; channel < FmChannelCount; channel++) {
      this.fm.setReg(0x08, channel);
    }
  }
}
