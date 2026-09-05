/**
 * エンベロープ・エラー処理・ノイズ系・マクロ複数行のテスト。
 * (移植元: tests/MzSound.MmlCompiler.Tests/MmlCompilerAdvancedTests.cs / MacroMultiLineTests.cs)
 */
import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from '../TrackId';
import { MmlCompiler } from '../MmlCompiler';
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
