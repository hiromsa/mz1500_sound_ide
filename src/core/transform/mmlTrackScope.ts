/**
 * MML ソースの行スコープ解析 (各行のトラック帰属の解決)。
 *
 * MML TRANSFORM エンジンから使用する純粋関数群。トラック宣言の検出ルールは
 * 正式パーサ (`MmlParser.detectTrackSpec` / W トラックの行頭スキップ判定) と同一:
 * - 宣言は行頭 (先頭空白の後) の大文字識別子のみ (`P1`-`P6` / `N1`-`N2` / `B1` / `F1`-`F8`)
 * - カンマ区切りによる複数指定 (`F1,F2`) に対応
 * - 作業用トラック (`W1`-`W99`) は行頭の `W数字` のみ (パーサーの W 行判定と同一条件)
 * - 宣言の無い行 (継続行) は直前行のトラックに帰属する
 */
import { parseTrackId } from '../mml/TrackId';

/** 解析済みの 1 行分のスコープ情報。 */
export interface MmlLineScope {
  /** 行に帰属するトラック名 (無所属行は空配列)。 */
  readonly trackNames: readonly string[];
  /** 行頭にトラック宣言があるか。 */
  readonly hasDeclaration: boolean;
  /** トラック宣言直後の MML 本体の開始インデックス (0-based、無宣言行は 0)。 */
  readonly contentStart: number;
  /** 内容の変換対象外の行 (マクロ定義行・ディレクティブ行)。 */
  readonly isSkipped: boolean;
}

/** 行頭トラック宣言の識別子トークン (テキスト上の位置つき)。 */
export interface TrackDeclarationToken {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

const isDigitChar = (ch: string): boolean => ch >= '0' && ch <= '9';

/** マクロ定義行 (`@VE1 = { ... }` / `@1 = { ... }` 等) かどうか。 */
export function isMacroDefinitionLine(line: string): boolean {
  return /^\s*@(?:VE|EP|PE|FM)?\d*\s*=/i.test(line);
}

/** ディレクティブ行 (`#TITLE` 等) かどうか。 */
export function isDirectiveLine(line: string): boolean {
  return /^\s*#/.test(line);
}

/**
 * 行頭のトラック宣言を識別子トークン (位置つき) として抽出する。
 * 宣言が無い場合は null を返す。検出ルールは正式パーサ準拠 (クラスコメント参照)。
 */
export function extractDeclarationTokens(
  line: string,
): { tokens: readonly TrackDeclarationToken[]; contentStart: number } | null {
  // W トラック宣言: 行頭の `W数字` のみ (パーサーの W 行スキップ判定 `/^W\d+\b/i` と同一条件)。
  // カンマ区切りの複数指定は正式パーサでも解釈されないため単一のみ対応。
  const workMatch = /^\s*W(\d+)\b/i.exec(line);
  if (workMatch) {
    const end = workMatch[0].length;
    return {
      tokens: [{ name: `W${workMatch[1]}`, start: workMatch.index, end }],
      contentStart: end,
    };
  }

  let pos = line.length - line.trimStart().length;
  const tokens: TrackDeclarationToken[] = [];

  while (pos < line.length) {
    const c = line[pos];

    if (c === ' ' || c === '\t') {
      // トラック記号列の後の空白で指定終了
      if (tokens.length > 0) {
        return { tokens, contentStart: pos + 1 };
      }
      pos++;
      continue;
    }

    // トラック記号は大文字のみ (小文字の f4 などは音符として扱う)
    if ((c === 'P' || c === 'N' || c === 'B' || c === 'F')
      && pos + 1 < line.length && isDigitChar(line[pos + 1])) {
      const id = parseTrackId(line.slice(pos, pos + 2));
      if (id === null) {
        break; // P7 / N9 など無効なトラック → トラック指定ではない
      }

      if (!tokens.some((token) => token.name === id.id)) {
        tokens.push({ name: id.id, start: pos, end: pos + 2 });
      }

      pos += 2;
      continue;
    }

    if (c === ',') {
      pos++;
      continue;
    }

    break;
  }

  return tokens.length > 0 ? { tokens, contentStart: pos } : null;
}

/**
 * MML ソース全体を解析し、各行のスコープ (トラック帰属) を返す。
 * マクロ定義行・ディレクティブ行は内容変換対象外だが、直前のトラック帰属は維持する。
 */
export function resolveLineScopes(source: string): MmlLineScope[] {
  let currentTracks: readonly string[] = [];

  return source.split('\n').map((line) => {
    if (isMacroDefinitionLine(line) || isDirectiveLine(line)) {
      return { trackNames: currentTracks, hasDeclaration: false, contentStart: 0, isSkipped: true };
    }

    const declaration = extractDeclarationTokens(line);
    if (declaration) {
      currentTracks = declaration.tokens.map((token) => token.name);
      return {
        trackNames: currentTracks,
        hasDeclaration: true,
        contentStart: declaration.contentStart,
        isSkipped: false,
      };
    }

    return { trackNames: currentTracks, hasDeclaration: false, contentStart: 0, isSkipped: false };
  });
}