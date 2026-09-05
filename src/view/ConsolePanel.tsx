import { useEffect, useRef } from 'react';
import { resolveConsoleLogStyle } from '../utils/consoleLogStyle';

interface ConsolePanelProps {
  logs: readonly string[];
}

/** ユーザーが末尾からこの距離 (px) 以内を見ている場合のみ、追記時に自動スクロールする。 */
const AUTO_SCROLL_THRESHOLD_PX = 24;

/**
 * システムコンソールのログ表示パネル。
 * 末尾自動追従 (過去ログを読み上げ中は追従しない) と空状態の表示を担う。
 */
export function ConsolePanel({ logs }: ConsolePanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef<boolean>(true);

  // ログ追記時、末尾付近を見ている場合のみ自動スクロールで追従する
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container === null || !isPinnedToBottomRef.current) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [logs]);

  // スクロール位置から「末尾を見ているか」を更新する
  const handleScroll = (): void => {
    const container = scrollContainerRef.current;
    if (container === null) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="h-full p-3 font-mono text-xs overflow-y-auto space-y-1 bg-[#1A1A1A]"
    >
      {logs.length === 0 ? (
        <div className="h-full flex items-center justify-center text-zinc-600 text-[11px]">
          No logs. BUILD / PLAY / EXPORT events will appear here.
        </div>
      ) : (
        logs.map((log, index) => (
          <div key={index} className={resolveConsoleLogStyle(log)}>
            {'>'} {log}
          </div>
        ))
      )}
      <div className="animate-pulse text-zinc-400 font-bold">{'_'}</div>
    </div>
  );
}
