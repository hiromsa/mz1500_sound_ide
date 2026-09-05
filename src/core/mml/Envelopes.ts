/**
 * エンベロープ・音色マクロの定義型。
 * (移植元: MzSound.MmlCompiler/Envelopes.cs)
 */

/** 音量エンベロープ (@v)。1 要素 = 1 フレーム。 */
export interface VolumeEnvelope {
  readonly number: number;
  readonly values: readonly number[];
  /** ループ位置 (無い場合は -1)。 */
  readonly loopIndex: number;
  /** リリース位置 (無い場合は -1)。@v のみ対応。 */
  readonly releaseIndex: number;
}

/** ピッチエンベロープ (@EP)。値は音源ごとのレジスタ差分。 */
export interface PitchEnvelope {
  readonly number: number;
  readonly values: readonly number[];
  readonly loopIndex: number;
}

/** FM 音色 (@FM)。YM2151 用 46 パラメータ。 */
export interface FmTone {
  readonly number: number;
  readonly parameters: readonly number[];
}

export const FmToneParameterCount = 46;
