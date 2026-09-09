/**
 * エディタ上のキャレット位置 / 選択範囲から、部分再生すべき音楽的な時間範囲 (フレーム) を解決する。
 * コンパイル結果の MmlMap (イベント ↔ ソース位置 + 演奏開始フレーム対応) を入力とし、
 * 文字列の切り出しではなくトークン (イベント) 単位・Tick (フレーム) ベースで範囲を求めるため、
 * 中途半端な構文境界の選択 (`c4 e4` の `4 e` のみ等) でもパースや再生が破綻しない。
 * Monaco 等の UI に依存しない純粋ロジックとして実装している。
 */
import type { MmlMap } from '../core/mml/MmlMap';
import type { MmlMapEvent } from '../core/mml/parser/MmlParserTypes';
import type { PlaybackRange } from '../core/player/PlaybackRange';

/** 部分再生の要求種別。 */
export type PlaybackRequestKind = 'caret' | 'selection';

/**
 * エディタ上の部分再生要求。
 * 行 / 列は Monaco と同一の 1-based 座標系で、パーサーが記録する MmlMapEvent の
 * line / column (1-based) と直接比較できる。
 * endColumn は終端文字の「次の位置」(Monaco Selection 準拠・排他的)。
 */
export interface PlaybackRangeRequest {
  readonly kind: PlaybackRequestKind;

  readonly startLine: number;

  readonly startColumn: number;

  /** 選択範囲の終端行 (kind = 'selection' のみ使用)。 */
  readonly endLine?: number;

  /** 選択範囲の終端列・排他的 (kind = 'selection' のみ使用)。 */
  readonly endColumn?: number;
}

/** 部分再生範囲の解決結果 (秒表記はコンソールログ / UI 表示用)。 */
export interface ResolvedPlaybackRange extends PlaybackRange {
  readonly startSeconds: number;

  readonly endSeconds: number | null;

  /** 範囲に含まれた発音イベント数 (デバッグログ用)。 */
  readonly eventCount: number;
}

/**
 * イベントのソース上の占有区間 (1-based 列 / 半開区間)。
 * 連符内音符 (column = 0) は列位置を持たないため、直前の位置確定トークン列位置 〜
 * 次の位置確定トークン列位置の区間で近似する。
 */
interface EventSpan {
  readonly line: number;

  readonly startColumn: number;

  readonly endColumn: number;
}

/** 60Hz 基準のフレーム数を秒へ変換する。 */
export function framesToSeconds(frames: number): number {
  return frames / 60;
}

/**
 * 全トラックの MmlMap を走査し、部分再生の時間範囲を解決する。
 *
 * - キャレット再生 (kind = 'caret'): 各トラックの「キャレット位置以降で最初のイベント」の
 *   開始フレームの最小値を開始とし、曲末尾まで再生する。
 * - 選択範囲再生 (kind = 'selection'): 選択範囲に含まれるイベントの
 *   開始フレーム最小値 〜 終了フレーム (startFrame + durationFrames の最大値) まで再生する。
 *
 * どちらの種別でも、開始フレームに含まれない区間はプレイヤーのプリシークにより
 * 「発音せず内部状態のみ進行」するため、開始位置直前までの v / o / @ / l 等の
 * コマンド状態が正確に引き継がれる。
 *
 * @returns 範囲内に再生可能なイベントが 1 つも無い場合は null (呼び出し側で案内表示)
 */
export function resolvePlaybackRange(map: MmlMap, request: PlaybackRangeRequest): ResolvedPlaybackRange | null {
  const isCaret = request.kind === 'caret';
  const endLine = request.endLine ?? request.startLine;
  const endColumn = request.endColumn ?? request.startColumn;

  let startFrame = Number.POSITIVE_INFINITY;
  let endFrameMax = -1;
  let eventCount = 0;

  for (const track of map.tracks) {
    const spans = buildEventSpans(track.events);

    for (let i = 0; i < track.events.length; i++) {
      const span = spans[i];
      if (!containsSpan(request, isCaret, endLine, endColumn, span)) {
        continue;
      }

      const event = track.events[i];
      eventCount++;
      startFrame = Math.min(startFrame, event.startFrame);
      endFrameMax = Math.max(endFrameMax, event.startFrame + event.durationFrames);
    }
  }

  if (eventCount === 0 || !Number.isFinite(startFrame)) {
    return null;
  }

  // キャレット再生は曲末尾まで、選択範囲再生は範囲内最後の音符 / 休符の終了時刻まで
  const endFrame: number | null = isCaret ? null : endFrameMax;

  return {
    startFrame,
    endFrame,
    startSeconds: framesToSeconds(startFrame),
    endSeconds: endFrame === null ? null : framesToSeconds(endFrame),
    eventCount,
  };
}

/**
 * トラックのイベント列をソース上の列区間へ写像する。
 *
 * - 位置確定イベント (column > 0): トークン開始列を基点とする 1 列幅の区間。
 * - 連符内音符 (column = 0): 列位置が記録されないため、直前の位置確定トークン列位置 〜
 *   次の位置確定トークン列位置の区間で近似する (連符は先頭トークン単位で判定される)。
 *   前後に位置確定トークンが無い場合は行末までを区間とする (多めに鳴る方向へ倒して破綻を防ぐ)。
 */
function buildEventSpans(events: readonly MmlMapEvent[]): EventSpan[] {
  const spans: EventSpan[] = [];
  let lastKnownColumn = 0;

  for (const event of events) {
    if (event.column > 0) {
      lastKnownColumn = event.column;
      spans.push({ line: event.line, startColumn: event.column, endColumn: event.column + 1 });
    } else {
      spans.push({ line: event.line, startColumn: lastKnownColumn, endColumn: Number.POSITIVE_INFINITY });
    }
  }

  // 連符区間の終端を「次の位置確定イベントの列位置」で確定する (後ろから走査)
  let nextKnownColumn = Number.POSITIVE_INFINITY;
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].endColumn !== Number.POSITIVE_INFINITY) {
      nextKnownColumn = spans[i].startColumn;
      continue;
    }

    spans[i] = { ...spans[i], endColumn: nextKnownColumn };
  }

  return spans;
}

/** イベントの占有区間 (1-based 行 / 列) が部分再生対象の範囲に含まれるか判定する。 */
function containsSpan(
  request: PlaybackRangeRequest,
  isCaret: boolean,
  endLine: number,
  endColumn: number,
  span: EventSpan,
): boolean {
  if (isCaret) {
    if (span.line > request.startLine) {
      return true;
    }

    if (span.line < request.startLine) {
      return false;
    }

    // 同一行: 区間終端がキャレットより後ろなら「キャレット以降に開始するイベント」
    // または「キャレットを含む連符」に該当する
    return span.endColumn > request.startColumn;
  }

  if (span.line < request.startLine || span.line > endLine) {
    return false;
  }

  if (span.line > request.startLine && span.line < endLine) {
    return true;
  }

  if (span.line === request.startLine && span.line === endLine) {
    return span.startColumn < endColumn && span.endColumn > request.startColumn;
  }

  if (span.line === request.startLine) {
    return span.endColumn > request.startColumn;
  }

  return span.startColumn < endColumn;
}