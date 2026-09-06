import { describe, expect, it } from 'vitest';
import {
  analyzeMmlLine,
  collectUsedIds,
  findDefinitionAt,
  findDefinitionBlocks,
  nextAvailableId,
} from '../mmlContextParser';

describe('findDefinitionBlocks', () => {
  it('複数行 (折り返し) の FM TONE 定義ブロックを開始行〜終了行の範囲で抽出する', () => {
    const content = [
      '@1 = {',
      '  4, 6,',
      '  31, 12, 0, 15, 3, 24, 0, 1, 0, 0, 0,',
      '  31,  8, 0,  8, 4,  0, 0, 1, 0, 0, 0',
      '}',
    ].join('\n');

    expect(findDefinitionBlocks(content)).toEqual([
      { kind: 'tone', id: 1, startLine: 1, endLine: 5 },
    ]);
  });

  it('1行の VOL ENV 定義 (@VEN) を | / > マーカー付きで抽出する', () => {
    const content = '@VE1 = { 15, 14, 13, |, 12, 11, >, 8, 5, 2, 0 }';

    expect(findDefinitionBlocks(content)).toEqual([
      { kind: 'volEnv', id: 1, startLine: 1, endLine: 1 },
    ]);
  });

  it('1行の PITCH ENV 定義 (@PEN) を抽出する', () => {
    const content = '@PE1 = { |, 0, 2, 4, 6, 8, 6, 4, 2 }';

    expect(findDefinitionBlocks(content)).toEqual([
      { kind: 'pitchEnv', id: 1, startLine: 1, endLine: 1 },
    ]);
  });

  it('エイリアス書式 (@FMN / @VEN / @EPN) も抽出する', () => {
    const content = [
      '@FM2 = { 4, 6, 31 }',
      '@VE3 = { 15, 10 }',
      '@EP4 = { 0, 3, 6 }',
    ].join('\n');

    expect(findDefinitionBlocks(content)).toEqual([
      { kind: 'tone', id: 2, startLine: 1, endLine: 1 },
      { kind: 'volEnv', id: 3, startLine: 2, endLine: 2 },
      { kind: 'pitchEnv', id: 4, startLine: 3, endLine: 3 },
    ]);
  });

  it('利用箇所のみの行は定義ブロックとして抽出しない (= を伴わないため)', () => {
    const content = [
      'P1 t120 l8 o4 @1 @VE2 @PE3',
      'P1 c e g > c < g e c r',
    ].join('\n');

    expect(findDefinitionBlocks(content)).toEqual([]);
  });

  it('コメント内の定義記述は抽出しない', () => {
    const content = [
      '; @1 = { 1, 2 }',
      '// @VE2 = { 15 }',
    ].join('\n');

    expect(findDefinitionBlocks(content)).toEqual([]);
  });

  it('コメント内の `}` を無視して複数行定義の終了行を正しく特定する', () => {
    const content = [
      '@VE2 = { 15,',
      '  10, 5 /* } コメント内閉じ */ ,',
      '  0 }',
    ].join('\n');

    expect(findDefinitionBlocks(content)).toEqual([
      { kind: 'volEnv', id: 2, startLine: 1, endLine: 3 },
    ]);
  });

  it('閉じられていない定義ブロックは抽出しない', () => {
    const content = '@1 = {\n  4, 6,\n  31, 12';

    expect(findDefinitionBlocks(content)).toEqual([]);
  });
});

describe('findDefinitionAt', () => {
  const blocks = findDefinitionBlocks(
    [
      '@1 = {',
      '  4, 6,',
      '  31, 12',
      '}',
      'P1 t120 l8 o4 @VE1 @PE1',
      '',
      '@PE2 = { |, 0, 2 }',
    ].join('\n'),
  );

  it('複数行 (折り返し) 定義のどの行でも同一ブロックを返す', () => {
    for (const lineNumber of [1, 2, 3, 4]) {
      expect(findDefinitionAt(blocks, lineNumber)).toEqual({
        kind: 'tone',
        id: 1,
        startLine: 1,
        endLine: 4,
      });
    }
  });

  it('定義ブロック外の行 (利用箇所・空行) は null を返す', () => {
    expect(findDefinitionAt(blocks, 5)).toBeNull();
    expect(findDefinitionAt(blocks, 6)).toBeNull();
  });

  it('別の定義ブロックの行はそのブロックを返す', () => {
    expect(findDefinitionAt(blocks, 7)).toEqual({
      kind: 'pitchEnv',
      id: 2,
      startLine: 7,
      endLine: 7,
    });
  });

  it('ブロック配列が空の場合は null を返す', () => {
    expect(findDefinitionAt([], 1)).toBeNull();
  });
});

describe('analyzeMmlLine (回帰)', () => {
  it('利用行から各 ID を抽出し、他コマンドを誤検出しない', () => {
    expect(analyzeMmlLine('P1 @1 o4 c d e')).toEqual({ toneId: 1, volEnvId: null, pitchEnvId: null });
    expect(analyzeMmlLine('@FM3 C D E')).toEqual({ toneId: 3, volEnvId: null, pitchEnvId: null });
    expect(analyzeMmlLine('@VE2 C')).toEqual({ toneId: null, volEnvId: 2, pitchEnvId: null });
    expect(analyzeMmlLine('@v5 C')).toEqual({ toneId: null, volEnvId: null, pitchEnvId: null }); // 旧 @v は解釈しない
    expect(analyzeMmlLine('@PE4 C')).toEqual({ toneId: null, volEnvId: null, pitchEnvId: 4 });
    expect(analyzeMmlLine('@WN1 @SW15 C')).toEqual({ toneId: null, volEnvId: null, pitchEnvId: null });
  });

  it('コメント以降は解析対象外とする', () => {
    expect(analyzeMmlLine('; @1 O4 C')).toEqual({ toneId: null, volEnvId: null, pitchEnvId: null });
    expect(analyzeMmlLine('@1 C ; @2')).toEqual({ toneId: 1, volEnvId: null, pitchEnvId: null });
  });
});

describe('collectUsedIds / nextAvailableId (回帰)', () => {
  it('MML 全文から定義・利用の両方の ID を収集する', () => {
    const content = [
      '@1 = { 4, 6, 31 }',
      'P1 @1 @FM2 @VE4 @PE5 c',
    ].join('\n');

    const used = collectUsedIds(content);
    expect([...used.toneIds].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...used.volEnvIds]).toEqual([4]);
    expect([...used.pitchEnvIds]).toEqual([5]);
  });

  it('未使用 ID は最大 ID + 1 を採番する', () => {
    expect(nextAvailableId(new Set([1, 2, 3]))).toBe(4);
    expect(nextAvailableId(new Set())).toBe(1);
  });
});
