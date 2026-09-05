import { Settings, Construction, Music, Keyboard, Volume2, Palette, Sparkles, Cpu } from 'lucide-react';
import { AudioEngineMode } from '../core/player/AudioEngine';

interface SettingsPanelProps {
  onGoToSongSetup?: () => void;
  /** 現在の演奏エンジン (未指定時はパネルのみ表示)。 */
  playbackMode?: AudioEngineMode;
  /** 演奏エンジン切替を反映する。 */
  onChangePlaybackMode?: (mode: AudioEngineMode) => void;
}

/** 演奏エンジンの選択肢 (表示名 + 説明)。 */
const playbackEngineOptions: ReadonlyArray<{
  mode: AudioEngineMode;
  label: string;
  description: string;
}> = [
  {
    mode: AudioEngineMode.SourceInterpreter,
    label: 'SOURCE INTERPRETER',
    description: 'C# 版リファレンス実装 (TS 移植) が MZSD データを直接解釈します。安定・低負荷。',
  },
  {
    mode: AudioEngineMode.Z80Driver,
    label: 'Z80 DRIVER',
    description: '内蔵 Z80 コア上で MzSD ドライバを実行します。実機ドライバと同一経路で演奏します。',
  },
];

export function SettingsPanel({ onGoToSongSetup, playbackMode, onChangePlaybackMode }: SettingsPanelProps) {
  return (
    <div className="flex flex-col h-full bg-[#1E1E1E] p-5 overflow-y-auto font-mono text-xs select-none text-zinc-300">
      {/* 設定ヘッダー */}
      <div className="flex justify-between items-center mb-5 pb-2.5 border-b border-[#3C3C3C]">
        <h2 className="text-xs font-bold text-zinc-100 tracking-wider flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-zinc-400" />
          APPLICATION PREFERENCES
        </h2>
        <span className="px-2 py-0.5 rounded-full bg-[#3A3A3A] text-zinc-300 text-[10px] font-medium border border-[#484848]">
          PREVIEW
        </span>
      </div>

      <div className="flex flex-col gap-6 max-w-xl">
        {/* 演奏エンジン切替 (有効な設定項目) */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-400 tracking-wider mb-2 flex items-center gap-1.5 border-b border-[#333333] pb-1">
            <Cpu className="w-3.5 h-3.5 text-zinc-500" />
            <span>PLAYBACK ENGINE</span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {playbackEngineOptions.map((option) => {
              const isActive = playbackMode !== undefined && playbackMode === option.mode;
              return (
                <button
                  key={option.mode}
                  onClick={() => onChangePlaybackMode?.(option.mode)}
                  disabled={playbackMode === undefined}
                  className={`p-3 rounded border text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#00A8FF]/10 border-[#00A8FF]/60'
                      : 'bg-[#242424] border-[#3A3A3A] hover:border-[#484848] hover:bg-[#282828]'
                  }`}
                  title={`演奏エンジンを ${option.label} に切り替える (次の PLAY から適用)`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-bold tracking-wide ${isActive ? 'text-[#00A8FF]' : 'text-zinc-200'}`}>
                      {option.label}
                    </span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00A8FF] shadow-[0_0_5px_#00A8FF]" />
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-400 leading-relaxed">{option.description}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-2 text-[10px] text-zinc-500">
            ※ 切替は次回の PLAY (Ctrl+Enter) から適用されます。演奏中は STOP してから切り替えてください。
          </div>
        </div>

        {/* メイン案内カード (UNDER DEVELOPMENT) */}
        <div className="p-5 rounded-lg border border-dashed border-[#484848] bg-[#252525] flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-full bg-[#303030] border border-[#444444] flex items-center justify-center mb-3 text-amber-400 shadow-inner">
            <Construction className="w-5 h-5" />
          </div>

          <h3 className="text-xs font-bold text-zinc-100 tracking-wide mb-1.5 flex items-center gap-1.5">
            <span>アプリ環境設定は将来バージョンで実装予定です</span>
          </h3>

          <p className="text-[11px] text-zinc-400 max-w-md leading-relaxed mb-4">
            本タブでは、エディタのキーバインドやシンタックステーマ、MIDI入力デバイスなどのIDE共通環境設定を将来的に提供予定です。現在開発準備中のため設定項目は固定されています。
          </p>

          {/* 楽曲設定への誘導バナー */}
          <div className="w-full p-3.5 rounded bg-[#1E1E1E] border border-[#3A3A3A] flex items-center justify-between text-left">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-[#00A8FF]/15 border border-[#00A8FF]/30 flex items-center justify-center shrink-0">
                <Music className="w-3.5 h-3.5 text-[#00A8FF]" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-zinc-200">
                  楽曲に関する設定（#TITLE, #OPM, #OCTAVE 等）をお探しですか？
                </div>
                <div className="text-[10px] text-zinc-400">
                  曲ごとのヘッダーディレクティブは「SONG SETUP」タブで設定可能です。
                </div>
              </div>
            </div>
            {onGoToSongSetup && (
              <button
                onClick={onGoToSongSetup}
                className="h-6 px-2.5 rounded bg-[#333333] hover:bg-[#3D3D3D] text-[#00A8FF] hover:text-[#33BFFF] border border-[#484848] text-[10px] font-bold transition-colors cursor-pointer shrink-0 ml-3"
              >
                SONG SETUP を開く ➔
              </button>
            )}
          </div>
        </div>

        {/* 将来実装予定の機能ロードマップ一覧 */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-400 tracking-wider mb-2 flex items-center gap-1.5 border-b border-[#333333] pb-1">
            <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
            <span>PLANNED PREFERENCE MODULES (実装予定項目)</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {/* 項目 1: キーバインド */}
            <div className="p-3 rounded border border-[#333333] bg-[#242424] flex items-center justify-between opacity-80">
              <div className="flex items-center gap-2.5">
                <Keyboard className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="text-xs font-semibold text-zinc-200">KEYBINDINGS & SHORTCUTS</div>
                  <div className="text-[10px] text-zinc-400">VS Code / Sublime / Emacs 風キーバインドの切替機能</div>
                </div>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded bg-[#2E2E2E] text-zinc-400 border border-[#404040]">
                COMING SOON
              </span>
            </div>

            {/* 項目 2: テーマ & カラー */}
            <div className="p-3 rounded border border-[#333333] bg-[#242424] flex items-center justify-between opacity-80">
              <div className="flex items-center gap-2.5">
                <Palette className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="text-xs font-semibold text-zinc-200">THEMES & SYNTAX COLORS</div>
                  <div className="text-[10px] text-zinc-400">エディタ配色のカスタマイズ、フォント変更</div>
                </div>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded bg-[#2E2E2E] text-zinc-400 border border-[#404040]">
                COMING SOON
              </span>
            </div>

            {/* 項目 3: オーディオ & MIDI デバイス */}
            <div className="p-3 rounded border border-[#333333] bg-[#242424] flex items-center justify-between opacity-80">
              <div className="flex items-center gap-2.5">
                <Volume2 className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="text-xs font-semibold text-zinc-200">AUDIO & MIDI HARDWARE ROUTING</div>
                  <div className="text-[10px] text-zinc-400">外部MIDIキーボード入力、オーディオ出力先デバイス選択</div>
                </div>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded bg-[#2E2E2E] text-zinc-400 border border-[#404040]">
                COMING SOON
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
