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

  private lfsr = 0x8000;

  private lfsrTimer = 0;

  /** ノイズ出力の 2 段 1-pole LPF 状態 (エイリアス抑制)。 */
  private noiseFilter1 = 0;

  /** ノイズ出力の 2 段目 LPF 状態。 */
  private noiseFilter2 = 0;

  /** ノイズ出力の DC ブロック状態 (実機の出力コンデンサ相当)。 */
  private noiseDcBlock = 0;

  /** フィルタ係数を計算したときの sampleRate (キャッシュ無効化用)。 */
  private noiseFilterRate = 0;

  /** フィルタ係数を計算したときの LPF カットオフ (キャッシュ無効化用)。 */
  private noiseFilterCutoff = 0;

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

  /**
   * 音名 → 非連動ノイズの分周レート (0-2)。
   * c〜d# = 2 (低) / e〜f# = 1 (中) / g〜b = 0 (高)。オクターブは問わない。
   * SourceInterpreter / 実機ドライバ / 仮想キーボードの共通規約であり、
   * 実機ドライバ (8bit レジスタ) と同じ桁落ち規約 (note & 0xff) を適用する。
   */
  static noiseRateForNote(note: number): number {
    return DcsgChip.noiseRateByDegree[(note & 0xff) % 12];
  }

  /**
   * 非連動ノイズの分周モード (0-2) に対応する出力 LPF カットオフ (Hz)。
   * ホワイトノイズは低いレートほど沈んだ音 (2 / 4 / 8kHz)。周期ノイズは基本波
   * (= シフトクロック / 16) 自体が音の高さのため固定 8kHz のまま (rate 差は基本波で決まる)。
   */
  static lpfCutoffForRate(rate: number, white: boolean): number {
    if (!white) {
      return NoiseFilterCutoffHz; // 周期ノイズ: 基本波が音の高さ = 固定 LPF
    }

    switch (clampInt(rate, 0, 3)) {
      case 1:
        return 4000; // Clock/32
      case 2:
        return 2000; // Clock/64
      default:
        return NoiseFilterCutoffHz; // rate 0 (Clock/16) / rate 3 (tone2 連動)
    }
  }

  /** 非連動ノイズの分周モード (0-2) における周期ノイズ基本波 (Hz) (= シフトクロック / 16)。 */
  static periodicCenterForRate(rate: number): number {
    return DcsgChip.ClockHz / 256.0 / 2 ** clampInt(rate, 0, 2);
  }

  /** 音名 (オクターブ内の 12 半音、c = 0) → 分周レート。 */
  private static readonly noiseRateByDegree: readonly number[] = [
    2, 2, 2, 2, // c, c#, d, d#
    1, 1, 1, // e, f, f#
    0, 0, 0, 0, 0, // g, g#, a, a#, b
  ];

  /**
   * 実機 10bit トーン周期レジスタで発音可能な最低 MIDI ノート (A2 = 110Hz)。
   * period = round(Clock/32/110) - 1 = 1016 ≤ 1023 に対し、
   * 1 つ下の G#2 (103.8Hz) は period 1076 となりレジスタ上限を超えるため発音不可。
   * 仮想キーボードの鍵盤有効判定に使用する。
   */
  static readonly LowestMidiNote = 45;

  /** MaxTonePeriod (レジスタ bit 数 10 相当)。 */
  static readonly MaxTonePeriod = 1023;

  /**
   * 周波数 (Hz) → 実機 10bit トーン周期レジスタ値 (0-1023 にクランプ)。
   * TrackSequencer / Z80 アセンブラ (dcsgPeriodFor) と同一の変換式。
   * レジスタ上限を超える低音 (period > 1023) は最低周波数へ丸められる (= 実機で鳴る音)。
   */
  static tonePeriodForFrequency(frequency: number): number {
    const safeFrequency = Math.max(frequency, 1.0);
    const period = Math.round(DcsgChip.ClockHz / 32.0 / safeFrequency) - 1;
    return Math.min(DcsgChip.MaxTonePeriod, Math.max(0, period));
  }

  /** トーン周期レジスタ値 → 実際の出力周波数 (Hz)。 */
  static toneFrequencyForPeriod(period: number): number {
    return DcsgChip.ClockHz / 32.0 / (clampInt(period, 0, DcsgChip.MaxTonePeriod) + 1);
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

  /** 検証 / デバッグ用: ノイズ LFSR の現在状態。 */
  get lfsrState(): number {
    return this.lfsr;
  }

  /** 検証 / デバッグ用: ノイズ LFSR を現在の波形モードで 1 ステップ進める。 */
  advanceLfsrForTest(): void {
    this.shiftLfsr();
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
        // 2 段 1-pole LPF + RMS 補正 + DC ブロック (出力コンデンサ相当)。
        // LPF カットオフは分周モード連動 (rate 0/3 = 8kHz / 1 = 4kHz / 2 = 2kHz) で、
        // 音名 3 段階 (c/e/g) が明るさの違いとして聞こえるようにしている。
        const lpfCutoff = DcsgChip.lpfCutoffForRate(this.noiseRate, this.noiseWhite);
        if (this.noiseFilterRate !== sampleRate || this.noiseFilterCutoff !== lpfCutoff) {
          this.noiseFilterRate = sampleRate;
          this.noiseFilterCutoff = lpfCutoff;
          this.noiseFilterK = 1 - Math.exp((-2 * Math.PI * lpfCutoff) / sampleRate);
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
    // SN76489AN 相当の 16bit LFSR: white = bit0 XOR bit3、periodic = bit0 を bit15 へフィードバック。
    // (AND フィードバックで実装すると LFSR が 0x0000 へ吸引され、
    //  白噪が数ミリ秒で永久無音化するため XOR が正仕様。
    //  また 15bit レジスタ + bit14 挿入ではタップ (0,3) が最大長から外れて
    //  63 ステップの短い循環 (= 約 890Hz のブザー音) になるため、実機と同じ 16bit とする。
    //  C# オリジナルは AND 実装のため意図的な差分 — web_core_port.md §3.1 参照)
    const bit0 = this.lfsr & 1;
    const bit = this.noiseWhite ? bit0 ^ ((this.lfsr >> 3) & 1) : bit0;
    this.lfsr = (this.lfsr >> 1) | (bit << 15);
  }
}

/** 減衰量 1 ステップあたりの dB (2dB/step)。 */
const AttenuationStepDb = 2.0;

/**
 * ノイズ出力のローパスカットオフ上限 (Hz)。
 * 実機のアナログ出力段 (RC LPF) を近似し、ノイズシフトクロック (55.9〜223.7kHz) が
 * 音声帯域 (ナイキスト 24kHz) を大きく超えることによるエイリアス高音 (折り返し雑音) を
 * 減衰する。rate 0 / 3 (最も明るい分周モード) のカットオフであり、rate 1 / 2 は
 * `lpfCutoffForRate` により 4kHz / 2kHz へ下げて音名 3 段階 (c/e/g) の明るさ差を作る。
 * 仮想キーボード (virtualSynth.ts) も同一基準 (`DcsgChip.lpfCutoffForRate`) を使用する。
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
