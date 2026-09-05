/**
 * MML コンパイル診断をシステムコンソール用のログ行へ整形する純粋ロジック。
 * (BUILD 失敗時にエラー詳細を CONSOLE へ表示するために使用する)
 */
import { DiagnosticSeverity, type MmlDiagnostic } from '../core/mml/TrackId';

/** 既定でコンソールへ出力する診断の上限件数 (超過分は要約行へ置き換える)。 */
export const DEFAULT_MAX_DIAGNOSTIC_LINES = 20;

/** 診断 1 件をコンソール 1 行へ整形する。 */
export function formatDiagnosticLine(diagnostic: MmlDiagnostic): string {
  const level = diagnostic.severity === DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
  return `[BUILD] ${level} ${diagnostic.line}:${diagnostic.column} - ${diagnostic.message}`;
}

/**
 * コンパイル診断をシステムコンソール用の行配列へ変換する。
 * maxLines を超える場合は切り詰め、残件数を要約した行を末尾へ付ける。
 */
export function formatDiagnosticsAsLogLines(
  diagnostics: readonly MmlDiagnostic[],
  maxLines: number = DEFAULT_MAX_DIAGNOSTIC_LINES,
): string[] {
  const lines = diagnostics.map(formatDiagnosticLine);
  if (lines.length <= maxLines) {
    return lines;
  }

  return [
    ...lines.slice(0, maxLines),
    `[BUILD] ... and ${lines.length - maxLines} more. See the PROBLEMS panel.`,
  ];
}
