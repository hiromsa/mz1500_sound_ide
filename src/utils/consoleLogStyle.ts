/**
 * システムコンソールの 1 行ログを分類し、文字色クラスを決定する純粋ロジック。
 * (UI コンポーネントから分離してテスト可能にしている)
 */

/** ログ行の分類トーン。 */
export type ConsoleLogTone = 'error' | 'success' | 'build' | 'default';

/** トーン毎に適用する Tailwind 文字色クラス。 */
const TONE_CLASSES: Record<ConsoleLogTone, string> = {
  error: 'text-red-400',
  success: 'text-emerald-400',
  build: 'text-cyan-300',
  default: 'text-zinc-400',
};

/** ログ行の内容を分類する (大文字小文字を区別する / ERROR と SUCCESS を最優先)。 */
export function classifyConsoleLog(log: string): ConsoleLogTone {
  if (log.includes('ERROR')) {
    return 'error';
  }
  if (log.includes('SUCCESS')) {
    return 'success';
  }
  if (log.includes('[BUILD]')) {
    return 'build';
  }
  return 'default';
}

/** ログ行に適用する文字色クラスを返す。 */
export function resolveConsoleLogStyle(log: string): string {
  return TONE_CLASSES[classifyConsoleLog(log)];
}
