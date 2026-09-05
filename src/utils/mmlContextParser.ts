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
// 指定行の解析
// ──────────────────────────────────────────────

/**
 * MML の 1 行から @N / @VEN / @PEN の使用箇所を抽出する。
 * コメント (`;` / `//`) 以降は無視する。
 */
export function analyzeMmlLine(line: string): MmlLineAnalysis {
  // コメントを除去
  const commentIdx = line.search(/;|\/\//);
  const effective = commentIdx >= 0 ? line.slice(0, commentIdx) : line;

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
