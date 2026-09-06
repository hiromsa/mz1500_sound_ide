import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { virtualSynth, type SoundEngineType, type SynthPlayOptions } from '../utils/virtualSynth';
import type { MmlCaretContext } from '../utils/mmlCaretParser';
import type { FmToneData } from '../core/fm/FmTone';

// プリセットFM音色
const DEFAULT_PRESET_FM_TONES: Record<number, string> = {
  1: 'E.PIANO 1',
  2: 'SLAP BASS',
  3: 'BRASS ENS',
  4: 'CRYSTAL BELL',
};

// プリセットピッチエンベロープ (@PE)
const PRESET_PITCH_ENVS: Record<number, { name: string; data: number[]; loop: number }> = {
  1: { name: 'Vib Mild', data: [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1], loop: 0 },
  2: { name: 'Vib Deep', data: [0, 3, 6, 8, 6, 3, 0, -3, -6, -8, -6, -3], loop: 0 },
  3: { name: 'Attack Drop', data: [12, 10, 8, 6, 4, 2, 0], loop: -1 },
};

// プリセットボリュームエンベロープ (@VE)
const PRESET_VOL_ENVS: Record<number, { name: string; data: number[]; loop: number }> = {
  1: { name: 'Piano Decay', data: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0], loop: -1 },
  2: { name: 'Organ Sust', data: [15, 14, 14, 14, 14, 14, 14, 14], loop: 2 },
  3: { name: 'Short Pluck', data: [15, 11, 7, 4, 2, 1, 0], loop: -1 },
};

// 鍵盤情報定義
interface KeyDefinition {
  midiNote: number;
  name: string;
  isBlack: boolean;
  octave: number;
  whiteIndex: number;
}

const WHITE_KEY_WIDTH = 26;
const BLACK_KEY_WIDTH = 16;
const TOTAL_WHITE_KEYS = 52; // 88鍵: A0(21) 〜 C8(108)

// 88鍵のデータ配列を生成
function generate88Keys(): { keys: KeyDefinition[]; whiteKeyCount: number } {
  const keys: KeyDefinition[] = [];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let currentWhiteIndex = 0;

  for (let note = 21; note <= 108; note++) {
    const semitone = note % 12;
    const octave = Math.floor(note / 12) - 1;
    const isBlack = [1, 3, 6, 8, 10].includes(semitone);
    const name = `${NOTE_NAMES[semitone]}${octave}`;

    keys.push({
      midiNote: note,
      name,
      isBlack,
      octave,
      whiteIndex: isBlack ? currentWhiteIndex - 1 : currentWhiteIndex,
    });

    if (!isBlack) {
      currentWhiteIndex++;
    }
  }

  return { keys, whiteKeyCount: currentWhiteIndex };
}

const { keys: ALL_KEYS } = generate88Keys();

// オクターブごとの白鍵オフセット（ジャンプ用）
const OCTAVE_WHITE_INDICES: Record<number, number> = {
  1: 2,   // C1
  2: 9,   // C2
  3: 16,  // C3
  4: 23,  // C4 (中央C)
  5: 30,  // C5
  6: 37,  // C6
  7: 44,  // C7
};

// PCキーボード (QWERTY) による演奏用マッピング (C=0, C#=1... 基準オクターブ加算)
const PC_KEY_TO_SEMITONE: Record<string, number> = {
  KeyA: 0,        // C
  KeyW: 1,        // C#
  KeyS: 2,        // D
  KeyE: 3,        // D#
  KeyD: 4,        // E
  KeyF: 5,        // F
  KeyT: 6,        // F#
  KeyG: 7,        // G
  KeyY: 8,        // G#
  KeyH: 9,        // A
  KeyU: 10,       // A#
  KeyJ: 11,       // B
  KeyK: 12,       // C (+1)
  KeyO: 13,       // C# (+1)
  KeyL: 14,       // D (+1)
  KeyP: 15,       // D# (+1)
  Semicolon: 16,  // E (+1)
  Quote: 17,      // F (+1)
};

// 鍵盤上に表示するPCキーボードラベル
const SEMITONE_TO_KEY_LABEL: Record<number, string> = {
  0: 'A',
  1: 'W',
  2: 'S',
  3: 'E',
  4: 'D',
  5: 'F',
  6: 'T',
  7: 'G',
  8: 'Y',
  9: 'H',
  10: 'U',
  11: 'J',
  12: 'K',
  13: 'O',
  14: 'L',
  15: 'P',
  16: ';',
  17: "'",
};

export type ActiveTabContext = 'mml' | 'tone' | 'vol_envelope' | 'pitch_envelope';

interface VirtualKeyboardProps {
  activeTabContext: ActiveTabContext;
  mmlContext?: MmlCaretContext;
  activeFmTone?: FmToneData;
  activePitchEnv?: number[];
  activePitchEnvLoop?: number;
  activeVolEnv?: number[];
  activeVolEnvLoop?: number;
  testMidiNote?: number;
  onChangeTestMidiNote?: (note: number) => void;
}

export function VirtualKeyboard({
  activeTabContext,
  mmlContext,
  activeFmTone,
  activePitchEnv,
  activePitchEnvLoop,
  activeVolEnv,
  activeVolEnvLoop,
  testMidiNote,
  onChangeTestMidiNote,
}: VirtualKeyboardProps) {
  // 手動オーバーライド設定
  const [manualEngine, setManualEngine] = useState<SoundEngineType | 'auto'>('auto');
  const [manualVolume, setManualVolume] = useState<number | null>(null);
  const [psgVolumeMode, setPsgVolumeMode] = useState<'direct' | 'env'>('direct'); // PSG/Noise時の音量モード
  const [selectedVolEnv, setSelectedVolEnv] = useState<string>('editor'); // 'editor' | '1' | '2' | '3'
  const [selectedPitchEnv, setSelectedPitchEnv] = useState<string>('none'); // 'none' | 'editor' | '1' | '2' | '3'
  const [selectedFmToneId, setSelectedFmToneId] = useState<number>(1);

  // 押下中のMIDIノート一覧
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());
  const isMouseDownRef = useRef<boolean>(false);
  const keyboardScrollRef = useRef<HTMLDivElement>(null);

  // PCキーボードタイピング演奏用の基準オクターブ (初期値 4 = C4基準)
  const [typingOctave, setTypingOctave] = useState<number>(() => mmlContext?.octave ?? 4);

  // 1. 実効音源判定
  const effectiveEngine: SoundEngineType = useMemo(() => {
    if (activeTabContext === 'tone') return 'fm'; // FM TONEエディタ時はFMのみ
    if (activeTabContext === 'vol_envelope') {
      // VOL ENVエディタ時はPSGまたはNOISE
      return (manualEngine === 'noise' || manualEngine === 'psg') ? manualEngine : 'psg';
    }
    if (activeTabContext === 'pitch_envelope') {
      // PITCH ENVエディタ時はFM / PSG / BEEP
      if (manualEngine === 'fm' || manualEngine === 'psg' || manualEngine === 'beep') {
        return manualEngine;
      }
      return 'fm';
    }
    // MMLエディタ時
    if (manualEngine !== 'auto') return manualEngine;
    return mmlContext?.engine || 'psg';
  }, [manualEngine, activeTabContext, mmlContext]);

  // 2. 実効音量 (0〜15)
  const effectiveVolume = manualVolume !== null ? manualVolume : (mmlContext?.volume ?? 12);

  // 3. ピッチエンベロープ (@PE) の実効データ判定
  const effectivePitchEnvData = useMemo(() => {
    if (activeTabContext === 'pitch_envelope') {
      // PITCH ENVエディタ時はエディタで編集中のデータを常に適用
      return { data: activePitchEnv, loop: activePitchEnvLoop };
    }
    if (selectedPitchEnv === 'editor' && activePitchEnv) {
      return { data: activePitchEnv, loop: activePitchEnvLoop };
    }
    if (selectedPitchEnv.startsWith('pe')) {
      const id = parseInt(selectedPitchEnv.slice(2), 10);
      const p = PRESET_PITCH_ENVS[id];
      if (p) return { data: p.data, loop: p.loop };
    }
    // MMLキャレットに@PE指定がある場合
    if (activeTabContext === 'mml' && selectedPitchEnv === 'none' && mmlContext?.pitchEnvId) {
      const p = PRESET_PITCH_ENVS[mmlContext.pitchEnvId];
      if (p) return { data: p.data, loop: p.loop };
    }
    return { data: undefined, loop: undefined };
  }, [activeTabContext, selectedPitchEnv, activePitchEnv, activePitchEnvLoop, mmlContext]);

  // 4. ボリュームエンベロープ (@VE) の実効データ判定
  const effectiveVolEnvData = useMemo(() => {
    if (activeTabContext === 'vol_envelope') {
      // VOL ENVエディタ時はエディタで編集中のデータを常に適用
      return { data: activeVolEnv, loop: activeVolEnvLoop };
    }
    if (psgVolumeMode === 'env' || (activeTabContext === 'mml' && mmlContext?.volEnvId)) {
      if (selectedVolEnv === 'editor' && activeVolEnv) {
        return { data: activeVolEnv, loop: activeVolEnvLoop };
      }
      const id = parseInt(selectedVolEnv, 10) || mmlContext?.volEnvId || 1;
      const v = PRESET_VOL_ENVS[id];
      if (v) return { data: v.data, loop: v.loop };
    }
    return { data: undefined, loop: undefined };
  }, [activeTabContext, psgVolumeMode, selectedVolEnv, activeVolEnv, activeVolEnvLoop, mmlContext]);

  // 初期スクロール: C4 (中央C) 付近にスクロール
  useEffect(() => {
    if (keyboardScrollRef.current) {
      const c4Offset = OCTAVE_WHITE_INDICES[4] * WHITE_KEY_WIDTH;
      keyboardScrollRef.current.scrollLeft = c4Offset - 180;
    }
  }, []);

  // MMLキャレットのオクターブが変化した時、自動追従スクロール
  useEffect(() => {
    if (activeTabContext === 'mml' && mmlContext?.octave && keyboardScrollRef.current) {
      const targetWhiteIdx = OCTAVE_WHITE_INDICES[mmlContext.octave];
      if (targetWhiteIdx !== undefined) {
        const offset = targetWhiteIdx * WHITE_KEY_WIDTH;
        keyboardScrollRef.current.scrollTo({
          left: Math.max(0, offset - 150),
          behavior: 'smooth'
        });
      }
    }
  }, [mmlContext?.octave, activeTabContext]);

  // MMLキャレットコンテキストの変化を各種パラメータへ自動連動
  useEffect(() => {
    if (activeTabContext !== 'mml' || !mmlContext) return;

    // 1. オクターブ自動追従
    if (mmlContext.octave !== undefined) {
      setTypingOctave(mmlContext.octave);
    }

    // 2. 音源の自動連動 (手動オーバーライドをAUTOに戻す)
    setManualEngine('auto');

    // 3. 音量の自動連動 (手動オーバーライドをリセットしMML値優先)
    setManualVolume(null);

    // 4. FM音色ID自動連動
    if (mmlContext.voiceId !== undefined) {
      setSelectedFmToneId(mmlContext.voiceId);
    }

    // 5. ボリュームエンベロープ自動連動
    if (mmlContext.volEnvId !== undefined) {
      setPsgVolumeMode('env');
      setSelectedVolEnv(String(mmlContext.volEnvId));
    } else {
      setPsgVolumeMode('direct');
    }

    // 6. ピッチエンベロープ自動連動
    if (mmlContext.pitchEnvId !== undefined) {
      setSelectedPitchEnv(`pe${mmlContext.pitchEnvId}`);
    } else {
      setSelectedPitchEnv('none');
    }
  }, [
    activeTabContext,
    mmlContext,
    mmlContext?.trackName,
    mmlContext?.octave,
    mmlContext?.volume,
    mmlContext?.engine,
    mmlContext?.voiceId,
    mmlContext?.volEnvId,
    mmlContext?.pitchEnvId,
  ]);



  // オクターブジャンプハンドラ
  const handleJumpOctave = (oct: number) => {
    const idx = OCTAVE_WHITE_INDICES[oct];
    if (idx !== undefined && keyboardScrollRef.current) {
      const offset = idx * WHITE_KEY_WIDTH;
      keyboardScrollRef.current.scrollTo({
        left: Math.max(0, offset - 150),
        behavior: 'smooth'
      });
    }
  };

  // オクターブ変更ハンドラ (テストノート音高とも同期)
  const changeTypingOctave = useCallback((updater: (prev: number) => number) => {
    setTypingOctave(prev => {
      const next = updater(prev);
      if (next !== prev && onChangeTestMidiNote) {
        const currentMidi = testMidiNote ?? 60;
        const semitone = ((currentMidi % 12) + 12) % 12;
        const newMidi = Math.max(12, Math.min(108, (next + 1) * 12 + semitone));
        onChangeTestMidiNote(newMidi);
      }
      return next;
    });
  }, [onChangeTestMidiNote, testMidiNote]);

  // ノート発音ハンドラ
  const handleNoteOn = useCallback((midiNote: number) => {
    setPressedNotes(prev => new Set(prev).add(midiNote));
    onChangeTestMidiNote?.(midiNote);

    // 合成オプション構築
    const options: SynthPlayOptions = {
      engine: effectiveEngine,
      volume: effectiveVolume,
      detune: mmlContext?.detune || 0,
    };

    // FM音色設定 (TONEエディタ編集中の音色、またはキーボード共有の音色)
    if (effectiveEngine === 'fm' && activeFmTone) {
      options.fmTone = activeFmTone;
    }

    // ピッチエンベロープ設定
    if (effectivePitchEnvData.data) {
      options.pitchEnv = effectivePitchEnvData.data;
      options.pitchEnvLoop = effectivePitchEnvData.loop;
    }

    // ボリュームエンベロープ設定
    if (effectiveVolEnvData.data) {
      options.volEnv = effectiveVolEnvData.data;
      options.volEnvLoop = effectiveVolEnvData.loop;
    }

    virtualSynth.noteOn(midiNote, options);
  }, [
    effectiveEngine,
    effectiveVolume,
    mmlContext,
    activeFmTone,
    effectivePitchEnvData,
    effectiveVolEnvData,
    onChangeTestMidiNote,
  ]);

  // ノート停止ハンドラ
  const handleNoteOff = useCallback((midiNote: number) => {
    setPressedNotes(prev => {
      const next = new Set(prev);
      next.delete(midiNote);
      return next;
    });
    virtualSynth.noteOff(midiNote);
  }, []);

  // 全音停止 (Panic)
  const handleAllNotesOff = () => {
    setPressedNotes(new Set());
    virtualSynth.allNotesOff();
  };

  // マウスイベント (ドラッグ演奏対応)
  const handleContainerMouseDown = () => {
    isMouseDownRef.current = true;
  };

  const handleContainerMouseUp = () => {
    if (isMouseDownRef.current) {
      isMouseDownRef.current = false;
      handleAllNotesOff();
    }
  };

  useEffect(() => {
    const onMouseUp = () => {
      if (isMouseDownRef.current) {
        isMouseDownRef.current = false;
        handleAllNotesOff();
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  // PCキーボード (QWERTY) 演奏の統合フック
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      // テキスト入力・エディタ操作中はキー演奏をバイパス
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable ||
        target?.closest('.monaco-editor') ||
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.tagName === 'SELECT' ||
        activeEl?.isContentEditable ||
        activeEl?.closest('.monaco-editor')
      ) {
        return;
      }

      // MMLモード時はテキスト入力と干渉するため、PCキーボード演奏・オクターブ切替を無効化
      if (activeTabContext === 'mml') {
        return;
      }

      // オクターブ切り替え (Z: -1 / X: +1)
      if (e.code === 'KeyZ') {
        changeTypingOctave(prev => Math.max(1, prev - 1));
        return;
      }
      if (e.code === 'KeyX') {
        changeTypingOctave(prev => Math.min(7, prev + 1));
        return;
      }

      // QWERTYキーによるノート発音 (右ペイン各エディタ選択中のみ有効)
      const semitone = PC_KEY_TO_SEMITONE[e.code];
      if (semitone !== undefined) {
        if (e.repeat) return;
        e.preventDefault();
        const midiNote = (typingOctave + 1) * 12 + semitone;
        if (midiNote >= 21 && midiNote <= 108) {
          handleNoteOn(midiNote);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (activeTabContext === 'mml') {
        return;
      }

      const semitone = PC_KEY_TO_SEMITONE[e.code];
      if (semitone !== undefined) {
        const midiNote = (typingOctave + 1) * 12 + semitone;
        handleNoteOff(midiNote);
      }
    };

    const handleBlur = () => {
      handleAllNotesOff();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [activeTabContext, typingOctave, handleNoteOn, handleNoteOff, changeTypingOctave]);

  return (
    <div
      className="h-full flex flex-col bg-[#14151c] select-none overflow-hidden font-mono text-xs"
    >
      {/* 1. 上部コントロール & 設定エリア */}
      <div className="h-8 px-2.5 bg-[#181922] border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0 overflow-x-auto">
        {/* 左側: コンテキスト状態 & 音源セレクタ */}
        <div className="flex items-center gap-2 shrink-0">
          {/* コンテキストバッジ */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-[10px] text-cyan-300 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>
              {activeTabContext === 'mml' && `MML CARET: ${mmlContext?.trackName || 'P1'}`}
              {activeTabContext === 'tone' && 'FM TONE EDITOR'}
              {activeTabContext === 'pitch_envelope' && 'PITCH ENV EDITOR'}
              {activeTabContext === 'vol_envelope' && 'VOL ENV EDITOR'}
            </span>
          </div>

          {/* 1) 音源切替セレクタ (CHIP) */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">CHIP:</span>
            {activeTabContext === 'tone' ? (
              <span className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.08] text-cyan-300 text-[10px] font-bold flex items-center" title="FM TONEエディタ選択中はFM音源固定">
                FM (YM2151)
              </span>
            ) : activeTabContext === 'vol_envelope' ? (
              <select
                value={effectiveEngine}
                onChange={(e) => setManualEngine(e.target.value as SoundEngineType)}
                className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                title="VOL ENVエディタ時はPSGまたはNOISEを選択可能"
              >
                <option value="psg">PSG (DCSG 矩形波)</option>
                <option value="noise">NOISE (DCSG)</option>
              </select>
            ) : activeTabContext === 'pitch_envelope' ? (
              <select
                value={effectiveEngine}
                onChange={(e) => setManualEngine(e.target.value as SoundEngineType)}
                className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                title="PITCH ENVエディタ時はFM/PSG/BEEPを選択可能"
              >
                <option value="fm">FM (YM2151)</option>
                <option value="psg">PSG (DCSG)</option>
                <option value="beep">BEEP (8253 PIT)</option>
              </select>
            ) : (
              <select
                value={manualEngine}
                onChange={(e) => setManualEngine(e.target.value as SoundEngineType | 'auto')}
                className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                title="MMLエディタ選択時は自動または手動選択"
              >
                <option value="auto">AUTO ({effectiveEngine.toUpperCase()})</option>
                <option value="psg">PSG (DCSG)</option>
                <option value="fm">FM (YM2151)</option>
                <option value="beep">BEEP (8253 PIT)</option>
                <option value="noise">NOISE (DCSG)</option>
              </select>
            )}
          </div>

          {/* 2) FM音色指定 (@VOICE: FM時のみ) */}
          {effectiveEngine === 'fm' && (
            <div className="flex items-center gap-1 pl-1 border-l border-white/[0.08]">
              <span className="text-[10px] text-zinc-500">VOICE:</span>
              {activeTabContext === 'tone' ? (
                <span className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.08] text-cyan-300 text-[10px] flex items-center font-bold" title="TONEエディタで編集中の音色">
                  @{activeFmTone?.id ?? 1}: {activeFmTone?.name ?? 'TONE'}
                </span>
              ) : (
                <select
                  value={selectedFmToneId}
                  onChange={(e) => setSelectedFmToneId(parseInt(e.target.value, 10))}
                  className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  {activeFmTone && (
                    <option value="current">@{activeFmTone.id}: {activeFmTone.name} (EDITOR)</option>
                  )}
                  {Object.entries(DEFAULT_PRESET_FM_TONES).map(([id, name]) => (
                    <option key={id} value={id}>@{id}: {name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* 3) PITCH指定 (@PE ピッチエンベロープ) */}
          <div className="flex items-center gap-1 pl-1 border-l border-white/[0.08]">
            <span className="text-[10px] text-zinc-500">PITCH:</span>
            {activeTabContext === 'pitch_envelope' ? (
              <span className="h-5 px-1.5 rounded bg-[#0c0d12] border border-cyan-500/40 text-cyan-300 text-[10px] font-bold flex items-center" title="PITCH ENVエディタのカーブを自動適用">
                @PE (EDITOR PREVIEW)
              </span>
            ) : (
              <select
                value={selectedPitchEnv}
                onChange={(e) => setSelectedPitchEnv(e.target.value)}
                className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                title="ピッチエンベロープ (@PE) を選択"
              >
                <option value="none">@PE OFF</option>
                {activePitchEnv && (
                  <option value="editor">@PE (EDITOR)</option>
                )}
                <option value="pe1">@PE1: Vib Mild</option>
                <option value="pe2">@PE2: Vib Deep</option>
                <option value="pe3">@PE3: Drop</option>
              </select>
            )}
          </div>

          {/* 4) VOLUME指定 (FM: 0-15 / PSG: 0-15 or @VE / BEEP: N/A) */}
          <div className="flex items-center gap-1 pl-1 border-l border-white/[0.08]">
            <span className="text-[10px] text-zinc-500">VOL:</span>
            {effectiveEngine === 'beep' ? (
              <span className="h-5 px-1.5 rounded bg-zinc-900 border border-white/[0.05] text-zinc-500 text-[10px] flex items-center" title="BEEP音源は音量制御不可 (1bitパルス固定)">
                <VolumeX className="w-3 h-3 mr-1 text-zinc-600" />
                N/A (BEEP 1bit)
              </span>
            ) : activeTabContext === 'vol_envelope' ? (
              <span className="h-5 px-1.5 rounded bg-[#0c0d12] border border-cyan-500/40 text-cyan-300 text-[10px] font-bold flex items-center" title="VOL ENVエディタのカーブを自動適用">
                @VE (EDITOR PREVIEW)
              </span>
            ) : (effectiveEngine === 'psg' || effectiveEngine === 'noise') ? (
              // PSG / NOISE: 直接音量 (0〜15) または @VE の選択
              <div className="flex items-center gap-1">
                <select
                  value={psgVolumeMode}
                  onChange={(e) => setPsgVolumeMode(e.target.value as 'direct' | 'env')}
                  className="h-5 px-1 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="direct">DIRECT</option>
                  <option value="env">@VE</option>
                </select>

                {psgVolumeMode === 'direct' ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min={0}
                      max={15}
                      value={effectiveVolume}
                      onChange={(e) => setManualVolume(parseInt(e.target.value, 10))}
                      className="w-14 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      title={`Volume: v${effectiveVolume}`}
                    />
                    <span className="text-[10px] text-zinc-400 w-5">v{effectiveVolume}</span>
                  </div>
                ) : (
                  <select
                    value={selectedVolEnv}
                    onChange={(e) => setSelectedVolEnv(e.target.value)}
                    className="h-5 px-1.5 rounded bg-[#0c0d12] border border-white/[0.1] text-zinc-200 text-[10px] focus:outline-none focus:border-cyan-400 cursor-pointer"
                  >
                    {activeVolEnv && (
                      <option value="editor">@VE (EDITOR)</option>
                    )}
                    <option value="1">@VE1: Piano</option>
                    <option value="2">@VE2: Organ</option>
                    <option value="3">@VE3: Pluck</option>
                  </select>
                )}
              </div>
            ) : (
              // FM: 0〜15直接指定
              <div className="flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-zinc-500" />
                <input
                  type="range"
                  min={0}
                  max={15}
                  value={effectiveVolume}
                  onChange={(e) => setManualVolume(parseInt(e.target.value, 10))}
                  className="w-16 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  title={`FM Volume: v${effectiveVolume}`}
                />
                <span className="text-[10px] text-zinc-400 w-5">v{effectiveVolume}</span>
              </div>
            )}
          </div>
        </div>

        {/* 右側: PCキーボード演奏案内 & スペースドラッグ案内 & オクターブジャンプ & Panicボタン */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* PCキーボード演奏インジケータ & オクターブ切替 (MMLモード時は無効) */}
          {activeTabContext !== 'mml' ? (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/90 border border-white/[0.08] text-[9px] text-zinc-400">
              <span className="text-zinc-500 font-semibold hidden md:inline">⌨ PC:</span>
              <span className="text-cyan-300 font-mono font-bold">A-K</span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-300 font-bold">OCT {typingOctave}</span>
              <button
                onClick={() => changeTypingOctave(o => Math.max(1, o - 1))}
                className="px-1 py-0.2 bg-[#222430] hover:bg-zinc-700 text-zinc-300 hover:text-white rounded border border-white/[0.06] cursor-pointer"
                title="オクターブ下げる (Zキー)"
              >
                Z-
              </button>
              <button
                onClick={() => changeTypingOctave(o => Math.min(7, o + 1))}
                className="px-1 py-0.2 bg-[#222430] hover:bg-zinc-700 text-zinc-300 hover:text-white rounded border border-white/[0.06] cursor-pointer"
                title="オクターブ上げる (Xキー)"
              >
                X+
              </button>
            </div>
          ) : (
            <div
              className="hidden xl:flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/40 border border-white/[0.04] text-[9px] text-zinc-600 select-none"
              title="MMLエディタ入力保護のため、PCキーボード(A-K)演奏は右ペイン各エディタ(TONE/ENV)選択時のみ有効です"
            >
              <span>⌨ PC PLAY: OFF (MML)</span>
            </div>
          )}

          <span className="text-[10px] text-zinc-500 mr-1 hidden sm:inline">OCT:</span>
          {[1, 2, 3, 4, 5, 6, 7].map(oct => {
            const isCurrentOct = mmlContext?.octave === oct;
            return (
              <button
                key={oct}
                onClick={() => handleJumpOctave(oct)}
                className={`h-5 px-1.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                  isCurrentOct
                    ? 'bg-cyan-500 text-black shadow-[0_0_6px_rgba(6,182,212,0.6)]'
                    : 'bg-[#222430] hover:bg-[#2c2e3d] text-zinc-400 hover:text-zinc-100 border border-white/[0.06]'
                }`}
                title={`Jump to Octave C${oct}`}
              >
                C{oct}
              </button>
            );
          })}

          <button
            onClick={handleAllNotesOff}
            className="h-5 px-2 ml-1.5 rounded bg-zinc-800 hover:bg-red-950/80 text-zinc-400 hover:text-red-300 border border-white/[0.08] hover:border-red-600/50 text-[10px] transition-colors cursor-pointer"
            title="All Notes Off (Panic)"
          >
            PANIC
          </button>
        </div>
      </div>

      {/* 2. 下部キーボード描画エリア (横スクロール対応) */}
      <div 
        ref={keyboardScrollRef}
        onMouseDown={handleContainerMouseDown}
        onMouseUp={handleContainerMouseUp}
        className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[#090a0f] p-1.5 scrollbar-thin scrollbar-thumb-zinc-700 select-none"
        style={{ minHeight: '80px' }}
      >
        <div 
          className="relative h-full select-none"
          style={{ width: `${TOTAL_WHITE_KEYS * WHITE_KEY_WIDTH + 16}px` }}
        >
          {/* 白鍵描画 */}
          {ALL_KEYS.filter(k => !k.isBlack).map((key) => {
            const isPressed = pressedNotes.has(key.midiNote);
            const left = key.whiteIndex * WHITE_KEY_WIDTH;
            const isC = key.name.startsWith('C') && !key.name.startsWith('C#');

            return (
              <div
                key={key.midiNote}
                data-note={key.midiNote}
                style={{
                  left: `${left}px`,
                  width: `${WHITE_KEY_WIDTH - 1}px`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isMouseDownRef.current = true;
                  handleNoteOn(key.midiNote);
                }}
                onMouseEnter={() => {
                  if (isMouseDownRef.current) {
                    handleNoteOn(key.midiNote);
                  }
                }}
                onMouseLeave={() => {
                  if (isMouseDownRef.current) {
                    handleNoteOff(key.midiNote);
                  }
                }}
                onMouseUp={() => {
                  handleNoteOff(key.midiNote);
                }}
                className={`absolute top-0 bottom-0 rounded-b border select-none z-0 flex flex-col justify-end pb-1 items-center transition-colors duration-75 cursor-pointer ${
                  isPressed
                    ? 'bg-gradient-to-t from-cyan-400 to-cyan-200 border-cyan-300 shadow-[inset_0_3px_6px_rgba(0,0,0,0.35),0_0_14px_rgba(34,211,238,0.9)] z-10 translate-y-1'
                    : isC
                      ? 'bg-zinc-100 hover:bg-white border-zinc-400/80 active:translate-y-1'
                      : 'bg-zinc-200 hover:bg-zinc-100 border-zinc-400/60 active:translate-y-1'
                }`}
              >
                {/* PCキーボード対応キー文字ガイド (右ペイン各エディタ選択中のみ表示) */}
                {activeTabContext !== 'mml' && (() => {
                  const diff = key.midiNote - ((typingOctave + 1) * 12);
                  const pcKey = SEMITONE_TO_KEY_LABEL[diff];
                  if (!pcKey) return null;
                  return (
                    <span className={`text-[8px] font-mono font-bold select-none ${
                      isPressed ? 'text-black' : 'text-cyan-700/80 font-semibold'
                    }`}>
                      {pcKey}
                    </span>
                  );
                })()}

                {/* C音にはオクターブラベル表示 */}
                {isC && (
                  <span className={`text-[9px] font-extrabold tracking-tighter ${
                    isPressed ? 'text-black' : 'text-zinc-600'
                  }`}>
                    {key.name}
                  </span>
                )}
              </div>
            );
          })}

          {/* 黒鍵描画 */}
          {ALL_KEYS.filter(k => k.isBlack).map((key) => {
            const isPressed = pressedNotes.has(key.midiNote);
            const left = (key.whiteIndex + 1) * WHITE_KEY_WIDTH - (BLACK_KEY_WIDTH / 2);

            return (
              <div
                key={key.midiNote}
                data-note={key.midiNote}
                style={{
                  left: `${left}px`,
                  width: `${BLACK_KEY_WIDTH}px`,
                  height: '62%',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isMouseDownRef.current = true;
                  handleNoteOn(key.midiNote);
                }}
                onMouseEnter={() => {
                  if (isMouseDownRef.current) {
                    handleNoteOn(key.midiNote);
                  }
                }}
                onMouseLeave={() => {
                  if (isMouseDownRef.current) {
                    handleNoteOff(key.midiNote);
                  }
                }}
                onMouseUp={() => {
                  handleNoteOff(key.midiNote);
                }}
                className={`absolute top-0 rounded-b border select-none z-20 flex flex-col justify-end pb-1 items-center shadow-md transition-colors duration-75 cursor-pointer ${
                  isPressed
                    ? 'bg-gradient-to-t from-cyan-500 to-cyan-300 border-cyan-200 shadow-[inset_0_3px_6px_rgba(0,0,0,0.6),0_0_14px_rgba(6,182,212,0.9)] translate-y-1'
                    : 'bg-[#181920] hover:bg-[#252834] border-black/80 active:translate-y-1'
                }`}
              >
                {/* PCキーボード対応キー文字ガイド (右ペイン各エディタ選択中のみ表示) */}
                {activeTabContext !== 'mml' ? (() => {
                  const diff = key.midiNote - ((typingOctave + 1) * 12);
                  const pcKey = SEMITONE_TO_KEY_LABEL[diff];
                  if (!pcKey) return <span className="w-1 h-2 rounded-full bg-zinc-600/40 mb-0.5" />;
                  return (
                    <span className={`text-[8px] font-mono font-bold select-none ${
                      isPressed ? 'text-black' : 'text-cyan-300/90'
                    }`}>
                      {pcKey}
                    </span>
                  );
                })() : (
                  <span className="w-1 h-2 rounded-full bg-zinc-600/40 mb-0.5" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
