/**
 * NOTE PREVIEW (打鍵プレビュー) のロジック層。
 *
 * MML エディタへのテキスト変更 (タイピング / ペースト / Undo 等) を集計し、
 * 「入力が一旦停止した時点 (デバウンス)」で入力された音符・休符トークン範囲を
 * 部分再生要求 (PlaybackRangeRequest 互換の 1-based 行 / 列) へ変換する。
 * 既存の SELECTION (選択範囲再生) と同じ `resolvePlaybackRange` 経路へ渡すため、
 * 音符トークンは MML 本来の音長 (Tick ベース) で 1 回だけ演奏される。
 *
 * Monaco / React に依存しない純粋関数として実装しており、単体テスト可能。
 */

/** デバウンス発火までの待機時間 (ms)。入力停止からこの時間経過した時点でプレビュー演奏する。 */
export const NOTE_PREVIEW_DEBOUNCE_MS = 500;

/** デバウンス期間中に編集されたソース上のオフセット区間 (半開区間 [startOffset, endOffset))。 */
export interface PreviewChangedRange {
  startOffset: number;
  endOffset: number;
  /** 発音につながる実質的な変更 (非空白の挿入 / 削除・置換) が含まれるかどうか。 */
  hasContentChange: boolean;
}

/** Monaco の 1 変更 (`IModelContentChange` 相当) の最小情報。 */
export interface PreviewModelContentChange {
  /** 変更開始位置のモデル上オフセット (0-based)。 */
  rangeOffset: number;
  /** 変更で置き換えられた元テキストの長さ (削除時のみ > 0)。 */
  rangeLength: number;
  /** 挿入されたテキスト (削除時は空文字)。 */
  text: string;
}

/**
 * 1 変更をデバウンス期間中の変更区間へ合算する。
 *
 * - 挿入: rangeOffset 〜 rangeOffset + text.length
 * - 削除: rangeOffset 〜 rangeOffset + rangeLength
 * を全て包含するよう現在の区間を拡張する (複数変更・Undo 等にも対応)。
 *
 * 空白のみの挿入 (`c4 ` のスペース入力等) は発音対象の実質変更として扱わない
 * (削除・置換は消えた内容を判別できないため常に実質変更)。
 */
export function accumulatePreviewChange(
  current: PreviewChangedRange | null,
  change: PreviewModelContentChange,
): PreviewChangedRange {
  const changeStart = change.rangeOffset;
  const changeEnd = change.rangeOffset + Math.max(change.rangeLength, change.text.length);
  const significant = change.rangeLength > 0 || /\S/.test(change.text);
  if (current === null) {
    return { startOffset: changeStart, endOffset: changeEnd, hasContentChange: significant };
  }
  return {
    startOffset: Math.min(current.startOffset, changeStart),
    endOffset: Math.max(current.endOffset, changeEnd),
    hasContentChange: current.hasContentChange || significant,
  };
}

/** 発音対象の変更区間かどうか (実質的な変更 (非空白の挿入 / 削除・置換) を含むこと)。 */
export function hasPreviewChanges(range: PreviewChangedRange | null): boolean {
  return range !== null && range.hasContentChange;
}

/** 音符 (音名) または休符トークンの開始文字かどうか (MML は小文字のみ有効・正式パーサ準拠)。 */
function isNoteOrRestStart(ch: string): boolean {
  return ch >= 'a' && ch <= 'g' || ch === 'r';
}

/** 音符 / 休符トークンの継続部分 (臨時記号・音長数字・付点) として後方走査を続けられる文字かどうか。 */
function isNoteTokenContinuation(ch: string): boolean {
  return ch === '+' || ch === '#' || ch === '-' || ch === '.' || (ch >= '0' && ch <= '9');
}

/**
 * 編集開始オフセットを、それが属する音符・休符トークンの開始オフセットへ拡張する。
 *
 * `c4` の `4` を入力しただけの場合、SELECTION 解決 (イベント開始位置ベース) には
 * `c` の開始位置が含まれず無音になるため、範囲始点をトークン先頭まで戻す。
 *
 * - 後方へ走査し、音名 (`a`-`g`) または休符 (`r`) に到達したらその位置を返す
 * - 走査を跨げるのはトークン継続部分 (臨時記号 `+` `#` `-` / 音長数字 / 付点 `.`) のみ
 * - 行頭 (`\n`) / 行コメント開始 (`;` / `/`) / 空白やコマンド文字 (`v` `o` `@` 等へは
 *   跨がない (コマンド数値入力で直前の音符が鳴ってしまうのを防止)
 *
 * @returns 拡張後の開始オフセット (拡張できない場合は元の offset をそのまま返す)
 */
export function expandToTokenStart(text: string, offset: number): number {
  const clamped = Math.min(Math.max(offset, 0), text.length);
  // テキスト範囲外の異常なオフセット (削除等による位置ずれ) は拡張せずクランプ位置のまま返す
  if (offset > text.length || offset < 0) return clamped;
  let i = clamped;
  while (i > 0) {
    const prev = text[i - 1];
    if (prev === '\n' || prev === ';' || prev === '/') break;
    if (isNoteOrRestStart(prev)) return i - 1;
    if (isNoteTokenContinuation(prev)) {
      i--;
      continue;
    }
    break; // 空白 / コマンド / `@` 系等はトークン継続ではないため拡張しない
  }
  return clamped;
}
