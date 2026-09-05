/**
 * MMLエディタ用のカスタムコンテキストメニュー (overlay 方式)
 *
 * Monaco のネイティブコンテキストメニューは Lucide アイコンを表示できないため、
 * 右ペインタブと同一の Lucide SVG アイコンを使える独自メニューとして実装。
 * UI (本コンポーネント) とロジック (メニュー項目の構築 = MmlEditor 側) を疎結合に保つ。
 */
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

// ──────────────────────────────────────────────
// 型定義
// ──────────────────────────────────────────────

/** 実行可能なメニュー項目 */
export interface MmlContextMenuItem {
  id: string;
  label: string;
  /** 右ペインタブと同一の Lucide アイコン */
  icon: LucideIcon;
  /** キーボードショートカット表記 (例: Ctrl+X, Ctrl+C, Ctrl+V) */
  shortcut?: string;
  /** true の場合は選択不可 (グレーアウト表示) */
  disabled?: boolean;
  onSelect: () => void;
}

/** 区切り線 */
export interface MmlContextMenuSeparator {
  type: 'separator';
}

export type MmlContextMenuEntry = MmlContextMenuItem | MmlContextMenuSeparator;

const isSeparator = (entry: MmlContextMenuEntry): entry is MmlContextMenuSeparator =>
  'type' in entry;

interface MmlContextMenuProps {
  /** 表示位置 (ビューポート座標 / position: fixed 基準) */
  x: number;
  y: number;
  entries: MmlContextMenuEntry[];
  onClose: () => void;
}

// ──────────────────────────────────────────────
// レイアウト定数 (画面はみ出し補正用の概算値)
// ──────────────────────────────────────────────
const MENU_WIDTH = 300;
const ITEM_HEIGHT = 32;
const SEPARATOR_HEIGHT = 9;
const MENU_PADDING_Y = 8;
const SCREEN_MARGIN = 8;

// ──────────────────────────────────────────────
// コンポーネント
// ──────────────────────────────────────────────

export function MmlContextMenu({ x, y, entries, onClose }: MmlContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリック / Esc キー / ウィンドウ非活性で閉じる
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // 画面右端・下端へのはみ出しを補正
  const menuHeight =
    MENU_PADDING_Y * 2 +
    entries.reduce(
      (height, entry) =>
        height + (isSeparator(entry) ? SEPARATOR_HEIGHT : ITEM_HEIGHT), 0,
    );
  const adjustedX = Math.max(SCREEN_MARGIN, Math.min(x, window.innerWidth - MENU_WIDTH - SCREEN_MARGIN));
  const adjustedY = Math.max(SCREEN_MARGIN, Math.min(y, window.innerHeight - menuHeight - SCREEN_MARGIN));

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px`, width: `${MENU_WIDTH}px` }}
      className="fixed z-50 flex flex-col py-1 rounded-md bg-[#181a20] border border-white/10 shadow-2xl shadow-black/70 select-none overflow-hidden"
    >
      {entries.map((entry, index) =>
        isSeparator(entry) ? (
          <div key={`separator-${index}`} className="my-1 mx-2 h-px bg-white/10" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
            className={`h-8 mx-1 px-2.5 rounded flex items-center gap-2.5 text-xs text-left transition-colors ${
              entry.disabled
                ? 'opacity-35 cursor-not-allowed text-zinc-500'
                : 'cursor-pointer text-zinc-300 hover:bg-[#00A8FF]/15 hover:text-[#4cc2ff]'
            }`}
          >
            <entry.icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{entry.label}</span>
            {entry.shortcut && (
              <span className="ml-auto pl-4 text-[10px] font-mono text-zinc-500 tracking-wider shrink-0">
                {entry.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
