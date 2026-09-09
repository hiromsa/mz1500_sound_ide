/**
 * 他方言 MML トラック (OTHER TRACKS: A-Z アルファベット 1 文字) の検出ユーティリティ。
 *
 * MZ-1500 正式パーサのトラック (`P1` / `N1` / `B1` / `F1` 等) 以外の
 * 単独大文字トラック (他方言 MML で使用される `A` / `B` / `C` 等) を
 * MML TRANSFORM の変換対象として扱えるようにするための純粋関数群 (UI 非依存)。
 * - 検出は `mmlTrackScope.resolveLineScopes` (行頭宣言解析) に委譲する
 * - 変換エンジン (`mmlTransformEngine`) はトラック名を辞書照会するのみのため、
 *   OTHER 名のトラックも既存の 4 操作 (remap / octave / transpose / volume) がそのまま適用可能
 */
import { resolveLineScopes } from './mmlTrackScope';

/** OTHER トラック (A-Z アルファベット 1 文字) のトラック名かどうか。 */
export function isOtherTrackName(name: string): boolean {
  return /^[A-Z]$/.test(name);
}

/** OTHER トラックの全候補 (`A`-`Z`)。 */
export const OTHER_TRACK_IDS: readonly string[] = Array.from(
  { length: 26 },
  (_, index) => String.fromCharCode('A'.charCodeAt(0) + index),
);

/**
 * MML ソースに記載されている OTHER トラック (行頭の A-Z 1 文字宣言) を
 * 出現順に検出する (重複なし)。マクロ定義行・ディレクティブ行は宣言を
 * 持たないため対象外。
 */
export function detectOtherTracks(source: string): string[] {
  const detected: string[] = [];

  for (const scope of resolveLineScopes(source)) {
    if (!scope.hasDeclaration) {
      continue;
    }

    for (const name of scope.trackNames) {
      if (isOtherTrackName(name) && !detected.includes(name)) {
        detected.push(name);
      }
    }
  }

  return detected;
}
