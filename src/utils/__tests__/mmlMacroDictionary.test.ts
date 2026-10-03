import { describe, expect, it } from 'vitest';
import {
  MML_MACROS,
  buildMacroCallRegExp,
  buildAllMacroCallsRegExp,
  buildMacroCommandPatternSource,
  buildMacroDefinitionLinePatternSource,
} from '../mmlMacroDictionary';

describe('mmlMacroDictionary', () => {
  it('マクロ種別ごとの呼び出しパターンが ID を解析できる (エイリアス含む・大文字小文字不問)', () => {
    const pitchEnv = MML_MACROS.find((m) => m.kind === 'pitchEnv')!;
    const pitchSweep = MML_MACROS.find((m) => m.kind === 'pitchSweep')!;
    const volEnv = MML_MACROS.find((m) => m.kind === 'volEnv')!;

    expect([...('P1 @PE1 c'.matchAll(buildMacroCallRegExp(pitchEnv)))][0][2]).toBe('1');
    expect([...('P1 @ep2 c'.matchAll(buildMacroCallRegExp(pitchEnv)))][0][2]).toBe('2');
    expect([...('P1 @PS3 c'.matchAll(buildMacroCallRegExp(pitchSweep)))][0][2]).toBe('3');
    expect([...('P1 @VE4 c'.matchAll(buildMacroCallRegExp(volEnv)))][0][2]).toBe('4');
  });

  it('buildMacroCommandPatternSource は小文字コマンドにもマッチする (caretParser COMMAND_PATTERN 用)', () => {
    const pattern = new RegExp(buildMacroCommandPatternSource());
    expect('P1 @ps2 c'.match(pattern)?.[0]).toBe('@ps2');
    expect('P1 @EP2 c'.match(pattern)?.[0]).toBe('@EP2');
    expect('P1 @VE4 c'.match(pattern)?.[0]).toBe('@VE4');
  });

  it('buildAllMacroCallsRegExp は全マクロの呼び出しを除去できる (ID 採番の衝突防止用)', () => {
    expect('@PE1 @PS2 @VE3 c @1'.replace(buildAllMacroCallsRegExp(), '').trim()).toBe('c @1');
  });

  it('buildMacroDefinitionLinePatternSource は定義行のみにマッチする (呼び出しにはマッチしない)', () => {
    const pattern = new RegExp(buildMacroDefinitionLinePatternSource(), 'i');
    expect(pattern.test('@PS1 = { 0, 10 }')).toBe(true);
    expect(pattern.test('@EP2 = { 0 }')).toBe(true);
    expect(pattern.test('@VE3 = { 15 }')).toBe(true);
    expect(pattern.test('@1 = { 4, 6 }')).toBe(true);
    expect(pattern.test('@FM4 = { 1, 2 }')).toBe(true);
    expect(pattern.test('@PE1 c')).toBe(false);
    expect(pattern.test('@WN1 @SW15 C')).toBe(false);
    expect(pattern.test('@v5 C')).toBe(false);
  });
});