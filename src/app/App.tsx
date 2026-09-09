import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Download, 
  Sliders, 
  AudioWaveform, 
  TrendingUp, 
  LineChart, 
  Music,
  Music2,
  Settings,
  Wand2
} from 'lucide-react';
import { MidiRouterModal } from '../view/MidiRouterModal';
import { AboutModal } from '../view/AboutModal';
import { APP_DISPLAY_VERSION, APP_COMMIT_HASH, APP_COPYRIGHT } from '../config/version';
import { MmlEditor, type BottomTab } from '../view/MmlEditor';
import { TrackMonitor } from '../view/TrackMonitor';
import { SettingsPanel } from '../view/SettingsPanel';
import { SongSetupPanel, type SongMetadata } from '../view/SongSetupPanel';
import { VolEnvelopeEditor } from '../view/VolEnvelopeEditor';
import { PitchEnvelopeEditor } from '../view/PitchEnvelopeEditor';
import { FmToneEditor } from '../view/FmToneEditor';
import { MmlTransformPanel, type MmlTransformRequest } from '../view/MmlTransformPanel';
import { applyMmlTransform } from '../core/transform/mmlTransformEngine';
import { MmlCompiler } from '../core/mml/MmlCompiler';
import type { MmlDiagnostic } from '../core/mml/TrackId';
import { DiagnosticSeverity } from '../core/mml/TrackId';
import { AudioEngineMode } from '../core/player/AudioEngine';
import { Player } from '../core/player/Player';
import { virtualSynth } from '../utils/virtualSynth';
import { Z80DriverImage } from '../core/player/Z80DriverImage';
import { buildQuickDiskImage } from '../core/export/QdfImageBuilder';
import type { FmToneData } from '../core/fm/FmTone';
import type { PlaybackMapInfo } from '../utils/mmlPlaybackTracker';
import { resolvePlaybackRange, type PlaybackRangeRequest, type ResolvedPlaybackRange } from '../utils/mmlSelectionResolver';
import { formatDiagnosticsAsLogLines } from '../utils/diagnosticsLog';
import type { CompileErrorItem } from '../view/CompileErrorPanel';
import type { ActiveTabContext } from '../view/VirtualKeyboard';
import { findDefinitionBlocks, type MmlDefinitionKind } from '../utils/mmlContextParser';
import type { MmlCaretContext } from '../utils/mmlCaretParser';
import type { editor } from 'monaco-editor';
import mz1500Logo from '../assets/mz1500logo.svg';

type RightTab = 'track' | 'tone' | 'vol_envelope' | 'pitch_envelope' | 'song_setup' | 'mml_tools' | 'settings';

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
  const [activeVolEnvRelease, setActiveVolEnvRelease] = useState<number | undefined>(undefined);

  // MML右クリックメニューから各エディタに渡す「ロードリクエスト」
  // (null = リセット / requestNo は同一 ID の再ロード要求を判定するための連番)
  const [loadToneId, setLoadToneId] = useState<{ id: number; requestNo: number } | null>(null);
  const [loadVolEnvId, setLoadVolEnvId] = useState<{ id: number; requestNo: number } | null>(null);
  const [loadPitchEnvId, setLoadPitchEnvId] = useState<{ id: number; requestNo: number } | null>(null);
  const loadRequestCounterRef = useRef(0);
  const buildLoadRequest = useCallback((id: number) => ({ id, requestNo: ++loadRequestCounterRef.current }), []);

  // 現在フォーカスされているエディタ領域 ('mml' | 'rightPane')
  // ※ バーチャルキーボード等の下部エリア操作はこの状態を変更しない (上部エディタ領域のクリック/フォーカスのみで変更)。
  //    そのため右ペインで TONE / ENV エディタを選択中に鍵盤を弾いても、そのエディタのプレビュー音が鳴る。
  const [focusedPane, setFocusedPane] = useState<'mml' | 'rightPane'>('mml');

  // テスト発音・プレビュー用MIDIノート番号 (デフォルト: 60 = C4)
  // バーチャルキーボードおよび各エディタの TEST NOTE コントロールで双方向同期
  const [testMidiNote, setTestMidiNote] = useState<number>(60);

  // マスター音量 / ミュート (プレビュー専用・コンパイル非連動)。
  // TRACK MONITOR の MASTER VOL を App で一元管理し、演奏プレビュー (Player) と
  // 仮想キーボード発音 (virtualSynth) の双方へ反映する (タブ切替でも値を保持)。
  const [masterVolume, setMasterVolume] = useState<number>(80);
  const [masterMuted, setMasterMuted] = useState<boolean>(false);
  // Player 遅延生成 (ensurePlayer) 時に現在値を引き継ぐための最新マスター音量
  const masterLevelRef = useRef<number>(0.8);

  // バーチャルキーボードの発音コンテキスト判定:
  // - 左ペイン (MMLエディタ等) 選択中 / 右ペイン非表示 / 右ペインがエディタ以外のタブ → MMLキャレットコンテキスト
  // - 右ペインで FM TONE / VOL ENV / PITCH ENV を選択中 → そのエディタのプレビューコンテキスト
  const activeTabContext: ActiveTabContext = (focusedPane === 'mml' || !showRightPane || activeRightTab === 'track' || activeRightTab === 'song_setup' || activeRightTab === 'mml_tools' || activeRightTab === 'settings')
    ? 'mml'
    : (activeRightTab as ActiveTabContext);

  // アクティブ MML 全文 (各エディタの定義済み判定・定義内容ロードに使用)
  const [activeMmlSource, setActiveMmlSource] = useState<string>('');

  // Monaco Editor インスタンス参照 (MMLスニペット挿入用)
  const monacoEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // MIDI Router モーダル開閉ステート
  const [isMidiRouterOpen, setIsMidiRouterOpen] = useState<boolean>(false);

  // About & Credits モーダル開閉ステート
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);

  // MIDI Router からの MML 反映処理
  const handleApplyMidiRouter = useCallback((generatedMml: string) => {
    if (monacoEditorRef.current) {
      const currentVal = monacoEditorRef.current.getValue();
      monacoEditorRef.current.setValue(`${generatedMml}\n${currentVal}`);
    }
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev,
      `[${time}] [MIDI ROUTER] Generated MZ-1500 tracks applied to MML editor.`,
    ]);
  }, []);

  // 右クリックメニュー: FM TONE 編集リクエスト
  const handleRequestEditTone = useCallback((id: number) => {
    setLoadToneId(buildLoadRequest(id));
    setActiveRightTab('tone');
    setFocusedPane('rightPane');
    setShowRightPane(true);
  }, [buildLoadRequest]);

  // 右クリックメニュー: VOL ENV 編集リクエスト
  const handleRequestEditVolEnv = useCallback((id: number) => {
    setLoadVolEnvId(buildLoadRequest(id));
    setActiveRightTab('vol_envelope');
    setFocusedPane('rightPane');
    setShowRightPane(true);
  }, [buildLoadRequest]);

  // 右クリックメニュー: PITCH ENV 編集リクエスト
  const handleRequestEditPitchEnv = useCallback((id: number) => {
    setLoadPitchEnvId(buildLoadRequest(id));
    setActiveRightTab('pitch_envelope');
    setFocusedPane('rightPane');
    setShowRightPane(true);
  }, [buildLoadRequest]);

  // 右クリックメニュー: 新規作成 (未使用の新IDをロードする。未定義のため初期値で初期化される)
  const handleRequestNewTone = useCallback((newId: number) => {
    setLoadToneId(buildLoadRequest(newId));
    setActiveRightTab('tone');
    setFocusedPane('rightPane');
    setShowRightPane(true);
  }, [buildLoadRequest]);

  const handleRequestNewVolEnv = useCallback((newId: number) => {
    setLoadVolEnvId(buildLoadRequest(newId));
    setActiveRightTab('vol_envelope');
    setFocusedPane('rightPane');
    setShowRightPane(true);
  }, [buildLoadRequest]);

  const handleRequestNewPitchEnv = useCallback((newId: number) => {
    setLoadPitchEnvId(buildLoadRequest(newId));
    setActiveRightTab('pitch_envelope');
    setFocusedPane('rightPane');
    setShowRightPane(true);
  }, [buildLoadRequest]);

  // キャレット位置からの自動連動でロードされた直近のID (同一IDでの無駄な再ロード防止)
  const lastAutoLoadedIdsRef = useRef<{ voiceId?: number; volEnvId?: number; pitchEnvId?: number }>({});

  // MMLキャレット位置変更ハンドラ
  const handleCaretContextChange = useCallback((ctx?: MmlCaretContext) => {
    if (!ctx) return;

    // MMLペイン操作中 (focusedPane === 'mml') のみ右ペインのIDおよびプレビュー音高を自動追従
    if (focusedPane === 'mml') {
      if (ctx.voiceId !== undefined && ctx.voiceId !== lastAutoLoadedIdsRef.current.voiceId) {
        lastAutoLoadedIdsRef.current.voiceId = ctx.voiceId;
        setLoadToneId(buildLoadRequest(ctx.voiceId));
      }
      if (ctx.volEnvId !== undefined && ctx.volEnvId !== lastAutoLoadedIdsRef.current.volEnvId) {
        lastAutoLoadedIdsRef.current.volEnvId = ctx.volEnvId;
        setLoadVolEnvId(buildLoadRequest(ctx.volEnvId));
      }
      if (ctx.pitchEnvId !== undefined && ctx.pitchEnvId !== lastAutoLoadedIdsRef.current.pitchEnvId) {
        lastAutoLoadedIdsRef.current.pitchEnvId = ctx.pitchEnvId;
        setLoadPitchEnvId(buildLoadRequest(ctx.pitchEnvId));
      }
      if (ctx.octave !== undefined) {
        setTestMidiNote(prevNote => {
          const semitone = ((prevNote % 12) + 12) % 12;
          const targetNote = Math.max(12, Math.min(108, (ctx.octave + 1) * 12 + semitone));
          return targetNote;
        });
      }
    }
  }, [focusedPane, buildLoadRequest]);

  /**
   * 「MMLに反映」ボタン: ID の定義有無で動作が変わる。
   * - 定義済み ID  : MML 内の該当定義ブロックを現在の編集内容で置き換える
   * - 未定義 ID    : MML 内の最後の定義ブロックの直後に新規定義として挿入する
   *                  (定義ブロックが 1 つも無い場合のみカーソル位置へ挿入)
   */
  const handleApplyToMml = useCallback((mmlSnippet: string, kind: MmlDefinitionKind, id: number) => {
    const ed = monacoEditorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;

    const blocks = findDefinitionBlocks(model.getValue());
    const target = blocks.find((b) => b.kind === kind && b.id === id);

    if (target) {
      // 定義済み → 該当定義ブロック (開始行〜終了行) を丸ごと置き換え
      const endLine = Math.min(target.endLine, model.getLineCount());
      const range = {
        startLineNumber: target.startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: model.getLineMaxColumn(endLine),
      };
      ed.executeEdits('apply-mml', [{ range, text: mmlSnippet }]);
      ed.revealLineInCenter(target.startLine);
    } else if (blocks.length > 0) {
      // 未定義 → 最後の定義ブロックの直後 (次の行頭) へ挿入
      const lastBlock = blocks[blocks.length - 1];
      const insertLine = Math.min(lastBlock.endLine + 1, model.getLineCount());
      const range = {
        startLineNumber: insertLine,
        startColumn: 1,
        endLineNumber: insertLine,
        endColumn: 1,
      };
      ed.executeEdits('apply-mml', [{ range, text: `${mmlSnippet}\n` }]);
      ed.revealLineInCenter(insertLine);
    } else {
      // 定義が 1 つも無い → カーソル位置へ挿入 (選択範囲があれば置換)
      const selection = ed.getSelection();
      const pos = ed.getPosition();
      if (!pos) return;
      const range = selection && !selection.isEmpty()
        ? selection
        : { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column };
      ed.executeEdits('apply-mml', [{ range, text: '\n' + mmlSnippet + '\n' }]);
    }
    ed.focus();
  }, []);

  // 各エディタの「MMLに反映」コールバック (種別を束縛して handleApplyToMml へ渡す)
  const handleApplyToneToMml = useCallback(
    (mmlSnippet: string, id: number) => handleApplyToMml(mmlSnippet, 'tone', id),
    [handleApplyToMml],
  );
  const handleApplyVolEnvToMml = useCallback(
    (mmlSnippet: string, id: number) => handleApplyToMml(mmlSnippet, 'volEnv', id),
    [handleApplyToMml],
  );
  const handleApplyPitchEnvToMml = useCallback(
    (mmlSnippet: string, id: number) => handleApplyToMml(mmlSnippet, 'pitchEnv', id),
    [handleApplyToMml],
  );



  // 再生ステート (PLAY / STOP 連動)
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // 無限ループ (Lコマンド) 有効ステート (ヘッダー/エディタの LOOP トグル UI は廃止済みのため常時 ON。
  // player.play への引数として内部利用する。将来 SETTINGS への移設を検討)
  const [isLoopEnabled] = useState<boolean>(true);

  // 演奏エンジン (既定 = Z80Driver: 内蔵 Z80 コアでドライバ実行 / SourceInterpreter = リファレンス実装)
  const [playbackMode, setPlaybackMode] = useState<AudioEngineMode>(AudioEngineMode.Z80Driver);

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

  // エディタ下部パネルのアクティブタブ & 折りたたみ状態
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('keyboard');
  const [isBottomCollapsed, setIsBottomCollapsed] = useState<boolean>(false);

  // PLAY失敗時のフィードバックステート (エラー時に一時的に true になり赤色・シェイクアニメーション)
  const [isPlayFailed, setIsPlayFailed] = useState<boolean>(false);
  const playFailedTimerRef = useRef<number | null>(null);

  // PLAY失敗演出を発火する (900ms後に自動復帰)
  const triggerPlayFailed = useCallback(() => {
    setIsPlayFailed(true);
    if (playFailedTimerRef.current !== null) {
      window.clearTimeout(playFailedTimerRef.current);
    }
    playFailedTimerRef.current = window.setTimeout(() => {
      setIsPlayFailed(false);
      playFailedTimerRef.current = null;
    }, 900);
  }, []);

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
    setActiveMmlSource(source);
  }, []);

  // MML TRANSFORM パネルからの変換要求を Monaco Editor へ適用する (Undo/Redo 履歴を保持)
  const handleMmlTransform = useCallback((request: MmlTransformRequest) => {
    const ed = monacoEditorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;

    const selection = ed.getSelection();
    const useSelection = request.scope === 'selection'
      && selection !== null
      && !selection.isEmpty();
    const range = useSelection && selection ? selection : model.getFullModelRange();
    const source = model.getValueInRange(range);

    let transformed = source;
    let totalChanges = 0;
    for (const operation of request.operations) {
      const result = applyMmlTransform(transformed, operation);
      transformed = result.source;
      totalChanges += result.changedCount;
    }

    if (request.operations.length === 0 || totalChanges === 0) {
      appendLog(`[MML TRANSFORM] ${request.description}: 適用可能な変更はありませんでした`);
      return;
    }

    // executeEdits で置換することで Undo (Ctrl+Z) で変換前に戻せる
    ed.executeEdits('mml-transform', [{ range, text: transformed }]);
    ed.pushUndoStop();

    const scopeLabel = useSelection ? ' / 選択範囲のみ' : '';
    appendLog(`[MML TRANSFORM] ${request.description} (${totalChanges} 件を適用${scopeLabel})`);
  }, [appendLog]);

  // 演奏ファサードを遅延生成する (AudioContext はユーザ操作内の play 時に生成される)
  const ensurePlayer = useCallback((): Player => {
    if (playerRef.current === null) {
      const player = new Player();
      player.onPlaybackFinished = () => {
        setIsPlaying(false);
        appendLog('[AUDIO] Playback finished.');
      };
      // Player は遅延生成のため、既に設定済みのマスター音量を引き継ぐ
      player.setMasterVolume(masterLevelRef.current);
      playerRef.current = player;
    }

    return playerRef.current;
  }, [appendLog]);

  // unmount 時に演奏ファサードとタイマーを破棄する
  useEffect(() => {
    return () => {
      void playerRef.current?.dispose();
      playerRef.current = null;
      if (playFailedTimerRef.current !== null) {
        window.clearTimeout(playFailedTimerRef.current);
      }
    };
  }, []);

  // PLAY ハンドラ (MML コンパイル ➜ [部分再生時は時間範囲解決] ➜ 再生開始)
  const handlePlay = useCallback(async (request?: PlaybackRangeRequest) => {
    const { source, fileName } = mmlSourceRef.current;
    appendLog(`[BUILD] Compiling ${fileName}...`);

    const result = new MmlCompiler().compile(source);
    setCompileErrors(toCompileErrorItems(result.diagnostics, fileName));

    if (!result.success || result.musicData === null) {
      const errorCount = result.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
      appendLog(`[BUILD] FAILED: ${errorCount} error(s). See the PROBLEMS panel.`);
      // エラー詳細 (行・桁・メッセージ) もコンソールへ出力する (上限件数を超えた分は要約)
      formatDiagnosticsAsLogLines(result.diagnostics).forEach(appendLog);
      // エラー時は PROBLEMS タブをアクティブ化し、折りたたまれていれば展開
      setActiveBottomTab('problems');
      setIsBottomCollapsed(false);
      triggerPlayFailed();
      return;
    }

    // 部分再生要求: MmlMap (イベント ↔ ソース位置 ↔ 演奏フレーム対応) から時間範囲を解決する
    let range: ResolvedPlaybackRange | null = null;
    if (request !== undefined) {
      range = result.map === null ? null : resolvePlaybackRange(result.map, request, source);
      if (range === null) {
        appendLog(
          `[PLAY] ${request.kind === 'caret' ? 'キャレット以降' : '選択範囲内'}に再生可能な音符・休符がありません。`,
        );
        return;
      }
    }

    appendLog(
      `[BUILD] SUCCESS: ${(result.totalFrames / 60).toFixed(2)} sec / ${result.tracks.length} tracks / ` +
      `${isLoopEnabled ? 'LOOP ENABLED' : 'PLAY ONCE'}.`
    );

    const player = ensurePlayer();
    try {
      const rangeLabel = range === null
        ? ''
        : ` / PARTIAL ${range.startSeconds.toFixed(2)}s - ${range.endSeconds === null ? 'END' : `${range.endSeconds.toFixed(2)}s`} (${range.eventCount} events)`;
      appendLog(`[AUDIO] Playback started (${playbackModeLabel(playbackMode)} / Web Audio${rangeLabel}).`);
      await player.play(result.musicData, isLoopEnabled, playbackMode, range ?? undefined);
      setPlaybackInfo({ map: result.map, source });
      setIsPlaying(true);
    } catch (err) {
      appendLog(`[AUDIO] ERROR: ${err instanceof Error ? err.message : String(err)}`);
      triggerPlayFailed();
    }
  }, [appendLog, ensurePlayer, isLoopEnabled, playbackMode, triggerPlayFailed]);

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

  // トラックのプレビューミュートを Player に反映 (ミュートフラグのみ切替・音量は不変)
  const handleTrackMuteChange = useCallback((trackIndex: number, muted: boolean) => {
    playerRef.current?.setTrackMuted(trackIndex, muted);
  }, []);

  // TRACK MONITOR のマスター音量 / ミュート変更を App state へ反映 (一元管理)
  const handleMasterVolumeChange = useCallback((volume: number, muted: boolean) => {
    setMasterVolume(Math.round(volume * 100));
    setMasterMuted(muted);
  }, []);

  // マスター音量 (0-1 / ミュート時 0)。演奏プレビュー・仮想キーボード・各エディタ試聴の共通音量
  const masterLevel = masterMuted ? 0 : masterVolume / 100;

  // マスター音量 / ミュートを Player (演奏プレビュー) と仮想キーボード発音 (virtualSynth) の
  // 双方へ反映する (プレビュー専用パラメータ、コンパイル・エクスポートには影響しない)
  useEffect(() => {
    masterLevelRef.current = masterLevel;
    playerRef.current?.setMasterVolume(masterLevel);
    virtualSynth.setMasterVolume(masterLevel);
  }, [masterLevel]);

  // EXPORT ハンドラ (.qdf エクスポート: コンパイル ➜ QuickDisk イメージ生成 ➜ ダウンロード)
  const handleExport = useCallback(() => {
    const { source, fileName } = mmlSourceRef.current;
    appendLog(`[BUILD] Compiling ${fileName} for export...`);

    const result = new MmlCompiler().compile(source);
    setCompileErrors(toCompileErrorItems(result.diagnostics, fileName));
    if (!result.success || result.musicData === null) {
      const errorCount = result.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
      appendLog(`[BUILD] FAILED: export aborted (${errorCount} error(s)). See the PROBLEMS panel.`);
      formatDiagnosticsAsLogLines(result.diagnostics).forEach(appendLog);
      setActiveBottomTab('problems');
      setIsBottomCollapsed(false);
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
      <header className="h-12 bg-[#2D2D2D] border-b border-[#3C3C3C] flex items-center justify-between px-3.5 shrink-0 z-10 relative overflow-x-auto">
        {/* Logo / App Name */}
        <div className="flex items-center gap-2 shrink-0">
          <img 
            src={mz1500Logo} 
            alt="MZ-1500" 
            onClick={() => setIsAboutOpen(true)}
            className="h-5 w-auto object-contain select-none filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] cursor-pointer hover:opacity-85 transition-opacity" 
            title="MZ-1500 Sound IDE について / Credits"
          />
          <button
            onClick={() => setIsAboutOpen(true)}
            className="text-xs px-2 py-0.5 rounded bg-[#383838] hover:bg-[#444444] text-zinc-300 hover:text-white border border-[#484848] font-bold font-mono transition-colors cursor-pointer"
            title="About & Credits"
          >
            Sound IDE
          </button>
          <button
            onClick={() => setIsAboutOpen(true)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-[#00A8FF]/15 hover:bg-[#00A8FF]/25 text-[#00A8FF] hover:text-[#55c8ff] border border-[#00A8FF]/40 font-bold font-mono transition-colors cursor-pointer tracking-tight"
            title={`バージョン情報 & クレジット (Commit: ${APP_COMMIT_HASH})`}
          >
            {APP_DISPLAY_VERSION}
          </button>
          <div className="text-[11px] text-zinc-400 font-mono hidden xl:block border-l border-[#444444] pl-2.5">
            SOUND DRIVER & MML COMPILER
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2 font-mono shrink-0 ml-4">
          {/* Special Action: EXPORT PLAYER (.qdf) */}
          {/* ※ トランスポート (PLAY / STOP / LOOP) はヘッダーから廃止し、MML エディタのトランスポートバーへ一元化 */}
          <button 
            onClick={handleExport}
            className="h-7 px-3 rounded text-xs font-semibold bg-[#383838] hover:bg-[#444444] active:bg-[#505050] text-zinc-300 hover:text-white border border-[#484848] transition-colors ml-1 flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
            title="実機演奏プレイヤー入り QuickDiskイメージ (.qdf) としてエクスポート"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span>EXPORT PLAYER (.qdf)</span>
          </button>

          {/* IMPORT MIDI */}
          <button 
            onClick={() => setIsMidiRouterOpen(true)}
            className="h-7 px-3 rounded text-xs font-bold bg-[#00A8FF]/20 hover:bg-[#00A8FF]/30 active:bg-[#00A8FF]/40 text-[#00A8FF] border border-[#00A8FF] shadow-[0_0_10px_rgba(0,168,255,0.3)] transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
            title="MIDIファイル (.mid) をインポートしてチャンネル割り当てを行う"
          >
            <Music2 className="w-3.5 h-3.5 text-[#00A8FF]" />
            <span>IMPORT MIDI</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main ref={containerRef} className="flex-1 flex flex-row overflow-hidden relative">
        
        {/* Left Pane (中央ペイン): MML Editor + Explorer + Compile Errors + System Console */}
        <div 
          style={{ width: showRightPane ? `${leftWidthPercent}%` : '100%' }}
          className="h-full flex flex-col z-0 shrink-0 overflow-hidden bg-[#1E1E1E]"
        >
          <MmlEditor 
            onFocusEditor={() => setFocusedPane('mml')}
            songMetadata={songMetadata}
            onChangeSongMetadata={setSongMetadata}
            showRightPane={showRightPane}
            onToggleRightPane={() => setShowRightPane(prev => !prev)}
            logs={logs}
            onClearLogs={() => setLogs([])}
            onAppendLog={appendLog}
            errors={compileErrors}
            onClearErrors={() => setCompileErrors([])}
            activeBottomTab={activeBottomTab}
            onChangeBottomTab={setActiveBottomTab}
            isBottomCollapsed={isBottomCollapsed}
            onChangeBottomCollapsed={setIsBottomCollapsed}
            onSelectError={(item) => {
              const time = new Date().toLocaleTimeString();
              setLogs(prev => [...prev, `[${time}] [NAVIGATE] Jump to ${item.sourceFile} Line ${item.line}, Col ${item.column}`]);
            }}
            onTogglePlay={handleTogglePlay}
            onStop={handleStop}
            isPlayFailed={isPlayFailed}
            onPlayRangeRequest={(request) => { void handlePlay(request); }}
            activeTabContext={activeTabContext}
            activeFmTone={activeFmTone}
            activePitchEnv={activePitchEnv}
            activePitchEnvLoop={activePitchEnvLoop}
            activeVolEnv={activeVolEnv}
            activeVolEnvLoop={activeVolEnvLoop}
            activeVolEnvRelease={activeVolEnvRelease}
            testMidiNote={testMidiNote}
            onChangeTestMidiNote={setTestMidiNote}
            onRequestEditTone={handleRequestEditTone}
            onRequestEditVolEnv={handleRequestEditVolEnv}
            onRequestEditPitchEnv={handleRequestEditPitchEnv}
            onRequestNewTone={handleRequestNewTone}
            onRequestNewVolEnv={handleRequestNewVolEnv}
            onRequestNewPitchEnv={handleRequestNewPitchEnv}
            onEditorMount={(editorInstance) => { monacoEditorRef.current = editorInstance; }}
            onActiveSourceChange={handleActiveSourceChange}
            onCaretContextChange={handleCaretContextChange}
            isPlaying={isPlaying}
            getTrackOffset={(trackIndex) => playerRef.current?.getTrackOffset(trackIndex) ?? -1}
            playbackMap={playbackInfo}
            onOpenMidiRouter={() => setIsMidiRouterOpen(true)}
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
            {/* Right Pane Tabs (Compact & Responsive: No horizontal scroll needed) */}
            <div className="h-9 flex flex-row bg-[#282828] border-b border-[#3C3C3C] shrink-0 overflow-x-auto items-stretch">
              {/* タブ 1: MONITOR */}
              <button
                onClick={() => {
                  setActiveRightTab('track');
                  setFocusedPane('rightPane');
                }}
                className={`px-2.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'track'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Track Monitor (VUメーター & 演奏追従 / ミュート・ソロ)"
              >
                <Sliders className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'track' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="tracking-tight">MONITOR</span>
              </button>

              {/* タブ 2: FM */}
              <button
                onClick={() => {
                  setActiveRightTab('tone');
                  setFocusedPane('rightPane');
                }}
                className={`px-2.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'tone'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="FM Tone Editor (YM2151 4オペレータ音色エディタ)"
              >
                <AudioWaveform className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'tone' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="tracking-tight">FM</span>
                {!enableYM2151 && (
                  <span className="text-[8px] px-1 rounded bg-[#383838] text-zinc-400 border border-[#484848] font-bold">
                    OFF
                  </span>
                )}
              </button>

              {/* タブ 3: V-ENV */}
              <button
                onClick={() => {
                  setActiveRightTab('vol_envelope');
                  setFocusedPane('rightPane');
                }}
                className={`px-2.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'vol_envelope'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Volume Envelope Editor (音量エンベロープ包絡線)"
              >
                <TrendingUp className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'vol_envelope' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="tracking-tight">V-ENV</span>
              </button>

              {/* タブ 4: P-ENV */}
              <button
                onClick={() => {
                  setActiveRightTab('pitch_envelope');
                  setFocusedPane('rightPane');
                }}
                className={`px-2.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'pitch_envelope'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Pitch Envelope Editor (ピッチエンベロープ包絡線)"
              >
                <LineChart className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'pitch_envelope' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="tracking-tight">P-ENV</span>
              </button>

              {/* タブ 5: SETUP */}
              <button
                onClick={() => {
                  setActiveRightTab('song_setup');
                  setFocusedPane('rightPane');
                }}
                className={`px-2.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'song_setup'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Song Setup & Header Directives (#TITLE, #OPM 等の楽曲設定)"
              >
                <Music className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'song_setup' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="tracking-tight">SETUP</span>
              </button>

              {/* タブ 6: TRANSFORM */}
              <button
                onClick={() => {
                  setActiveRightTab('mml_tools');
                  setFocusedPane('rightPane');
                }}
                className={`px-2.5 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 cursor-pointer ${
                  activeRightTab === 'mml_tools'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="MML Transform (オクターブ・移調・音量スケーリング・チャンネル一括置換)"
              >
                <Wand2 className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'mml_tools' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="tracking-tight">TRANSFORM</span>
              </button>

              {/* タブ 7: SETTINGS (右端固定アイコンボタン) */}
              <button
                onClick={() => {
                  setActiveRightTab('settings');
                  setFocusedPane('rightPane');
                }}
                className={`px-3 text-xs font-mono font-medium focus:outline-none transition-colors border-b-2 flex items-center gap-1.5 select-none shrink-0 ml-auto cursor-pointer ${
                  activeRightTab === 'settings'
                    ? 'bg-[#1E1E1E] text-zinc-100 border-[#00A8FF] font-semibold'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-[#333333]'
                }`}
                title="Application Preferences & Credits (環境設定・演奏エンジン・リスペクト先)"
              >
                <Settings className={`w-3.5 h-3.5 shrink-0 ${activeRightTab === 'settings' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span className="hidden xl:inline tracking-tight">SETTINGS</span>
              </button>
            </div>
            
            {/* Right Pane Content (タブコンテンツ切替) */}
            <div className="flex-grow flex flex-col overflow-hidden min-h-0">
              {activeRightTab === 'track' && (
                <TrackMonitor
                  enableYM2151={enableYM2151}
                  isPlaying={isPlaying}
                  masterVolume={masterVolume}
                  masterMuted={masterMuted}
                  getTrackLevel={(trackIndex) => playerRef.current?.getTrackLevel(trackIndex) ?? 0}
                  getMasterLevel={() => playerRef.current?.getMasterLevel() ?? 0}
                  onTrackMuteChange={handleTrackMuteChange}
                  onMasterVolumeChange={handleMasterVolumeChange}
                />
              )}

              {activeRightTab === 'tone' && (
                enableYM2151 ? (
                  <FmToneEditor
                    onChangeToneData={setActiveFmTone}
                    loadToneId={loadToneId}
                    mmlSource={activeMmlSource}
                    onApplyToMml={handleApplyToneToMml}
                    testMidiNote={testMidiNote}
                    onChangeTestMidiNote={setTestMidiNote}
                    masterLevel={masterLevel}
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
                  onChangeEnvData={(data, loop, release) => {
                    setActiveVolEnv(data);
                    setActiveVolEnvLoop(loop);
                    setActiveVolEnvRelease(release);
                  }}
                  loadEnvId={loadVolEnvId}
                  mmlSource={activeMmlSource}
                  onApplyToMml={handleApplyVolEnvToMml}
                  testMidiNote={testMidiNote}
                  onChangeTestMidiNote={setTestMidiNote}
                  masterLevel={masterLevel}
                />
              )}

              {activeRightTab === 'pitch_envelope' && (
                <PitchEnvelopeEditor
                  onChangeEnvData={(data, loop) => {
                    setActivePitchEnv(data);
                    setActivePitchEnvLoop(loop);
                  }}
                  loadEnvId={loadPitchEnvId}
                  mmlSource={activeMmlSource}
                  onApplyToMml={handleApplyPitchEnvToMml}
                  testMidiNote={testMidiNote}
                  onChangeTestMidiNote={setTestMidiNote}
                  masterLevel={masterLevel}
                />
              )}

              {activeRightTab === 'song_setup' && (
                <SongSetupPanel 
                  metadata={songMetadata}
                  onChangeMetadata={setSongMetadata}
                />
              )}

              {activeRightTab === 'mml_tools' && (
                <MmlTransformPanel 
                  enableYM2151={enableYM2151}
                  onToggleEnableYM2151={() => {
                    const nextVal = !enableYM2151;
                    setEnableYM2151(nextVal);
                    appendLog(`[MML TRANSFORM] ACZ-8BS1MZ (YM2151) sound board turned ${nextVal ? 'ON' : 'OFF'}.`);
                  }}
                  onOpenMidiRouter={() => setIsMidiRouterOpen(true)}
                  onRequestTransform={handleMmlTransform}
                />
              )}

              {activeRightTab === 'settings' && (
                <SettingsPanel
                  onGoToSongSetup={() => setActiveRightTab('song_setup')}
                  onOpenAbout={() => setIsAboutOpen(true)}
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

      {/* Footer / Status Bar */}
      <footer className="h-6 bg-[#181818] border-t border-[#303030] px-3 flex items-center justify-between text-[11px] font-mono select-none shrink-0 text-zinc-400 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAboutOpen(true)}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title={`About & Credits (Commit: ${APP_COMMIT_HASH})`}
          >
            <span className="font-semibold text-zinc-300">MZ-1500 Sound IDE</span>
            <span className="text-[10px] text-[#00A8FF]">{APP_DISPLAY_VERSION}</span>
          </button>
          <span className="text-zinc-600">|</span>
          <span className="text-[10.5px] text-zinc-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#34d399]" />
            <span>DCSG (SN76489)</span>
            {enableYM2151 && (
              <>
                <span className="text-zinc-600">+</span>
                <span className="text-[#00A8FF] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00A8FF] shadow-[0_0_4px_#00A8FF]" />
                  <span>OPM (YM2151)</span>
                </span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAboutOpen(true)}
            className="text-zinc-400 hover:text-[#00A8FF] hover:underline transition-colors cursor-pointer flex items-center gap-1"
            title="Copyright & Respects / Credits"
          >
            <span>{APP_COPYRIGHT}</span>
            <span className="text-zinc-400 text-[10px]">(Credits & Respects)</span>
          </button>
        </div>
      </footer>

      {/* MIDI Router Modal */}
      {isMidiRouterOpen && (
        <MidiRouterModal
          isOpen={isMidiRouterOpen}
          onClose={() => setIsMidiRouterOpen(false)}
          onApplyToMml={handleApplyMidiRouter}
          enableYM2151={enableYM2151}
          onToggleEnableYM2151={() => {
            const nextVal = !enableYM2151;
            setEnableYM2151(nextVal);
            appendLog(`[MIDI ROUTER] ACZ-8BS1MZ (YM2151) sound board turned ${nextVal ? 'ON' : 'OFF'}.`);
          }}
        />
      )}

      {/* About & Credits / Respects Modal */}
      {isAboutOpen && (
        <AboutModal
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
