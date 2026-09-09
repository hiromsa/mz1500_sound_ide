/**
 * 他方言 MML トラック (OTHER TRACKS: A-Z 1 文字) 検出ユーティリティの単体テスト。
 */
import { describe, expect, it } from 'vitest';
import { detectOtherTracks, isOtherTrackName, OTHER_TRACK_IDS } from '../mmlOtherTracks';

describe('isOtherTrackName', () => {
  it('accepts single uppercase letters only', () => {
    expect(isOtherTrackName('A')).toBe(true);
    expect(isOtherTrackName('Z')).toBe(true);
    expect(isOtherTrackName('a')).toBe(false); // 小文字は音符扱い
    expect(isOtherTrackName('P1')).toBe(false); // 正式パーサのトラック
    expect(isOtherTrackName('W1')).toBe(false);
    expect(isOtherTrackName('AB')).toBe(false);
  });
});

describe('OTHER_TRACK_IDS', () => {
  it('lists A-Z in order', () => {
    expect(OTHER_TRACK_IDS).toHaveLength(26);
    expect(OTHER_TRACK_IDS[0]).toBe('A');
    expect(OTHER_TRACK_IDS[25]).toBe('Z');
  });
});

describe('detectOtherTracks', () => {
  it('detects dialect letters in order of appearance (user example)', () => {
    const source = [
      'ABC @t1,86',
      '',
      'A @1 @v0 o5 l8 q8',
      'B @1 v12 o3 l16 @q0',
      'C         o4 l8 @q2',
    ].join('\n');
    expect(detectOtherTracks(source)).toEqual(['A', 'B', 'C']);
  });

  it('returns nothing for MZ-1500 parser tracks only', () => {
    const source = 'P1 c\nP2 d\nN1 c\nB1 c\nF1 c\nF8 c\nW1 c\nW99 c\n';
    expect(detectOtherTracks(source)).toEqual([]);
  });

  it('ignores digit-suffixed letters and lowercase lines', () => {
    // A1 / Q5 は無効宣言 (継続行帰属)、小文字は音符扱いのため検出しない
    const source = 'A1 c\nc d e f\nQ5 e\nZ o4 g';
    expect(detectOtherTracks(source)).toEqual(['Z']);
  });

  it('ignores macro definition and directive lines', () => {
    const source = '#TITLE "A test"\n@VE1 = { 15 }\n@1 = { c }\nA c';
    expect(detectOtherTracks(source)).toEqual(['A']);
  });

  it('deduplicates repeated declarations', () => {
    expect(detectOtherTracks('A c\nA d\nB e\nA f')).toEqual(['A', 'B']);
  });
});
