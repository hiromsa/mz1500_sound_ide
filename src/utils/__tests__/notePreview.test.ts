import { describe, expect, it } from 'vitest';
import {
  NOTE_PREVIEW_DEBOUNCE_MS,
  accumulatePreviewChange,
  expandToTokenStart,
  hasPreviewChanges,
} from '../notePreview';

/** NOTE PREVIEW (打鍵プレビュー) ロジックの検証。 */

describe('NOTE_PREVIEW_DEBOUNCE_MS', () => {
  it('デバウンス時間は 500ms (ユーザー確定仕様)', () => {
    expect(NOTE_PREVIEW_DEBOUNCE_MS).toBe(500);
  });
});

describe('accumulatePreviewChange', () => {
  it('初回の挿入変更から区間を生成する (実質変更あり)', () => {
    const range = accumulatePreviewChange(null, { rangeOffset: 10, rangeLength: 0, text: 'c4' });
    expect(range).toEqual({ startOffset: 10, endOffset: 12, hasContentChange: true });
  });

  it('初回の削除変更 (空テキスト) から区間を生成する (実質変更あり)', () => {
    const range = accumulatePreviewChange(null, { rangeOffset: 5, rangeLength: 3, text: '' });
    expect(range).toEqual({ startOffset: 5, endOffset: 8, hasContentChange: true });
  });

  it('空白のみの挿入は実質変更として扱わない (c4 の後にスペースを入れても鳴らさない)', () => {
    const range = accumulatePreviewChange(null, { rangeOffset: 8, rangeLength: 0, text: ' ' });
    expect(range.hasContentChange).toBe(false);
  });

  it('タブ・改行のみの挿入も実質変更として扱わない', () => {
    const range = accumulatePreviewChange(null, { rangeOffset: 8, rangeLength: 0, text: ' \t\n' });
    expect(range.hasContentChange).toBe(false);
  });

  it('置換 (削除を含む変更) は挿入テキストが空白でも実質変更として扱う', () => {
    const range = accumulatePreviewChange(null, { rangeOffset: 8, rangeLength: 2, text: ' ' });
    expect(range.hasContentChange).toBe(true);
  });

  it('複数変更を包含する最小区間へ合算し、実質変更は保持される', () => {
    let range = accumulatePreviewChange(null, { rangeOffset: 20, rangeLength: 0, text: ' ' });
    range = accumulatePreviewChange(range, { rangeOffset: 12, rangeLength: 0, text: 'e' });
    expect(range).toEqual({ startOffset: 12, endOffset: 21, hasContentChange: true });
  });

  it('実質変更なしの変更のみの場合は hasContentChange が false のまま', () => {
    let range = accumulatePreviewChange(null, { rangeOffset: 20, rangeLength: 0, text: '  ' });
    range = accumulatePreviewChange(range, { rangeOffset: 12, rangeLength: 0, text: '\n' });
    expect(range).toEqual({ startOffset: 12, endOffset: 22, hasContentChange: false });
  });
});

describe('hasPreviewChanges', () => {
  it('null は変更なしとして扱う', () => {
    expect(hasPreviewChanges(null)).toBe(false);
  });

  it('実質変更 (非空白の挿入 / 削除・置換) を含む区間は発音対象', () => {
    expect(hasPreviewChanges({ startOffset: 5, endOffset: 7, hasContentChange: true })).toBe(true);
  });

  it('実質変更を含まない区間 (空白のみの挿入) は発音対象としない', () => {
    expect(hasPreviewChanges({ startOffset: 5, endOffset: 6, hasContentChange: false })).toBe(false);
  });
});

describe('expandToTokenStart', () => {
  it('音長数字のみの入力 (c4 の 4) を音符トークン開始 (c) へ拡張する', () => {
    const text = 'P1 c4 de';
    // "4" の挿入位置 (c の直後 = offset 5)
    expect(expandToTokenStart(text, 5)).toBe(3); // c の位置
  });

  it('臨時記号のみの入力 (c+ の +) を音符トークン開始へ拡張する', () => {
    const text = 'P1 c+ d';
    expect(expandToTokenStart(text, 4)).toBe(3); // c の位置
  });

  it('付点・音長・臨時記号を跨いでトークン開始へ拡張する (c+4. の .)', () => {
    const text = 'P1 c+4. e';
    expect(expandToTokenStart(text, 7)).toBe(3); // c の位置
  });

  it('休符の音長数字 (r8 の 8) を休符トークン開始 (r) へ拡張する', () => {
    const text = 'P1 r8 e';
    expect(expandToTokenStart(text, 4)).toBe(3); // r の位置
  });

  it('入力位置が音名自身の場合はその位置をそのまま返す', () => {
    const text = 'P1 c d e';
    expect(expandToTokenStart(text, 3)).toBe(3); // c の位置
  });

  it('コマンド数値の入力 (v10 の 0) は拡張しない', () => {
    const text = 'P1 v10 c';
    // v10 の "0" の位置 → v は音符でないため c へは戻らない
    expect(expandToTokenStart(text, 6)).toBe(6);
  });

  it('オクターブ指定の数値 (o4 の 4) は拡張しない', () => {
    const text = 'P1 o4 c';
    expect(expandToTokenStart(text, 5)).toBe(5);
  });

  it('@ コマンドの数値 (@VE1 の 1) は拡張しない (大文字は音符でない)', () => {
    const text = 'P1 @VE1 c';
    expect(expandToTokenStart(text, 7)).toBe(7);
  });

  it('ディチューン (D-8) の数値は大文字 D で打ち切られるため拡張しない', () => {
    const text = 'P1 D-8 c';
    expect(expandToTokenStart(text, 6)).toBe(6);
  });

  it('挿入済み音符トークンの直後のオフセットはトークン開始へ拡張される', () => {
    const text = 'P1 c4 d';
    // d を入力し終えた直後のオフセット (7) → d 自身のトークン開始 (6) へ拡張される
    expect(expandToTokenStart(text, 7)).toBe(6);
  });

  it('空白直後の挿入位置は拡張しない (直前の音符へ飛び越えない)', () => {
    const text = 'P1 c4 ';
    // これから d を打とうとしている位置 (空白の直後) → 拡張しない
    expect(expandToTokenStart(text, 6)).toBe(6);
  });

  it('行コメント (; 以降) 内の入力は拡張しない', () => {
    const text = 'P1 c4 ; c4 d';
    // コメント内の "4" の位置 → コメント開始 (;) で打ち切り
    expect(expandToTokenStart(text, 11)).toBe(11);
  });

  it('行頭から始まるトークンの音長数字は行頭位置へ拡張する', () => {
    const text = 'c4';
    expect(expandToTokenStart(text, 1)).toBe(0); // 行頭 = c の位置
  });

  it('前の行のトークンへは跨がない (改行で打ち切り)', () => {
    const text = 'P1 c4\nd';
    // 2 行目 d の挿入位置 (offset 6) → 行頭で打ち切り
    expect(expandToTokenStart(text, 6)).toBe(6);
  });

  it('範囲外のオフセットはクランプされる', () => {
    const text = 'P1 c4';
    expect(expandToTokenStart(text, 100)).toBe(text.length);
    expect(expandToTokenStart(text, -5)).toBe(0);
  });

  it('空テキストでは元のオフセット (0) を返す', () => {
    expect(expandToTokenStart('', 0)).toBe(0);
  });
});
