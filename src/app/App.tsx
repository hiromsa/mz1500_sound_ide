import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  Download, 
  Sliders, 
  AudioWaveform, 
  TrendingUp, 
  LineChart, 
  Music,
  Settings,
  Repeat 
} from 'lucide-react';
import { MmlEditor } from '../view/MmlEditor';
import { TrackMonitor, type PlaybackMapInfo } from '../view/TrackMonitor';
import { SettingsPanel } from '../view/SettingsPanel';
import { SongSetupPanel, type SongMetadata } from '../view/SongSetupPanel';
import { VolEnvelopeEditor } from '../view/VolEnvelopeEditor';
import { PitchEnvelopeEditor } from '../view/PitchEnvelopeEditor';
import { FmToneEditor } from '../view/FmToneEditor';
import { MmlCompiler } from '../core/mml/MmlCompiler';
import type { MmlDiagnostic } from '../core/mml/TrackId';
import { DiagnosticSeverity } from '../core/mml/TrackId';
import { AudioEngineMode } from '../core/player/AudioEngine';
import { Player } from '../core/player/Player';
import { Z80DriverImage } from '../core/player/Z80DriverImage';
import { buildQuickDiskImage } from '../core/export/QdfImageBuilder';
import type { FmToneData } from '../core/fm/FmTone';
import type { CompileErrorItem } from '../view/CompileErrorPanel';
import type { ActiveTabContext } from '../view/VirtualKeyboard';
import type { editor } from 'monaco-editor';
import mz1500Logo from '../assets/mz1500logo.svg';

type RightTab = 'track' | 'tone' | 'vol_envelope' | 'pitch_envelope' | 'song_setup' | 'settings';

/** コンパイル診断を PROBLEMS パネル用の項目へ変換する。 */
function toCompileErrorItems(
  diagnostics: readonly MmlDiagnostic[],
  sourceFile: string,
): CompileErrorItem[] {
  return diagnostics.map((diagnostic, index) => ({
    id: `compile-${index}-${diagnostic.line}-${diagnostic.column}`,
    severity: diagnostic.severity === DiagnosticSeverity.Error ? 'error' : 'warning',
    line: diagnostic.line,
    column: diagnostic.column,
    message: diagnostic.message,
    sourceFile,
  }));
}

/** QD のファイル名に使える ASCII 文字列へ正規化する (非 ASCII はアンダースコア)。 */
function sanitizeFileName(name: string): string {
  const normalized = [...name]
    .map((ch) => (/[A-Za-z0-9 _-]/.test(ch) ? ch : '_'))
    .join('')
    .trim();

  return normalized.slice(0, 16);
}

/** 演奏エンジンの表示名。 */
function playbackModeLabel(mode: AudioEngineMode): string {
  return mode === AudioEngineMode.Z80Driver ? 'Z80 DRIVER' : 'SOURCE INTERPRETER';
}

function App() {
  // 左右ペインの幅比率 (%)
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLElement>(null);

  // 右ペインの表示/非表示ステート
  const [showRightPane, setShowRightPane] = useState<boolean>(true);

  // 右ペインのアクティブタブ
  const [activeRightTab, setActiveRightTab] = useState<RightTab>('track');

  // 各エディタの最新データ (バーチャルキーボード共有用)
  const [activeFmTone, setActiveFmTone] = useState<FmToneData | undefined>(undefined);
  const [activePitchEnv, setActivePitchEnv] = useState<number[] | undefined>(undefined);
  const [activePitchEnvLoop, setActivePitchEnvLoop] = useState<number | undefined>(undefined);
  const [activeVolEnv, setActiveVolEnv] = useState<number[] | undefined>(undefined);
  const [activeVolEnvLoop, setActiveVolEnvLoop] = useState<number | undefined>(undefined);

  // MML右クリックメニューから各エディタに渡す「ロードID」 (null = リセット)
  const [loadToneId, setLoadToneId] = useState<number | null>(null);
  const [loadVolEnvId, setLoadVolEnvId] = useState<number | null>(null);
  const [loadPitchEnvId, setLoadPitchEnvId] = useState<number | null>(null);

  // Monaco Editor インスタンス参照 (MMLスニペット挿入用)
  const monacoEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // 右クリックメニュー: FM TONE 編集リクエスト
  const handleRequestEditTone = useCallback((id: number) => {
    setLoadToneId(id);
    setActiveRightTab('tone');
    setShowRightPane(true);
  }, []);

  // 右クリックメニュー: VOL ENV 編集リクエスト
  const handleRequestEditVolEnv = useCallback((id: number) => {
    setLoadVolEnvId(id);
    setActiveRightTab('vol_envelope');
    setShowRightPane(true);
  }, []);

  // 右クリックメニュー: PITCH ENV 編集リクエスト
  const handleRequestEditPitchEnv = useCallback((id: number) => {
    setLoadPitchEnvId(id);
    setActiveRightTab('pitch_envelope');
    setShowRightPane(true);
  }, []);

  // 右クリックメニュー: 新規作成 (新IDをそのままロードする)
  const handleRequestNewTone = useCallback((newId: number) => {
    setLoadToneId(newId);
    setActiveRightTab('tone');
    setShowRightPane(true);
  }, []);

  const handleRequestNewVolEnv = useCallback((newId: number) => {
    setLoadVolEnvId(newId);
    setActiveRightTab('vol_envelope');
    setShowRightPane(true);
  }, []);

  const handleRequestNewPitchEnv = useCallback((newId: number) => {
    setLoadPitchEnvId(newId);
    setActiveRightTab('pitch_envelope');
    setShowRightPane(true);
  }, []);

  // 「MMLに反映」ボタン: カーソル位置にスニペットを挿入
  const handleApplyToMml = useCallback((mmlSnippet: string, _id: number) => {
    const ed = monacoEditorRef.current;
    if (!ed) return;
    const selection = ed.getSelection();
    const pos = ed.getPosition();
    if (!pos) return;
    const range = selection && !selection.isEmpty()
      ? selection
      : { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column };
    ed.executeEdits('apply-mml', [{ range, text: '\n' + mmlSnippet + '\n' }]);
    ed.focus();
  }, []);


  // 現在フォーカスされている領域 ('mml' | 'rightPane')
  const [focusedPane, setFocusedPane] = useState<'mml' | 'rightPane'>('mml');

  // 現在のアクティブコンテキスト判定 (MMLエディタ選択時は常にMMLコンテキスト、右ペイン選択時はそのエディタ)
  const activeTabContext: ActiveTabContext = (focusedPane === 'mml' || !showRightPane || activeRightTab === 'track' || activeRightTab === 'song_setup' || activeRightTab === 'settings')
    ? 'mml'
    : (activeRightTab as ActiveTabContext);

  // 再生ステート (PLAY / STOP 連動)
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // 無限ループ (Lコマンド) 有効/無効ステート (デフォルト ON)
  const [isLoopEnabled, setIsLoopEnabled] = useState<boolean>(true);

  // 演奏エンジン (SourceInterpreter = リファレンス実装 / Z80Driver = 内蔵 Z80 コアでドライバ実行)
  const [playbackMode, setPlaybackMode] = useState<AudioEngineMode>(AudioEngineMode.SourceInterpreter);

  // 演奏位置ハイライト用の MML 対応情報 (コンパイル成功時に更新)
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackMapInfo | null>(null);

  // MmlEditor のアクティブファイルの最新ソース (BUILD / EXPORT で使用)
  const mmlSourceRef = useRef<{ source: string; fileName: string }>({ source: '', fileName: 'main.mml' });

  // 演奏ファサード (初回 PLAY 時に生成、unmount 時に破棄)
  const playerRef = useRef<Player | null>(null);

  // システムコンソールログ
  const [logs, setLogs] = useState<string[]>([
    'MZ-1500 IDE INITIALIZED.',
    'AUDIO PREVIEW ENGINE READY (Web Audio API 44.1 kHz).',
    'READY.'
  ]);

  // コンパイルエラー・問題一覧 (BUILD / PLAY 実行時にコンパイル結果で更新)
  const [compileErrors, setCompileErrors] = useState<CompileErrorItem[]>([]);

  // 楽曲メタデータ・ヘッダー設定 (#TITLE, #COMPOSER, #OCTAVE, #OPM)
  const [songMetadata, setSongMetadata] = useState<SongMetadata>({
    title: 'Theme of MZ',
    composer: 'User',
    octaveDirection: 'NORMAL',
    enableYM2151: false,
  });

  const enableYM2151 = songMetadata.enableYM2151;
  const setEnableYM2151 = (val: boolean) => {
    setSongMetadata(prev => ({ ...prev, enableYM2151: val }));
  };

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // システムコンソールへ 1 行追記する
  const appendLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${message}`]);
  }, []);

  // MmlEditor から通知されるアクティブソースを保持する
  const handleActiveSourceChange = useCallback((source: string, fileName: string) => {
    mmlSourceRef.current = { source, fileName };
  }, []);

  // 演奏ファサードを遅延生成する (AudioContext はユーザ操作内の play 時に生成される)
  const ensurePlayer = useCallback((): Player => {
    if (playerRef.current === null) {
      const player = new Player();
      player.onPlaybackFinished = () => {
        setIsPlaying(false);
        appendLog('[AUDIO] Playback finished.');
      };
      playerRef.current = player;
    }

    return playerRef.current;
  }, [appendLog]);

  // unmount 時に演奏ファサードを破棄する
  useEffect(() => {
    return () => {
      void playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  // PLAY ハンドラ (MML コンパイル ➜ 再生開始)
  const handlePlay = useCallback(async () => {
    const { source, fileName } = mmlSourceRef.current;
    appendLog(`[BUILD] Compiling ${fileName}...`);

    const result = new MmlCompiler().compile(source);
    setCompileErrors(toCompileErrorItems(result.diagnostics, fileName));

    if (!result.success || result.musicData === null) {
      const errorCount = result.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
      appendLog(`[BUILD] FAILED: ${errorCount} error(s). See the PROBLEMS panel.`);
      return;
    }

    appendLog(
      `[BUILD] SUCCESS: ${(result.totalFrames / 60).toFixed(2)} sec / ${result.tracks.length} tracks / ` +
      `${isLoopEnabled ? 'LOOP ENABLED' : 'PLAY ONCE'}.`
    );

    const player = ensurePlayer();
    try {
      appendLog(`[AUDIO] Playback started (${playbackModeLabel(playbackMode)} / Web Audio).`);
      await player.play(result.musicData, isLoopEnabled, playbackMode);
      setPlaybackInfo({ map: result.map, source });
      setIsPlaying(true);
    } catch (err) {
      appendLog(`[AUDIO] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [appendLog, ensurePlayer, isLoopEnabled, playbackMode]);

  // STOP ハンドラ (停止)
  const handleStop = useCallback(() => {
    playerRef.current?.stop();
    setIsPlaying(false);
    appendLog('[AUDIO] Playback stopped.');
  }, [appendLog]);

  // PLAY/STOP トグルハンドラ (再生中なら停止、停止中なら再生)
  const handleTogglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      handleStop();
    } else {
      void handlePlay();
    }
  }, [handleStop, handlePlay]);

  // グローバルショートカット (Ctrl + Enter で再生/停止トグル)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay]);

  // トラックのプレビューミュートを Player に反映 (プレビュー専用・コンパイル非連動)
  const handleTrackMuteChange = useCallback((trackIndex: number, muted: boolean) => {
    playerRef.current?.setTrackVolume(trackIndex, 0.8, muted);
  }, []);

  // マスター音量 / ミュートを Player に反映 (プレビュー専用・コンパイル非連動)
  const handleMasterVolumeChange = useCallback((volume: number, muted: boolean) => {
    playerRef.current?.setMasterVolume(muted ? 0 : volume);
  }, []);

  // EXPORT ハンドラ (.qdf エクスポート: コンパイル ➜ QuickDisk イメージ生成 ➜ ダウンロード)
  const handleExport = useCallback(() => {
    const { source, fileName } = mmlSourceRef.current;
    appendLog(`[BUILD] Compiling ${fileName} for export...`);

    const result = new MmlCompiler().compile(source);
    setCompileErrors(toCompileErrorItems(result.diagnostics, fileName));
    if (!result.success || result.musicData === null) {
      const errorCount = result.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
      appendLog(`[BUILD] FAILED: export aborted (${errorCount} error(s)). See the PROBLEMS panel.`);
      return;
    }

    try {
      const baseName =
        sanitizeFileName(songMetadata.title) ||
        sanitizeFileName(fileName.replace(/\.mml$/i, '')) ||
        'song';

      // 実機で演奏できるよう、ドライバ (0x1200〜) の music_data 位置へ MZSD データを
      // 埋め込んだ起動イメージを QuickDisk に格納する (Z80DriverMachine.load と同一の配置)
      const executableImage = Z80DriverImage.buildExecutableImage(
        Z80DriverImage.defaultDriver,
        result.musicData,
      );
      const image = buildQuickDiskImage(baseName, executableImage);

      const blob = new Blob([image.slice()], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${baseName}.qdf`;
      anchor.click();
      URL.revokeObjectURL(url);

      appendLog(`[EXPORT] SUCCESS: Exported "${baseName}.qdf" (${image.length.toLocaleString()} bytes).`);
      setPlaybackInfo({ map: result.map, source });
    } catch (err) {
      appendLog(`[EXPORT] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [appendLog, songMetadata.title]);

  // ドラッグ開始ハンドラ
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startContainer = containerRef.current;
    if (!startContainer) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const rect = startContainer.getBoundingClientRect();
      const newPercent = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const clampedPercent = Math.max(20, Math.min(80, newPercent));
      setLeftWidthPercent(clampedPercent);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleDoubleClickSplitter = () => {
    setLeftWidthPercent(50);
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans select-none bg-[#1E1E1E] text-zinc-300">
      {/* ドラッグ中の全画面マウス捕捉オーバーレイ */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none" />
      )}

      {/* Header Area (Professional Studio Transport Header) */}
      <header className="h-12 bg-[#2D2D2D] border-b border-[#3C3C3C] flex items-center justify-between px-3.5 shrink-0 z-10 relative">
        {/* Logo / App Name */}
        <div className="flex items-center gap-2.5">
          <img 
            src={mz1500Logo} 
            alt="MZ-1500" 
            className="h-5 w-auto object-contain select-none filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" 
          />
          <span className="text-xs px-2 py-0.5 rounded bg-[#383838] text-zinc-300 border border-[#484848] font-bold font-mono">
            Sound IDE
          </span>
          <div className="text-[11px] text-zinc-400 font-mono hidden md:block border-l border-[#444444] pl-2.5">
            SOUND DRIVER & MML COMPILER
          </div>
        </div>

        {/* Header Actions (Transport Controls) */}
        <div className="flex items-center gap-2 font-mono">
          {/* Transport: LOOP TOGGLE (無限ループ有効/無効、デフォルトON) */}
          <button
            onClick={() => setIsLoopEnabled(prev => !prev)}
            className={`h-7 px-2.5 rounded text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
              isLoopEnabled
                ? 'bg-[#00A8FF]/15 text-[#00A8FF] border-[#00A8FF]/60 hover:bg-[#00A8FF]/25 shadow-[0_0_8px_rgba(0,168,255,0.25)]'
                : 'bg-[#2E2E2E] hover:bg-[#383838] text-zinc-500 hover:text-zinc-300 border-[#404040]'
            }`}
            title={`Lコマンド 無限ループ: ${isLoopEnabled ? 'ON (無限ループする)' : 'OFF (1周で終了)'} (クリックで切替)`}
          >
            <Repeat className={`w-3.5 h-3.5 ${isLoopEnabled ? 'text-[#00A8FF]' : 'text-zinc-500'}`} />
            <span className="text-[11px] font-bold tracking-tight">LOOP</span>
            <span className={`w-1.5 h-1.5 rounded-full ${isLoopEnabled ? 'bg-[#00A8FF] shadow-[0_0_5px_#00A8FF]' : 'bg-zinc-600'}`} />
          </button>

          {/* Transport: PLAY (ビルド＆再生、再生中に押すと停止、Ctrl+Enter連動) */}
          <button 
            onClick={handleTogglePlay}
            className={`h-7 px-3.5 rounded text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
              isPlaying 
                ? 'bg-[#00A8FF]/25 text-[#00A8FF] border-[#00A8FF] shadow-[0_0_12px_rgba(0,168,255,0.45)] hover:bg-[#00A8FF]/35' 
                : 'bg-[#383838] hover:bg-[#444444] active:bg-[#505050] text-[#00A8FF] hover:text-[#33BFFF] border-[#484848] hover:border-[#00A8FF]/40'
            }`}
            title={isPlaying ? "クリックまたは Ctrl+Enter で停止" : "MMLをビルドして再生 (Ctrl+Enter)"}
          >
            <Play className={`w-3.5 h-3.5 fill-current ${isPlaying ? 'animate-pulse text-[#00A8FF]' : ''}`} />
            <span>{isPlaying ? 'STOP / PLAYING' : 'PLAY'}</span>
          </button>

          {/* Transport: STOP */}
          <button 
            onClick={handleStop}
            className={`h-7 px-3 rounded text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs ${
              isPlaying 
                ? 'bg-[#383838] text-amber-300 hover:text-white border-amber-500/50 hover:bg-[#444444]' 
                : 'bg-[#383838] hover:bg-[#444444] active:bg-[#505050] text-zinc-400 hover:text-zinc-200 border-[#484848]'
            }`}
            title="再生停止 (Stop)"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>STOP</span>
          </button>

          {/* Special Action: EXPORT (.qdf) */}
          <button 
            onClick={handleExport}
            className="h-7 px-3 rounded text-xs font-semibold bg-[#383838] hover:bg-[#444444] active:bg-[#505050] text-zinc-300 hover:text-white border border-[#484848] transition-colors ml-2 flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="QuickDiskイメージ (.qdf) としてエクスポート"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span>EXPORT (.qdf)</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main ref={containerRef} className="flex-1 flex flex-row overflow-hidden relative">
        
        {/* Left Pane (中央ペイン): MML Editor + Explorer + Compile Errors + System Console */}
        <div 
          style={{ width: showRightPane ? `${leftWidthPercent}%` : '100%' }}
          className="h-full flex flex-col z-0 shrink-0 overflow-hidden bg-[#1E1E1E]"
          onMouseDownCapture={() => setFocusedPane('mml')}
        >
          <MmlEditor 
            songMetadata={songMetadata}
            onChangeSongMetadata={setSongMetadata}
            showRightPane={showRightPane}
            onToggleRightPane={() => setShowRightPane(prev => !prev)}
            logs={logs}
            onClearLogs={() => setLogs([])}
            errors={compileErrors}
            onClearErrors={() => setCompileErrors([])}
            onSelectError={(item) => {
              const time = new Date().toLocaleTimeString();
              setLogs(prev => [...prev, `[${time}] [NAVIGATE] Jump to ${item.sourceFile} Ln ${item.line}, Col ${item.column}`]);
            }}
            onTogglePlay={handleTogglePlay}
            activeTabContext={activeTabContext}
            activeFmTone={activeFmTone}
            activePitchEnv={activePitchEnv}
            activePitchEnvLoop={activePitchEnvLoop}
            activeVolEnv={activeVolEnv}
            activeVolEnvLoop={activeVolEnvLoop}
            onRequestEditTone={handleRequestEditTone}
            onRequestEditVolEnv={handleRequestEditVolEnv}
            onRequestEditPitchEnv={handleRequestEditPitchEnv}
            onRequestNewTone={handleRequestNewTone}
            onRequestNewVolEnv={handleRequestNewVolEnv}
            onRequestNewPitchEnv={handleRequestNewPitchEnv}
            onEditorMount={(editorInstance) => { monacoEditorRef.current = editorInstance; }}
            onActiveSourceChange={handleActiveSourceChange}
          />
        </div>

        {/* Resizable Splitter Bar (右ペイン表示時のみ) */}
        {showRightPane && (
          <div
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClickSplitter}
            className="w-2 -mx-1 h-full cursor-col-resize z-20 shrink-0 flex items-center justify-center group select-none relative"
            title="左右ペインの幅をドラッグして変更 (ダブルクリックで50:50リセット)"
          >
            <div className={`w-0.5 h-full transition-colors duration-150 ${
              isDragging 
                ? 'bg-[#00A8FF] shadow-[0_0_8px_rgba(0,168,255,0.8)]' 
                : 'bg-[#3C3C3C] group-hover:bg-[#00A8FF]/60'
            }`} />
          </div>
        )}

        {/* Right Pane: Panels (表示時のみ) */}
        {showRightPane && (
          <div 
            style={{ width: `${100 - leftWidthPercent}%` }}
            className="h-full flex flex-col bg-[#1E1E1E] z-0 flex-1 overflow-hidden border-l border-[#3C3C3C]"
            onMouseDownCapture={() => setFocusedPane('rightPane')}
          >
            {/* Right Pane Tabs */}
            <div className="h-9 flex flex-row bg-[#282828] border-b border-[#3C3C3C] shrink-0 overflow-x-auto items-stretch">
              {/* タブ 1: TRACK MONITOR */}
              <button
                onClick={() => {
                  setActiveRightTab('track');
                  setFocusedPane('rightPane');
                }}
                className={`px-3.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'track'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
              >
                <Sliders className={`w-3.5 h-3.5 ${activeRightTab === 'track' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>TRACK MONITOR</span>
              </button>

              {/* タブ 2: YM2151 TONE */}
              <button
                onClick={() => {
                  setActiveRightTab('tone');
                  setFocusedPane('rightPane');
                }}
                className={`px-3.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'tone'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
              >
                <AudioWaveform className={`w-3.5 h-3.5 ${activeRightTab === 'tone' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>YM2151 TONE</span>
                {!enableYM2151 && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-[#383838] text-zinc-400 border border-[#484848] font-bold">
                    OFF
                  </span>
                )}
              </button>

              {/* タブ 3: VOL ENV */}
              <button
                onClick={() => {
                  setActiveRightTab('vol_envelope');
                  setFocusedPane('rightPane');
                }}
                className={`px-3.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'vol_envelope'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Volume Envelope Editor"
              >
                <TrendingUp className={`w-3.5 h-3.5 ${activeRightTab === 'vol_envelope' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>VOL ENV</span>
              </button>

              {/* タブ 4: PITCH ENV */}
              <button
                onClick={() => {
                  setActiveRightTab('pitch_envelope');
                  setFocusedPane('rightPane');
                }}
                className={`px-3.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'pitch_envelope'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Pitch Envelope Editor"
              >
                <LineChart className={`w-3.5 h-3.5 ${activeRightTab === 'pitch_envelope' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>PITCH ENV</span>
              </button>

              {/* タブ 5: SONG SETUP */}
              <button
                onClick={() => {
                  setActiveRightTab('song_setup');
                  setFocusedPane('rightPane');
                }}
                className={`px-3.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'song_setup'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Song Setup & Header Directives"
              >
                <Music className={`w-3.5 h-3.5 ${activeRightTab === 'song_setup' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>SONG SETUP</span>
              </button>

              {/* タブ 6: SETTINGS */}
              <button
                onClick={() => {
                  setActiveRightTab('settings');
                  setFocusedPane('rightPane');
                }}
                className={`px-3.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 ml-auto cursor-pointer ${
                  activeRightTab === 'settings'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
              >
                <Settings className={`w-3.5 h-3.5 ${activeRightTab === 'settings' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>SETTINGS</span>
              </button>
            </div>
            
            {/* Right Pane Content (タブコンテンツ切替) */}
            <div className="flex-grow flex flex-col overflow-hidden min-h-0">
              {activeRightTab === 'track' && (
                <TrackMonitor
                  enableYM2151={enableYM2151}
                  isPlaying={isPlaying}
                  getTrackLevel={(trackIndex) => playerRef.current?.getTrackLevel(trackIndex) ?? 0}
                  getMasterLevel={() => playerRef.current?.getMasterLevel() ?? 0}
                  getTrackOffset={(trackIndex) => playerRef.current?.getTrackOffset(trackIndex) ?? -1}
                  onTrackMuteChange={handleTrackMuteChange}
                  onMasterVolumeChange={handleMasterVolumeChange}
                  playbackMap={playbackInfo}
                />
              )}

              {activeRightTab === 'tone' && (
                enableYM2151 ? (
                  <FmToneEditor
                    onChangeToneData={setActiveFmTone}
                    loadToneId={loadToneId}
                    onApplyToMml={handleApplyToMml}
                  />
                ) : (
                  <div className="flex-grow p-6 flex flex-col items-center justify-center text-slate-400 font-mono text-xs">
                    <div className="text-center p-6 border border-dashed border-slate-800 rounded bg-slate-950/40 max-w-md">
                      <div className="text-red-400 font-bold mb-1">ACZ-8BS1MZ (YM2151) IS DISABLED</div>
                      <p className="text-slate-500 mb-3">
                        The FM sound board (ACZ-8BS1MZ by @poyokoma_danna) is disabled in the SONG SETUP tab.
                      </p>
                      <button
                        onClick={() => setEnableYM2151(true)}
                        className="px-3 py-1 bg-cyan-950 text-cyan-300 border border-cyan-700 rounded hover:bg-cyan-900 transition-colors cursor-pointer"
                      >
                        Enable ACZ-8BS1MZ Sound Board
                      </button>
                    </div>
                  </div>
                )
              )}

              {activeRightTab === 'vol_envelope' && (
                <VolEnvelopeEditor
                  onChangeEnvData={(data, loop) => {
                    setActiveVolEnv(data);
                    setActiveVolEnvLoop(loop);
                  }}
                  loadEnvId={loadVolEnvId}
                  onApplyToMml={handleApplyToMml}
                />
              )}

              {activeRightTab === 'pitch_envelope' && (
                <PitchEnvelopeEditor
                  onChangeEnvData={(data, loop) => {
                    setActivePitchEnv(data);
                    setActivePitchEnvLoop(loop);
                  }}
                  loadEnvId={loadPitchEnvId}
                  onApplyToMml={handleApplyToMml}
                />
              )}

              {activeRightTab === 'song_setup' && (
                <SongSetupPanel 
                  metadata={songMetadata}
                  onChangeMetadata={setSongMetadata}
                />
              )}

              {activeRightTab === 'settings' && (
                <SettingsPanel
                  onGoToSongSetup={() => setActiveRightTab('song_setup')}
                  playbackMode={playbackMode}
                  onChangePlaybackMode={(mode) => {
                    setPlaybackMode(mode);
                    appendLog(`[SETTINGS] Playback engine set to ${playbackModeLabel(mode)}.`);
                  }}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
