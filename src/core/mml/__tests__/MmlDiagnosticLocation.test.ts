/**
 * コンパイル診断の位置情報 (line / column) の検証テスト。
 * PROBLEMS パネルの "Line x, Col y" 表示とエラー行ジャンプの精度に直結する。
 * column は 1-based (Monaco Editor 準拠)。
 */
import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity, type MmlDiagnostic } from '../TrackId';
import { MmlCompiler } from '../MmlCompiler';

/** ソースをコンパイルし、診断を返す。 */
function compile(source: string): readonly MmlDiagnostic[] {
  return new MmlCompiler().compile(source).diagnostics;
}

/** 最初のエラー診断を返す (無ければ失敗)。 */
function firstError(diagnostics: readonly MmlDiagnostic[]): MmlDiagnostic {
  const error = diagnostics.find((d) => d.severity === DiagnosticSeverity.Error);
  expect(error, `エラー診断が存在しない: ${JSON.stringify(diagnostics)}`).toBeDefined();
  return error!;
}

/** 最初の警告診断を返す (無ければ失敗)。 */
function firstWarning(diagnostics: readonly MmlDiagnostic[]): MmlDiagnostic {
  const warning = diagnostics.find((d) => d.severity === DiagnosticSeverity.Warning);
  expect(warning, `警告診断が存在しない: ${JSON.stringify(diagnostics)}`).toBeDefined();
  return warning!;
}

describe('MmlCompiler 診断の位置情報 (line / column)', () => {
  it('不明な文字はその文字の列位置を報告する', () => {
    // "P1 cdef X" → X は 9 列目 (1-based)
    const diagnostics = compile('P1 cdef X\n');
    const error = firstError(diagnostics);
    expect(error.line).toBe(1);
    expect(error.column).toBe(9);
  });

  it('引数欠落エラーはコマンド文字の列位置を報告する (v)', () => {
    // "P1 v" → v は 4 列目
    const diagnostics = compile('P1 v\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('v');
    expect(error.line).toBe(1);
    expect(error.column).toBe(4);
  });

  it('引数欠落エラーはコマンド文字の列位置を報告する (o)', () => {
    // "P1 ov" → o は 4 列目
    const diagnostics = compile('P1 ov\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('o');
    expect(error.line).toBe(1);
    expect(error.column).toBe(4);
  });

  it('音長の範囲警告は数値の列位置を報告する', () => {
    // "P1 c99" → 99 は 5 列目
    const diagnostics = compile('P1 c99\n');
    const warning = firstWarning(diagnostics);
    expect(warning.line).toBe(1);
    expect(warning.column).toBe(5);
  });

  it('未定義エンベロープは番号の列位置を報告する', () => {
    // "P1 @VE9" → 9 は 7 列目
    const diagnostics = compile('P1 @VE9\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('@VE9');
    expect(error.line).toBe(1);
    expect(error.column).toBe(7);
  });

  it('トラック未指定行のエラーは行頭 (column 1) を報告する', () => {
    const diagnostics = compile('abc\ndef\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('トラック指定がありません');
    expect(error.line).toBe(1);
    expect(error.column).toBe(1);
  });

  it('ループ閉じ忘れ (対応する ] がない) は行頭 (column 1) を報告する', () => {
    const diagnostics = compile('P1 [cde\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('] がありません');
    expect(error.column).toBe(1);
  });

  it('対応する [ のない ] はその文字の列位置を報告する', () => {
    // "P1 ]" → ] は 4 列目
    const diagnostics = compile('P1 ]\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('] に対応する [');
    expect(error.column).toBe(4);
  });

  it('連符内の不正文字はその文字の列位置を報告する', () => {
    // "P1 {cx}" → x は 6 列目
    const diagnostics = compile('P1 {cx}\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('連符内');
    expect(error.line).toBe(1);
    expect(error.column).toBe(6);
  });

  it('マクロ定義の無効な要素は定義ヘッダの @ の列位置を報告する', () => {
    // "  @VE1 = { x }" → @ は 3 列目
    const diagnostics = compile('  @VE1 = { x }\nP1 c\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('無効なエンベロープ要素');
    expect(error.line).toBe(1);
    expect(error.column).toBe(3);
  });

  it('トラック未指定行のテンポ警告は数値の列位置を報告する (行頭 t)', () => {
    // "t300" → 300 は 2 列目
    const diagnostics = compile('t300\n');
    const warning = firstWarning(diagnostics);
    expect(warning.message).toContain('テンポ 300');
    expect(warning.line).toBe(1);
    expect(warning.column).toBe(2);
  });

  it('先頭空白があるテンポ行でも列位置がズレない', () => {
    // "  t300" → 300 は 4 列目
    const diagnostics = compile('  t300\n');
    const warning = firstWarning(diagnostics);
    expect(warning.message).toContain('テンポ 300');
    expect(warning.line).toBe(1);
    expect(warning.column).toBe(4);
  });

  it('@t の形式エラーは引数期待位置の列を報告する (先頭空白あり)', () => {
    // "  @t" → 引数期待位置は 5 列目
    const diagnostics = compile('  @t\n');
    const error = firstError(diagnostics);
    expect(error.message).toContain('@t');
    expect(error.line).toBe(1);
    expect(error.column).toBe(5);
  });

  it('コメント以降は解析対象外でエラーにならない', () => {
    const diagnostics = compile('P1 cde ; comment !!\n');
    expect(diagnostics).toHaveLength(0);
  });
});
