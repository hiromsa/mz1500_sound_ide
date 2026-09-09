import { describe, expect, it } from 'vitest';
import {
  buildMmlNoteInsertion,
  buildMmlNoteInsertionAtCaret,
  isMmlNoteInsertModeActive,
  midiNoteToMmlNoteName,
  midiNoteToMmlOctave,
} from '../mmlNoteInserter';

describe('mmlNoteInserter', () => {
  describe('midiNoteToMmlOctave / midiNoteToMmlNoteName', () => {
    it('MIDI 60 (C4) はオクターブ 4 / 音名 c に変換される', () => {
      expect(midiNoteToMmlOctave(60)).toBe(4);
      expect(midiNoteToMmlNoteName(60)).toBe('c');
    });

    it('黒鍵はシャープ表記の音名になる', () => {
      expect(midiNoteToMmlNoteName(61)).toBe('c#');
      expect(midiNoteToMmlNoteName(63)).toBe('d#');
      expect(midiNoteToMmlNoteName(66)).toBe('f#');
      expect(midiNoteToMmlNoteName(70)).toBe('a#');
    });
  });

  describe('isMmlNoteInsertModeActive', () => {
    it('3 条件 (MML エディタ & Ctrl 押下中 & チャンネル行キャレット) が揃ったときのみ有効', () => {
      expect(isMmlNoteInsertModeActive({ isMmlEditorMode: true, isControlKeyHeld: true, isTrackSpecLine: true })).toBe(true);
      expect(isMmlNoteInsertModeActive({ isMmlEditorMode: false, isControlKeyHeld: true, isTrackSpecLine: true })).toBe(false);
      expect(isMmlNoteInsertModeActive({ isMmlEditorMode: true, isControlKeyHeld: false, isTrackSpecLine: true })).toBe(false);
      expect(isMmlNoteInsertModeActive({ isMmlEditorMode: true, isControlKeyHeld: true, isTrackSpecLine: false })).toBe(false);
      expect(isMmlNoteInsertModeActive({ isMmlEditorMode: true, isControlKeyHeld: true })).toBe(false);
    });
  });

  describe('buildMmlNoteInsertion', () => {
    it('同一オクターブは音名のみ (音長なし)', () => {
      expect(buildMmlNoteInsertion(4, 60)).toEqual({ text: 'c', octave: 4 });
      expect(buildMmlNoteInsertion(4, 62)).toEqual({ text: 'd', octave: 4 });
    });

    it('1 オクターブ上は > を自動付与する', () => {
      expect(buildMmlNoteInsertion(4, 72)).toEqual({ text: '>c', octave: 5 });
    });

    it('1 オクターブ下は < を自動付与する', () => {
      expect(buildMmlNoteInsertion(4, 48)).toEqual({ text: '<c', octave: 3 });
    });

    it('複数オクターブ差分は記号を繰り返す', () => {
      expect(buildMmlNoteInsertion(4, 84)).toEqual({ text: '>>c', octave: 6 });
      expect(buildMmlNoteInsertion(4, 36)).toEqual({ text: '<<c', octave: 2 });
      expect(buildMmlNoteInsertion(4, 24)).toEqual({ text: '<<<c', octave: 1 });
    });

    it('#OCTAVE REVERSE 時は < / > の方向が反転する', () => {
      expect(buildMmlNoteInsertion(4, 72, true)).toEqual({ text: '<c', octave: 5 });
      expect(buildMmlNoteInsertion(4, 48, true)).toEqual({ text: '>c', octave: 3 });
    });

    it('MML オクターブ範囲 (1-8) 外へは正式パーサ準拠でクランプする', () => {
      // A0 (MIDI 21 / オクターブ 0) は o1 までしか下がれない
      expect(buildMmlNoteInsertion(4, 21)).toEqual({ text: '<<<a', octave: 1 });
      expect(buildMmlNoteInsertion(1, 21)).toEqual({ text: 'a', octave: 1 });
      // C8 (MIDI 108 / オクターブ 8) は o8 が上限
      expect(buildMmlNoteInsertion(4, 108)).toEqual({ text: '>>>>c', octave: 8 });
      expect(buildMmlNoteInsertion(8, 108)).toEqual({ text: 'c', octave: 8 });
    });
  });

  describe('buildMmlNoteInsertionAtCaret', () => {
    it('チャンネル行 (トラック宣言行) のキャレットは挿入テキストを返す', () => {
      const content = 'P1 o4 c';
      expect(buildMmlNoteInsertionAtCaret(content, 1, content.length + 1, 72)).toEqual({ text: '>c', octave: 5 });
    });

    it('継続行 (トラック宣言の無い行) は null を返す', () => {
      const content = 'P1 c\n d e';
      expect(buildMmlNoteInsertionAtCaret(content, 2, 5, 60)).toBeNull();
    });

    it('マクロ定義行は null を返す', () => {
      const content = '@VE1 = { v15, v10, v5 }';
      expect(buildMmlNoteInsertionAtCaret(content, 1, 10, 60)).toBeNull();
    });

    it('ディレクティブ行 (#TITLE 等) は null を返す', () => {
      const content = '#TITLE Test Song';
      expect(buildMmlNoteInsertionAtCaret(content, 1, 10, 60)).toBeNull();
    });

    it('#OCTAVE REVERSE 定義時は挿入テキストの相対方向が反転する', () => {
      const content = '#OCTAVE REVERSE\nP1 o4 c';
      expect(buildMmlNoteInsertionAtCaret(content, 2, 8, 72)).toEqual({ text: '<c', octave: 5 });
    });

    it('直前の相対指定を考慮したオクターブを基準にする', () => {
      // 'P1 o4 > > c' の 2 つ目の > 直後 (column 10) → 現在オクターブ 6
      const content = 'P1 o4 > > c';
      expect(buildMmlNoteInsertionAtCaret(content, 1, 10, 72)).toEqual({ text: '<c', octave: 5 });
    });

    it('行内コメント以降は解析対象外 (キャレットがコメント上でも挿入できる)', () => {
      const content = 'P1 o4 c ; comment';
      expect(buildMmlNoteInsertionAtCaret(content, 1, 12, 60)).toEqual({ text: 'c', octave: 4 });
    });
  });
});
