/**
 * MML パーサの内部状態型。
 * (移植元: MzSound.MmlCompiler/Internal/MmlParserTypes.cs)
 */
import type { TrackId } from '../TrackId';

/** バイナリ上のイベント 1 件と MML ソース位置の対応。 */
export interface MmlMapEvent {
  /** トラックデータ先頭からのイベント開始位置。 */
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  /** MML ソース上の長さ (文字数)。 */
  readonly length: number;
  /** イベント種別 (note / rest / control)。 */
  readonly kind: string;
  /** 演奏開始フレーム (0-based / 曲先頭基準 / 60Hz)。部分再生の開始位置解決に使用。 */
  readonly startFrame: number;
  /** 音符 / 休符の長さ (フレーム数)。部分再生の終了位置解決に使用。 */
  readonly durationFrames: number;
}

/** トラックごとのコンパイル中状態。 */
export class TrackState {
  octave = 4;
  defaultLength = 4;
  volume = 15;
  quantize = 7;
  /** @q 使用時のゲートカット フレーム数 (-1 = 未使用、優先される)。 */
  quantizeFrames = -1;
  transpose = 0;
  detune = 0;
  volumeEnvIndex = -1;
  pitchEnvIndex = -1;
  sweep = 0;
  /** @WN で指定したノイズ波形 (0 = periodic / 1 = white)。N1 / N2 トラック専用。 */
  noiseWhite = 1;
  /** @IN で指定したノイズ統合モード (0 = 解除 / 1 = periodic 連動 / 2 = white 連動)。P3 / P6 トラック専用。 */
  noiseIntegrate = 0;
}

/** タイ (^) で延長対象となる直前 NOTE/REST の長さフィールド位置。 */
export interface NotePatch {
  readonly offset: number;
  readonly isNote: boolean;
}

/** トラック 1 つ分のコード生成バッファ。 */
export class TrackBuilder {
  readonly track: TrackId;
  readonly state = new TrackState();
  readonly code: number[] = [];
  readonly events: MmlMapEvent[] = [];

  /** 累積演奏時刻 (秒)。 */
  tickSeconds = 0;

  notePatch: NotePatch | null = null;

  loopDepth = 0;

  /** 全体ループ (L) のコード位置 (無い場合は -1)。 */
  wholeLoopOffset = -1;

  constructor(track: TrackId) {
    this.track = track;
  }
}

/** パース結果。 */
export class ParseResult {
  readonly tracks = new Map<number, TrackBuilder>();

  /** 四分音符あたりのフレーム数 (60Hz)。テンポはここで管理する。 */
  quarterFrames = 30;

  wholeLoopEnabled = false;
}
