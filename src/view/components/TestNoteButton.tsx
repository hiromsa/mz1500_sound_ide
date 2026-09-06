import { useState, useRef, useEffect } from 'react';
import { Play, Square, ChevronDown } from 'lucide-react';
import { midiNoteToName, QUICK_TEST_NOTES } from '../../utils/noteUtils';

export interface TestNoteButtonProps {
  /** 現在再生中かどうか */
  isPlaying: boolean;
  /** 再生開始コールバック (選択中のMIDIノート番号を渡す) */
  onPlay: (midiNote: number) => void;
  /** 再生停止コールバック */
  onStop: () => void;
  /** 現在のMIDIノート番号 (未指定時は 60 = C4) */
  midiNote?: number;
  /** ノート番号変更コールバック */
  onChangeNote?: (midiNote: number) => void;
  /** ボタンのラベル (デフォルト: 'PREVIEW') */
  label?: string;
  /** ホバー時のツールチップ */
  title?: string;
}

export function TestNoteButton({
  isPlaying,
  onPlay,
  onStop,
  midiNote = 60,
  onChangeNote,
  label = 'PREVIEW',
  title = 'Play preview tone',
}: TestNoteButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 外側クリックでドロップダウンを閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const noteName = midiNoteToName(midiNote);

  const handleTogglePlay = () => {
    if (isPlaying) {
      onStop();
    } else {
      onPlay(midiNote);
    }
  };

  const handleSelectNote = (note: number) => {
    onChangeNote?.(note);
    setIsOpen(false);
    // すでに再生中なら新しい音高で鳴らし直す
    if (isPlaying) {
      onPlay(note);
    }
  };

  return (
    <div className="relative inline-flex items-center" ref={dropdownRef}>
      {/* メインの再生/停止ボタン */}
      <button
        onClick={handleTogglePlay}
        className={`h-6 px-2.5 rounded-l text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs select-none ${
          isPlaying
            ? 'bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-500/60 animate-pulse'
            : 'bg-[#00A8FF]/20 hover:bg-[#00A8FF]/30 text-[#00A8FF] border border-[#00A8FF]/60'
        }`}
        title={isPlaying ? 'Stop Preview' : `${title} (${noteName})`}
      >
        {isPlaying ? (
          <>
            <Square className="w-3 h-3 fill-current" />
            <span>STOP</span>
          </>
        ) : (
          <>
            <Play className="w-3 h-3 fill-current" />
            <span>{label}</span>
          </>
        )}
      </button>

      {/* 音高セレクタートグルボタン */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={`h-6 px-1.5 rounded-r border-t border-b border-r text-[10px] font-mono font-bold flex items-center gap-0.5 cursor-pointer transition-colors select-none ${
          isPlaying
            ? 'bg-red-950/60 hover:bg-red-900/80 text-red-300 border-red-500/60'
            : 'bg-[#121a24] hover:bg-[#1a2536] text-cyan-300 hover:text-cyan-200 border-[#00A8FF]/60'
        }`}
        title={`Select preview pitch (Current: ${noteName} / MIDI ${midiNote})`}
      >
        <span>{noteName}</span>
        <ChevronDown className="w-2.5 h-2.5 opacity-70" />
      </button>

      {/* 音高クイック選択ドロップダウン */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-[#1e2029] border border-white/10 rounded-md shadow-2xl z-50 py-1 font-mono text-xs overflow-hidden">
          <div className="px-2.5 py-1 text-[9px] font-semibold text-zinc-400 border-b border-white/[0.06] flex items-center justify-between">
            <span>PREVIEW PITCH</span>
            <span className="text-zinc-500">MIDI #{midiNote}</span>
          </div>
          <div className="max-h-56 overflow-y-auto py-0.5">
            {QUICK_TEST_NOTES.map(({ note, label: l, desc }) => {
              const isSelected = note === midiNote;
              return (
                <button
                  key={note}
                  onClick={() => handleSelectNote(note)}
                  className={`w-full text-left px-2.5 py-1 text-[11px] flex items-center justify-between hover:bg-white/[0.08] transition-colors cursor-pointer ${
                    isSelected ? 'bg-[#00A8FF]/20 text-cyan-300 font-bold' : 'text-zinc-300'
                  }`}
                >
                  <span className="font-mono">{l}</span>
                  <span className="text-[9px] text-zinc-500 font-sans">{desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
