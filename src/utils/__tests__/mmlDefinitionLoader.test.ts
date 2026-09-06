/**
 * MML 定義ブロック → エディタデータ ローダー (mmlDefinitionLoader) のテスト。
 * 各エディタ (FM TONE / VOL ENV / PITCH ENV) の「ID 変更時の定義内容ロード」の基幹ロジックを検証する。
 */
import { describe, expect, it } from 'vitest';
import {
  isIdDefined,
  loadFmToneDefinition,
  loadPitchEnvDefinition,
  loadVolEnvDefinition,
} from '../mmlDefinitionLoader';

describe('loadVolEnvDefinition', () => {
  it('ループ / リリース マーカー付きの 1 行定義を読み込む (エディタ出力の `| 12` 形式にも対応)', () => {
    const content = '@VE2 = { 15, 14, | 12, 11, > 8, 5, 2, 0 }\n';
    const loaded = loadVolEnvDefinition(content, 2);
    expect(loaded).not.toBeNull();
    expect(loaded?.data).toEqual([15, 14, 12, 11, 8, 5, 2, 0]);
    expect(loaded?.loopPoint).toBe(2);
    expect(loaded?.releasePoint).toBe(4);
  });

  it('カンマ区切りのマーカー書式 (`|,`) も読み込める', () => {
    const content = '@VE2 = { 15, 14, |, 12, 11, >, 8, 5, 2, 0 }\n';
    const loaded = loadVolEnvDefinition(content, 2);
    expect(loaded?.data).toEqual([15, 14, 12, 11, 8, 5, 2, 0]);
    expect(loaded?.loopPoint).toBe(2);
    expect(loaded?.releasePoint).toBe(4);
  });

  it('複数行 (折り返し) 定義を読み込める', () => {
    const content = [
      '@VE3 = {',
      '  15,',
      '  12, 10,',
      '  8, 5',
      '}',
    ].join('\n');
    const loaded = loadVolEnvDefinition(content, 3);
    expect(loaded?.data).toEqual([15, 12, 10, 8, 5]);
    expect(loaded?.loopPoint).toBe(-1);
    expect(loaded?.releasePoint).toBe(-1);
  });

  it('定義されていない ID は null を返す', () => {
    expect(loadVolEnvDefinition('@VE2 = { 15, 14 }\n', 9)).toBeNull();
  });

  it('利用箇所のみで定義が無い ID は null を返す', () => {
    const content = 'P1 c @VE3 d\n';
    expect(loadVolEnvDefinition(content, 3)).toBeNull();
  });

  it('旧書式 (@v) は @VE へ一本化されたため定義として認識しない', () => {
    const content = '@v4 = { 10, 5 }\n';
    expect(loadVolEnvDefinition(content, 4)).toBeNull();
  });

  it('範囲外の音量値は 0-15 にクランプされる', () => {
    const content = '@VE1 = { 20, -3, 8 }\n';
    const loaded = loadVolEnvDefinition(content, 1);
    expect(loaded?.data).toEqual([15, 0, 8]);
  });
});

describe('loadPitchEnvDefinition', () => {
  it('ループ マーカー付き定義を読み込む (負値も保持)', () => {
    const content = '@PE1 = { |, 0, 3, 6, -8, -6 }\n';
    const loaded = loadPitchEnvDefinition(content, 1);
    expect(loaded?.data).toEqual([0, 3, 6, -8, -6]);
    expect(loaded?.loopPoint).toBe(0);
  });

  it('定義されていない ID は null を返す', () => {
    expect(loadPitchEnvDefinition('@PE1 = { 0, 3 }\n', 2)).toBeNull();
  });
});

describe('loadFmToneDefinition', () => {
  const fmToneMml = [
    '@5 = {',
    '  /* TEST TONE */',
    '  /* ALG=4, FB=3 */',
    '  4, 3,',
    '  /* OP1: AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME */',
    '  31, 10, 5, 7, 3, 20, 1, 2, 3, 0, 1 ; Carrier,',
    '  /* OP2 */',
    '  20, 8, 4, 6, 2, 30, 0, 1, 1, 1, 0,',
    '  /* OP3 */',
    '  15, 6, 3, 5, 1, 40, 1, 0, 0, 2, 0,',
    '  /* OP4 (Carrier) */',
    '  25, 9, 2, 8, 4, 50, 2, 3, 4, 3, 1,',
    '}',
  ].join('\n');

  it('複数行の FM 音色定義から音色名・ALG・FB・各 OP パラメータを復元する', () => {
    const loaded = loadFmToneDefinition(fmToneMml, 5);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(5);
    expect(loaded?.name).toBe('TEST TONE');
    expect(loaded?.alg).toBe(4);
    expect(loaded?.fb).toBe(3);

    const op1 = loaded?.ops[0];
    expect(op1).toEqual({ ar: 31, d1r: 10, d2r: 5, rr: 7, d1l: 3, tl: 20, ks: 1, mul: 2, dt1: 3, dt2: 0, ame: true });
    expect(loaded?.ops[1].ame).toBe(false);
    expect(loaded?.ops[3].tl).toBe(50);
    expect(loaded?.ops[3].ame).toBe(true);
  });

  it('パラメータ数が不足している定義は null を返す', () => {
    const shortMml = '@5 = { 4, 3, 31, 10, 5 }';
    expect(loadFmToneDefinition(shortMml, 5)).toBeNull();
  });

  it('定義されていない ID は null を返す', () => {
    expect(loadFmToneDefinition(fmToneMml, 6)).toBeNull();
  });
});

describe('isIdDefined', () => {
  const content = [
    '@VE2 = { 15, 14 }',
    'P1 c @VE2 d @VE3 e',
  ].join('\n');

  it('定義ブロックが存在する ID は true を返す', () => {
    expect(isIdDefined(content, 'volEnv', 2)).toBe(true);
  });

  it('利用箇所のみの ID は false を返す', () => {
    expect(isIdDefined(content, 'volEnv', 3)).toBe(false);
  });

  it('種別が異なる同一 ID は定義済みと判定しない', () => {
    expect(isIdDefined(content, 'tone', 2)).toBe(false);
  });
});
