/**
 * MML マクロ種別の単一ソース辞書。
 *
 * マクロの追加・変更は本ファイルのみを更新すれば、以下へ自動反映される:
 * - `mmlContextParser.ts` : 行内 ID 解析 (`analyzeMmlLine`) / 使用済み ID 収集 (`collectUsedIds`)
 * - `mmlCaretParser.ts`   : 演奏状態コマンドパターン (`COMMAND_PATTERN`) / マクロ定義行判定
 * - `mmlLanguage.ts`      : Monarch シンタックスハイライト (定義行 & 呼び出しトークン)
 *
 * ⚠ FM 音色 `@<番号>` / `@FM<番号>` は番号直接指定の固有書式のため本辞書の対象外
 *    (利用側モジュールで個別処理する)。
 */

/** マクロ種別 (定義ブロック抽出・各エディタの対応付けに使用) */
export type MmlMacroKind = 'volEnv' | 'pitchEnv' | 'pitchSweep';

/** マクロ 1 種別分の定義 */
export interface MmlMacroSpec {
  readonly kind: MmlMacroKind;
  /** Monarch シンタックスハイライト用のトークン種別 */
  readonly token: 'macro.vol' | 'macro.pitch';
  /**
   * トラック内での呼び出しプレフィックス (`@` 除く・大文字表記)。
   * エイリアス (`@PE` の `@EP` 等) もここへ列挙する。
   */
  readonly prefixes: readonly string[];
  /** 行解析結果 (`MmlLineAnalysis`) への書き込み先プロパティキー */
  readonly analysisKey: 'volEnvId' | 'pitchEnvId' | 'pitchSweepId';
  /** 使用済み ID セット (`UsedIds`) への書き込み先プロパティキー */
  readonly usedIdsKey: 'volEnvIds' | 'pitchEnvIds' | 'pitchSweepIds';
}

/**
 * マクロ種別定義。配列順が正規表現のマッチ優先順位になるため、
 * 他プレフィックスの接頭辞になるもの (`@PE` に対する `@P` 等) を先に置くこと。
 */
export const MML_MACROS: readonly MmlMacroSpec[] = [
  {
    kind: 'pitchEnv',
    token: 'macro.pitch',
    prefixes: ['PE', 'EP'],
    analysisKey: 'pitchEnvId',
    usedIdsKey: 'pitchEnvIds',
  },
  {
    kind: 'pitchSweep',
    token: 'macro.pitch',
    prefixes: ['PS'],
    analysisKey: 'pitchSweepId',
    usedIdsKey: 'pitchSweepIds',
  },
  {
    kind: 'volEnv',
    token: 'macro.vol',
    prefixes: ['VE'],
    analysisKey: 'volEnvId',
    usedIdsKey: 'volEnvIds',
  },
];

/** 大小文字両対応の文字クラス (`P` → `[pP]`) を生成する */
function charClass(ch: string): string {
  const lower = ch.toLowerCase();
  const upper = ch.toUpperCase();
  return lower === upper ? ch : `[${lower}${upper}]`;
}

/** 指定マクロの呼び出しコマンド (`@PE1` / `@EP2` 等) にマッチする正規表現 ([2] に ID が入る・matchAll 用) */
export function buildMacroCallRegExp(macro: MmlMacroSpec): RegExp {
  return new RegExp(`@(${macro.prefixes.join('|')})(\\d+)`, 'gi');
}

/** 全マクロの呼び出しコマンド (`@PE1` / `@PS2` / `@VE3` 等) にマッチする正規表現 (ID 除去用) */
export function buildAllMacroCallsRegExp(): RegExp {
  const alternatives = MML_MACROS.flatMap((m) => m.prefixes).join('|');
  return new RegExp(`@(?:${alternatives})\\d+`, 'gi');
}

/**
 * 演奏状態コマンドパターン (mmlCaretParser `COMMAND_PATTERN` 用) のマクロ部ソース。
 * 正式パーサ同様に大文字小文字を区別しない (`@PS1` / `@ps1` の両方にマッチ)。
 * 例: `@[pP][eE]\d+|@[eE][pP]\d+|@[pP][sS]\d+|@[vV][eE]\d+`
 */
export function buildMacroCommandPatternSource(): string {
  return MML_MACROS
    .flatMap((m) => m.prefixes.map((p) => `@${charClass(p[0])}${charClass(p[1])}\\d+`))
    .join('|');
}

/**
 * マクロ定義行ヘッダ (`@PE1 = {` / `@PS2 = {` / `@VE3 = {` / `@1 = {` / `@FM4 = {` 等) の
 * 正規表現ソース。`FM` (音色の番号直接指定) も定義行として許容する。
 */
export function buildMacroDefinitionLinePatternSource(): string {
  const alternatives = [...MML_MACROS.flatMap((m) => m.prefixes), 'FM'].join('|');
  return `^\\s*@(?:${alternatives})?\\d*\\s*=`;
}