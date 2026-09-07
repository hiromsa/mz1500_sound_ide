import React, { useState, useEffect } from 'react';
import { 
  Wand2, 
  ArrowUpDown, 
  ArrowRightLeft, 
  Check, 
  RotateCcw,
  Layers,
  Shuffle,
  Music2
} from 'lucide-react';
import type { MmlTransformOperation } from '../core/transform/mmlTransformEngine';

/** TRANSFORM パネルから App (Monaco Editor) へ送る変換適用要求。 */
export interface MmlTransformRequest {
  /** ログ / トースト表示用の説明文。 */
  description: string;
  /** 適用スコープ (track = 全文 / selection = エディタ選択範囲のみ)。 */
  scope: 'track' | 'selection';
  /** 順次適用する変換操作。 */
  operations: readonly MmlTransformOperation[];
}

interface MmlTransformPanelProps {
  enableYM2151?: boolean;
  onToggleEnableYM2151?: () => void;
  onOpenMidiRouter?: () => void;
  onRequestTransform?: (request: MmlTransformRequest) => void;
}

// MZ-1500 全17ch 定義
interface TrackDefinition {
  id: string;
  name: string;
  category: 'dcsg' | 'noise' | 'beep' | 'fm' | 'work';
}

const ALL_TRACKS: TrackDefinition[] = [
  // DCSG 1 (SN76489 #1)
  { id: 'P1', name: 'P1 (PSG 1)', category: 'dcsg' },
  { id: 'P2', name: 'P2 (PSG 2)', category: 'dcsg' },
  { id: 'P3', name: 'P3 (PSG 3)', category: 'dcsg' },
  { id: 'N1', name: 'N1 (Noise 1)', category: 'noise' },
  // DCSG 2 (SN76489 #2)
  { id: 'P4', name: 'P4 (PSG 4)', category: 'dcsg' },
  { id: 'P5', name: 'P5 (PSG 5)', category: 'dcsg' },
  { id: 'P6', name: 'P6 (PSG 6)', category: 'dcsg' },
  { id: 'N2', name: 'N2 (Noise 2)', category: 'noise' },
  // BEEP (8253 PIT)
  { id: 'B1', name: 'B1 (BEEP)', category: 'beep' },
  // YM2151 FM (ACZ-8BS1MZ)
  { id: 'F1', name: 'F1 (FM 1)', category: 'fm' },
  { id: 'F2', name: 'F2 (FM 2)', category: 'fm' },
  { id: 'F3', name: 'F3 (FM 3)', category: 'fm' },
  { id: 'F4', name: 'F4 (FM 4)', category: 'fm' },
  { id: 'F5', name: 'F5 (FM 5)', category: 'fm' },
  { id: 'F6', name: 'F6 (FM 6)', category: 'fm' },
  { id: 'F7', name: 'F7 (FM 7)', category: 'fm' },
  { id: 'F8', name: 'F8 (FM 8)', category: 'fm' },
  // WORK TRACKS (作業用トラック W1〜W4: PSG準拠・実機外)
  { id: 'W1', name: 'W1 (Work 1)', category: 'work' },
  { id: 'W2', name: 'W2 (Work 2)', category: 'work' },
  { id: 'W3', name: 'W3 (Work 3)', category: 'work' },
  { id: 'W4', name: 'W4 (Work 4)', category: 'work' },
];

const DCSG_TRACK_IDS = ['P1', 'P2', 'P3', 'N1', 'P4', 'P5', 'P6', 'N2', 'B1'];
const FM_TRACK_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];
const WORK_TRACK_IDS = ['W1', 'W2', 'W3', 'W4'];

export const MmlTransformPanel: React.FC<MmlTransformPanelProps> = ({
  enableYM2151 = false,
  onToggleEnableYM2151,
  onOpenMidiRouter,
  onRequestTransform,
}) => {
  const availableTracks = enableYM2151
    ? ALL_TRACKS
    : ALL_TRACKS.filter((t) => t.category !== 'fm');

  // 複数選択ステート (初期値: P1, P2, P3)
  const [selectedTracks, setSelectedTracks] = useState<string[]>(['P1', 'P2', 'P3']);
  const [scope, setScope] = useState<'track' | 'selection'>('track');

  // ピッチ系ステート
  const [octaveShift, setOctaveShift] = useState<number>(0);
  const [semitoneShift, setSemitoneShift] = useState<number>(0);

  // 音量スケーリングステート (加減算と割合: scaleVolume エンジン操作に対応)
  const [volumeAdd, setVolumeAdd] = useState<number>(0);
  const [volumePercent, setVolumePercent] = useState<number>(100);

  // チャンネル操作タブ (一括 remap / 単一置換 & スワップ)
  const [channelOpTab, setChannelOpTab] = useState<'batch' | 'single'>('batch');

  // 一括置き換え用マッピング辞書 { 'P1': 'P4', 'P2': 'P5', ... }
  const [batchMappings, setBatchMappings] = useState<Record<string, string>>({});
  const [batchStartTarget, setBatchStartTarget] = useState<string>('P1');

  // 単一チャンネル置き換え / スワップ ステート
  const [reassignSource, setReassignSource] = useState<string>('P1');
  const [reassignTarget, setReassignTarget] = useState<string>('P2');
  const [swapTrackA, setSwapTrackA] = useState<string>('P1');
  const [swapTrackB, setSwapTrackB] = useState<string>('P2');

  // トースト通知
  const [appliedToast, setAppliedToast] = useState<string | null>(null);

  // FM利用可否切り替え時に無効な選択を自動解除・安全化
  useEffect(() => {
    if (!enableYM2151) {
      setSelectedTracks((prev) => prev.filter((t) => !FM_TRACK_IDS.includes(t)));
      if (FM_TRACK_IDS.includes(batchStartTarget)) setBatchStartTarget('P1');
      if (FM_TRACK_IDS.includes(reassignSource)) setReassignSource('P1');
      if (FM_TRACK_IDS.includes(reassignTarget)) setReassignTarget('P2');
      if (FM_TRACK_IDS.includes(swapTrackA)) setSwapTrackA('P1');
      if (FM_TRACK_IDS.includes(swapTrackB)) setSwapTrackB('P2');
    }
  }, [enableYM2151, batchStartTarget, reassignSource, reassignTarget, swapTrackA, swapTrackB]);

  // selectedTracks が変化した時にデフォルトのマッピングを同期生成
  useEffect(() => {
    setBatchMappings((prev) => {
      const next: Record<string, string> = { ...prev };
      Object.keys(next).forEach((k) => {
        if (!selectedTracks.includes(k)) delete next[k];
      });
      selectedTracks.forEach((t, idx) => {
        if (!next[t]) {
          const startIdx = availableTracks.findIndex((item) => item.id === batchStartTarget);
          const defaultTarget = availableTracks[(startIdx >= 0 ? startIdx + idx : idx) % availableTracks.length]?.id ?? t;
          next[t] = defaultTarget;
        }
      });
      return next;
    });
  }, [selectedTracks, batchStartTarget, availableTracks]);

  const toggleTrack = (id: string) => {
    if (FM_TRACK_IDS.includes(id) && !enableYM2151) return;
    setSelectedTracks((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedTracks(availableTracks.map((t) => t.id));
  };
  const selectDcsg = () => setSelectedTracks(DCSG_TRACK_IDS);
  const selectFm = () => {
    if (enableYM2151) setSelectedTracks(FM_TRACK_IDS);
  };
  const selectWork = () => setSelectedTracks(WORK_TRACK_IDS);
  const clearSelection = () => setSelectedTracks([]);

  // クイックプリセット: 連番マッピング
  const applySequentialMapping = (startId: string) => {
    setBatchStartTarget(startId);
    const startIdx = availableTracks.findIndex((t) => t.id === startId);
    if (startIdx === -1) return;
    const newMappings: Record<string, string> = {};
    selectedTracks.forEach((src, idx) => {
      const targetTrack = availableTracks[(startIdx + idx) % availableTracks.length];
      newMappings[src] = targetTrack.id;
    });
    setBatchMappings(newMappings);
  };

  // クイックプリセット: W# -> P# (作業用トラックから実機DCSGへ展開)
  const applyPresetWorkToDcsg = () => {
    const newMappings: Record<string, string> = { ...batchMappings };
    selectedTracks.forEach((src) => {
      if (src.startsWith('W')) {
        const num = src.slice(1);
        newMappings[src] = `P${num}`;
      }
    });
    setBatchMappings(newMappings);
  };

  // クイックプリセット: W# -> F# (作業用トラックから実機FMへ展開)
  const applyPresetWorkToFm = () => {
    if (!enableYM2151) return;
    const newMappings: Record<string, string> = { ...batchMappings };
    selectedTracks.forEach((src) => {
      if (src.startsWith('W')) {
        const num = src.slice(1);
        newMappings[src] = `F${num}`;
      }
    });
    setBatchMappings(newMappings);
  };

  // クイックプリセット: P# -> F# (DCSGからFMへ同一番号移動)
  const applyPresetDcsgToFm = () => {
    if (!enableYM2151) return;
    const newMappings: Record<string, string> = { ...batchMappings };
    selectedTracks.forEach((src) => {
      if (src.startsWith('P')) {
        const num = src.slice(1);
        newMappings[src] = `F${num}`;
      } else if (src === 'B1') {
        newMappings[src] = 'F7';
      }
    });
    setBatchMappings(newMappings);
  };

  // クイックプリセット: F# -> P# (FMからDCSGへ同一番号移動)
  const applyPresetFmToDcsg = () => {
    const newMappings: Record<string, string> = { ...batchMappings };
    selectedTracks.forEach((src) => {
      if (src.startsWith('F')) {
        const num = parseInt(src.slice(1), 10);
        newMappings[src] = num <= 6 ? `P${num}` : 'B1';
      }
    });
    setBatchMappings(newMappings);
  };

  // クイックプリセット: P1-3 -> P4-6 (DCSGチップ1からチップ2へ)
  const applyPresetChip1ToChip2 = () => {
    const newMappings: Record<string, string> = { ...batchMappings };
    selectedTracks.forEach((src) => {
      if (src === 'P1') newMappings[src] = 'P4';
      if (src === 'P2') newMappings[src] = 'P5';
      if (src === 'P3') newMappings[src] = 'P6';
      if (src === 'N1') newMappings[src] = 'N2';
    });
    setBatchMappings(newMappings);
  };

  // 変換適用要求を App (Monaco Editor) へ送出する
  const requestTransform = (description: string, operations: readonly MmlTransformOperation[]) => {
    const targetDesc = selectedTracks.length === 0
      ? 'NO TRACKS'
      : selectedTracks.length === availableTracks.length
      ? (enableYM2151 ? 'ALL TRACKS (17ch)' : 'ALL TRACKS (9ch)')
      : selectedTracks.join(', ');
    const msg = `${description} → [${targetDesc}] (${scope === 'track' ? 'Entire Track' : 'Selection'})`;
    setAppliedToast(msg);
    onRequestTransform?.({ description: msg, scope, operations });
    setTimeout(() => setAppliedToast(null), 3000);
  };

  // ピッチおよび音量の変更有無
  const hasPitchChange = octaveShift !== 0 || semitoneShift !== 0;
  const hasVolumeChange = volumeAdd !== 0 || volumePercent !== 100;
  const hasPitchOrVolumeChange = hasPitchChange || hasVolumeChange;

  // ピッチのみ反映 (オクターブシフト + 半音移調を順次適用)
  const handleApplyPitch = () => {
    if (selectedTracks.length === 0 || !hasPitchChange) return;

    const operations: MmlTransformOperation[] = [];
    if (octaveShift !== 0) {
      operations.push({ kind: 'shiftOctave', targetTracks: selectedTracks, shift: octaveShift });
    }
    if (semitoneShift !== 0) {
      operations.push({ kind: 'transpose', targetTracks: selectedTracks, semitones: semitoneShift });
    }

    if (operations.length === 0) return;
    requestTransform(`Pitch Shift (${octaveShift} oct, ${semitoneShift} semi)`, operations);
  };

  // 音量スケーリングのみ反映 (加減算 + 割合を scaleVolume として適用)
  const handleApplyVolume = () => {
    if (selectedTracks.length === 0 || !hasVolumeChange) return;

    requestTransform(
      `Volume Scale (${volumeAdd > 0 ? `+${volumeAdd}` : volumeAdd} / ${volumePercent}%)`,
      [{ kind: 'scaleVolume', targetTracks: selectedTracks, add: volumeAdd, percent: volumePercent }],
    );
  };

  // ピッチ + 音量をまとめて一括反映 (ヘッダーボタン用)
  const handleApplyAll = () => {
    if (selectedTracks.length === 0 || !hasPitchOrVolumeChange) return;

    const operations: MmlTransformOperation[] = [];
    const descParts: string[] = [];

    if (octaveShift !== 0) {
      operations.push({ kind: 'shiftOctave', targetTracks: selectedTracks, shift: octaveShift });
      descParts.push(`Oct ${octaveShift > 0 ? `+${octaveShift}` : octaveShift}`);
    }
    if (semitoneShift !== 0) {
      operations.push({ kind: 'transpose', targetTracks: selectedTracks, semitones: semitoneShift });
      descParts.push(`Semi ${semitoneShift > 0 ? `+${semitoneShift}` : semitoneShift}`);
    }
    if (hasVolumeChange) {
      operations.push({ kind: 'scaleVolume', targetTracks: selectedTracks, add: volumeAdd, percent: volumePercent });
      descParts.push(`Vol ${volumePercent}% ${volumeAdd >= 0 ? `+${volumeAdd}` : volumeAdd}`);
    }

    if (operations.length === 0) return;
    requestTransform(`Transform (${descParts.join(', ')})`, operations);
  };

  const handleApplyBatchRemap = () => {
    const mappings = Object.fromEntries(
      Object.entries(batchMappings).filter(([src, tgt]) => src !== tgt),
    );
    const mapPairs = Object.entries(mappings).map(([src, tgt]) => `${src}➔${tgt}`);
    if (mapPairs.length === 0) {
      requestTransform('Batch Remap (No changes)', []);
      return;
    }

    requestTransform(`Batch Remap: ${mapPairs.join(', ')}`, [
      { kind: 'remapTracks', mappings },
    ]);
  };

  // 単一チャンネルの振り替え (移動・トラック名置換)
  const handleApplyReassign = () => {
    if (reassignSource === reassignTarget) return;
    requestTransform(`Reassign ${reassignSource} to ${reassignTarget}`, [
      { kind: 'remapTracks', mappings: { [reassignSource]: reassignTarget } },
    ]);
  };

  // 2 チャンネルの相互入替 (スワップ)
  const handleApplySwap = () => {
    if (swapTrackA === swapTrackB) return;
    requestTransform(`Swap ${swapTrackA} <-> ${swapTrackB}`, [
      { kind: 'remapTracks', mappings: { [swapTrackA]: swapTrackB, [swapTrackB]: swapTrackA } },
    ]);
  };

  // 選択トラックの要約表示テキスト
  const targetSummaryText = selectedTracks.length === 0
    ? 'NONE'
    : selectedTracks.length === availableTracks.length
    ? (enableYM2151 ? 'ALL 17ch' : 'ALL 9ch')
    : selectedTracks.length === 1
    ? selectedTracks[0]
    : `${selectedTracks.length}ch (${selectedTracks.join(',')})`;

  return (
    <div className="flex flex-col h-full bg-[#1E1E1E] p-3.5 overflow-y-auto font-mono text-zinc-300 gap-3 select-none">
      {/* 画面ヘッダー Bento Bar: TrackMonitor / SongSetup と完全一致のスタイル */}
      <div className="flex flex-wrap justify-between items-center gap-3 bg-[#12131a] p-3 rounded-lg border border-white/[0.08] shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5">
          <Wand2 className="w-4 h-4 text-[#00A8FF]" />
          <h2 className="text-xs font-semibold text-zinc-200 tracking-wide">
            MML TRANSFORM
          </h2>
          <span className="text-[10px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-800/80 border border-white/10 font-medium">
            BATCH OPS
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#2D2D2D] text-zinc-400 border border-[#3C3C3C] font-mono">
            {enableYM2151 ? '17 CH (FM ON)' : '9 CH (MZ-1500 BASICS)'}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {/* IMPORT MIDI ボタン (MIDI ROUTING STUDIO モーダルを開く) */}
          {onOpenMidiRouter && (
            <button
              onClick={onOpenMidiRouter}
              className="h-6.5 px-2.5 rounded text-xs font-bold bg-[#00A8FF]/15 hover:bg-[#00A8FF]/25 active:bg-[#00A8FF]/35 text-[#00A8FF] border border-[#00A8FF]/50 shadow-[0_0_8px_rgba(0,168,255,0.2)] transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              title="MIDIファイル (.mid) をインポートしてMZ-1500音源へマッピング"
            >
              <Music2 className="w-3.5 h-3.5 text-[#00A8FF]" />
              <span>IMPORT MIDI</span>
            </button>
          )}

          {/* Scope 選択 */}
          <div className="flex items-center gap-1.5 bg-[#222222] border border-[#3C3C3C] px-2.5 py-1 rounded shrink-0">
            <span className="text-[10px] font-medium text-zinc-400 tracking-wide">
              SCOPE:
            </span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as any)}
              className="bg-transparent text-zinc-200 text-xs font-mono focus:outline-none cursor-pointer"
            >
              <option value="track" className="bg-[#1E1E1E]">Entire Track</option>
              <option value="selection" className="bg-[#1E1E1E]">Selection</option>
            </select>
          </div>

          {/* 適用通知トースト */}
          {appliedToast && (
            <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-1 rounded border border-emerald-700/60 flex items-center gap-1 animate-fade-in shrink-0">
              <Check className="w-3 h-3 stroke-[3]" />
              <span>{appliedToast}</span>
            </span>
          )}

          {/* 一括反映ボタン */}
          <button
            disabled={selectedTracks.length === 0 || !hasPitchOrVolumeChange}
            onClick={handleApplyAll}
            title={
              selectedTracks.length === 0
                ? '対象トラックを選択してください'
                : !hasPitchOrVolumeChange
                ? 'ピッチまたは音量の数値を変更してください'
                : 'ピッチと音量の変更をまとめてMMLへ反映'
            }
            className={`h-6.5 px-3 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
              selectedTracks.length === 0 || !hasPitchOrVolumeChange
                ? 'bg-[#2E2E2E] text-zinc-500 border border-[#3C3C3C] cursor-not-allowed'
                : 'bg-[#00A8FF] hover:bg-[#33BFFF] text-black font-bold shadow-[0_0_10px_rgba(0,168,255,0.4)]'
            }`}
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
            <span>APPLY TO MML ({targetSummaryText})</span>
          </button>
        </div>
      </div>

      {/* TARGET CHANNELS: Bento Card */}
      <div className="flex flex-col bg-[#2D2D2D] p-3 rounded-lg border border-[#3C3C3C] shadow-xs gap-2.5 shrink-0">
        <div className="flex items-center justify-between text-xs text-zinc-300 font-medium tracking-wide border-b border-[#3C3C3C] pb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100">TARGET CHANNELS</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#3A3A3A] text-zinc-300 text-[9px] font-medium">
              {selectedTracks.length} / {availableTracks.length} SELECTED
            </span>
          </div>

          {/* ショートカットボタン群 */}
          <div className="flex items-center gap-1">
            <button
              onClick={selectAll}
              className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
            >
              {enableYM2151 ? 'ALL (17ch)' : 'ALL (9ch)'}
            </button>
            <button
              onClick={selectDcsg}
              className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
            >
              DCSG (9ch)
            </button>
            <button
              onClick={selectFm}
              disabled={!enableYM2151}
              className={`h-5 px-2 text-[10px] font-medium rounded border transition-colors cursor-pointer ${
                enableYM2151
                  ? 'bg-[#383838] hover:bg-[#444444] text-zinc-200 border-[#484848]'
                  : 'bg-[#222222] text-zinc-600 border-[#333333] cursor-not-allowed opacity-40'
              }`}
              title={!enableYM2151 ? 'FM音源ボードが無効化されています (SONG SETUPタブで有効化可能)' : undefined}
            >
              FM (8ch)
            </button>
            <button
              onClick={selectWork}
              className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-amber-300 rounded border border-[#484848] hover:border-amber-500/50 transition-colors cursor-pointer"
              title="作業用トラック W1〜W4 を選択"
            >
              WORK (4ch)
            </button>
            <button
              onClick={clearSelection}
              className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-400 hover:text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer flex items-center gap-1"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>CLEAR</span>
            </button>
          </div>
        </div>

        {/* チャンネルボタングリッド */}
        <div className="flex flex-col gap-2">
          {/* DCSG グループ */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00A8FF]"></span>
              <span>MZ-1500 BASICS (DCSG 1-2, NOISE, BEEP):</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1">
              {ALL_TRACKS.filter((t) => ['dcsg', 'noise', 'beep'].includes(t.category)).map((track) => {
                const isSelected = selectedTracks.includes(track.id);
                return (
                  <button
                    key={track.id}
                    onClick={() => toggleTrack(track.id)}
                    className={`h-7 px-1 rounded text-center text-xs font-mono transition-colors cursor-pointer flex items-center justify-center gap-1 border ${
                      isSelected
                        ? 'bg-[#00A8FF] text-black font-bold border-[#00A8FF]'
                        : 'bg-[#222222] text-zinc-400 border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#333333]'
                    }`}
                  >
                    <span>{track.id}</span>
                    <span className={`text-[8px] ${isSelected ? 'text-black/75' : 'text-zinc-500'}`}>
                      {track.category === 'noise' ? 'NOISE' : track.category === 'beep' ? 'BEEP' : 'PSG'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FM グループ (enableYM2151 が false のときは操作不可) */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${enableYM2151 ? 'bg-[#9966FF]' : 'bg-zinc-600'}`}></span>
                <span>YM2151 (ACZ-8BS1MZ OPTION BOARD):</span>
                {!enableYM2151 && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-500 border border-zinc-700 font-medium">
                    DISABLED (OFF)
                  </span>
                )}
              </div>
              {!enableYM2151 && onToggleEnableYM2151 && (
                <button
                  onClick={onToggleEnableYM2151}
                  className="text-[9px] text-[#00A8FF] hover:underline cursor-pointer flex items-center gap-1"
                  title="ACZ-8BS1MZ FM音源ボードを有効化する"
                >
                  <span>+ 有効化する</span>
                </button>
              )}
            </div>

            <div className={`grid grid-cols-4 sm:grid-cols-8 gap-1 ${!enableYM2151 ? 'opacity-35 pointer-events-none' : ''}`}>
              {ALL_TRACKS.filter((t) => t.category === 'fm').map((track) => {
                const isSelected = selectedTracks.includes(track.id);
                return (
                  <button
                    key={track.id}
                    disabled={!enableYM2151}
                    onClick={() => toggleTrack(track.id)}
                    className={`h-7 px-1 rounded text-center text-xs font-mono transition-colors flex items-center justify-center gap-1 border ${
                      !enableYM2151
                        ? 'bg-[#181818] text-zinc-600 border-[#2A2A2A] cursor-not-allowed'
                        : isSelected
                        ? 'bg-[#00A8FF] text-black font-bold border-[#00A8FF] cursor-pointer'
                        : 'bg-[#222222] text-zinc-400 border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#333333] cursor-pointer'
                    }`}
                  >
                    <span>{track.id}</span>
                    <span className={`text-[8px] ${isSelected ? 'text-black/75' : 'text-zinc-500'}`}>
                      FM
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* WORK TRACKS グループ (作業用プール) */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-amber-400/90 mb-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                <span>WORK TRACKS (作業用プール W1〜W4):</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50 font-medium">
                  PSG準拠・実機演奏外
                </span>
              </div>
              <span className="text-[9px] text-zinc-500">MIDI Import 退避素材</span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
              {ALL_TRACKS.filter((t) => t.category === 'work').map((track) => {
                const isSelected = selectedTracks.includes(track.id);
                return (
                  <button
                    key={track.id}
                    onClick={() => toggleTrack(track.id)}
                    className={`h-7 px-1 rounded text-center text-xs font-mono transition-colors flex items-center justify-center gap-1 border cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 text-black font-bold border-amber-500 shadow-xs'
                        : 'bg-[#222222] text-amber-300/80 border-[#3C3C3C] hover:border-amber-500/50 hover:text-amber-200 hover:bg-[#2A2A2A]'
                    }`}
                  >
                    <span>{track.id}</span>
                    <span className={`text-[8px] ${isSelected ? 'text-black/75' : 'text-amber-500/70'}`}>
                      WORK
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 2カラム Bento Cards (PITCH & CHANNEL OPERATIONS) */}
      <div className="flex flex-col md:flex-row gap-3 flex-1 items-start">
        
        {/* 左カード: PITCH & OCTAVE */}
        <div className="flex-1 w-full flex flex-col bg-[#2D2D2D] p-3 rounded-lg border border-[#3C3C3C] shadow-xs gap-3">
          <div className="flex items-center justify-between text-xs text-zinc-300 font-medium tracking-wide border-b border-[#3C3C3C] pb-2">
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-3.5 h-3.5 text-[#00A8FF]" />
              <span className="font-semibold text-zinc-100">PITCH & VOLUME</span>
            </div>
            <button
              onClick={() => {
                setOctaveShift(0);
                setSemitoneShift(0);
                setVolumeAdd(0);
                setVolumePercent(100);
              }}
              className="h-5 px-1.5 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-400 hover:text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer flex items-center gap-1"
              title="Reset Pitch & Volume"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>RESET</span>
            </button>
          </div>

          {/* オクターブシフト */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
              <span>OCTAVE SHIFT:</span>
              <span className="text-[#00A8FF] font-bold">
                {octaveShift > 0 ? `+${octaveShift}` : octaveShift} oct
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[-2, -1, 0, 1, 2].map((shift) => (
                <button
                  key={shift}
                  onClick={() => setOctaveShift(shift)}
                  className={`flex-1 h-6 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                    octaveShift === shift
                      ? 'bg-[#00A8FF] text-black border-[#00A8FF]'
                      : 'bg-[#222222] text-zinc-400 border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#333333]'
                  }`}
                >
                  {shift > 0 ? `+${shift}` : shift}
                </button>
              ))}
            </div>
          </div>

          {/* 半音トランスポーズ */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
              <span>TRANSPOSE (SEMITONE):</span>
              <span className="text-[#00A8FF] font-bold">
                {semitoneShift > 0 ? `+${semitoneShift}` : semitoneShift}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[-12, -1, 0, 1, 12].map((semi) => (
                <button
                  key={semi}
                  onClick={() => setSemitoneShift(semi)}
                  className={`flex-1 h-6 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                    semitoneShift === semi
                      ? 'bg-[#00A8FF] text-black border-[#00A8FF]'
                      : 'bg-[#222222] text-zinc-400 border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#333333]'
                  }`}
                >
                  {semi > 0 ? `+${semi}` : semi}
                </button>
              ))}
            </div>
          </div>

          {/* 音量スケーリング */}
          <div className="flex flex-col gap-1 pt-1 border-t border-[#3C3C3C]">
            <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
              <span>VOLUME SCALE:</span>
              <span className="text-[#00A8FF] font-bold">
                {volumeAdd > 0 ? `+${volumeAdd}` : volumeAdd} / {volumePercent}%
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[-2, -1, 0, 1, 2].map((add) => (
                <button
                  key={add}
                  onClick={() => setVolumeAdd(add)}
                  className={`flex-1 h-6 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                    volumeAdd === add
                      ? 'bg-[#00A8FF] text-black border-[#00A8FF]'
                      : 'bg-[#222222] text-zinc-400 border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#333333]'
                  }`}
                >
                  {add > 0 ? `+${add}` : add}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {[50, 75, 100, 125, 150].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setVolumePercent(pct)}
                  className={`flex-1 h-6 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                    volumePercent === pct
                      ? 'bg-[#00A8FF] text-black border-[#00A8FF]'
                      : 'bg-[#222222] text-zinc-400 border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#333333]'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
            <div className="text-[9px] text-zinc-400 font-mono">
              {volumePercent === 100 && volumeAdd === 0 ? (
                <span className="text-zinc-500">※ 音量変更なし (100% / ±0)</span>
              ) : (
                <span>
                  ※ 計算式: v = clamp(round(v × {volumePercent}%) {volumeAdd >= 0 ? `+ ${volumeAdd}` : `- ${Math.abs(volumeAdd)}`}) [DCSG: 0-15 / FM: 0-127]
                </span>
              )}
            </div>
          </div>

          <div className="pt-1 mt-auto flex flex-col gap-1">
            <button
              disabled={selectedTracks.length === 0 || !hasPitchChange}
              onClick={handleApplyPitch}
              className={`w-full h-6 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
                selectedTracks.length === 0 || !hasPitchChange
                  ? 'bg-[#2E2E2E] text-zinc-500 border-[#3C3C3C] cursor-not-allowed'
                  : 'bg-[#383838] hover:bg-[#444444] text-zinc-200 border-[#484848]'
              }`}
            >
              ピッチのみ反映 ({targetSummaryText})
            </button>
            <button
              disabled={selectedTracks.length === 0 || !hasVolumeChange}
              onClick={handleApplyVolume}
              className={`w-full h-6 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
                selectedTracks.length === 0 || !hasVolumeChange
                  ? 'bg-[#2E2E2E] text-zinc-500 border-[#3C3C3C] cursor-not-allowed'
                  : 'bg-[#383838] hover:bg-[#444444] text-zinc-200 border-[#484848]'
              }`}
            >
              音量のみ反映 ({targetSummaryText})
            </button>
          </div>
        </div>

        {/* 右カード: CHANNEL OPERATIONS */}
        <div className="flex-1 w-full flex flex-col bg-[#2D2D2D] p-3 rounded-lg border border-[#3C3C3C] shadow-xs gap-3">
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-zinc-300 font-medium tracking-wide border-b border-[#3C3C3C] pb-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#00A8FF]" />
              <span className="font-semibold text-zinc-100">CHANNEL OPERATIONS</span>
            </div>

            {/* サブモード切替タブ */}
            <div className="flex items-center rounded bg-[#222222] p-0.5 border border-[#3C3C3C] shrink-0">
              <button
                onClick={() => setChannelOpTab('batch')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                  channelOpTab === 'batch'
                    ? 'bg-[#00A8FF] text-black font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Layers className="w-2.5 h-2.5" />
                <span>一括置換 (BATCH)</span>
              </button>
              <button
                onClick={() => setChannelOpTab('single')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                  channelOpTab === 'single'
                    ? 'bg-[#00A8FF] text-black font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Shuffle className="w-2.5 h-2.5" />
                <span>単体/スワップ</span>
              </button>
            </div>
          </div>

          {/* モード A: 複数チャンネル一括置換 (BATCH REMAP) */}
          {channelOpTab === 'batch' && (
            <div className="flex flex-col gap-2.5">
              {/* クイックプリセット */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-400 font-medium">
                  PRESET MAPPINGS:
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    onClick={applyPresetWorkToDcsg}
                    className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-amber-300 border border-[#484848] hover:border-amber-500/50 rounded transition-colors cursor-pointer"
                    title="作業用トラック W# を実機標準 DCSG (P1〜P4) へ展開"
                  >
                    W# ➔ P# (実機へ)
                  </button>
                  <button
                    disabled={!enableYM2151}
                    onClick={applyPresetWorkToFm}
                    className={`h-5 px-2 text-[10px] font-medium rounded border transition-colors ${
                      enableYM2151
                        ? 'bg-[#383838] hover:bg-[#444444] text-amber-300 border-[#484848] hover:border-amber-500/50 cursor-pointer'
                        : 'bg-[#222222] text-zinc-600 border-[#333333] cursor-not-allowed opacity-40'
                    }`}
                    title={!enableYM2151 ? 'FM音源が無効のため使用できません' : '作業用トラック W# を実機拡張 FM (F1〜F4) へ展開'}
                  >
                    W# ➔ F# (FMへ)
                  </button>
                  <button
                    disabled={!enableYM2151}
                    onClick={applyPresetDcsgToFm}
                    className={`h-5 px-2 text-[10px] font-medium rounded border transition-colors ${
                      enableYM2151
                        ? 'bg-[#383838] hover:bg-[#444444] text-zinc-200 border-[#484848] cursor-pointer'
                        : 'bg-[#222222] text-zinc-600 border-[#333333] cursor-not-allowed opacity-40'
                    }`}
                    title={!enableYM2151 ? 'FM音源が無効のため使用できません' : undefined}
                  >
                    P# ➔ F# (FMへ)
                  </button>
                  <button
                    onClick={applyPresetFmToDcsg}
                    className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                  >
                    F# ➔ P# (DCSGへ)
                  </button>
                  <button
                    onClick={applyPresetChip1ToChip2}
                    className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                  >
                    P1-3 ➔ P4-6 (DCSG2へ)
                  </button>
                </div>
              </div>

              {/* 連番マッピング設定 */}
              <div className="p-2 rounded bg-[#222222] border border-[#3C3C3C] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 font-medium">
                    開始チャンネルから連番:
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={batchStartTarget}
                      onChange={(e) => applySequentialMapping(e.target.value)}
                      className="bg-[#1E1E1E] border border-[#3C3C3C] rounded px-1.5 py-0.5 text-zinc-200 text-xs focus:outline-none cursor-pointer font-mono"
                    >
                      {availableTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id} ({t.category.toUpperCase()})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => applySequentialMapping(batchStartTarget)}
                      className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                    >
                      割り当て
                    </button>
                  </div>
                </div>

                {/* 選択中のトラック対応リスト */}
                <div className="pt-1.5 border-t border-[#333333]">
                  {selectedTracks.length === 0 ? (
                    <div className="text-[10px] text-zinc-500 py-2 text-center">
                      TARGET CHANNELS でトラックを選択してください
                    </div>
                  ) : (
                    <div className="max-h-36 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {selectedTracks.map((src) => {
                          const tgt = batchMappings[src] ?? src;
                          const isChanged = src !== tgt;
                          return (
                            <div
                              key={src}
                              className={`flex items-center justify-between px-1.5 py-1 rounded border text-[10px] font-mono ${
                                isChanged
                                  ? 'bg-[#182a38] border-[#00A8FF]/50 text-zinc-100'
                                  : 'bg-[#1E1E1E] border-[#3C3C3C] text-zinc-400'
                              }`}
                            >
                              <span className="font-bold text-zinc-200">{src}</span>
                              <span className="text-zinc-500 text-[9px]">➔</span>
                              <select
                                value={tgt}
                                onChange={(e) => {
                                  setBatchMappings((prev) => ({
                                    ...prev,
                                    [src]: e.target.value,
                                  }));
                                }}
                                className="bg-[#1E1E1E] border border-[#3C3C3C] rounded px-1 py-0.2 text-[11px] font-bold text-[#00A8FF] focus:outline-none cursor-pointer font-mono"
                              >
                                {availableTracks.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.id}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                disabled={selectedTracks.length === 0}
                onClick={handleApplyBatchRemap}
                className={`w-full h-6 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer border ${
                  selectedTracks.length === 0
                    ? 'bg-[#2E2E2E] text-zinc-500 border-[#3C3C3C] cursor-not-allowed'
                    : 'bg-[#383838] hover:bg-[#444444] text-zinc-200 border-[#484848]'
                }`}
              >
                <Check className="w-3 h-3 stroke-[3]" />
                <span>一括チャンネル置き換えを実行 ({selectedTracks.length} CH)</span>
              </button>
            </div>
          )}

          {/* モード B: 単一置換 & 2chスワップ */}
          {channelOpTab === 'single' && (
            <div className="flex flex-col gap-3 py-1">
              {/* チャンネル振り替え */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-400 font-medium">
                  単一チャンネル振り替え (移動・トラック名置換):
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={reassignSource}
                    onChange={(e) => setReassignSource(e.target.value)}
                    className="w-28 bg-[#1E1E1E] border border-[#3C3C3C] rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none"
                  >
                    {availableTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} ({t.category.toUpperCase()})
                      </option>
                    ))}
                  </select>

                  <span className="text-zinc-500 text-xs">➔</span>

                  <select
                    value={reassignTarget}
                    onChange={(e) => setReassignTarget(e.target.value)}
                    className="w-28 bg-[#1E1E1E] border border-[#3C3C3C] rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none"
                  >
                    {availableTracks.filter((t) => t.id !== reassignSource).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} ({t.category.toUpperCase()})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleApplyReassign}
                    className="h-6 px-3 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                  >
                    変更
                  </button>
                </div>
              </div>

              {/* 2チャンネルの入れ替え */}
              <div className="flex flex-col gap-1 pt-2 border-t border-[#3C3C3C]">
                <span className="text-[10px] text-zinc-400 font-medium">
                  2チャンネルのスワップ入替:
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={swapTrackA}
                    onChange={(e) => setSwapTrackA(e.target.value)}
                    className="w-28 bg-[#1E1E1E] border border-[#3C3C3C] rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none"
                  >
                    {availableTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} ({t.category.toUpperCase()})
                      </option>
                    ))}
                  </select>

                  <ArrowRightLeft className="w-3.5 h-3.5 text-[#00A8FF]" />

                  <select
                    value={swapTrackB}
                    onChange={(e) => setSwapTrackB(e.target.value)}
                    className="w-28 bg-[#1E1E1E] border border-[#3C3C3C] rounded px-2 py-1 text-zinc-200 text-xs font-mono focus:outline-none"
                  >
                    {availableTracks.filter((t) => t.id !== swapTrackA).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} ({t.category.toUpperCase()})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleApplySwap}
                    className="h-6 px-3 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <ArrowRightLeft className="w-3 h-3 text-[#00A8FF]" />
                    <span>スワップ</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="text-[9px] text-zinc-400 text-center pt-1 border-t border-[#3C3C3C]/60 mt-auto font-mono">
            {channelOpTab === 'batch' ? (
              <span>
                ※ MML内のトラック定義ヘッダーを一括置換 (例:{' '}
                {(() => {
                  const activePairs = Object.entries(batchMappings)
                    .filter(([src, tgt]) => src !== tgt)
                    .map(([src, tgt]) => `${src}➔${tgt}`);
                  return activePairs.length > 0
                    ? activePairs.slice(0, 3).join(', ') + (activePairs.length > 3 ? '...' : '')
                    : 'P1➔P4, P2➔P5 など';
                })()}
                )
              </span>
            ) : (
              <span>
                ※ MML内のトラック定義ヘッダーを安全に相互入替 (例: {swapTrackA} ⇔ {swapTrackB})
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
