import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { allTracks } from '../core/mml/TrackId';
import type { MmlMap } from '../core/mml/MmlMap';

/** 演奏位置 → MML 対応情報 (コンパイル成功時に App から渡される)。 */
export interface PlaybackMapInfo {
  map: MmlMap | null;

  source: string;
}

interface ChannelState {
  id: string;
  trackId: string;        // F1, P1, N1, B1 など
  subLabel: string;       // FM1, PSG1, Noise1, BEEP など
  type: 'FM' | 'DCSG' | 'NOISE' | 'BEEP';
  note: string;
  level: number;          // 0-100 (VUメーター)
  active: boolean;        // 現在音が鳴っているか
  previewEnabled: boolean;// プレビュー発音ON/OFF (MMLコンパイル非連動)
  extra?: string;
}

const generateInitialChannels = (): ChannelState[] => {
  const channels: ChannelState[] = [];

  // YM2151 (8ch): F1 FM1 ～ F8 FM8
  for (let i = 1; i <= 8; i++) {
    channels.push({
      id: `fm-${i}`,
      trackId: `F${i}`,
      subLabel: `FM${i}`,
      type: 'FM',
      note: '---  ',
      level: 0,
      active: false,
      previewEnabled: true,
    });
  }

  // DCSG 1 (SN76489): P1 PSG1 ～ P3 PSG3, N1 Noise1
  for (let i = 1; i <= 3; i++) {
    channels.push({
      id: `dcsg-A-tone-${i}`,
      trackId: `P${i}`,
      subLabel: `PSG${i}`,
      type: 'DCSG',
      note: '---  ',
      level: 0,
      active: false,
      previewEnabled: true,
    });
  }
  channels.push({
    id: `dcsg-A-noise`,
    trackId: `N1`,
    subLabel: `Noise1`,
    type: 'NOISE',
    note: '---  ',
    level: 0,
    active: false,
    previewEnabled: true,
  });

  // DCSG 2 (SN76489): P4 PSG4 ～ P6 PSG6, N2 Noise2
  for (let i = 1; i <= 3; i++) {
    const pNum = i + 3;
    channels.push({
      id: `dcsg-B-tone-${i}`,
      trackId: `P${pNum}`,
      subLabel: `PSG${pNum}`,
      type: 'DCSG',
      note: '---  ',
      level: 0,
      active: false,
      previewEnabled: true,
    });
  }
  channels.push({
    id: `dcsg-B-noise`,
    trackId: `N2`,
    subLabel: `Noise2`,
    type: 'NOISE',
    note: '---  ',
    level: 0,
    active: false,
    previewEnabled: true,
  });

  // BEEP: B1 BEEP
  channels.push({
    id: `beep-1`,
    trackId: `B1`,
    subLabel: `BEEP`,
    type: 'BEEP',
    note: '---  ',
    level: 0,
    active: false,
    previewEnabled: true,
  });

  return channels;
};

/** トラック記号 (P1, N1, B1, F1 等) → 17 トラックのインデックス (0-16)。 */
function trackIndexOf(trackId: string): number {
  return allTracks.find((track) => track.id === trackId)?.index ?? -1;
}

/** 演奏位置 (データオフセット) に対応する MML 上のノート文字列を取り出す。 */
function resolveTrackNote(
  info: PlaybackMapInfo | null | undefined,
  trackId: string,
  offset: number,
): string | null {
  if (!info?.map || offset < 0) {
    return null;
  }

  const mapTrack = info.map.tracks.find((track) => track.id === trackId);
  if (!mapTrack || mapTrack.events.length === 0) {
    return null;
  }

  const relative = offset - mapTrack.offset;
  let current = mapTrack.events[0];
  for (const event of mapTrack.events) {
    if (event.offset > relative) {
      break;
    }

    current = event;
  }

  const line = info.source.split(/\r?\n/)[current.line - 1] ?? '';
  const start = Math.max(0, current.column - 1);
  const text = line.slice(start, start + current.length).trim();
  return text !== '' ? text : null;
}

interface ChannelRowProps {
  ch: ChannelState;
  onTogglePreview: (id: string) => void;
}

const ChannelRow = ({ ch, onTogglePreview }: ChannelRowProps) => {
  const isPlaying = ch.active && ch.previewEnabled;

  return (
    <div className={`flex items-center gap-2.5 py-1 px-2 border-b border-[#363636] rounded transition-colors group ${
      ch.previewEnabled ? 'hover:bg-white/[0.03] opacity-100' : 'opacity-40'
    }`}>
      {/* プレビュー発音トグルボタン (スピーカーアイコン) */}
      <button
        onClick={() => onTogglePreview(ch.id)}
        className={`w-5.5 h-5.5 flex items-center justify-center rounded border transition-colors shrink-0 cursor-pointer ${
          !ch.previewEnabled
            ? 'bg-[#1A1A1A] border-[#333333] text-zinc-600 hover:text-zinc-400'
            : isPlaying
            ? 'text-[#00A8FF] bg-[#222222] border-[#00A8FF]/60 shadow-[0_0_6px_rgba(0,168,255,0.3)]'
            : 'text-zinc-400 bg-[#252525] border-[#3C3C3C] hover:text-zinc-200 hover:bg-[#303030]'
        }`}
        title={ch.previewEnabled ? `Preview Enabled (${ch.trackId}): Click to mute` : `Preview Muted (${ch.trackId}): Click to enable`}
      >
        {ch.previewEnabled ? (
          <Volume2 className="w-3.5 h-3.5" />
        ) : (
          <VolumeX className="w-3.5 h-3.5" />
        )}
      </button>

      {/* トラック名・サブラベル */}
      <div className="flex items-center gap-1.5 w-22 shrink-0 font-mono">
        <span className={`inline-flex items-center justify-center min-w-[26px] h-[20px] px-1 rounded text-[11px] font-semibold border tracking-wide transition-colors ${
          ch.previewEnabled 
            ? 'bg-[#1E1E1E] text-zinc-200 border-[#3C3C3C]' 
            : 'bg-[#181818] text-zinc-600 border-[#2A2A2A]'
        }`}>
          {ch.trackId}
        </span>
        <span className={`text-[10px] tracking-tight uppercase ${
          ch.previewEnabled ? 'text-zinc-400' : 'text-zinc-600'
        }`}>
          {ch.subLabel}
        </span>
      </div>

      {/* ノート/音程 */}
      <div className={`w-12 text-xs font-mono font-medium tracking-tight ${
        isPlaying 
          ? 'text-zinc-100 font-semibold' 
          : 'text-zinc-500'
      }`}>
        {ch.previewEnabled ? ch.note : 'MUTE '}
      </div>
      
      {/* VUメーター: 発音時のみクリアブルー、無音時は暗いグレーに沈静化 */}
      <div className="flex-1 h-2.5 bg-[#181818] rounded overflow-hidden flex items-center border border-[#353535]">
        <div 
          className="h-full transition-all duration-75 ease-out relative rounded-xs"
          style={{ 
            width: ch.previewEnabled ? `${ch.level}%` : '0%',
            backgroundColor: isPlaying ? '#00A8FF' : '#3F3F46',
            opacity: isPlaying ? 1 : 0.4
          }}
        />
      </div>
      
      {/* 付加情報 (ALG / NOISEタイプ等) */}
      <div className="w-12 text-right text-[10px] text-zinc-400 font-mono tracking-tight shrink-0">
        {ch.extra || ''}
      </div>
    </div>
  );
};

interface TrackMonitorProps {
  enableYM2151?: boolean;
  /** 演奏中か (Player の再生状態)。 */
  isPlaying?: boolean;
  /** トラックの VU レベル取得 (0-1)。 */
  getTrackLevel?: (trackIndex: number) => number;
  /** マスターの VU レベル取得 (0-1)。 */
  getMasterLevel?: () => number;
  /** トラックの現在データオフセット取得 (演奏位置ハイライト用、停止中は -1)。 */
  getTrackOffset?: (trackIndex: number) => number;
  /** トラックのプレビュー ON/OFF (ミュート) を Player へ反映する。 */
  onTrackMuteChange?: (trackIndex: number, muted: boolean) => void;
  /** マスター音量 / ミュートを Player へ反映する (プレビュー専用・コンパイル非連動)。 */
  onMasterVolumeChange?: (volume: number, muted: boolean) => void;
  /** 演奏位置 → MML 対応情報。 */
  playbackMap?: PlaybackMapInfo | null;
}

export function TrackMonitor({
  enableYM2151 = true,
  isPlaying = false,
  getTrackLevel,
  getMasterLevel,
  getTrackOffset,
  onTrackMuteChange,
  onMasterVolumeChange,
  playbackMap = null,
}: TrackMonitorProps) {
  const [channels, setChannels] = useState<ChannelState[]>(generateInitialChannels());
  const [masterVolume, setMasterVolume] = useState<number>(80);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [masterVU, setMasterVU] = useState<{ l: number; r: number }>({ l: 0, r: 0 });

  // ポーリング内で参照する最新 props (stale closure 回避)
  const providersRef = useRef({ isPlaying, getTrackLevel, getMasterLevel, getTrackOffset, playbackMap });
  useEffect(() => {
    providersRef.current = { isPlaying, getTrackLevel, getMasterLevel, getTrackOffset, playbackMap };
  });

  // マスター音量 / ミュートを Player へ反映 (プレビュー専用パラメータ、コンパイル・エクスポートには影響しない)
  useEffect(() => {
    onMasterVolumeChange?.(masterVolume / 100, isMuted);
  }, [masterVolume, isMuted, onMasterVolumeChange]);

  // VU / 演奏位置を Player からポーリングして反映 (100ms 間隔)
  useEffect(() => {
    const timer = setInterval(() => {
      const providers = providersRef.current;
      if (!providers.isPlaying || !providers.getTrackLevel) {
        // 停止中: メーターを沈静化する (すでに沈静化済みなら再レンダリングしない)
        setChannels(prev => {
          if (!prev.some(ch => ch.level !== 0 || ch.active || ch.note !== '---  ')) {
            return prev;
          }

          return prev.map(ch => ({ ...ch, level: 0, active: false, note: '---  ' }));
        });
        setMasterVU(prev => (prev.l === 0 && prev.r === 0 ? prev : { l: 0, r: 0 }));
        return;
      }

      const trackLevel = providers.getTrackLevel;
      setChannels(prev => prev.map(ch => {
        const trackIndex = trackIndexOf(ch.trackId);
        if (trackIndex < 0) return ch;
        const level01 = trackLevel(trackIndex);
        const offset = providers.getTrackOffset?.(trackIndex) ?? -1;
        const note = resolveTrackNote(providers.playbackMap, ch.trackId, offset) ?? '---  ';
        return { ...ch, level: Math.round(level01 * 100), active: level01 >= 0.01, note };
      }));

      const master01 = providers.getMasterLevel?.() ?? 0;
      const meter = Math.round(Math.min(1, master01) * 100);
      setMasterVU({ l: meter, r: meter });
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const handleTogglePreview = (id: string) => {
    setChannels(prev => prev.map(ch => {
      if (ch.id !== id) return ch;
      const nextEnabled = !ch.previewEnabled;
      const trackIndex = trackIndexOf(ch.trackId);
      if (trackIndex >= 0) {
        onTrackMuteChange?.(trackIndex, !nextEnabled);
      }
      return { ...ch, previewEnabled: nextEnabled };
    }));
  };

  const setAllPreview = (enabled: boolean, typeFilter?: 'FM' | 'DCSG_GROUP') => {
    setChannels(prev => prev.map(ch => {
      if (typeFilter === 'FM' && ch.type !== 'FM') return ch;
      if (typeFilter === 'DCSG_GROUP' && ch.type === 'FM') return ch;
      const trackIndex = trackIndexOf(ch.trackId);
      if (trackIndex >= 0) {
        onTrackMuteChange?.(trackIndex, !enabled);
      }
      return { ...ch, previewEnabled: enabled };
    }));
  };

  const fmChannels = channels.filter(ch => ch.type === 'FM');
  const dcsg1Channels = channels.filter(ch => ['P1', 'P2', 'P3', 'N1'].includes(ch.trackId));
  const dcsg2Channels = channels.filter(ch => ['P4', 'P5', 'P6', 'N2'].includes(ch.trackId));
  const beepChannels = channels.filter(ch => ch.type === 'BEEP');

  return (
    <div className="flex flex-col h-full bg-[#1E1E1E] p-3.5 overflow-y-auto font-mono text-zinc-300 gap-3">
      {/* ヘッダー Bento Bar: タイトル & マスターボリューム */}
      <div className="flex flex-wrap justify-between items-center gap-3 bg-[#2D2D2D] px-3.5 py-2.5 rounded-lg border border-[#3C3C3C] shrink-0 shadow-xs">
        {/* タイトル領域 */}
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-semibold text-zinc-100 tracking-wide">
            TRACK MONITOR
          </h2>
          <span className="px-2 py-0.5 rounded-full bg-[#3A3A3A] text-zinc-200 text-[10px] font-medium tracking-tight">
            {enableYM2151 ? '17 CH' : '9 CH (MZ-1500 BASICS)'}
          </span>
        </div>

        {/* マスターボリューム コントロール */}
        <div className="flex items-center gap-3 bg-[#222222] border border-[#3C3C3C] px-3 py-1.5 rounded">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-zinc-300 tracking-wide">
                MASTER VOL
              </span>
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#353535] text-zinc-400 tracking-tight font-medium">
                PREVIEW
              </span>
            </div>
          </div>

          {/* MUTE ボタン */}
          <button
            onClick={() => setIsMuted(prev => !prev)}
            className={`h-5.5 px-2 text-[10px] font-medium rounded border transition-colors cursor-pointer ${
              isMuted
                ? 'bg-[#3A3A3A] text-red-400 border-red-500/60 shadow-xs font-bold'
                : 'bg-[#2E2E2E] text-zinc-400 border-[#404040] hover:text-zinc-200 hover:bg-[#383838]'
            }`}
            title="Mute Preview Output"
          >
            {isMuted ? 'MUTED' : 'MUTE'}
          </button>

          {/* スライダー */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : masterVolume}
              disabled={isMuted}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              className="w-20 h-1.5 bg-[#181818] rounded-lg appearance-none cursor-pointer accent-[#00A8FF] disabled:opacity-25"
            />
            <span className="w-8 text-right text-xs font-semibold text-zinc-200 font-mono">
              {isMuted ? '0%' : `${masterVolume}%`}
            </span>
          </div>

          {/* 小型 Master L/R メーター */}
          <div className="flex flex-col gap-0.5 pl-2 border-l border-[#3C3C3C] w-11">
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 font-bold">L</span>
              <div className="flex-1 h-1 bg-[#181818] rounded-xs overflow-hidden">
                <div 
                  className="h-full bg-[#00A8FF] transition-all duration-75"
                  style={{ width: `${masterVU.l}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 font-bold">R</span>
              <div className="flex-1 h-1 bg-[#181818] rounded-xs overflow-hidden">
                <div 
                  className="h-full bg-[#00A8FF] transition-all duration-75"
                  style={{ width: `${masterVU.r}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* チャンネルリスト (左右 2-Column Bento Cards) */}
      <div className="flex flex-col md:flex-row gap-3 flex-1">
        {/* 左カラム: MZ-1500 BASICS (DCSG 1, DCSG 2, BEEP) */}
        <div className="flex-1 flex flex-col bg-[#2D2D2D] p-3 rounded-lg border border-[#3C3C3C] shadow-xs">
          {/* パネル共通ヘッダー */}
          <div className="flex items-center justify-between text-xs text-zinc-300 font-medium mb-2.5 tracking-wide border-b border-[#3C3C3C] pb-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100">MZ-1500 BASICS</span>
              <span className="px-1.5 py-0.2 rounded-full bg-[#3A3A3A] text-zinc-300 text-[9px] font-medium">STANDARD 9ch</span>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setAllPreview(true, 'DCSG_GROUP')} 
                className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                title="Enable all DCSG & BEEP channels"
              >
                ALL ON
              </button>
              <button 
                onClick={() => setAllPreview(false, 'DCSG_GROUP')} 
                className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-400 hover:text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                title="Mute all DCSG & BEEP channels"
              >
                MUTE
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {/* サブカテゴリ 1: DCSG 1 (SN76489) */}
            <div>
              <div className="flex items-center justify-between px-2 py-0.5 mb-1 bg-[#232323] rounded border border-[#383838]/70 text-[10px] text-zinc-300 font-medium">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-xs bg-[#00A8FF]/80" />
                  <span className="font-semibold text-zinc-200">DCSG 1 (SN76489)</span>
                </div>
                <span className="text-[9px] text-zinc-400 font-mono">PSG 1-3 & Noise 1</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {dcsg1Channels.map(ch => (
                  <ChannelRow 
                    key={ch.id} 
                    ch={ch} 
                    onTogglePreview={handleTogglePreview} 
                  />
                ))}
              </div>
            </div>

            {/* サブカテゴリ 2: DCSG 2 (SN76489) */}
            <div>
              <div className="flex items-center justify-between px-2 py-0.5 mb-1 bg-[#232323] rounded border border-[#383838]/70 text-[10px] text-zinc-300 font-medium">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-xs bg-[#00A8FF]/80" />
                  <span className="font-semibold text-zinc-200">DCSG 2 (SN76489)</span>
                </div>
                <span className="text-[9px] text-zinc-400 font-mono">PSG 4-6 & Noise 2</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {dcsg2Channels.map(ch => (
                  <ChannelRow 
                    key={ch.id} 
                    ch={ch} 
                    onTogglePreview={handleTogglePreview} 
                  />
                ))}
              </div>
            </div>

            {/* サブカテゴリ 3: BEEP */}
            <div>
              <div className="flex items-center justify-between px-2 py-0.5 mb-1 bg-[#232323] rounded border border-[#383838]/70 text-[10px] text-zinc-300 font-medium">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-xs bg-amber-400/80" />
                  <span className="font-semibold text-zinc-200">BEEP</span>
                </div>
                <span className="text-[9px] text-zinc-400 font-mono">1-bit Pulse (8253 Timer)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {beepChannels.map(ch => (
                  <ChannelRow 
                    key={ch.id} 
                    ch={ch} 
                    onTogglePreview={handleTogglePreview} 
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右カラム: YM2151 (ACZ-8BS1MZ / F1～F8) */}
        <div className="flex-1 flex flex-col gap-0.5 bg-[#2D2D2D] p-3 rounded-lg border border-[#3C3C3C] shadow-xs">
          <div className="flex items-center justify-between text-xs text-zinc-300 font-medium mb-1.5 tracking-wide border-b border-[#3C3C3C] pb-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100">YM2151 (ACZ-8BS1MZ)</span>
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                enableYM2151 
                  ? 'bg-[#3A3A3A] text-zinc-200' 
                  : 'bg-[#252525] text-zinc-500'
              }`}>
                {enableYM2151 ? '8 CHANNELS' : 'DISABLED'}
              </span>
            </div>
            {enableYM2151 && (
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setAllPreview(true, 'FM')} 
                  className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                  title="Enable all FM channels"
                >
                  ALL ON
                </button>
                <button 
                  onClick={() => setAllPreview(false, 'FM')} 
                  className="h-5 px-2 text-[10px] font-medium bg-[#383838] hover:bg-[#444444] text-zinc-400 hover:text-zinc-200 rounded border border-[#484848] transition-colors cursor-pointer"
                  title="Mute all FM channels"
                >
                  MUTE
                </button>
              </div>
            )}
          </div>
          {enableYM2151 ? (
            fmChannels.map(ch => (
              <ChannelRow 
                key={ch.id} 
                ch={ch} 
                onTogglePreview={handleTogglePreview} 
              />
            ))
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#3C3C3C] rounded-lg p-6 text-center my-2 bg-[#1E1E1E]">
              <div className="text-zinc-300 text-xs font-semibold mb-1">ACZ-8BS1MZ OPTION BOARD NOT INSTALLED</div>
              <p className="text-[10px] text-zinc-500 max-w-xs leading-relaxed">
                ACZ-8BS1MZ (YM2151 FM sound board by @poyokoma_danna) is currently disabled in the SONG SETUP tab.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
