/**
 * 演奏位置ハイライト用のデバッグ情報 (.mmlmap サイドファイル相当)。
 * (移植元: MzSound.MmlCompiler/MmlMap.cs)
 */
import type { MmlMapEvent } from './parser/MmlParserTypes';

export interface MmlMapTrack {
  readonly id: string;
  readonly index: number;
  /** トラックデータの開始オフセット (データ先頭から)。 */
  readonly offset: number;
  readonly events: readonly MmlMapEvent[];
}

/** 演奏位置ハイライト用のデバッグ情報。 */
export interface MmlMap {
  readonly version: number;
  readonly tracks: readonly MmlMapTrack[];
}
