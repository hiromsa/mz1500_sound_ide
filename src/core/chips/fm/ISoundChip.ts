/**
 * ステレオサンプルストリームへ自らを合成する音源チップの共通インターフェース。
 * チップは常にマシンのタイムラインとロックステップで動作し、{@link ISoundChip.mix}
 * の 1 呼び出しでちょうど sampleCount 分の新しいステレオ標本 (L/R インターリーブ)
 * を生成してバッファへ加算する (バッファはクリアしない)。
 * (移植元: MzSound.Player/Chips/Fm/ISoundChip.cs)
 */

/** インターリーブ・ステレオ (L, R) の int32 標本バッファ (C# の Span<int> 相当)。 */
export type StereoSampleBuffer = Int32Array;

export interface ISoundChip {
  /** 診断やデバッガで使用するチップ名。 */
  readonly name: string;

  /** チップを電源投入時の状態 (レジスタと内部タイミング) に戻す。 */
  reset(): void;

  /** 指定された出力サンプルレート (Hz) 向けに標本生成を準備する。 */
  initialize(sampleRateHz: number): void;

  /** sampleCount 分のステレオ・インターリーブ標本をバッファへ加算する。 */
  mix(buffer: StereoSampleBuffer, sampleCount: number): void;
}