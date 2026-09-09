import { describe, expect, it } from 'vitest';
import { parseMmlCaretContext } from '../mmlCaretParser';

describe('parseMmlCaretContext', () => {
  describe('単一行の解析 (従来互換)', () => {
    it('トラック・オクターブ・音量・各IDを解析する', () => {
      const content = 'P1 t120 l8 o4 v10 @VE2 @PE3 c d e';
      const ctx = parseMmlCaretContext(content, 1, content.length + 1);

      expect(ctx).toMatchObject({
        trackName: 'P1',
        engine: 'psg',
        octave: 4,
        volume: 10,
        voiceId: 1,
        volEnvId: 2,
        pitchEnvId: 3,
      });
    });

    it('トラック宣言が無い場合はデフォルト (P1 / o4 / v12) を返す', () => {
      expect(parseMmlCaretContext('', 1, 1)).toMatchObject({
        trackName: 'P1',
        engine: 'psg',
        octave: 4,
        volume: 12,
        detune: 0,
      });
    });

    it('B1 / N1 トラックの音源種別とノイズ波形を判定する', () => {
      const beepCtx = parseMmlCaretContext('B1 o5 c', 1, 8);
      expect(beepCtx.engine).toBe('beep');

      const noiseCtx = parseMmlCaretContext('N1 @WN1 o4 c', 1, 13);
      expect(noiseCtx.engine).toBe('noise');
      expect(noiseCtx.noiseType).toBe('white');
    });

    it('行内コメント (; 以降) は解析対象外', () => {
      const ctx = parseMmlCaretContext('P1 o5 v15 ; v1 o2', 1, 18);
      expect(ctx.octave).toBe(5);
      expect(ctx.volume).toBe(15);
    });
  });

  describe('キャレット位置の切り詰め', () => {
    it('キャレットより後のコマンドは適用しない', () => {
      const content = 'P1 v10 v12';
      // v12 の直前 → v10 のみ適用
      expect(parseMmlCaretContext(content, 1, 8).volume).toBe(10);
      // v12 の直後 → v12 も適用
      expect(parseMmlCaretContext(content, 1, 11).volume).toBe(12);
    });
  });

  describe('複数行・複数トラック対応', () => {
    it('同一トラックの複数行: 2行目でも1行目の状態を引き継ぐ', () => {
      const content = [
        'F1 t120 @1 l8 o4 p3  c d e f g  a b > c @PE1',
        'F1 c d e f g  a b > c',
      ].join('\n');

      // 2行目の g の直後 (column 13)
      const ctxAtG = parseMmlCaretContext(content, 2, 13);
      expect(ctxAtG.trackName).toBe('F1');
      expect(ctxAtG.engine).toBe('fm');
      expect(ctxAtG.voiceId).toBe(1);
      expect(ctxAtG.pitchEnvId).toBe(1);
      // 1行目: o4 → > で o5 (2行目の > は g より後なので未適用)
      expect(ctxAtG.octave).toBe(5);

      // 2行目末尾 (> の後) では o6
      const ctxAtEnd = parseMmlCaretContext(content, 2, 22);
      expect(ctxAtEnd.octave).toBe(6);
    });

    it('複数トラックが交互に現れても各トラックの状態を復元する', () => {
      const content = [
        'F1 @1 o5 v10',
        'P1 o4 v3 @VE7',
        'F1 c d e',
      ].join('\n');

      const ctx = parseMmlCaretContext(content, 3, 9);
      expect(ctx.trackName).toBe('F1');
      expect(ctx.engine).toBe('fm');
      expect(ctx.octave).toBe(5);
      expect(ctx.volume).toBe(10);
      expect(ctx.voiceId).toBe(1);
      expect(ctx.volEnvId).toBeUndefined();
    });

    it('マクロ定義行は演奏状態へ影響しない', () => {
      const content = [
        '@1 = { 4, 6, 31, 12 }',
        '@VE1 = { 15, 10, 8 }',
        '@PE2 = { 0, 3, 6 }',
        'F1 o5 c d e',
      ].join('\n');

      const ctx = parseMmlCaretContext(content, 4, 12);
      expect(ctx.voiceId).toBe(1); // デフォルトのまま (定義行の @1 は無視)
      expect(ctx.volEnvId).toBeUndefined();
      expect(ctx.pitchEnvId).toBeUndefined();
      expect(ctx.octave).toBe(5);
    });

    it('音長付き音符 (f2 / d4) をトラック宣言やディチューンと誤認しない', () => {
      const content = 'F1 o5 f2 d4 D-8 c';
      const ctx = parseMmlCaretContext(content, 1, content.length + 1);
      expect(ctx.trackName).toBe('F1');
      expect(ctx.octave).toBe(5);
      expect(ctx.detune).toBe(-8); // ディチューンは大文字 D のみ
    });

    it('小文字の f1 はトラック宣言ではなく音符として扱う', () => {
      const ctx = parseMmlCaretContext('f1 o5 c', 1, 8);
      expect(ctx.trackName).toBe('P1'); // トラック指定なし → デフォルト
      expect(ctx.octave).toBe(5);
    });

    it('カンマ区切りの複数トラック指定 (F1,F2) は全トラックへ状態を適用する', () => {
      const content = [
        'F1,F2 o5 v9',
        'F2 c d e',
      ].join('\n');

      const ctx = parseMmlCaretContext(content, 2, 9);
      expect(ctx.trackName).toBe('F2');
      expect(ctx.octave).toBe(5);
      expect(ctx.volume).toBe(9);
    });
  });

  describe('オクターブ相対移動', () => {
    it('#OCTAVE REVERSE で < > の方向が反転する', () => {
      const content = '#OCTAVE REVERSE\nP1 o4 < c';
      expect(parseMmlCaretContext(content, 2, 8).octave).toBe(5);

      const normalContent = 'P1 o4 < c';
      expect(parseMmlCaretContext(normalContent, 1, 8).octave).toBe(3);
    });

    it('オクターブは 1-8 の範囲に制限される', () => {
      expect(parseMmlCaretContext('P1 o1 < c', 1, 10).octave).toBe(1);
      expect(parseMmlCaretContext('P1 o8 > c', 1, 10).octave).toBe(8);
    });
  });

  describe('@ (FM音色) の適用範囲', () => {
    it('@ は FM トラック以外では無視される (正式パーサ準拠)', () => {
      const ctx = parseMmlCaretContext('P1 @3 o5 c', 1, 11);
      expect(ctx.engine).toBe('psg');
      expect(ctx.voiceId).toBe(1); // デフォルトのまま

      const fmCtx = parseMmlCaretContext('F1 @3 o5 c', 1, 11);
      expect(fmCtx.engine).toBe('fm');
      expect(fmCtx.voiceId).toBe(3);
    });

    it('@FM / @EP エイリアスも解析する', () => {
      const ctx = parseMmlCaretContext('F1 @FM4 @EP2 c', 1, 15);
      expect(ctx.voiceId).toBe(4);
      expect(ctx.pitchEnvId).toBe(2);
    });

    it('旧 @vN は音量エンベロープ ID として解釈しない (@VE に一本化)', () => {
      const ctx = parseMmlCaretContext('P1 o4 @v7 c', 1, 12);
      expect(ctx.volEnvId).toBeUndefined();

      const veCtx = parseMmlCaretContext('P1 o4 @VE7 c', 1, 13);
      expect(veCtx.volEnvId).toBe(7);
    });
  });

  describe('@v (FM 専用音量) の適用範囲', () => {
    it('@v を FM トラックで解析する', () => {
      const ctx = parseMmlCaretContext('F1 @v100 c', 1, 12);
      expect(ctx.engine).toBe('fm');
      expect(ctx.fmVolume).toBe(100);
    });

    it('@v は PSG トラックでは無視される (正式パーサ準拠)', () => {
      const ctx = parseMmlCaretContext('P1 @v100 c', 1, 12);
      expect(ctx.engine).toBe('psg');
      expect(ctx.fmVolume).toBe(127); // 初期値のまま
    });

    it('@v の即値指定で音量エンベロープは解除される (正式パーサ準拠)', () => {
      const ctx = parseMmlCaretContext('F1 @VE2 @v100 c', 1, 17);
      expect(ctx.volEnvId).toBeUndefined();
      expect(ctx.fmVolume).toBe(100);
    });
  });

  describe('@WN / @IN (ノイズ波形・統合モード) の適用範囲', () => {
    it('@WN0 / @WN1 でノイズ波形を解析する', () => {
      expect(parseMmlCaretContext('N1 @WN0 c', 1, 9).noiseType).toBe('periodic');
      expect(parseMmlCaretContext('N1 @WN1 c', 1, 9).noiseType).toBe('white');
    });

    it('@IN0 / @IN1 / @IN2 を P3 トラックで解析する', () => {
      expect(parseMmlCaretContext('P3 @IN1 c', 1, 9).noiseIntegrate).toBe(1);
      expect(parseMmlCaretContext('P3 @IN2 c', 1, 9).noiseIntegrate).toBe(2);
      expect(parseMmlCaretContext('P3 @IN1 @IN0 c', 1, 13).noiseIntegrate).toBe(0);
    });

    it('@IN は P6 トラックでも有効 (トーン 3 統合トラック)', () => {
      expect(parseMmlCaretContext('P6 @IN2 c', 1, 9).noiseIntegrate).toBe(2);
    });

    it('@IN は P3/P6 以外のトラックでは無視される (正式パーサ準拠)', () => {
      expect(parseMmlCaretContext('P1 @IN1 c', 1, 9).noiseIntegrate).toBe(0);
      expect(parseMmlCaretContext('P4 @IN1 c', 1, 9).noiseIntegrate).toBe(0);
      expect(parseMmlCaretContext('N1 @IN1 c', 1, 9).noiseIntegrate).toBe(0);
    });

    it('@IN 指定が無いトラックの noiseIntegrate は初期値 0', () => {
      expect(parseMmlCaretContext('P3 o4 c', 1, 8).noiseIntegrate).toBe(0);
    });
  });

  describe('isTrackSpecLine (キャレット行のトラック宣言判定)', () => {
    it('行頭にトラック宣言がある行は true', () => {
      expect(parseMmlCaretContext('P1 c d e', 1, 5).isTrackSpecLine).toBe(true);
      expect(parseMmlCaretContext('F1,F2 c', 1, 5).isTrackSpecLine).toBe(true);
      expect(parseMmlCaretContext('B1 c', 1, 4).isTrackSpecLine).toBe(true);
    });

    it('継続行・マクロ定義行・ディレクティブ行は false', () => {
      const content = ['P1 c', ' d e', '@VE1 = { v15 }', '#TITLE Test'].join('\n');
      expect(parseMmlCaretContext(content, 2, 3).isTrackSpecLine).toBe(false);
      expect(parseMmlCaretContext(content, 3, 8).isTrackSpecLine).toBe(false);
      expect(parseMmlCaretContext(content, 4, 8).isTrackSpecLine).toBe(false);
    });

    it('行の途中にキャレットがあっても行頭宣言の有無で判定する', () => {
      const content = 'P1 o4 v10 c d e f g a b';
      expect(parseMmlCaretContext(content, 1, content.length + 1).isTrackSpecLine).toBe(true);
    });
  });
});
