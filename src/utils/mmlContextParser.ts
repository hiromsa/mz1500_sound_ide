/**
 * MML右クリックコンテキストメニュー用パーサーユーティリティ
 * - 指定行に含まれる @N / @VEN / @PEN の ID を抽出
 * - MML全文から使用済み ID セットを収集して新規採番に使用
 */

// ──────────────────────────────────────────────
// 型定義
// ──────────────────────────────────────────────

export interface MmlLineAnalysis {
  /** FM音色マクロ ID (@N / @FMN) */
  toneId: number | null;
  /** ボリュームエンベロープ ID (@vN / @VEN) */
  volEnvId: number | null;
  /** ピッチエンベロープ ID (@PEN) */
  pitchEnvId: number | null;
}

export interface UsedIds {
  toneIds: Set<number>;
  volEnvIds: Set<number>;
  pitchEnvIds: Set<number>;
}

// ──────────────────────────────────────────────
// 共通ヘルパー
// ──────────────────────────────────────────────

/**
 * 行からコメントを除去したテキストを返す。
 * - 同一行内で完結するブロックコメントを先に除去 (内側の ; / // を保護)
 * - 閉じられていないブロックコメント開始以降はコメントとして除去
 * - 行コメント (`;` / `//`) 以降を除去
 */
function stripComment(line: string): string {
  // 同一行内で完結する /* ... */ を先に除去 (内側の ; / // を保護)
  let text = line.replace(/\/\*.*?\*\//g, '');

  // 閉じられていない /* は以降をコメントとみなす
  const openIdx = text.search(/\/\*/);
  if (openIdx >= 0) text = text.slice(0, openIdx);

  // 行コメント (; / //) 以降を除去
  const commentIdx = text.search(/;|\/\//);
  return commentIdx >= 0 ? text.slice(0, commentIdx) : text;
}

// ──────────────────────────────────────────────
// 指定行の解析
// ──────────────────────────────────────────────

/**
 * MML の 1 行から @N / @VEN / @PEN の使用箇所を抽出する。
 * コメント (`;` / `//`) 以降は無視する。
 */
export function analyzeMmlLine(line: string): MmlLineAnalysis {
  const effective = stripComment(line);

  let toneId: number | null = null;
  let volEnvId: number | null = null;
  let pitchEnvId: number | null = null;

  // @PEN を先にマッチ (@PE が @P を含むため)
  const peMatch = effective.match(/@PE(\d+)/i);
  if (peMatch) {
    pitchEnvId = parseInt(peMatch[1], 10);
  }

  // @VEN / @vN
  const veMatch = effective.match(/@(?:VE|v)(\d+)/i);
  if (veMatch) {
    // ただし @VE または @v であり、@PE ではないことを確認
    volEnvId = parseInt(veMatch[1], 10);
  }

  // @N / @FMN  (数字のみ or FM プレフィックス)
  // @PE や @VE との衝突を避けるためにそれらを除外した後にマッチ
  const stripped = effective
    .replace(/@PE\d+/gi, '')
    .replace(/@(?:VE|v)\d+/gi, '');
  const toneMatch = stripped.match(/@(?:FM)?(\d+)/i);
  if (toneMatch) {
    toneId = parseInt(toneMatch[1], 10);
  }

  return { toneId, volEnvId, pitchEnvId };
}

// ──────────────────────────────────────────────
// MML全文から使用済みIDを収集
// ──────────────────────────────────────────────

/**
 * MML 全文を走査して TONE / VOL ENV / PITCH ENV の定義・使用 ID を収集する。
 * 主に「新規採番」時の最大ID+1の計算に使用する。
 */
export function collectUsedIds(content: string): UsedIds {
  const toneIds = new Set<number>();
  const volEnvIds = new Set<number>();
  const pitchEnvIds = new Set<number>();

  for (const m of content.matchAll(/@PE(\d+)/gi)) {
    pitchEnvIds.add(parseInt(m[1], 10));
  }

  for (const m of content.matchAll(/@(?:VE|v)(\d+)/gi)) {
    volEnvIds.add(parseInt(m[1], 10));
  }

  // @N / @FMN - ただし @PE / @VE / @v を除いた文字列に対してマッチ
  const stripped = content
    .replace(/@PE\d+/gi, '')
    .replace(/@(?:VE|v)\d+/gi, '');
  for (const m of stripped.matchAll(/@(?:FM)?(\d+)/gi)) {
    toneIds.add(parseInt(m[1], 10));
  }

  return { toneIds, volEnvIds, pitchEnvIds };
}

/**
 * 使用済み ID セットから次の未使用 ID を計算して返す。
 * 最大ID + 1 を採番する (セットが空の場合は 1)。
 */
export function nextAvailableId(usedIds: Set<number>): number {
  if (usedIds.size === 0) return 1;
  return Math.max(...usedIds) + 1;
}

// ──────────────────────────────────────────────
// 定義ブロック解析
// ──────────────────────────────────────────────

/** 右クリックメニューの「編集」対象となる定義ブロックの種別 */
export type MmlDefinitionKind = 'tone' | 'volEnv' | 'pitchEnv';

/** MML 内のマクロ定義ブロック (`@<種別><番号> = { ... }`) 1件分の情報 */
export interface MmlDefinitionBlock {
  kind: MmlDefinitionKind;
  id: number;
  /** 定義開始行 (`@N = {` の行、1-based) */
  startLine: number;
  /** 定義終了行 (対応する `}` の行、1-based) */
  endLine: number;
}

/**
 * 定義ヘッダ (`@<種別><番号> = {`) を行頭から抽出する正規表現。
 * 書式はコンパイラ (MmlCompiler.ts の macroRegex) と同一で `=` 必須、
 * `{` はヘッダと同一行に置かれることを要求する。
 */
const definitionHeaderRegex = /^[ \t]*@(?:(v|VE|EP|PE|FM)(\d+)|(\d+))[ \t]*=[ \t]*\{/;

/** 定義ヘッダの接頭辞をメニュー用種別へ変換する (コンパイラ parseMacroHeader と同一の対応表)。 */
function resolveDefinitionKind(prefix: string | undefined): MmlDefinitionKind {
  switch (prefix) {
    case 'v':
    case 'VE':
      return 'volEnv';
    case 'PE':
    case 'EP':
      return 'pitchEnv';
    default:
      return 'tone';
  }
}

/**
 * MML 全文からマクロ定義ブロック (TONE / VOL ENV / PITCH ENV) を抽出する。
 * 定義が複数行 (折り返し) にわたる場合は対応する `}` の行までを範囲として返す。
 * 利用箇所 (`P1 @1` 等) は `=` を伴わないため抽出対象外。コメント内の記述も無視する。
 */
export function findDefinitionBlocks(content: string): MmlDefinitionBlock[] {
  const blocks: MmlDefinitionBlock[] = [];
  const lines = content.split('\n');

  let openBlock: { kind: MmlDefinitionKind; id: number; startLine: number } | null = null;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const text = stripComment(lines[i]);

    // 未オープン時は行頭から定義ヘッダを探す
    if (openBlock === null) {
      const header = definitionHeaderRegex.exec(text);
      if (header === null) continue;
      openBlock = {
        kind: resolveDefinitionKind(header[1]),
        id: parseInt(header[2] ?? header[3], 10),
        startLine: lineNumber,
      };
    }

    // ブロック内の `{` / `}` を数え、対応する `}` の行を定義終了行とする
    for (const ch of text) {
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth <= 0) {
          blocks.push({ ...openBlock, endLine: lineNumber });
          openBlock = null;
          break;
        }
      }
    }
  }

  return blocks;
}

/**
 * 指定行を含む定義ブロックを返す (存在しなければ null)。
 * 複数行 (折り返し) 定義は開始行〜終了行のどの行でもヒットする。
 */
export function findDefinitionAt(
  blocks: readonly MmlDefinitionBlock[],
  lineNumber: number,
): MmlDefinitionBlock | null {
  return blocks.find(b => b.startLine <= lineNumber && lineNumber <= b.endLine) ?? null;
}
