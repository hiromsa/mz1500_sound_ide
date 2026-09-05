import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from '../../core/mml/TrackId';
import {
  DEFAULT_MAX_DIAGNOSTIC_LINES,
  formatDiagnosticLine,
  formatDiagnosticsAsLogLines,
} from '../diagnosticsLog';

function buildError(line: number, column: number, message: string) {
  return { severity: DiagnosticSeverity.Error, line, column, message };
}

function buildWarning(line: number, column: number, message: string) {
  return { severity: DiagnosticSeverity.Warning, line, column, message };
}

describe('formatDiagnosticLine', () => {
  it('エラーを ERROR レベル付きの 1 行へ整形する', () => {
    expect(formatDiagnosticLine(buildError(3, 12, 'unknown command "X"'))).toBe(
      '[BUILD] ERROR 3:12 - unknown command "X"',
    );
  });

  it('警告を WARNING レベル付きの 1 行へ整形する', () => {
    expect(formatDiagnosticLine(buildWarning(5, 1, 'missing volume'))).toBe(
      '[BUILD] WARNING 5:1 - missing volume',
    );
  });
});

describe('formatDiagnosticsAsLogLines', () => {
  it('診断をそのまま行配列へ変換する (上限以内)', () => {
    const lines = formatDiagnosticsAsLogLines([
      buildError(1, 1, 'a'),
      buildWarning(2, 2, 'b'),
    ]);

    expect(lines).toEqual(['[BUILD] ERROR 1:1 - a', '[BUILD] WARNING 2:2 - b']);
  });

  it('空の診断は空配列を返す', () => {
    expect(formatDiagnosticsAsLogLines([])).toEqual([]);
  });

  it('上限件数ちょうどでは要約行を付けない', () => {
    const diagnostics = Array.from({ length: DEFAULT_MAX_DIAGNOSTIC_LINES }, (_, i) =>
      buildError(i + 1, 1, `error ${i}`),
    );
    const lines = formatDiagnosticsAsLogLines(diagnostics);

    expect(lines).toHaveLength(DEFAULT_MAX_DIAGNOSTIC_LINES);
    expect(lines.some((line) => line.includes('more.'))).toBe(false);
  });

  it('上限を超える場合は切り詰め、残件数の要約行を末尾へ付ける', () => {
    const diagnostics = Array.from({ length: 25 }, (_, i) => buildWarning(i + 1, 1, `warn ${i}`));
    const lines = formatDiagnosticsAsLogLines(diagnostics, 10);

    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe('[BUILD] WARNING 1:1 - warn 0');
    expect(lines[9]).toBe('[BUILD] WARNING 10:1 - warn 9');
    expect(lines[10]).toBe('[BUILD] ... and 15 more. See the PROBLEMS panel.');
  });
});
