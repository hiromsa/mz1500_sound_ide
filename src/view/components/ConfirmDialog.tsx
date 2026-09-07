import { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, Save } from 'lucide-react';

// ダイアログのタイプ
// - 'confirm': 確認 (OK / キャンセル)
// - 'save'   : 未保存警告 (保存して閉じる / 破棄 / キャンセル)
export type ConfirmDialogType = 'confirm' | 'save';

export interface ConfirmDialogProps {
  type: ConfirmDialogType;
  title: string;
  message: string;
  /** confirm型: OK ボタンのラベル (省略時: "削除") */
  confirmLabel?: string;
  /** ファイル名など補足情報 (save型で使用) */
  fileName?: string;
  onConfirm: () => void;
  onDiscard?: () => void; // save型のみ
  onCancel: () => void;
}

/**
 * 共通確認ダイアログ (モーダルオーバーレイ)
 *
 * - confirm型: ファイル/フォルダ削除など1段階の確認に使用
 * - save型   : タブを閉じる前の「保存 / 破棄 / キャンセル」に使用
 */
export function ConfirmDialog({
  type,
  title,
  message,
  confirmLabel,
  fileName,
  onConfirm,
  onDiscard,
  onCancel,
}: ConfirmDialogProps) {
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  // マウント時にフォーカスをキャンセルボタン (安全な選択) へ
  useEffect(() => {
    primaryBtnRef.current?.focus();
  }, []);

  // Escape キーでキャンセル
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onCancel]);

  const isConfirm = type === 'confirm';
  const isSave    = type === 'save';

  return (
    /* オーバーレイ */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        // オーバーレイクリックでキャンセル
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* ダイアログボックス */}
      <div
        className="
          w-[400px] max-w-[90vw]
          bg-[#161820] border border-white/[0.12]
          rounded-xl shadow-2xl shadow-black/60
          flex flex-col overflow-hidden
          animate-in fade-in zoom-in-95 duration-150
        "
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        {/* ヘッダー */}
        <div className={`px-5 pt-5 pb-3 flex items-start gap-3 ${
          isSave ? 'border-b border-amber-500/20' : 'border-b border-red-500/20'
        }`}>
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            isSave
              ? 'bg-amber-500/15 text-amber-400'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {isSave ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <Trash2 className="w-5 h-5" />
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-bold text-zinc-100"
            >
              {title}
            </h2>
            {fileName && (
              <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[280px]">
                {fileName}
              </span>
            )}
          </div>
        </div>

        {/* メッセージ */}
        <div className="px-5 py-4">
          <p className="text-xs text-zinc-300 leading-relaxed">{message}</p>
        </div>

        {/* アクションボタン */}
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          {/* キャンセル (共通) */}
          <button
            ref={primaryBtnRef}
            onClick={onCancel}
            className="
              h-7 px-4 text-xs font-medium rounded
              bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600
              text-zinc-300 hover:text-zinc-100
              border border-white/10
              transition-colors cursor-pointer
            "
          >
            キャンセル
          </button>

          {/* save型のみ: 破棄ボタン */}
          {isSave && onDiscard && (
            <button
              onClick={onDiscard}
              className="
                h-7 px-4 text-xs font-medium rounded
                bg-zinc-800 hover:bg-red-900/60 active:bg-red-900/80
                text-zinc-400 hover:text-red-300
                border border-white/10 hover:border-red-500/40
                transition-colors cursor-pointer
              "
            >
              変更を破棄
            </button>
          )}

          {/* confirm型: 削除/OK ボタン */}
          {isConfirm && (
            <button
              onClick={onConfirm}
              className="
                h-7 px-4 text-xs font-semibold rounded
                bg-red-900/70 hover:bg-red-800/80 active:bg-red-700/80
                text-red-200 hover:text-red-100
                border border-red-500/50 hover:border-red-400
                transition-colors cursor-pointer
                flex items-center gap-1.5
              "
            >
              <Trash2 className="w-3 h-3" />
              {confirmLabel ?? '削除'}
            </button>
          )}

          {/* save型: 保存して閉じるボタン */}
          {isSave && (
            <button
              onClick={onConfirm}
              className="
                h-7 px-4 text-xs font-semibold rounded
                bg-[#00A8FF]/20 hover:bg-[#00A8FF]/30 active:bg-[#00A8FF]/40
                text-[#00A8FF] hover:text-[#55c8ff]
                border border-[#00A8FF]/50 hover:border-[#00A8FF]
                transition-colors cursor-pointer
                flex items-center gap-1.5
              "
            >
              <Save className="w-3 h-3" />
              保存して閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
