import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Play, 
  Square, 
  Sliders, 
  Split, 
  Check, 
  RefreshCw, 
  ArrowRight, 
  Sparkles,
  Music2,
  FileCode2,
  Cpu,
  FolderOpen,
  Upload,
  FileUp,
  AlertCircle
} from 'lucide-react';
import { MidiPreviewPlayer } from '../core/midi/midiPreview';
import {
  autoAssignRouting,
  extractVoice,
  generateMml,
  parseMidiFile,
  type AssignedPart,
  type MidiParseSummary,
  type MidiTrackSummary,
  type VoicePart,
} from '../core/midi/midiToMmlConverter';
import { createDemoMidiBytes } from '../core/midi/demoMidi';
import { midiNoteToName } from '../utils/noteUtils';

interface WorkTrack {
  id: string; // "t0", "t1", ... (MIDI トラック識別子)
  name: string;
  midiCh: number;
  type: 'mono' | 'poly';
  polyCount?: number;
  range: string;
  noteCount: number;
  assignedTo: string; // "P1", "SPLIT(3)", "N1", "W1", "Unassigned", etc.
  isMuted?: boolean;
  isSolo?: boolean;
  /** 元 MIDI トラックの解析結果 (MML 生成に使用)。ファイル読み込み時に設定される。 */
  source?: MidiTrackSummary;
}

// MZ-1500 実音源全17チャンネル + 作業用トラック (実機標準 DCSG/Noise/BEEP 9ch 最優先)
const MZ1500_CHANNELS = [
  // 1. DCSG 矩形波 (実機標準 6ch)
  { id: 'P1', group: 'DCSG (標準)', label: 'P1 (DCSG 1)' },
  { id: 'P2', group: 'DCSG (標準)', label: 'P2 (DCSG 2)' },
  { id: 'P3', group: 'DCSG (標準)', label: 'P3 (DCSG 3)' },
  { id: 'P4', group: 'DCSG (標準)', label: 'P4 (DCSG 4)' },
  { id: 'P5', group: 'DCSG (標準)', label: 'P5 (DCSG 5)' },
  { id: 'P6', group: 'DCSG (標準)', label: 'P6 (DCSG 6)' },
  // 2. DCSG ノイズ & BEEP (実機標準 3ch)
  { id: 'N1', group: 'Noise/BEEP (標準)', label: 'N1 (Noise 1)' },
  { id: 'N2', group: 'Noise/BEEP (標準)', label: 'N2 (Noise 2)' },
  { id: 'B1', group: 'Noise/BEEP (標準)', label: 'B1 (BEEP)' },
  // 3. YM2151 FM (拡張オプションボード 8ch)
  { id: 'F1', group: 'YM2151 FM (オプション)', label: 'F1 (FM 1)' },
  { id: 'F2', group: 'YM2151 FM (オプション)', label: 'F2 (FM 2)' },
  { id: 'F3', group: 'YM2151 FM (オプション)', label: 'F3 (FM 3)' },
  { id: 'F4', group: 'YM2151 FM (オプション)', label: 'F4 (FM 4)' },
  { id: 'F5', group: 'YM2151 FM (オプション)', label: 'F5 (FM 5)' },
  { id: 'F6', group: 'YM2151 FM (オプション)', label: 'F6 (FM 6)' },
  { id: 'F7', group: 'YM2151 FM (オプション)', label: 'F7 (FM 7)' },
  { id: 'F8', group: 'YM2151 FM (オプション)', label: 'F8 (FM 8)' },
  // 4. Work Tracks (作業用 4ch: 実機外・MML保持)
  { id: 'W1', group: 'Work (作業用)', label: 'W1 (Work 1)' },
  { id: 'W2', group: 'Work (作業用)', label: 'W2 (Work 2)' },
  { id: 'W3', group: 'Work (作業用)', label: 'W3 (Work 3)' },
  { id: 'W4', group: 'Work (作業用)', label: 'W4 (Work 4)' },
];

/** 読み込み済み MIDI ファイルの情報 (ヘッダー表示 / MML 生成に使用)。 */
interface LoadedMidiFile {
  name: string;
  size: number;
  summary: MidiParseSummary;
}

/** 解析済み MIDI トラックをトラックリスト (WorkTrack) へ変換する。 */
function createWorkTrack(source: MidiTrackSummary, assignedTo: string, index: number): WorkTrack {
  return {
    id: `t${index}`,
    name: source.name,
    midiCh: source.channel + 1,
    type: source.type,
    polyCount: source.type === 'poly' ? source.maxPolyphony : undefined,
    range: `${midiNoteToName(source.lowestNote)} - ${midiNoteToName(source.highestNote)}`,
    noteCount: source.noteCount,
    assignedTo,
    isMuted: false,
    isSolo: false,
    source,
  };
}

const FM_CHANNELS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];

interface MidiRouterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyToMml?: (generatedMml: string) => void;
  enableYM2151?: boolean;
  onToggleEnableYM2151?: () => void;
}

export const MidiRouterModal: React.FC<MidiRouterModalProps> = ({
  isOpen,
  onClose,
  onApplyToMml,
  enableYM2151 = true,
  onToggleEnableYM2151,
}) => {
  const [tracks, setTracks] = useState<WorkTrack[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'mono' | 'poly'>('all');
  const [preset, setPreset] = useState<string>('standard');
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);

  // FM音源が無効化された場合の自動フォールバック
  useEffect(() => {
    if (!enableYM2151) {
      if (preset === 'fm_full') {
        setPreset('standard');
      }
      setMonoTarget((prev) => (FM_CHANNELS.includes(prev) ? 'P1' : prev));
      setSplitTargets((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(next).forEach(([v, ch]) => {
          if (FM_CHANNELS.includes(ch)) {
            const voiceNum = Number(v);
            next[voiceNum] = voiceNum === 1 ? 'P2' : voiceNum === 2 ? 'P3' : 'P4';
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setTracks((prev) =>
        prev.map((t) => {
          if (FM_CHANNELS.includes(t.assignedTo)) {
            return { ...t, assignedTo: 'W1' };
          }
          return t;
        })
      );
    }
  }, [enableYM2151, preset]);

  // ファイル読み込みステート
  const [loadedFile, setLoadedFile] = useState<LoadedMidiFile | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GM 試聴プレイヤー (遅延生成) と SoundFont ロード失敗時のエラー表示
  const previewPlayerRef = useRef<MidiPreviewPlayer | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // アンマウント時にプレイヤー (AudioContext) を破棄する
  useEffect(() => () => {
    previewPlayerRef.current?.dispose();
  }, []);

  // 解析済み MIDI へスロットを自動割り当ててトラックリストを再構築する
  const applyRouting = (summary: MidiParseSummary, presetValue: string) => {
    // 再ルーティング時は GM 試聴を停止する
    previewPlayerRef.current?.stop();
    setPlayingTrackId(null);

    const fmActive = presetValue === 'fm_full' && enableYM2151;
    const slots = autoAssignRouting(summary.tracks, fmActive, fmActive);
    setTracks(summary.tracks.map((source, index) => createWorkTrack(source, slots[index], index)));
    setSelectedTrackId(summary.tracks.length > 0 ? 't0' : '');
  };

  const handleProcessFile = (file: File) => {
    void file.arrayBuffer()
      .then((buffer) => {
        const summary = parseMidiFile(file.name, buffer);
        setLoadedFile({ name: summary.fileName, size: file.size, summary });
        applyRouting(summary, preset);
      })
      .catch((error: unknown) => {
        // 不正な MIDI ファイル: ドロップゾーンへ戻す
        console.error('Failed to parse MIDI file:', error);
        setLoadedFile(null);
        setTracks([]);
      });
  };

  // 内蔵デモ MIDI を読み込む (手元にファイルがない場合の動作確認用)
  const loadDemoFile = () => {
    const bytes = createDemoMidiBytes();
    const summary = parseMidiFile('mz1500_demo.mid', bytes);
    setLoadedFile({ name: summary.fileName, size: bytes.length, summary });
    applyRouting(summary, preset);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.mid') || file.name.endsWith('.midi'))) {
      handleProcessFile(file);
    }
  };

  // 和音スプリット設定 (DCSGファースト: P2, P3, P4)
  const [chordSplitLogic, setChordSplitLogic] = useState<'top_down' | 'bottom_up' | 'round_robin'>('top_down');
  const [splitTargets, setSplitTargets] = useState<{ [voice: number]: string }>({
    1: 'P2',
    2: 'P3',
    3: 'P4',
  });

  // 単音設定 (DCSGファースト: P1)
  const [monoTarget, setMonoTarget] = useState<string>('P1');

  if (!isOpen) return null;

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId);

  const toggleMute = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isMuted: !t.isMuted } : t))
    );
  };

  const toggleSolo = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isSolo: !t.isSolo } : t))
    );
  };

  // GM SoundFont でトラックを試聴再生する (再生中に押すと停止)
  const togglePlay = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (playingTrackId === id) {
      previewPlayerRef.current?.stop();
      setPlayingTrackId(null);
      return;
    }

    const track = tracks.find((t) => t.id === id);
    if (!track?.source || !loadedFile) {
      return;
    }

    if (previewPlayerRef.current === null) {
      previewPlayerRef.current = new MidiPreviewPlayer();
    }

    setPreviewError(null);
    setPlayingTrackId(id);
    void previewPlayerRef.current.play(
      track.source.notes,
      loadedFile.summary.bpm,
      track.source.isPercussion,
      {
        onError: (message) => {
          setPreviewError(message);
          setPlayingTrackId((prev) => (prev === id ? null : prev));
        },
        onFinished: () => {
          setPlayingTrackId((prev) => (prev === id ? null : prev));
        },
      },
    );
  };

  const filteredTracks = tracks.filter((t) => {
    if (filterType === 'all') return true;
    return t.type === filterType;
  });

  // プリセット変更 (実データに対して再ルーティングする)
  const handlePresetChange = (newPreset: string) => {
    if (newPreset === 'fm_full' && !enableYM2151) return;
    setPreset(newPreset);
    if (loadedFile) {
      applyRouting(loadedFile.summary, newPreset);
    }

    setMonoTarget('P1');
    if (newPreset === 'fm_full') {
      setSplitTargets({ 1: 'F1', 2: 'F2', 3: 'F3' });
    } else {
      setSplitTargets({ 1: 'P2', 2: 'P3', 3: 'P4' });
    }
  };

  // 単音トラックの割り当て先更新
  const handleUpdateMonoTarget = (targetChannel: string) => {
    if (!enableYM2151 && FM_CHANNELS.includes(targetChannel)) return;
    setMonoTarget(targetChannel);
    if (selectedTrack) {
      setTracks((prev) =>
        prev.map((t) => (t.id === selectedTrack.id ? { ...t, assignedTo: targetChannel } : t))
      );
    }
  };

  // 割り当て設定から MML を生成する (ミュート解除トラックのみ、ソロ優先)
  const buildRoutedMml = (): string | null => {
    const summary = loadedFile?.summary;
    if (!summary) {
      return null;
    }

    const soloActive = tracks.some((track) => track.isSolo);
    const parts: AssignedPart[] = [];
    for (const track of tracks) {
      const source = track.source;
      if (!source || track.isMuted) {
        continue;
      }

      if (soloActive && !track.isSolo) {
        continue;
      }

      if (track.assignedTo === 'Unassigned') {
        continue;
      }

      const velocity = source.notes.reduce((sum, note) => sum + note.velocity, 0) / source.notes.length;

      if (track.assignedTo === 'SPLIT(3)') {
        const voiceTargets: ReadonlyArray<{ voice: VoicePart; target: string | undefined }> = [
          { voice: 'top', target: splitTargets[1] },
          { voice: 'middle', target: splitTargets[2] },
          { voice: 'bottom', target: splitTargets[3] },
        ];

        for (const { voice, target } of voiceTargets) {
          if (!target || target === 'OFF' || (!enableYM2151 && FM_CHANNELS.includes(target))) {
            continue;
          }

          const voiceNotes = extractVoice(source.notes, voice);
          if (voiceNotes.length > 0) {
            parts.push({
              targetTrack: target,
              sourceLabel: `${source.name} (${voice})`,
              notes: voiceNotes,
              velocity,
            });
          }
        }
      } else {
        parts.push({
          targetTrack: track.assignedTo,
          sourceLabel: source.name,
          notes: [...source.notes],
          velocity,
        });
      }
    }

    if (parts.length === 0) {
      return null;
    }

    return generateMml({ fileName: loadedFile?.name ?? summary.fileName, bpm: summary.bpm }, parts);
  };

  // モーダルを閉じる (GM 試聴を停止してから onClose を呼ぶ)
  const handleClose = () => {
    previewPlayerRef.current?.stop();
    setPlayingTrackId(null);
    onClose();
  };

  const handleApply = () => {
    const generatedMml = buildRoutedMml();
    if (generatedMml && onApplyToMml) {
      onApplyToMml(generatedMml);
    }

    handleClose();
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none font-mono animate-in fade-in duration-150 relative"
    >
      {/* 隠しファイル入力要素 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mid,.midi"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* ドラッグオーバー時のハイライトオーバーレイ */}
      {isDraggingFile && (
        <div className="absolute inset-4 z-60 rounded-xl bg-[#00A8FF]/20 border-2 border-dashed border-[#00A8FF] backdrop-blur-xs flex flex-col items-center justify-center gap-3 text-white pointer-events-none shadow-[0_0_40px_rgba(0,168,255,0.4)]">
          <Upload className="w-12 h-12 text-[#00A8FF] animate-bounce" />
          <div className="text-sm font-bold tracking-wide">Drop .mid / .midi file here to load!</div>
          <div className="text-xs text-zinc-300">Standard MIDI File Format 0/1</div>
        </div>
      )}

      {/* Modal Container: MZ-1500 IDE 仕様のマットチャコールグレー */}
      <div className="w-[96vw] max-w-[1360px] h-[88vh] max-h-[860px] bg-[#1E1E1E] border border-[#3C3C3C] rounded-lg shadow-2xl flex flex-col overflow-hidden text-zinc-300">
        
        {/* Modal Header */}
        <header className="h-12 bg-[#2D2D2D] border-b border-[#3C3C3C] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-[#383838] border border-[#484848] flex items-center justify-center text-[#00A8FF] shadow-xs">
              <Music2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-zinc-100 tracking-wider">
                  MIDI ROUTING STUDIO
                </h2>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#383838] text-zinc-300 border border-[#484848] font-bold">
                  PROTOTYPE
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#2D2D2D] text-zinc-400 border border-[#3C3C3C] font-mono">
                  {enableYM2151 ? '17 CH (FM ON)' : '9 CH (MZ-1500 BASICS)'}
                </span>
              </div>
              <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
                {loadedFile ? (
                  <>
                    <span>Source: <strong className="text-zinc-200 font-semibold">{loadedFile.name}</strong></span>
                    <span className="text-zinc-500">|</span>
                    <span>{(loadedFile.size / 1024).toFixed(1)} KB</span>
                    <span className="text-zinc-500">|</span>
                    <span>{loadedFile.summary.bpm} BPM</span>
                    <span className="text-zinc-500">|</span>
                    <span>{tracks.length} Tracks</span>
                  </>
                ) : (
                  <span className="text-zinc-500 italic">No MIDI file loaded</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* ファイル選択・再選択ボタン */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2.5 rounded text-xs font-semibold bg-[#383838] hover:bg-[#444444] text-[#00A8FF] hover:text-[#33BFFF] border border-[#484848] hover:border-[#00A8FF]/50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="PCから別の .mid ファイルを選択して開く"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{loadedFile ? 'Change File...' : 'Select .mid File...'}</span>
            </button>

            {loadedFile && (
              <button
                onClick={() => {
                  previewPlayerRef.current?.stop();
                  setPlayingTrackId(null);
                  setPreviewError(null);
                  setLoadedFile(null);
                  setTracks([]);
                  setSelectedTrackId('');
                }}
                className="h-7 px-2 rounded text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-[#383838] transition-colors cursor-pointer"
                title="読み込みファイルをクリアしてドロップゾーンを表示"
              >
                Clear
              </button>
            )}

            {loadedFile && (
              <div className="flex items-center gap-2 text-xs border-l border-[#3C3C3C] pl-2.5">
                <span className="text-zinc-400">Preset:</span>
                <select 
                  value={preset} 
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="bg-[#181818] border border-[#3C3C3C] rounded px-2 py-1 text-zinc-200 text-xs focus:outline-none focus:border-[#00A8FF]"
                >
                  <option value="standard">MZ-1500 Standard (DCSG & Noise 9ch 優先)</option>
                  <option 
                    value="fm_full" 
                    disabled={!enableYM2151}
                    className={!enableYM2151 ? 'text-zinc-600 bg-[#141414]' : ''}
                  >
                    Option Board (YM2151 FM 併用){!enableYM2151 ? ' [DISABLED / OFF]' : ''}
                  </option>
                </select>
              </div>
            )}

            <button
              onClick={handleClose}
              className="w-7 h-7 rounded hover:bg-[#383838] text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer ml-1 border border-transparent hover:border-[#484848]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* GM SoundFont のロード失敗などの試聴エラー表示 */}
        {previewError && (
          <div className="mx-4 mt-2.5 px-2.5 py-1.5 rounded bg-red-950/80 border border-red-700/60 text-red-300 text-[11px] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{previewError}</span>
            <button
              onClick={() => setPreviewError(null)}
              className="text-red-400 hover:text-red-200 text-[10px] font-bold px-1.5 py-0.5 rounded hover:bg-red-900/60 transition-colors cursor-pointer shrink-0"
              title="閉じる"
            >
              ✕
            </button>
          </div>
        )}

        {/* Modal Body */}
        {!loadedFile ? (
          <div className="flex-1 flex items-center justify-center p-6 bg-[#1E1E1E]">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-full max-w-xl p-10 rounded-lg border-2 border-dashed border-[#3C3C3C] hover:border-[#00A8FF]/60 bg-[#252525] hover:bg-[#2A2A2A] transition-all flex flex-col items-center justify-center gap-4 text-center cursor-pointer group shadow-sm"
            >
              <div className="w-16 h-16 rounded-lg bg-[#1E1E1E] border border-[#3C3C3C] flex items-center justify-center text-[#00A8FF] group-hover:scale-105 group-hover:border-[#00A8FF]/50 transition-all shadow-xs">
                <FileUp className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-sm font-bold text-zinc-100 tracking-wide">
                  Drag & Drop your .mid file here
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  またはクリックしてPC内のMIDIファイル（.mid, .midi）を選択
                </p>
              </div>

              <div className="flex items-center gap-3 mt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="h-8 px-4 rounded text-xs font-bold bg-[#00A8FF] hover:bg-[#33BFFF] text-black shadow-[0_0_10px_rgba(0,168,255,0.3)] flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Browse .mid File</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadDemoFile();
                  }}
                  className="h-8 px-3.5 rounded text-xs font-semibold bg-[#383838] hover:bg-[#444444] text-zinc-200 border border-[#484848] flex items-center gap-1.5 transition-all cursor-pointer"
                  title="手元にMIDIがない場合にデモデータで試す"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Load Demo File</span>
                </button>
              </div>

              <div className="text-[11px] text-zinc-500 mt-2 border-t border-[#333333] pt-3 w-full">
                Supports Standard MIDI File (SMF Format 0 & Format 1, Max 16 ch)
              </div>
            </div>
          </div>
        ) : (
          /* Modal Body: 3 Bento Columns */
          <div className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden bg-[#1E1E1E]">
            
            {/* COLUMN 1: Source / Work Tracks (W1~W99) */}
            <div className="col-span-4 bg-[#252525] border border-[#3C3C3C] rounded-lg flex flex-col overflow-hidden shadow-xs">
              {/* Column Header */}
              <div className="p-2.5 border-b border-[#383838] bg-[#2D2D2D] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <FileCode2 className="w-3.5 h-3.5 text-[#00A8FF]" />
                  <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                    Source / Work Tracks (W1〜W99)
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1E1E1E] text-zinc-400 border border-[#383838]">
                  {filteredTracks.length} tracks
                </span>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 p-2 border-b border-[#383838] bg-[#202020] text-[11px]">
                {(['all', 'mono', 'poly'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-2.5 py-0.5 rounded transition-colors uppercase cursor-pointer ${
                      filterType === type
                        ? 'bg-[#00A8FF]/20 text-[#00A8FF] font-semibold border border-[#00A8FF]/50'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {/* Track List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {filteredTracks.map((track) => {
                  const isSelected = track.id === selectedTrackId;
                  const isPlaying = playingTrackId === track.id;

                  return (
                    <div
                      key={track.id}
                      onClick={() => {
                        setSelectedTrackId(track.id);
                        if (track.type === 'mono' && track.assignedTo !== 'Unassigned') {
                          setMonoTarget(track.assignedTo);
                        }
                      }}
                      className={`p-2.5 rounded border transition-all cursor-pointer relative ${
                        isSelected
                          ? 'bg-[#00A8FF]/15 border-[#00A8FF]/70 shadow-[0_0_8px_rgba(0,168,255,0.25)]'
                          : 'bg-[#1E1E1E] border-[#363636] hover:border-[#484848] hover:bg-[#252525]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-[#00A8FF] bg-[#00A8FF]/10 px-1.5 py-0.5 rounded border border-[#00A8FF]/30">
                            {track.id}
                          </span>
                          <span className="text-xs font-semibold text-zinc-200 truncate">
                            {track.name}
                          </span>
                        </div>

                        {/* Solo / Mute / Play */}
                        <div className="flex items-center gap-1 shrink-0 text-[10px]">
                          <button
                            onClick={(e) => toggleSolo(track.id, e)}
                            className={`w-5 h-5 rounded flex items-center justify-center font-bold border transition-colors cursor-pointer ${
                              track.isSolo
                                ? 'bg-amber-500 text-black border-amber-400'
                                : 'bg-[#2A2A2A] text-zinc-400 border-[#3C3C3C] hover:text-white'
                            }`}
                            title="Solo"
                          >
                            S
                          </button>
                          <button
                            onClick={(e) => toggleMute(track.id, e)}
                            className={`w-5 h-5 rounded flex items-center justify-center font-bold border transition-colors cursor-pointer ${
                              track.isMuted
                                ? 'bg-red-500 text-white border-red-400'
                                : 'bg-[#2A2A2A] text-zinc-400 border-[#3C3C3C] hover:text-white'
                            }`}
                            title="Mute"
                          >
                            M
                          </button>
                          <button
                            onClick={(e) => togglePlay(track.id, e)}
                            className={`w-5 h-5 rounded flex items-center justify-center border transition-colors cursor-pointer ${
                              isPlaying
                                ? 'bg-[#00A8FF] text-black border-[#00A8FF]'
                                : 'bg-[#2A2A2A] text-zinc-400 border-[#3C3C3C] hover:text-white'
                            }`}
                            title="Preview Track"
                          >
                            {isPlaying ? <Square className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                          </button>
                        </div>
                      </div>

                      {/* Meta info row */}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
                        {track.type === 'mono' ? (
                          <span className="px-1.5 py-0.2 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-700/50 text-[10px]">
                            Mono (単音)
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded bg-purple-950/60 text-purple-300 border border-purple-700/50 text-[10px]">
                            Poly ({track.polyCount}和音)
                          </span>
                        )}
                        <span>Ch:{track.midiCh}</span>
                        <span>·</span>
                        <span>{track.range}</span>
                        <span className="ml-auto text-zinc-500">{track.noteCount} nt</span>
                      </div>

                      {/* Routing status tag */}
                      <div className="mt-2 pt-2 border-t border-[#303030] flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500">Assigned:</span>
                        <span className={`font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                          track.assignedTo === 'Unassigned'
                            ? 'bg-[#2A2A2A] text-zinc-400 border border-[#3C3C3C]'
                            : 'bg-[#00A8FF]/15 text-[#00A8FF] border border-[#00A8FF]/40'
                        }`}>
                          {track.assignedTo}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* COLUMN 2: Routing & Processing Details */}
            <div className="col-span-5 bg-[#252525] border border-[#3C3C3C] rounded-lg flex flex-col overflow-hidden shadow-xs">
              {/* Column Header */}
              <div className="p-2.5 border-b border-[#383838] bg-[#2D2D2D] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-[#00A8FF]" />
                  <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                    Track Routing
                  </span>
                </div>
                {selectedTrack && (
                  <span className="text-[11px] text-[#00A8FF] bg-[#00A8FF]/10 px-2 py-0.5 rounded border border-[#00A8FF]/30">
                    {selectedTrack.id}: {selectedTrack.name}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {selectedTrack ? (
                  <>
                    {/* Case 1: 単音トラック (Mono) -> DCSG/ノイズ/BEEP標準を最優先で表示 */}
                    {selectedTrack.type === 'mono' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-[#222222] border border-[#383838] space-y-3">
                          <div className="flex items-center gap-2 text-[#00A8FF] text-xs font-bold">
                            <ArrowRight className="w-4 h-4" />
                            <span>1-to-1 CHANNEL ROUTING</span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            このMIDIトラック（{selectedTrack.id}）を鳴らすMZ-1500の実チャンネルを選択してください（実機標準DCSG 9ch優先 / 拡張FM 8ch対応）。
                          </p>

                          {/* クイック選択グリッド (DCSGファースト) */}
                          <div className="space-y-3 pt-1">
                            {/* ① DCSG 6ch (本体標準 矩形波) */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-zinc-200">
                                  1. DCSG 矩形波 (P1〜P6) [実機標準]:
                                </span>
                                <span className="text-[9px] text-zinc-500">SN76489 x 2</span>
                              </div>
                              <div className="grid grid-cols-6 gap-1 text-[11px]">
                                {['P1','P2','P3','P4','P5','P6'].map((ch) => (
                                  <button
                                    key={ch}
                                    onClick={() => handleUpdateMonoTarget(ch)}
                                    className={`py-1.5 rounded text-center font-bold border transition-colors cursor-pointer ${
                                      monoTarget === ch
                                        ? 'bg-[#00A8FF] text-black border-[#00A8FF] shadow-xs'
                                        : 'bg-[#181818] text-zinc-300 border-[#383838] hover:border-[#00A8FF]/50 hover:bg-[#2A2A2A]'
                                    }`}
                                  >
                                    {ch}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* ② Noise 2ch & BEEP 1ch (本体標準) */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-zinc-200">
                                  2. Noise (N1, N2) & BEEP (B1) [実機標準]:
                                </span>
                                <span className="text-[9px] text-zinc-500">リズム / SE</span>
                              </div>
                              <div className="grid grid-cols-3 gap-1 text-[11px]">
                                {['N1','N2','B1'].map((ch) => (
                                  <button
                                    key={ch}
                                    onClick={() => handleUpdateMonoTarget(ch)}
                                    className={`py-1.5 rounded text-center font-bold border transition-colors cursor-pointer ${
                                      monoTarget === ch
                                        ? 'bg-[#00A8FF] text-black border-[#00A8FF] shadow-xs'
                                        : 'bg-[#181818] text-zinc-300 border-[#383838] hover:border-[#00A8FF]/50 hover:bg-[#2A2A2A]'
                                    }`}
                                  >
                                    {ch}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* ③ YM2151 FM 8ch (拡張オプションボード) */}
                            <div className="space-y-1.5 pt-1 border-t border-[#333333]">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[10px] font-semibold ${enableYM2151 ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                    3. YM2151 FM (F1〜F8) [拡張ボード / オプション]:
                                  </span>
                                  {!enableYM2151 && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-500 border border-zinc-700 font-medium">
                                      DISABLED (OFF)
                                    </span>
                                  )}
                                </div>
                                {!enableYM2151 && onToggleEnableYM2151 ? (
                                  <button
                                    onClick={onToggleEnableYM2151}
                                    className="text-[9px] text-[#00A8FF] hover:underline cursor-pointer flex items-center gap-1 font-mono"
                                    title="ACZ-8BS1MZ FM音源ボードを有効化する"
                                  >
                                    + 有効化する
                                  </button>
                                ) : (
                                  <span className="text-[9px] px-1 bg-[#282828] text-zinc-400 rounded border border-[#383838]">
                                    ACZ-8BS1MZ
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-8 gap-1 text-[11px]">
                                {['F1','F2','F3','F4','F5','F6','F7','F8'].map((ch) => (
                                  <button
                                    key={ch}
                                    disabled={!enableYM2151}
                                    onClick={() => handleUpdateMonoTarget(ch)}
                                    className={`py-1.5 rounded text-center font-bold border transition-colors ${
                                      !enableYM2151
                                        ? 'opacity-35 cursor-not-allowed bg-[#181818] text-zinc-600 border-[#282828]'
                                        : monoTarget === ch
                                        ? 'bg-[#00A8FF] text-black border-[#00A8FF] shadow-xs cursor-pointer'
                                        : 'bg-[#181818] text-zinc-400 border-[#383838] hover:border-[#00A8FF]/50 hover:text-zinc-200 hover:bg-[#2A2A2A] cursor-pointer'
                                    }`}
                                  >
                                    {ch}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* ④ Work Tracks (W1〜W4: 作業用プール) */}
                            <div className="space-y-1.5 pt-1 border-t border-[#333333]">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-amber-400">
                                    4. Work Tracks (W1〜W4) [作業用プール]:
                                  </span>
                                  <span className="text-[9px] px-1 bg-amber-950/60 text-amber-400 rounded border border-amber-800/40">
                                    PSG準拠・実機外
                                  </span>
                                </div>
                                <span className="text-[9px] text-zinc-500">MML保持</span>
                              </div>
                              <div className="grid grid-cols-4 gap-1 text-[11px]">
                                {['W1','W2','W3','W4'].map((ch) => (
                                  <button
                                    key={ch}
                                    onClick={() => handleUpdateMonoTarget(ch)}
                                    className={`py-1.5 rounded text-center font-bold border transition-colors cursor-pointer ${
                                      monoTarget === ch
                                        ? 'bg-amber-500 text-black border-amber-500 shadow-xs'
                                        : 'bg-[#181818] text-amber-300/80 border-[#383838] hover:border-amber-500/50 hover:text-amber-200 hover:bg-[#2A2A2A]'
                                    }`}
                                  >
                                    {ch}
                                  </button>
                                ))}
                              </div>
                            </div>

                          </div>
                        </div>

                        {/* 現在の接続プレビュー */}
                        <div className="p-3 rounded-lg bg-[#222222] border border-[#383838] flex items-center justify-between text-xs">
                          <span className="text-zinc-400">現在ルーティング:</span>
                          <span className="font-bold text-[#00A8FF] bg-[#181818] px-2.5 py-1 rounded border border-[#00A8FF]/30">
                            {selectedTrack.id} ➔ {monoTarget}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Case 2: 和音トラック (Poly) -> 複数チャンネルへボイス分割 (DCSG優先) */}
                    {selectedTrack.type === 'poly' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-[#222222] border border-[#383838] space-y-3">
                          <div className="flex items-center gap-2 text-[#00A8FF] text-xs font-bold">
                            <Split className="w-4 h-4" />
                            <span>CHORD SPLIT ROUTING ({selectedTrack.polyCount || 3} Voices)</span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            和音トラックの各音（高音・中音・低音など）を、MZ-1500の任意のチャンネルへ個別に割り当てます。
                          </p>

                          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div>
                              <label className="text-[10px] text-zinc-400 block mb-1">スプリット優先度:</label>
                              <select 
                                value={chordSplitLogic}
                                onChange={(e) => setChordSplitLogic(e.target.value as any)}
                                className="w-full bg-[#181818] border border-[#3C3C3C] rounded px-2 py-1 text-zinc-200 text-xs focus:outline-none focus:border-[#00A8FF]"
                              >
                                <option value="top_down">Top-to-Bottom (高音優先)</option>
                                <option value="bottom_up">Bottom-to-Top (低音/ベース優先)</option>
                                <option value="round_robin">Round-Robin (巡回割当)</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] text-zinc-400 block mb-1">一括割り当て:</label>
                              <div className="flex gap-1.5">
                                {/* DCSGをメインに配置 */}
                                <button 
                                  onClick={() => setSplitTargets({ 1: 'P2', 2: 'P3', 3: 'P4' })}
                                  className="flex-1 px-2 py-1 rounded bg-[#00A8FF]/15 text-[#00A8FF] border border-[#00A8FF]/40 hover:bg-[#00A8FF]/25 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                                  title="DCSG 矩形波 3チャンネル (P2, P3, P4) へ展開"
                                >
                                  <Sparkles className="w-3 h-3" /> DCSG (P2-P4)
                                </button>
                                <button 
                                  disabled={!enableYM2151}
                                  onClick={() => setSplitTargets({ 1: 'F1', 2: 'F2', 3: 'F3' })}
                                  className={`flex-1 px-2 py-1 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors ${
                                    !enableYM2151
                                      ? 'opacity-35 cursor-not-allowed bg-[#222222] text-zinc-600 border border-[#303030]'
                                      : 'bg-[#383838] text-zinc-300 border border-[#484848] hover:bg-[#444444] cursor-pointer'
                                  }`}
                                  title={!enableYM2151 ? 'YM2151 FM音源が無効化されています' : '拡張FM音源 (F1, F2, F3) へ展開'}
                                >
                                  FM (F1-F3)
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Voices Mapping List */}
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">
                            Voice Channel Assign
                          </label>
                          {[1, 2, 3].map((voiceNum) => (
                            <div 
                              key={voiceNum}
                              className="flex items-center justify-between p-2.5 rounded bg-[#1E1E1E] border border-[#363636] text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded bg-[#383838] text-[#00A8FF] border border-[#484848] flex items-center justify-center font-bold text-[11px]">
                                  V{voiceNum}
                                </span>
                                <div>
                                  <div className="text-zinc-200 font-semibold">
                                    {voiceNum === 1 ? 'Voice 1 (Top Note)' : voiceNum === 2 ? 'Voice 2 (Middle)' : 'Voice 3 (Bottom Note)'}
                                  </div>
                                  <div className="text-[10px] text-zinc-500">
                                    {voiceNum === 1 ? '最高音を抽出' : voiceNum === 2 ? '中間音を抽出' : '最低音を抽出'}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                                <select
                                  value={splitTargets[voiceNum] || 'P2'}
                                  onChange={(e) => setSplitTargets({ ...splitTargets, [voiceNum]: e.target.value })}
                                  className="bg-[#181818] border border-[#00A8FF]/50 rounded px-2.5 py-1 text-[#00A8FF] font-bold text-xs focus:outline-none"
                                >
                                  {MZ1500_CHANNELS.map(ch => {
                                    const isFm = FM_CHANNELS.includes(ch.id);
                                    const isOptionDisabled = isFm && !enableYM2151;
                                    return (
                                      <option 
                                        key={ch.id} 
                                        value={ch.id}
                                        disabled={isOptionDisabled}
                                        className={isOptionDisabled ? 'text-zinc-600 bg-[#141414]' : ''}
                                      >
                                        {ch.label}{isOptionDisabled ? ' [OFF]' : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
                    左のトラック一覧から編集するトラックを選択してください
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN 3: Target MZ-1500 Hardware Slots (DCSG/Noise/BEEP 9ch 最優先) */}
            <div className="col-span-3 bg-[#252525] border border-[#3C3C3C] rounded-lg flex flex-col overflow-hidden shadow-xs">
              {/* Column Header */}
              <div className="p-2.5 border-b border-[#383838] bg-[#2D2D2D] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                    Target: MZ-1500
                  </span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
                  enableYM2151 
                    ? 'text-[#00A8FF] bg-[#00A8FF]/10 border-[#00A8FF]/30' 
                    : 'text-emerald-400 bg-emerald-950/60 border-emerald-700/50'
                }`}>
                  {enableYM2151 ? '5/17 Channels Used' : '5/9 Standard Used'}
                </span>
              </div>

              {/* Hardware Slots List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {/* 1. DCSG SN76489 Pulse (P1-P6: 実機標準) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-300 px-1 font-bold">
                    <span>1. DCSG 矩形波 (6ch) [標準]</span>
                    <span className="text-zinc-400 font-normal">2 Free</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    {[
                      { id: 'P1', name: 'Melody', src: 'D1', active: true },
                      { id: 'P2', name: 'Chord V1', src: 'D2-V1', active: true },
                      { id: 'P3', name: 'Chord V2', src: 'D2-V2', active: true },
                      { id: 'P4', name: 'Chord V3', src: 'D2-V3', active: true },
                      { id: 'P5', name: 'Bass', src: 'D3', active: true },
                      { id: 'P6', name: '(Empty)', src: null, active: false },
                    ].map((slot) => (
                      <div
                        key={slot.id}
                        className={`p-1.5 rounded border flex flex-col justify-between ${
                          slot.active
                            ? 'bg-[#1E1E1E] border-amber-500/60 text-amber-200 shadow-xs'
                            : 'bg-[#181818] border-[#303030] text-zinc-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{slot.id}</span>
                          {slot.active && (
                            <span className="text-[9px] px-1 bg-amber-500/15 text-amber-300 rounded border border-amber-500/30 font-semibold">
                              {slot.src}
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] truncate mt-0.5 text-zinc-400">
                          {slot.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Noise (N1, N2) & BEEP (B1: 実機標準) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-300 px-1 font-bold">
                    <span>2. Noise & BEEP (3ch) [標準]</span>
                    <span className="text-zinc-400 font-normal">2 Free</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    {[
                      { id: 'N1', name: 'Rhythm', src: 'D5', active: true },
                      { id: 'N2', name: '(Empty)', src: null, active: false },
                      { id: 'B1', name: '(Empty)', src: null, active: false },
                    ].map((slot) => (
                      <div
                        key={slot.id}
                        className={`p-1.5 rounded border flex flex-col justify-between ${
                          slot.active
                            ? 'bg-[#1E1E1E] border-pink-500/60 text-pink-200 shadow-xs'
                            : 'bg-[#181818] border-[#303030] text-zinc-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{slot.id}</span>
                          {slot.active && (
                            <span className="text-[8px] px-0.5 bg-pink-500/15 text-pink-300 rounded border border-pink-500/30 font-semibold">
                              {slot.src}
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] truncate mt-0.5 text-zinc-400">
                          {slot.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. FM OPM (YM2151: F1-F8: 拡張ボード / オプション) */}
                <div className="space-y-1 pt-2 border-t border-[#333333]">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 px-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold ${enableYM2151 ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        3. YM2151 FM (8ch) [オプション]
                      </span>
                      {!enableYM2151 && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-500 border border-zinc-700 font-medium">
                          OFF
                        </span>
                      )}
                    </div>
                    {!enableYM2151 && onToggleEnableYM2151 ? (
                      <button
                        onClick={onToggleEnableYM2151}
                        className="text-[9px] text-[#00A8FF] hover:underline cursor-pointer flex items-center gap-1 font-mono"
                        title="ACZ-8BS1MZ FM音源ボードを有効化する"
                      >
                        + 有効化
                      </button>
                    ) : (
                      <span className="text-zinc-500">
                        {enableYM2151 ? (preset === 'fm_full' ? '4 Used / 4 Free' : '8 Free') : '無効 (OFF)'}
                      </span>
                    )}
                  </div>
                  <div className={`grid grid-cols-2 gap-1 text-[10px] ${!enableYM2151 ? 'opacity-35 pointer-events-none' : ''}`}>
                    {[
                      { id: 'F1', name: preset === 'fm_full' ? 'Melody (FM)' : '(Empty)', src: preset === 'fm_full' ? 'D1' : null, active: preset === 'fm_full' },
                      { id: 'F2', name: preset === 'fm_full' ? 'Chord V2' : '(Empty)', src: preset === 'fm_full' ? 'D2-V2' : null, active: preset === 'fm_full' },
                      { id: 'F3', name: preset === 'fm_full' ? 'Chord V3' : '(Empty)', src: preset === 'fm_full' ? 'D2-V3' : null, active: preset === 'fm_full' },
                      { id: 'F4', name: preset === 'fm_full' ? 'Strings Pad' : '(Empty)', src: preset === 'fm_full' ? 'D4' : null, active: preset === 'fm_full' },
                      { id: 'F5', name: '(Empty)', src: null, active: false },
                      { id: 'F6', name: '(Empty)', src: null, active: false },
                      { id: 'F7', name: '(Empty)', src: null, active: false },
                      { id: 'F8', name: '(Empty)', src: null, active: false },
                    ].map((slot) => (
                      <div
                        key={slot.id}
                        className={`p-1.5 rounded border flex flex-col justify-between ${
                          slot.active
                            ? 'bg-[#1E1E1E] border-[#9966FF]/60 text-[#c8a8ff] shadow-xs'
                            : 'bg-[#181818] border-[#303030] text-zinc-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{slot.id}</span>
                          {slot.active && (
                            <span className="text-[9px] px-1 bg-[#9966FF]/15 text-[#c8a8ff] rounded border border-[#9966FF]/30 font-semibold">
                              {slot.src}
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] truncate mt-0.5 text-zinc-400">
                          {slot.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. Work Tracks (W1〜W4: 作業用プール) */}
                <div className="space-y-1 pt-2 border-t border-[#333333]">
                  <div className="flex items-center justify-between text-[10px] text-amber-400 px-1 font-bold">
                    <div className="flex items-center gap-1.5">
                      <span>4. Work Tracks (W1〜W4)</span>
                      <span className="text-[9px] px-1 bg-amber-950/60 text-amber-300 rounded border border-amber-800/40 font-normal">
                        作業用
                      </span>
                    </div>
                    <span className="text-zinc-500 font-normal">MML素材保持</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    {[
                      { id: 'W1', name: 'Strings Pad', src: 'W4', active: true },
                      { id: 'W2', name: '(Empty)', src: null, active: false },
                      { id: 'W3', name: '(Empty)', src: null, active: false },
                      { id: 'W4', name: '(Empty)', src: null, active: false },
                    ].map((slot) => (
                      <div
                        key={slot.id}
                        className={`p-1.5 rounded border flex flex-col justify-between ${
                          slot.active
                            ? 'bg-[#1E1E1E] border-amber-500/50 text-amber-300 shadow-xs'
                            : 'bg-[#181818] border-[#303030] text-zinc-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{slot.id}</span>
                          {slot.active && (
                            <span className="text-[9px] px-1 bg-amber-500/15 text-amber-300 rounded border border-amber-500/30 font-semibold">
                              {slot.src}
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] truncate mt-0.5 text-zinc-400">
                          {slot.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>

          </div>
        )}

        {/* Modal Footer */}
        <footer className="h-12 bg-[#2D2D2D] border-t border-[#3C3C3C] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className={`w-2 h-2 rounded-full ${enableYM2151 ? 'bg-[#00A8FF]' : 'bg-emerald-400'} animate-pulse`} />
            <span>
              {enableYM2151 
                ? 'MZ-1500 Full 17ch (DCSG 6ch + Noise 2ch + BEEP 1ch + YM2151 FM 8ch) Ready'
                : 'MZ-1500 Standard 9ch (DCSG 6ch + Noise 2ch + BEEP 1ch) Ready'}
            </span>
            {!enableYM2151 && (
              <span className="text-[10px] text-zinc-500 bg-[#222222] px-1.5 py-0.5 rounded border border-[#333333]">
                #OPM OFF
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (loadedFile) {
                  applyRouting(loadedFile.summary, preset);
                }
              }}
              className="h-7 px-3 rounded text-xs font-semibold bg-[#383838] hover:bg-[#444444] text-zinc-300 border border-[#484848] flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              onClick={handleClose}
              className="h-7 px-3 rounded text-xs font-semibold bg-[#383838] hover:bg-[#444444] text-zinc-300 border border-[#484848] transition-colors cursor-pointer shadow-xs"
            >
              Cancel
            </button>

            <button
              onClick={handleApply}
              className="h-7 px-3.5 rounded text-xs font-bold bg-[#00A8FF] hover:bg-[#33BFFF] text-black shadow-[0_0_10px_rgba(0,168,255,0.3)] flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>✔ APPLY TO MML</span>
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
};
