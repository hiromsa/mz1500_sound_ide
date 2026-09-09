/**
 * mmlSelectionResolver (キャレット位置 / 選択範囲 → 部分再生時間範囲の解決) のテスト。
 * コンパイル結果の MmlMap から、エディタ上の 1-based 行 / 列で指定した
 * キャレット・選択範囲が音楽的なフレーム範囲へ正しく写像されることを検証する。
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../../core/mml/MmlCompiler';
import type { MmlMap } from '../../core/mml/MmlMap';
import { resolvePlaybackRange } from '../mmlSelectionResolver';

/** MML をコンパイルし、成功した場合のみ MmlMap を返す。 */
function compileMap(mml: string): MmlMap {
  const result = new MmlCompiler().compile(mml);
  expect(result.success, result.diagnostics.map((d) => d.toString()).join('\n')).toBe(true);
  expect(result.map).not.toBeNull();
  return result.map!;
}

describe('resolvePlaybackRange (note-preview / NOTE PREVIEW 打鍵プレビュー)', () => {
  it('指定トラックのイベントのみを解決する (他チャンネルの同時刻イベントは含めない)', () => {
    // 列位置: c=10 (1-based) / c のトークン区間 [10, 11)
    const map = compileMap('P1 o4 l4 c\nP2 o4 l4 c');

    const range = resolvePlaybackRange(map, {
      kind: 'note-preview',
      trackName: 'P1',
      startLine: 1,
      startColumn: 10,
      endLine: 1,
      endColumn: 11,
    });
    expect(range).not.toBeNull();
    expect(range!.startFrame).toBe(0);
    expect(range!.endFrame).toBe(30); // c (l4 = 1拍 = 30 フレーム / t120 既定) の終端
    expect(range!.eventCount).toBe(1); // P1 の c のみ (P2 の同時刻 c は含まれない)
  });

  it('範囲を含まない隣接トークン (次の音符) は対象外', () => {
    // 列位置: c=10, d=12 (1-based)
    const map = compileMap('P1 o4 l4 c d');
    // c4 の 4 を入力 → 始点を c のトークン開始へ拡張した状態を想定 (範囲は c トークンまで)
    const range = resolvePlaybackRange(map, {
      kind: 'note-preview',
      trackName: 'P1',
      startLine: 1,
      startColumn: 10,
      endLine: 1,
      endColumn: 11,
    });
    expect(range).not.toBeNull();
    expect(range!.startFrame).toBe(0);
    expect(range!.endFrame).toBe(30);
    expect(range!.eventCount).toBe(1); // d (startColumn 12) は含まれない
  });

  it('指定トラックが MmlMap に存在しない場合は null (W トラック等)', () => {
    const map = compileMap('P1 o4 l4 c');
    const range = resolvePlaybackRange(map, {
      kind: 'note-preview',
      trackName: 'W1',
      startLine: 1,
      startColumn: 10,
      endLine: 1,
      endColumn: 11,
    });
    expect(range).toBeNull();
  });

  it('trackName 未指定なら全トラックが対象 (selection 互換)', () => {
    const map = compileMap('P1 o4 l4 c\nP2 o4 l4 c');
    const range = resolvePlaybackRange(map, {
      kind: 'note-preview',
      startLine: 1,
      startColumn: 10,
      endLine: 2,
      endColumn: 11,
    });
    expect(range!.eventCount).toBe(2); // P1 と P2 の両方
  });
});

describe('resolvePlaybackRange', () => {
  it('starts from the event at the caret column and plays to the end', () => {
    // 列位置: c=10, d=12, e=14 (1-based) / l4 = 30 フレーム (t120 既定)
    const map = compileMap('P1 o4 l4 c d e');

    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 14 });
    expect(range).not.toBeNull();
    expect(range!.startFrame).toBe(60); // 3 音目 (e) から
    expect(range!.endFrame).toBeNull(); // 曲末尾まで
    expect(range!.startSeconds).toBeCloseTo(1.0);
    expect(range!.endSeconds).toBeNull();
    expect(range!.eventCount).toBe(1);
  });

  it('includes every event on and after the caret line', () => {
    const map = compileMap('P1 o4 l4 c d e');

    // c の直前 (列 10) → c / d / e の全イベント
    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 10 });
    expect(range!.startFrame).toBe(0);
    expect(range!.eventCount).toBe(3);
  });

  it('bounds the selection by the contained events', () => {
    const map = compileMap('P1 o4 l4 c d e');

    // "c d" を選択 (列 10..13 = 終端排他)
    const range = resolvePlaybackRange(map, {
      kind: 'selection',
      startLine: 1,
      startColumn: 10,
      endLine: 1,
      endColumn: 13,
    });
    expect(range!.startFrame).toBe(0); // c から
    expect(range!.endFrame).toBe(60); // d の終了時刻 (30 + 30) まで
    expect(range!.eventCount).toBe(2);
  });

  it('counts rest events for the selection end', () => {
    const map = compileMap('P1 o4 l4 c r e');

    // "c r" を選択 → 休符の終了時刻まで演奏して停止する
    const range = resolvePlaybackRange(map, {
      kind: 'selection',
      startLine: 1,
      startColumn: 10,
      endLine: 1,
      endColumn: 13,
    });
    expect(range!.startFrame).toBe(0);
    expect(range!.endFrame).toBe(60);
  });

  it('returns null when the selection contains no events', () => {
    const map = compileMap('P1 o4 l4 c d e');

    // "l4" のみ選択 (制御コマンド = イベントに含まれない)
    const range = resolvePlaybackRange(map, {
      kind: 'selection',
      startLine: 1,
      startColumn: 7,
      endLine: 1,
      endColumn: 9,
    });
    expect(range).toBeNull();
  });

  it('returns null when nothing exists after the caret', () => {
    const map = compileMap('P1 o4 l4 c d e');

    expect(resolvePlaybackRange(map, { kind: 'caret', startLine: 2, startColumn: 1 })).toBeNull();
  });

  it('collects events from multiple tracks', () => {
    const mml = ['P1 o4 l4 c d e', 'P2 o5 l4 r r g'].join('\n');
    const map = compileMap(mml);

    // 2 行目 (P2) の g (列 14) → キャレット所属トラック P2 の g (startFrame 60) をアンカーにする
    // (P2 より前のイベントはプリシークで無音スキップ)
    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 2, startColumn: 14 }, mml);
    expect(range!.startFrame).toBe(60);
    expect(range!.endFrame).toBeNull();
    // アンカー以降に発音する全トラックのイベント: P1 の e (startFrame 60) + P2 の g (startFrame 60)
    expect(range!.eventCount).toBe(2);
  });

  it('supports multi-line selections', () => {
    const mml = ['P1 o4 l4 c d', 'P1 e f'].join('\n');
    const map = compileMap(mml);

    // 1 行目の d (列 12) から 2 行目の f (列 6) まで選択
    const range = resolvePlaybackRange(map, {
      kind: 'selection',
      startLine: 1,
      startColumn: 12,
      endLine: 2,
      endColumn: 7,
    });
    expect(range!.startFrame).toBe(30); // d から
    expect(range!.endFrame).toBe(120); // f の終了 (90 + 30) まで
  });

  it('respects tempo changes for the frame positions', () => {
    // c: l4 = 30 フレーム (t120 既定) → t60 で quarterFrames が 60 へ変わり d / e は 60 フレーム
    const map = compileMap('P1 l4 c t60 d e');

    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 15 });
    expect(range!.startFrame).toBe(90); // c(0..30) + d(30..90) の後

    const selection = resolvePlaybackRange(map, {
      kind: 'selection',
      startLine: 1,
      startColumn: 7,
      endLine: 1,
      endColumn: 12,
    });
    expect(selection!.startFrame).toBe(0); // c のみ
    expect(selection!.endFrame).toBe(30);
  });

  it('judges column-less tuplet events by their approximated token span', () => {
    // 連符内の音符は列位置を持たない (column = 0)。連符は「直前〜次の位置確定トークン間」の
    // 区間で近似されるため、連符の真ん中にキャレットがあれば連符先頭から再生される
    const map = compileMap('P1 {cde}4 g');

    // 連符の真ん中 (d の上 = 列 6) → 連符は採用され、開始は連符先頭 (startFrame 0)
    const midRange = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 6 });
    expect(midRange!.startFrame).toBe(0);

    // 連符より後の g (列 11) → 連符は対象外
    const afterRange = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 11 });
    expect(afterRange!.startFrame).toBe(30); // 4 分音符を 3 等分した連符の後
  });

  it('skips work tracks that are excluded from the binary', () => {
    const mml = ['W1 c d e', 'P1 o4 c'].join('\n');
    const map = compileMap(mml);

    // W1 行はバイナリ生成対象外のためイベントが存在しない → P1 の c (line 2) が解決される
    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 4 });
    expect(range!.startFrame).toBe(0);
    expect(range!.eventCount).toBe(1);
  });

  it('falls back to source-position resolution when the caret track has no map track', () => {
    // W1 は MmlMap に存在しないため、テキスト位置ベースの解決へフォールバックする
    const mml = ['W1 c d e', 'P1 o4 c'].join('\n');
    const map = compileMap(mml);

    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 4 }, mml);
    expect(range!.startFrame).toBe(0);
    expect(range!.eventCount).toBe(1);
  });

  it('anchors caret playback on the caret track even when later tracks start earlier in time', () => {
    // 回帰: ソース後方に書かれた P2 のイベント (演奏時刻は曲先頭付近) に開始位置を
    // 引きずられて、キャレット位置と無関係に曲先頭から再生される問題の修正
    const mml = ['P1 o4 l4 c d', 'P1 e f', '', 'P2 o5 l4 g g g g'].join('\n');
    const map = compileMap(mml);

    // 2 行目 (P1 継続行) の e の直前 (列 4) → P1 の e (startFrame 60) をアンカーにする
    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 2, startColumn: 4 }, mml);
    expect(range!.startFrame).toBe(60);
    expect(range!.endFrame).toBeNull();
    // アンカー以降に発音する全トラックのイベント: P1 e / f + P2 後半 2 音 (startFrame 60 / 90)
    expect(range!.eventCount).toBe(4);
  });

  it('starts from the caret track end when the caret is after its last event', () => {
    const mml = ['P1 o4 l4 c d', 'P2 o5 l4 g g g g g'].join('\n');
    const map = compileMap(mml);

    // 1 行目末尾 (P1 の d の直後) → P1 に以降イベントが無いため d の終端 (frame 60) を
    // アンカーにし、P2 の残り 3 音 (startFrame 60 / 90 / 120) が同期再生される
    const range = resolvePlaybackRange(map, { kind: 'caret', startLine: 1, startColumn: 13 }, mml);
    expect(range!.startFrame).toBe(60);
    expect(range!.eventCount).toBe(3);
  });
});
