/**
 * 演奏位置 → MML ソース位置の対応を解決するハイライト・トラッキング用ユーティリティ。
 * コンパイル時に生成した MmlMap (トラックごとのイベント ↔ ソース位置対応) と、
 * Player.getTrackOffset が返す現在データオフセットを突き合わせて、
 * 各トラックが「現在到達している」MML 上のイベント位置を算出する。
 * Monaco 等の UI に依存しない純粋ロジックとして実装している。
 */
import type { MmlMap, MmlMapTrack } from '../core/mml/MmlMap';
import type { MmlMapEvent } from '../core/mml/parser/MmlParserTypes';

/** 演奏位置 → MML 対応情報 (コンパイル成功時に App が保持)。 */
export interface PlaybackMapInfo {
  /** コンパイル結果のハイライト用マップ (失敗時は null)。 */
  map: MmlMap | null;

  /** コンパイル対象の MML ソース (編集によるズレ防止のため表示元ソースと照合する)。 */
  source: string;
}

/** 1 トラック分の「現在到達している」MML 上のイベント位置。 */
export interface MmlPlaybackPosition {
  readonly trackId: string;

  readonly trackIndex: number;

  /** MML ソースの 1-based 行番号。 */
  readonly line: number;

  /** MML ソースの 1-based 列位置 (連符由来のイベントは 0 = 不定)。 */
  readonly column: number;

  /** MML ソース上の発音トークン長 (文字数)。連符由来は 0。 */
  readonly length: number;

  /** イベント種別 (note / rest)。 */
  readonly kind: string;
}

/**
 * 全トラックの現在演奏位置を MML 上のイベントへ解決する。
 * @param map コンパイル結果の MmlMap
 * @param getTrackOffset トラックインデックス → 現在データオフセット (MZSD データ先頭基準、停止中は -1)
 * @returns 演奏中トラックの位置リスト (停止中 / 未開始トラックは除外)
 */
export function resolvePlaybackPositions(
  map: MmlMap,
  getTrackOffset: (trackIndex: number) => number,
): MmlPlaybackPosition[] {
  const positions: MmlPlaybackPosition[] = [];

  for (const track of map.tracks) {
    const absolute = getTrackOffset(track.index);
    if (absolute < 0) {
      continue;
    }

    // Player のオフセットは MZSD データ先頭基準 / イベントはトラックデータ先頭基準のため変換する
    const relative = absolute - track.offset;
    if (relative < 0) {
      continue;
    }

    const event = findActiveEvent(track, relative);
    if (event !== null) {
      positions.push({
        trackId: track.id,
        trackIndex: track.index,
        line: event.line,
        column: event.column,
        length: event.length,
        kind: event.kind,
      });
    }
  }

  return positions;
}

/**
 * トラックのイベント列から、指定オフセットに到達済みの最新イベントを二分探索する。
 * @returns 見つからない場合 (トラック先頭未満) は null
 */
export function findEventAtOffset(track: MmlMapTrack, offset: number): MmlMapEvent | null {
  const events = track.events;

  let low = 0;
  let high = events.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (events[mid].offset <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found >= 0 ? events[found] : null;
}

/**
 * 指定オフセット (トラックデータ先頭基準) で「演奏が到達している」イベントを二分探索する。
 * シーケンサは NOTE / REST 命令を読み終えた直後 (開始位置 + 命令サイズ) から発音を
 * 開始するため、命令サイズを加算した位置を基準に判定する。
 * @returns 見つからない場合 (最初の音符 / 休符に到達していない) は null
 */
export function findActiveEvent(track: MmlMapTrack, relative: number): MmlMapEvent | null {
  const events = track.events;

  let low = 0;
  let high = events.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (events[mid].offset + mzsdEventSize(events[mid]) <= relative) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found >= 0 ? events[found] : null;
}

/** NOTE / REST 命令のバイトサイズ (MzsdOp の NOTE = op+note+len2+gate2 / REST = op+len2)。 */
function mzsdEventSize(event: MmlMapEvent): number {
  return event.kind === 'rest' ? 3 : 6;
}
