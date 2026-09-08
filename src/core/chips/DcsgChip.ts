/**
 * SN76489AN (DCSG) 相当の音源エミュレーション。
 * トーン 3ch + ノイズ 1ch。MZ-1500 の PSG クロックは 3.579545MHz。
 * f(tone) = Clock / 32 / (period + 1)、減衰量は 0 (最大) 〜 15 (無音) の 2dB/step。
 * (移植元: MzSound.Player/Chips/DcsgChip.cs)
 */
export class DcsgChip {
  static readonly ClockHz = 3579545.0;

  static readonly ChannelCount = 4; // tone0-2 + noise

  private readonly tonePeriod: number[] = new Array<number>(3).fill(0);

  private readonly attenuation: number[] = new Array<number>(DcsgChip.ChannelCount).fill(0);

  private readonly phase: number[] = new Array<number>(3).fill(0);

  /** ミキサー側チャンネルゲイン (UI 連携)。初期値 1 (鳴る状態、BEEP / FM と統一)。 */
  private readonly gain: number[] = new Array<number>(DcsgChip.ChannelCount).fill(1);

  private noiseWhite = true;

  private noiseRate = 0; // 0-2 = 分周 1/2/4、3 = tone2 連動

  private lfsr = 0x4000;

  private lfsrTimer = 0;

  /** ノイズ出力の 2 段 1-pole LPF 状態 (エイリアス抑制)。 */
  private noiseFilter1 = 0;

  /** ノイズ出力の 2 段目 LPF 状態。 */
  private noiseFilter2 = 0;

  /** ノイズ出力の DC ブロック状態 (実機の出力コンデンサ相当)。 */
  private noiseDcBlock = 0;

  /** フィルタ係数を計算したときの sampleRate (キャッシュ無効化用)。 */
  private noiseFilterRate = 0;

  /** 1-pole LPF の 1 標本あたり係数。 */
  private noiseFilterK = 0;

  /** LPF による RMS 減衰を補正するゲイン。 */
  private noiseFilterGain = 1;

  /** DC ブロックの 1 標本あたり係数。 */
  private noiseDcBlockK = 0;

  /** トーン周期レジスタ (0-1023) を設定する。 */
  setTonePeriod(channel: number, period: number): void {
    this.tonePeriod[channel] = clampInt(period, 0, 1023);
  }

  /** 減衰量 (0 = 最大音量 〜 15 = 無音) を設定する。 */
  setAttenuation(channel: number, attenuation: number): void {
    this.attenuation[channel] = clampInt(attenuation, 0, 15);
  }

  /** ノイズ制御レジスタ (波形 + 分周モード) を設定する。 */
  setNoiseControl(white: boolean, rate: number): void {
    this.noiseWhite = white;
    this.noiseRate = clampInt(rate, 0, 3);
  }

  /** UI ミキサーのチャンネルゲイン (0-1) を設定する。 */
  setChannelGain(channel: number, gain: number): void {
    this.gain[channel] = Math.min(Math.max(gain, 0), 1);
  }

  /** 検証 / デバッグ用: トーン周期レジスタ値。 */
  tonePeriodRegister(channel: number): number {
    return this.tonePeriod[channel];
  }

  /** 検証 / デバッグ用: 減衰量レジスタ値。 */
  attenuationRegister(channel: number): number {
    return this.attenuation[channel];
  }

  /** 検証 / デバッグ用: ノイズ波形 (true = white)。 */
  get isNoiseWhite(): boolean {
    return this.noiseWhite;
  }

  /** 検証 / デバッグ用: ノイズ分周モード (0-2 = 分周、3 = tone2 連動)。 */
  get noiseRateMode(): number {
    return this.noiseRate;
  }

  /** トーン周波数 (Hz)。 */
  toneFrequency(channel: number): number {
    return DcsgChip.ClockHz / 32.0 / (this.tonePeriod[channel] + 1);
  }

  /** ノイズシフトクロック (Hz)。 */
  get noiseClock(): number {
    switch (this.noiseRate) {
      case 0:
        return DcsgChip.ClockHz / 16.0 / 1.0;
      case 1:
        return DcsgChip.ClockHz / 16.0 / 2.0;
      case 2:
        return DcsgChip.ClockHz / 16.0 / 4.0;
      default:
        return this.toneFrequency(2) * 16.0; // tone2 連動
    }
  }

  /** 1 標本分を合成する (-1 〜 +1)。 */
  renderSample(sampleRate: number): number {
    let mix = 0;

    for (let ch = 0; ch < 3; ch++) {
      const gain = volumeGain(this.attenuation[ch]) * this.gain[ch];
      if (gain <= 0) {
        continue;
      }

      const freq = this.toneFrequency(ch);
      if (freq <= 0 || freq >= sampleRate / 2) {
        continue; // 聞こえない周波数は無音扱い
      }

      this.phase[ch] += freq / sampleRate;
      if (this.phase[ch] >= 1) {
        this.phase[ch] -= Math.floor(this.phase[ch]);
      }

      mix += (this.phase[ch] < 0.5 ? 1 : -1) * gain;
    }

    // ノイズ
    const noiseGain = volumeGain(this.attenuation[3]) * this.gain[3];
    if (noiseGain > 0) {
      const clock = this.noiseClock;
      if (clock > 0) {
        this.lfsrTimer += clock / sampleRate;
        while (this.lfsrTimer >= 1) {
          this.lfsrTimer -= 1;
          this.shiftLfsr();
        }

        // 実機のアナログ出力段を近似し、シフトクロック (55.9〜223.7kHz) が
        // 音声帯域を大きく超えることによるエイリアス高音 (折り返し雑音) を減衰する。
        // 2 段 1-pole LPF (8kHz) + RMS 補正 + DC ブロック (出力コンデンサ相当)。
        if (this.noiseFilterRate !== sampleRate) {
          this.noiseFilterRate = sampleRate;
          this.noiseFilterK = 1 - Math.exp((-2 * Math.PI * NoiseFilterCutoffHz) / sampleRate);
          // 2 段 1-pole の白色入力に対する RMS 減衰 (= k / (2 - k)) を補正する
          this.noiseFilterGain = (2 - this.noiseFilterK) / this.noiseFilterK;
          this.noiseDcBlockK = 1 - Math.exp((-2 * Math.PI * NoiseDcBlockCutoffHz) / sampleRate);
        }

        const level = (this.lfsr & 1) !== 0 ? 1 : -1;
        this.noiseFilter1 += (level - this.noiseFilter1) * this.noiseFilterK;
        this.noiseFilter2 += (this.noiseFilter1 - this.noiseFilter2) * this.noiseFilterK;

        // DC ブロック: 周期ノイズ (bit0 循環) の DC 成分を実機の出力コンデンサ相当で除去する
        this.noiseDcBlock += (this.noiseFilter2 - this.noiseDcBlock) * this.noiseDcBlockK;
        mix += (this.noiseFilter2 - this.noiseDcBlock) * this.noiseFilterGain * noiseGain;
      }
    } else {
      this.lfsrTimer = 0;
    }

    return mix * 0.25;
  }

  /** VU 表示用のチャンネルレベル (0-1、ゲイン反映済み)。 */
  channelLevel(channel: number): number {
    const att = this.attenuation[channel];
    return att >= 15 ? 0 : volumeGain(att) * Math.min(Math.max(this.gain[channel], 0), 1);
  }

  private shiftLfsr(): void {
    // TMS 系 15bit LFSR: white = bit0 XOR bit3、periodic = bit0 をフィードバック
    // (AND フィードバックで実装すると LFSR が 0x0000 へ吸引され、
    //  白噪が数ミリ秒で永久無音化するため XOR が正仕様。
    //  C# オリジナルは AND 実装のため意図的な差分 — web_core_port.md §3.1 参照)
    const bit0 = this.lfsr & 1;
    const bit = this.noiseWhite ? bit0 ^ ((this.lfsr >> 3) & 1) : bit0;
    this.lfsr = (this.lfsr >> 1) | (bit << 14);
  }
}

/** 減衰量 1 ステップあたりの dB (2dB/step)。 */
const AttenuationStepDb = 2.0;

/**
 * ノイズ出力のローパスカットオフ (Hz)。
 * 実機のアナログ出力段 (RC LPF) を近似し、ノイズシフトクロック (55.9〜223.7kHz) が
 * 音声帯域 (ナイキスト 24kHz) を大きく超えることによるエイリアス高音 (折り返し雑音) を
 * 減衰する。仮想キーボード (virtualSynth.ts) の白噪 lowpass 8kHz と同一基準。
 */
const NoiseFilterCutoffHz = 8000;

/**
 * ノイズ出力の DC ブロックカットオフ (Hz)。
 * 周期ノイズ (bit0 循環) が持つ DC 成分を実機の出力コンデンサ相当で除去する。
 */
const NoiseDcBlockCutoffHz = 30;

/** 減衰量 → 線形音量 (2dB/step の対数近似)。 */
function volumeGain(attenuation: number): number {
  return attenuation >= 15 ? 0 : Math.pow(10, (-attenuation * AttenuationStepDb) / 20.0);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
