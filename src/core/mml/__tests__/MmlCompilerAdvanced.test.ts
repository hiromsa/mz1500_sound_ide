/**
 * エンベロープ・エラー処理・ノイズ系・マクロ複数行のテスト。
 * (移植元: tests/MzSound.MmlCompiler.Tests/MmlCompilerAdvancedTests.cs / MacroMultiLineTests.cs)
 */
import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity, type MmlDiagnostic } from '../TrackId';
import { MmlCompiler } from '../MmlCompiler';
import { parsePitchEnvelope, parseVolumeEnvelope } from '../MmlCompilerMacros';
import { getTrackData } from './MmlCompiler.test';

function compile(mml: string) {
  return new MmlCompiler().compile(mml);
}

describe('MmlCompiler advanced', () => {
  it('volume envelope compiles to table', () => {
    const result = compile('@v0 = {15, 12, 9, 6, 3, 0}\nP1 @v0 c d');
    expect(result.success).toBe(true);
    expect(result.musicData).not.toBeNull();
    expect((result.musicData as Uint8Array)[14]).toBe(1); // 音量エンベロープ数
  });

  it('volume envelope repeat syntax expands', () => {
    const result = compile('@v1 = {15x3, 0}\nP1 @v1 c');
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[14]).toBe(1);
  });

  it('pitch envelope compiles to table', () => {
    const result = compile('@EP1 = {5, -5, |, 5, -5}\nP1 @EP1 c');
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[17]).toBe(1); // ピッチエンベロープ数
  });

  it('FM tone validates 46 parameters', () => {
    const tone = Array.from({ length: 46 }, () => '31').join(', ');
    const result = compile(`@FM1 = { ${tone} }\nF1 @1 c`);
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[20]).toBe(1); // FM 音色数
  });

  it('FM tone with wrong parameter count is error', () => {
    const result = compile('@FM1 = { 4, 3 }\nF1 @1 c');
    expect(result.success).toBe(false);
  });

  it('undefined envelope is error', () => {
    const result = compile('P1 @v5 c');
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.severity === DiagnosticSeverity.Error)).toBe(true);
  });

  it('missing track spec is error', () => {
    const result = compile('cdef');
    expect(result.success).toBe(false);
  });

  it('unmatched loop close is error', () => {
    const result = compile('P1 c]2');
    expect(result.success).toBe(false);
  });

  it('whole loop sets loop offset', () => {
    const result = compile('P1 c L d');
    expect(result.success).toBe(true);

    const data = result.musicData as Uint8Array;
    const tableOffset = data[10] | (data[11] << 8);
    const loopOffset = data[tableOffset + 2] | (data[tableOffset + 3] << 8);
    expect(loopOffset).toBeGreaterThan(0);
  });

  it('comments are ignored', () => {
    const result = compile('P1 c d ; コメント\n/ 行コメント\nP1 e');
    expect(result.success).toBe(true);
  });

  it('detune and transpose are emitted', () => {
    const result = compile('P1 K2 D-10 c');
    expect(result.success).toBe(true);

    const p1 = getTrackData(result, 'P1');
    expect(p1[0]).toBe(0x08); // TRANSPOSE
    expect(p1[1] > 127 ? p1[1] - 256 : p1[1]).toBe(2); // 符号付き 8bit で 2
    expect(p1[2]).toBe(0x07); // DETUNE
    const detune = p1[3] | (p1[4] << 8);
    expect(detune > 32767 ? detune - 65536 : detune).toBe(-10); // 符号付き 16bit で -10
  });

  it('noise commands are applied to noise tracks', () => {
    const result = compile('N1 @wn1 @in2 c');
    expect(result.success).toBe(true);

    const n1 = getTrackData(result, 'N1');
    // @wn1 → NOISECTL(flags=0x01)、@in2 → NOISECTL(flags=0x05) の順に emit
    expect(n1[0]).toBe(0x0a); // NOISECTL
    expect(n1[1]).toBe(0x01); // ホワイト (bit0)
    expect(n1[2]).toBe(0x0a); // 2 つ目の NOISECTL
    expect(n1[3]).toBe(0b0000_0101); // トーン 3 連動・ホワイト
  });

  it('sample song compiles', () => {
    const mml = [
      '; サンプル',
      '@v0 = {15, 12, 9, 6, 3, 0}',
      't120',
      'P1 @v0 o4 l8 c d e c e f g2',
      'P2 o3 l8 c2 c2 f2 f2',
      'B1 l4 c c c c',
      'L',
    ].join('\n');
    const result = compile(mml);
    expect(result.success).toBe(true);
    expect(result.tracks.length).toBe(3);
    expect(result.totalFrames).toBeGreaterThan(0);
  });
});

describe('MML macro multi-line', () => {
  it('FM tone multi-line without trailing commas compiles', () => {
    const result = compile([
      '@FM1 = {',
      '  4, 3',
      '  31, 10, 0, 0, 0, 40, 0, 1, 0, 0, 0',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0',
      '}',
      'F1 @1 c',
    ].join('\n'));
    expect(result.success).toBe(true);
  });

  it('FM tone multi-line with line comments compiles', () => {
    const result = compile([
      '@FM1 = {',
      '  4, 3                                 ; ALG, FB',
      '  31, 10, 0, 0, 0, 40, 0, 1, 0, 0, 0   ; Op1',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0   ; Op2',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0   ; Op3',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0   ; Op4',
      '}',
      'F1 @1 c',
    ].join('\n'));
    expect(result.success).toBe(true);
  });

  it('volume envelope multi-line compiles', () => {
    const result = compile([
      '@v0 = {',
      '  15, 12',
      '  9, 6',
      '  3, 0',
      '}',
      'P1 @v0 c',
    ].join('\n'));
    expect(result.success).toBe(true);
  });

  it('pitch envelope multi-line with loop compiles', () => {
    const result = compile([
      '@EP0 = {',
      '  0, 3, 6,',
      '  |, 6, 3, 0',
      '}',
      'P1 @EP0 c',
    ].join('\n'));
    expect(result.success).toBe(true);
  });
});

describe('MML reference compliance (mml_reference.md 4章)', () => {
  // FM 音色 46 パラメータ (ALG, FB + OP1〜OP4 各 11: AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME)
  const tone46MultiLine = [
    '  4, 6,',
    '  31, 12, 0, 15, 3, 24, 0, 1, 0, 0, 0,',
    '  31, 18, 0, 12, 5, 18, 0, 2, 3, 0, 0,',
    '  31, 10, 0, 15, 2, 30, 0, 1, 0, 0, 0,',
    '  31,  8, 0,  8, 4,  0, 0, 1, 0, 0, 0',
  ].join('\n');
  const tone46Inline = tone46MultiLine.replace(/\s+/g, ' ').trim();

  it('FM tone @1 = { } multi-line definition (4.3 / TONE エディタ出力形式)', () => {
    const result = compile(`@1 = {\n  /* E.PIANO 1 */\n${tone46MultiLine}\n}\nF1 @1 c`);
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[20]).toBe(1); // FM 音色数
  });

  it('FM tone @FM1 = { } definition and @FM1 apply', () => {
    const result = compile(`@FM1 = { ${tone46Inline} }\nF1 @FM1 c`);
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[20]).toBe(1); // FM 音色数
  });

  it('volume envelope @VE1 = { } definition and @VE1 apply (4.1)', () => {
    const result = compile('@VE1 = {15, 14, 13, |, 12, 11, >, 8, 5, 2, 0}\nP1 @VE1 c');
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[14]).toBe(1); // 音量エンベロープ数
  });

  it('pitch envelope @PE1 = { } definition and @PE1 apply (4.2)', () => {
    const result = compile('@PE1 = {5, -5, |, 5, -5}\nP1 @PE1 c');
    expect(result.success).toBe(true);
    expect((result.musicData as Uint8Array)[17]).toBe(1); // ピッチエンベロープ数
  });

  it('volume envelope loop | and release > markers are parsed', () => {
    const diagnostics: MmlDiagnostic[] = [];
    const env = parseVolumeEnvelope(1, '15, 14, 13, |, 12, 11, >, 8, 5, 2, 0', 1, diagnostics);
    expect(env).not.toBeNull();
    expect(env?.loopIndex).toBe(3);
    expect(env?.releaseIndex).toBe(5);
    expect(diagnostics).toHaveLength(0);
  });

  it('pitch envelope loop | marker is parsed', () => {
    const diagnostics: MmlDiagnostic[] = [];
    const env = parsePitchEnvelope(1, '|, 0, 3, 6', 1, diagnostics);
    expect(env).not.toBeNull();
    expect(env?.loopIndex).toBe(0);
    expect(diagnostics).toHaveLength(0);
  });

  it('obsolete |L / |R markers are invalid elements', () => {
    const result = compile('@v1 = { 15, |L 12, |R 8 }\nP1 @v1 c');
    expect(result.success).toBe(false);
  });

  it('sample main.mml compiles with reference syntax', () => {
    const mml = [
      '; MZ-1500 MML Example',
      '',
      '#TITLE "Theme of MZ"',
      '#COMPOSER "User"',
      '#OPM OFF',
      '#OCTAVE NORMAL',
      '',
      '; FM音色定義 (#OPM ON 時に F1〜F8 トラックで @1 を指定して使用)',
      '@1 = {',
      '  4, 6,',
      '  31, 12, 0, 15, 3, 24, 0, 1, 0, 0, 0,',
      '  31, 18, 0, 12, 5, 18, 0, 2, 3, 0, 0,',
      '  31, 10, 0, 15, 2, 30, 0, 1, 0, 0, 0,',
      '  31,  8, 0,  8, 4,  0, 0, 1, 0, 0, 0',
      '}',
      '@v1 = { 15, 14, 13, |, 12, 11, >, 8, 5, 2, 0 }',
      '@PE1 = { |, 0, 2, 4, 6, 8, 6, 4, 2 }',
      '',
      'P1 t120 l8 o4 @v1 @PE1',
      'P1 c e g > c < g e c r',
      'P1 L [c d e f g2]2',
    ].join('\n');
    const result = compile(mml);
    expect(result.success).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error)).toHaveLength(0);
  });
});
