/**
 * トラック ID (P1-P6 / N1-N2 / B1 / F1-F8) と診断型。
 * (移植元: MzSound.MmlCompiler/TrackId.cs)
 */

/** トラック ID (P1-P6 / N1-N2 / B1 / F1-F8)。 */
export interface TrackId {
  readonly id: string;
  /** 0-16 のトラック番号 (仕様書 §2 の並び順)。 */
  readonly index: number;
  readonly isNoise: boolean;
  readonly isBeep: boolean;
  readonly isFm: boolean;
  /** FM チャンネル番号 (0-7、FM 以外は -1)。 */
  readonly fmChannel: number;
}

function buildAllTracks(): TrackId[] {
  const list: TrackId[] = [];
  for (let i = 1; i <= 6; i++) {
    list.push({ id: `P${i}`, index: list.length, isNoise: false, isBeep: false, isFm: false, fmChannel: -1 });
  }

  list.push({ id: 'N1', index: list.length, isNoise: true, isBeep: false, isFm: false, fmChannel: -1 });
  list.push({ id: 'N2', index: list.length, isNoise: true, isBeep: false, isFm: false, fmChannel: -1 });
  list.push({ id: 'B1', index: list.length, isNoise: false, isBeep: true, isFm: false, fmChannel: -1 });
  for (let i = 1; i <= 8; i++) {
    list.push({ id: `F${i}`, index: list.length, isNoise: false, isBeep: false, isFm: true, fmChannel: i - 1 });
  }

  return list;
}

/** 全トラック ID (仕様書 §2 の並び順)。 */
export const allTracks: readonly TrackId[] = buildAllTracks();

/** トラック記号をパースする (大文字小文字を区別しない)。見つからない場合は null。 */
export function parseTrackId(text: string): TrackId | null {
  const upper = text.toUpperCase();
  return allTracks.find((track) => track.id === upper) ?? null;
}

/** 診断の重要度。 */
export const DiagnosticSeverity = {
  Warning: 0,
  Error: 1,
} as const;
export type DiagnosticSeverity = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

/** 診断 (エラー/警告)。 */
export interface MmlDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export function diagnosticToString(diagnostic: MmlDiagnostic): string {
  const level = diagnostic.severity === DiagnosticSeverity.Error ? 'error' : 'warning';
  return `${level} MML${String(diagnostic.line).padStart(4, '0')}: ${diagnostic.message} (${diagnostic.line} 行 ${diagnostic.column} 列目)`;
}
