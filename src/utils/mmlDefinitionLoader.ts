/**
 * MML 定義ブロック (@N = { ... } / @VEN = { ... } / @PEN = { ... }) を
 * 各エディタ (FM TONE / VOL ENV / PITCH ENV) のデータ形状へロードするユーティリティ。
 * UI (React コンポーネント) に依存しない純粋関数として分離する (高凝集・疎結合)。
 *
 * 生成 (各エディタ generateMmlSnippet) と逆変換 (本モジュール) の書式対応表:
 * - FM TONE  : `@N = { /* 音色名 *\/ ... 46 値 ... }` (ALG, FB + OP1〜OP4 各 11 値)
 * - VOL ENV  : `@VEN = { | / > マーカー付き音量列 }` (マーカーはループ/リリース開始位置)
 * - PITCH ENV: `@PEN = { | マーカー付きピッチ列 }`
 */
import { findDefinitionBlocks, type MmlDefinitionKind } from './mmlContextParser';
import type { FmToneData, OperatorParams } from '../core/fm/FmTone';

/** VOL ENV 定義をエディタのデータ形状へロードした結果 */
export interface VolEnvDefinition {
  /** エンベロープ名 (MMLコメント /* NAME: xxx *\/ から抽出、未指定時は undefined) */
  name?: string;
  /** 各フレームの音量 (0〜15) */
  data: number[];
  /** ループ開始ステップ (-1 = ループなし) */
  loopPoint: number;
  /** KEYOFF 時のリリース開始ステップ (-1 = なし) */
  releasePoint: number;
}

/** PITCH ENV 定義をエディタのデータ形状へロードした結果 */
export interface PitchEnvDefinition {
  /** エンベロープ名 (MMLコメント /* NAME: xxx *\/ から抽出、未指定時は undefined) */
  name?: string;
  /** 各フレームのピッチ変調値 */
  data: number[];
  /** ループ開始ステップ (-1 = ループなし) */
  loopPoint: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * 定義本文のコメントから名称 (NAME: xxx / name: xxx) を抽出する。
 * 後方互換性として、NAME: プレフィックスが無い場合でも
 * パラメータメタ情報 (ALG= や OP 等) でない最初のコメントをフォールバック抽出する。
 */
export function extractDefinitionName(body: string): string | undefined {
  const comments = [...body.matchAll(/\/\*([\s\S]*?)\*\//g)].map((m) => m[1].trim());

  // 1. 最優先: `NAME: xxx` または `name: xxx` (大文字小文字不問)
  for (const comment of comments) {
    const match = /^name\s*:\s*(.+)$/i.exec(comment);
    if (match) {
      const trimmed = match[1].trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  // 2. 後方互換フォールバック: 予約キーワード (ALG=, OP, FB= 等) を含まない最初のコメント
  for (const comment of comments) {
    if (
      comment.length > 0 &&
      !/^(ALG|FB|OP\d|AR|D1R|D2R|RR|TL|MUL)\b/i.test(comment) &&
      !comment.includes('=')
    ) {
      return comment;
    }
  }

  return undefined;
}

/**
 * 指定種別・ID の定義ブロック本文 (`{` と `}` の間) を抽出する。
 * 定義が存在しない場合は null を返す。
 */
function extractDefinitionBody(content: string, kind: MmlDefinitionKind, id: number): string | null {
  const block = findDefinitionBlocks(content).find((b) => b.kind === kind && b.id === id);
  if (!block) return null;

  const lines = content.split('\n').slice(block.startLine - 1, block.endLine);
  const text = lines.join('\n');
  const openIdx = text.indexOf('{');
  const closeIdx = text.lastIndexOf('}');
  if (openIdx < 0 || closeIdx < 0 || closeIdx <= openIdx) return null;
  return text.slice(openIdx + 1, closeIdx);
}

/**
 * 定義本文をトークン配列へ分割する。
 * コメント除去・改行も区切りとして扱う点はコンパイラ (MmlCompilerMacros.splitMacroTokens) と同一。
 * トークンはトリム済み (マーカー `|` / `>` はトークンとして保持)。
 */
function splitDefinitionTokens(body: string): string[] {
  const cleaned = body
    .replace(/(;|\/)[^\r\n]*/g, '')
    .replace(/\r?\n/g, ',');
  return cleaned
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .flatMap((token) => {
      // `| 12` / `> 8` のような「マーカー+数値」(エディタ generateMmlSnippet 出力書式) を分離する
      const match = /^([|>])\s*(.+)$/.exec(token);
      return match ? [match[1], match[2]] : [token];
    });
}

/** トークンが整数 (符号可) かどうか判定する。 */
function isIntegerToken(token: string): boolean {
  return /^[+-]?\d+$/.test(token);
}

/** 本文から数値トークンを順序を保って抽出する (マーカーやコメントは無視)。 */
function extractNumberTokens(body: string): number[] {
  return splitDefinitionTokens(body)
    .filter(isIntegerToken)
    .map((token) => parseInt(token, 10));
}

// ──────────────────────────────────────────────
// FM TONE (@N / @FMN = { ... })
// ──────────────────────────────────────────────

/** FM 音色パラメータの有効範囲 (FmToneEditor の PARAM_LIMITS と同一) */
const FmParamLimits = {
  alg: { min: 0, max: 7 },
  fb: { min: 0, max: 7 },
  ar: { min: 0, max: 31 },
  d1r: { min: 0, max: 31 },
  d2r: { min: 0, max: 31 },
  rr: { min: 0, max: 31 },
  d1l: { min: 0, max: 15 },
  tl: { min: 0, max: 127 },
  ks: { min: 0, max: 3 },
  mul: { min: 0, max: 15 },
  dt1: { min: 0, max: 7 },
  dt2: { min: 0, max: 3 },
} as const;

/** MML 定義 1 OP 分 (11 値) を OperatorParams へ変換する。値の並びは generateMmlSnippet に準拠。 */
function buildOperatorParams(values: number[]): OperatorParams {
  return {
    ar: clamp(values[0], FmParamLimits.ar.min, FmParamLimits.ar.max),
    d1r: clamp(values[1], FmParamLimits.d1r.min, FmParamLimits.d1r.max),
    d2r: clamp(values[2], FmParamLimits.d2r.min, FmParamLimits.d2r.max),
    rr: clamp(values[3], FmParamLimits.rr.min, FmParamLimits.rr.max),
    d1l: clamp(values[4], FmParamLimits.d1l.min, FmParamLimits.d1l.max),
    tl: clamp(values[5], FmParamLimits.tl.min, FmParamLimits.tl.max),
    ks: clamp(values[6], FmParamLimits.ks.min, FmParamLimits.ks.max),
    mul: clamp(values[7], FmParamLimits.mul.min, FmParamLimits.mul.max),
    dt1: clamp(values[8], FmParamLimits.dt1.min, FmParamLimits.dt1.max),
    dt2: clamp(values[9], FmParamLimits.dt2.min, FmParamLimits.dt2.max),
    ame: values[10] === 1,
  };
}

/**
 * MML 全文から指定 ID の FM 音色定義を読み込む。
 * 定義が存在しない・パラメータ数が不足している場合は null を返す。
 */
export function loadFmToneDefinition(content: string, id: number): FmToneData | null {
  const body = extractDefinitionBody(content, 'tone', id);
  if (body === null) return null;

  // 音色名: /* NAME: xxx */ を最優先、フォールバックで既存コメントを復元
  const name = extractDefinitionName(body) ?? 'UNNAMED';

  const numbers = extractNumberTokens(body);
  // ALG, FB + OP1〜OP4 各 11 値 = 46
  if (numbers.length < 2 + 4 * 11) return null;

  const alg = clamp(numbers[0], FmParamLimits.alg.min, FmParamLimits.alg.max);
  const fb = clamp(numbers[1], FmParamLimits.fb.min, FmParamLimits.fb.max);
  const ops = [
    buildOperatorParams(numbers.slice(2, 13)),
    buildOperatorParams(numbers.slice(13, 24)),
    buildOperatorParams(numbers.slice(24, 35)),
    buildOperatorParams(numbers.slice(35, 46)),
  ] as [OperatorParams, OperatorParams, OperatorParams, OperatorParams];

  return { id, name, alg, fb, ops };
}

// ──────────────────────────────────────────────
// VOL ENV (@VEN = { ... })
// ──────────────────────────────────────────────

/**
 * MML 全文から指定 ID の音量エンベロープ定義を読み込む。
 * 定義が存在しない・有効な要素が 1 つも無い場合は null を返す。
 * マーカー (`|` / `>`) は直後の要素を先頭とするループ/リリース位置へ変換する。
 */
export function loadVolEnvDefinition(content: string, id: number): VolEnvDefinition | null {
  const body = extractDefinitionBody(content, 'volEnv', id);
  if (body === null) return null;

  const name = extractDefinitionName(body);
  const data: number[] = [];
  let loopPoint = -1;
  let releasePoint = -1;

  for (const token of splitDefinitionTokens(body)) {
    if (token === '|') {
      if (loopPoint < 0) loopPoint = data.length;
      continue;
    }

    if (token === '>') {
      if (releasePoint < 0) releasePoint = data.length;
      continue;
    }

    if (isIntegerToken(token)) {
      data.push(clamp(parseInt(token, 10), 0, 15));
    }
  }

  if (data.length === 0) return null;
  return { name, data, loopPoint, releasePoint };
}

// ──────────────────────────────────────────────
// PITCH ENV (@PEN / @EPN = { ... })
// ──────────────────────────────────────────────

/**
 * MML 全文から指定 ID のピッチエンベロープ定義を読み込む。
 * 定義が存在しない・有効な要素が 1 つも無い場合は null を返す。
 * (ピッチレンジ ±N は MML 定義に含まれないためロード対象外)
 */
export function loadPitchEnvDefinition(content: string, id: number): PitchEnvDefinition | null {
  const body = extractDefinitionBody(content, 'pitchEnv', id);
  if (body === null) return null;

  const name = extractDefinitionName(body);
  const data: number[] = [];
  let loopPoint = -1;

  for (const token of splitDefinitionTokens(body)) {
    if (token === '|') {
      if (loopPoint < 0) loopPoint = data.length;
      continue;
    }

    if (isIntegerToken(token)) {
      data.push(parseInt(token, 10));
    }
  }

  if (data.length === 0) return null;
  return { name, data, loopPoint };
}

// ──────────────────────────────────────────────
// 定義済み判定
// ──────────────────────────────────────────────

/**
 * MML 全文中に指定種別・ID の定義ブロック (`@<種別><番号> = { ... }`) が存在するかを返す。
 * 利用箇所 (`P1 @1` 等) のみで定義が無い場合は false (未定義) 扱いとする。
 */
export function isIdDefined(content: string, kind: MmlDefinitionKind, id: number): boolean {
  return findDefinitionBlocks(content).some((b) => b.kind === kind && b.id === id);
}
