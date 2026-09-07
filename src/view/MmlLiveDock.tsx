import React, { useState, useRef } from 'react';
import { Code2, ChevronUp, ChevronDown, Copy, Check, GripHorizontal } from 'lucide-react';

interface MmlLiveDockProps {
  title?: string;
  code: string;
  onChangeCode?: (newCode: string) => void;
  onApplyToMml?: () => void;
  defaultExpandedHeight?: number;
  minExpandedHeight?: number;
  maxExpandedHeight?: number;
}

/**
 * MML チラ見せ ＆ 展開編集ボトムドック (モックUI)
 * - 上端ドラッグによる自由な高さリサイズに対応
 * - 各種エディタ (FM / V-ENV / P-ENV) に応じたデフォルト展開高さを設定可能
 */
export function MmlLiveDock({
  title = 'MML CODE',
  code,
  onChangeCode,
  onApplyToMml,
  defaultExpandedHeight = 220,
  minExpandedHeight = 120,
  maxExpandedHeight = 560,
}: MmlLiveDockProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [expandedHeight, setExpandedHeight] = useState<number>(defaultExpandedHeight);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const dragStartRef = useRef<{ startY: number; startH: number } | null>(null);

  // クリップボードへコピー
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // チラ見せ時の1行サマリー (改行や余分な空白を1行に整形)
  const singleLinePreview = code
    .replace(/\/\*[\s\S]*?\*\//g, '') // コメントをプレビューでは短縮
    .replace(/\s+/g, ' ')
    .trim();

  // 上端ドラッグによるリサイズ処理
  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDragging(true);
    dragStartRef.current = {
      startY: e.clientY,
      startH: isExpanded ? expandedHeight : 38,
    };
    if (!isExpanded) {
      setIsExpanded(true);
    }
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const deltaY = dragStartRef.current.startY - e.clientY; // 上へ引くと拡大
    const newH = Math.max(
      minExpandedHeight,
      Math.min(maxExpandedHeight, dragStartRef.current.startH + deltaY)
    );
    setExpandedHeight(newH);
  };

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      setIsDragging(false);
      dragStartRef.current = null;
    }
  };

  return (
    <div
      style={{ height: isExpanded ? `${expandedHeight}px` : '38px' }}
      className={`sticky bottom-0 left-0 right-0 z-30 border-t shadow-2xl flex flex-col relative select-none ${
        isDragging ? 'transition-none cursor-row-resize' : 'transition-[height] duration-200 ease-out'
      } ${
        isExpanded
          ? 'bg-[#090a10] border-cyan-500/50'
          : 'bg-[#0c0d15]/95 hover:bg-[#11131e] backdrop-blur-xs border-cyan-500/30 cursor-pointer'
      }`}
      onClick={() => {
        if (!isExpanded && !isDragging) setIsExpanded(true);
      }}
    >
      {/* 0. 上端リサイズハンドル (展開中およびチラ見え時どちらもドラッグ可能) */}
      <div
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        className="group absolute -top-1.5 left-0 right-0 h-3.5 cursor-row-resize flex items-center justify-center z-40 touch-none"
        title="上下にドラッグしてエディタの高さを調節"
      >
        <div
          className={`w-14 h-1 rounded-full transition-colors ${
            isDragging
              ? 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]'
              : 'bg-white/20 group-hover:bg-cyan-400/80'
          }`}
        />
      </div>

      {/* 1. ドックヘッダー / チラ見せバー */}
      <div className="h-9.5 px-3 flex items-center justify-between gap-2.5 shrink-0 select-none border-b border-white/[0.05]">
        {/* 左側: アイコン & ラベル & チラ見せプレビュー */}
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          <div className="flex items-center gap-1.5 shrink-0">
            <Code2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] font-bold text-cyan-300 tracking-wider">
              {title}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse hidden sm:inline-block"></span>
          </div>

          {/* 折りたたみ時のチラ見せコードプレビュー */}
          {!isExpanded && (
            <div className="text-[11px] font-mono text-zinc-400 truncate opacity-90 hover:opacity-100 flex-1 pl-1">
              <span className="text-zinc-600 mr-1.5">➔</span>
              <span className="text-cyan-200/90">{singleLinePreview || code}</span>
            </div>
          )}

          {isExpanded && (
            <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-mono hidden sm:flex">
              <span>(Direct Edit ➔ Realtime Sync to GUI)</span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400 flex items-center gap-1">
                <GripHorizontal className="w-3 h-3 text-cyan-400/70" />
                <span>Drag top bar to resize: {expandedHeight}px</span>
              </span>
            </div>
          )}
        </div>

        {/* 右側: アクションボタン (展開/折りたたみ, コピー, 反映) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleCopy}
            className="h-6 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-white/10 transition-colors text-[10px] flex items-center gap-1 cursor-pointer shadow-xs"
            title="MMLコードをクリップボードにコピー"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-300">COPIED</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-zinc-400" />
                <span className="hidden sm:inline">COPY</span>
              </>
            )}
          </button>

          {isExpanded && onApplyToMml && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApplyToMml();
              }}
              className="h-6 px-2.5 rounded bg-emerald-900/60 hover:bg-emerald-800/70 text-emerald-300 border border-emerald-600/60 hover:border-emerald-400 font-medium transition-colors text-[10px] flex items-center gap-1 cursor-pointer shadow-xs"
              title="MMLエディタへ反映"
            >
              <span>▶ MMLに反映</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="h-6 px-2 rounded bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-300 border border-cyan-500/40 transition-colors text-[10px] font-semibold flex items-center gap-1 cursor-pointer shadow-xs"
            title={isExpanded ? '最小化してチラ見せ状態に戻す' : 'クリックして全体を展開・編集'}
          >
            {isExpanded ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>MINIMIZE</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>EXPAND</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. 展開時のエディタ本体 (高さ可変) */}
      {isExpanded && (
        <div className="flex-1 p-2.5 bg-[#07080d] flex flex-col gap-1.5 overflow-hidden font-mono select-text">
          <textarea
            value={code}
            onChange={(e) => onChangeCode?.(e.target.value)}
            className="flex-1 w-full p-2 bg-[#090b12] border border-white/10 focus:border-cyan-400 rounded text-cyan-200 text-xs leading-relaxed outline-none resize-none font-mono shadow-inner select-text"
            placeholder="MML definition code..."
            spellCheck={false}
          />
          <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 shrink-0">
            <span>※ ここで数値を編集すると上部GUIへリアルタイムに連動反映されます（予定）</span>
            <span className="text-zinc-600">Double click or click MINIMIZE to fold</span>
          </div>
        </div>
      )}
    </div>
  );
}
