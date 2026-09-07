import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  PanelLeftClose, 
  PanelLeftOpen, 
  PanelRightClose, 
  PanelRightOpen, 
  FileCode, 
  X, 
  Plus, 
  Terminal,
  AlertCircle,
  Music,
  AudioWaveform,
  TrendingUp,
  ChartLine,
  Scissors,
  Copy,
  ClipboardPaste,
  ChevronUp,
  ChevronDown,
  Check
} from 'lucide-react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { FileExplorer } from './FileExplorer';
import { CompileErrorPanel, type CompileErrorItem } from './CompileErrorPanel';
import { ConsolePanel } from './ConsolePanel';
import { MmlPlaybackHighlighter } from './MmlPlaybackHighlighter';
import type { SongMetadata } from './SongSetupPanel';
import { VirtualKeyboard, type ActiveTabContext } from './VirtualKeyboard';
import { parseMmlCaretContext, type MmlCaretContext } from '../utils/mmlCaretParser';
import { collectUsedIds, findDefinitionAt, findDefinitionBlocks, nextAvailableId } from '../utils/mmlContextParser';
import { resolvePlaybackPositions, type PlaybackMapInfo } from '../utils/mmlPlaybackTracker';
import { MmlContextMenu, type MmlContextMenuEntry } from './MmlContextMenu';
import type { FmToneData } from '../core/fm/FmTone';
import { setupMmlLanguage, MML_LANGUAGE_ID, MML_THEME_NAME } from '../utils/mmlLanguage';

interface MmlFile {
  id: string;
  name: string;
  content: string;
}

const DUMMY_FILES: MmlFile[] = [
  {
    id: '1',
    name: 'main.mml',
    content: '; MZ-1500 MML Example\n\n#TITLE "Theme of MZ"\n#COMPOSER "User"\n#OPM OFF\n#OCTAVE NORMAL\n\n; FM音色定義 (#OPM ON 時に F1〜F8 トラックで @1 を指定して使用)\n@1 = {\n  4, 6,\n  31, 12, 0, 15, 3, 24, 0, 1, 0, 0, 0,\n  31, 18, 0, 12, 5, 18, 0, 2, 3, 0, 0,\n  31, 10, 0, 15, 2, 30, 0, 1, 0, 0, 0,\n  31,  8, 0,  8, 4,  0, 0, 1, 0, 0, 0\n}\n@VE1 = { 15, 14, 13, |, 12, 11, >, 8, 5, 2, 0 }\n@PE1 = { |, 0, 2, 4, 6, 8, 6, 4, 2 }\n\n; 定義行 (@1 / @VE1 / @PE1) を右クリックすると対応エディタで編集できます (複数行定義はどの行でもOK)\nP1 t120 l8 o4 @VE1 @PE1\nP1 c e g > c < g e c r\nP1 L [c d e f g2]2\n'
  },
  {
    id: '2',
    name: 'drums.mml',
    content: '; DCSG Noise / Drums\n\nN1 @WN1 t120 l4 o2\nN1 c c c c r2\n'
  }
];

function parseSongMetadata(content: string): SongMetadata {
  const titleMatch = content.match(/^#TITLE\s+"([^"]*)"/im);
  const composerMatch = content.match(/^#COMPOSER\s+"([^"]*)"/im);
  const octaveMatch = content.match(/^#OCTAVE\s+(NORMAL|REVERSE)\b/im);
  const opmMatch = content.match(/^#(?:OPM|FM)\s+(ON|OFF)\b/im);

  return {
    title: titleMatch ? titleMatch[1] : '',
    composer: composerMatch ? composerMatch[1] : '',
    octaveDirection: (octaveMatch && octaveMatch[1].toUpperCase() === 'REVERSE') ? 'REVERSE' : 'NORMAL',
    enableYM2151: (opmMatch && opmMatch[1].toUpperCase() === 'ON') ? true : false,
  };
}

function insertAfterHeaders(content: string, newLine: string): string {
  const headerMatch = content.match(/(#(?:TITLE|COMPOSER|OCTAVE|OPM|FM)[^\n]*\n)/gi);
  if (headerMatch && headerMatch.length > 0) {
    const lastHeader = headerMatch[headerMatch.length - 1];
    const lastIdx = content.lastIndexOf(lastHeader);
    const insertPos = lastIdx + lastHeader.length;
    return content.slice(0, insertPos) + newLine + content.slice(insertPos);
  }
  const commentMatch = content.match(/^(?:;[^\n]*\n|\/[^\n]*\n)+\n?/);
  if (commentMatch) {
    const insertPos = commentMatch[0].length;
    return content.slice(0, insertPos) + newLine + content.slice(insertPos);
  }
  return newLine + content;
}

function applyMetadataToContent(content: string, meta: SongMetadata): string {
  let res = content;

  // #TITLE
  if (meta.title !== undefined) {
    if (/#TITLE\b[^\n]*/i.test(res)) {
      res = res.replace(/#TITLE\b[^\n]*/i, `#TITLE "${meta.title}"`);
    } else if (meta.title.trim() !== '') {
      res = insertAfterHeaders(res, `#TITLE "${meta.title}"\n`);
    }
  }

  // #COMPOSER
  if (meta.composer !== undefined) {
    if (/#COMPOSER\b[^\n]*/i.test(res)) {
      res = res.replace(/#COMPOSER\b[^\n]*/i, `#COMPOSER "${meta.composer}"`);
    } else if (meta.composer.trim() !== '') {
      res = insertAfterHeaders(res, `#COMPOSER "${meta.composer}"\n`);
    }
  }

  // #OCTAVE
  if (/#OCTAVE\b[^\n]*/i.test(res)) {
    res = res.replace(/#OCTAVE\b[^\n]*/i, `#OCTAVE ${meta.octaveDirection}`);
  } else if (meta.octaveDirection === 'REVERSE') {
    res = insertAfterHeaders(res, `#OCTAVE ${meta.octaveDirection}\n`);
  }

  // #OPM
  if (/#(?:OPM|FM)\b[^\n]*/i.test(res)) {
    res = res.replace(/#(?:OPM|FM)\b[^\n]*/i, `#OPM ${meta.enableYM2151 ? 'ON' : 'OFF'}`);
  } else if (meta.enableYM2151) {
    res = insertAfterHeaders(res, `#OPM ON\n`);
  }

  return res;
}

export type BottomTab = 'problems' | 'console' | 'keyboard';

/** 折りたたみ時に下部エリアへ残すタブバーの高さ (px)。 */
const BOTTOM_COLLAPSED_HEIGHT_PX = 28;

interface MmlEditorProps {
  songMetadata: SongMetadata;
  onChangeSongMetadata: (metadata: SongMetadata) => void;
  showRightPane: boolean;
  onToggleRightPane: () => void;
  logs: string[];
  onClearLogs: () => void;
  errors: CompileErrorItem[];
  onClearErrors?: () => void;
  onSelectError?: (error: CompileErrorItem) => void;
  onTogglePlay?: () => void;
  // バーチャルキーボード連携用 props
  activeTabContext?: ActiveTabContext;
  activeFmTone?: FmToneData;
  activePitchEnv?: number[];
  activePitchEnvLoop?: number;
  activeVolEnv?: number[];
  activeVolEnvLoop?: number;
  testMidiNote?: number;
  onChangeTestMidiNote?: (note: number) => void;
  // 右クリックコンテキストメニューから各エディタへの遷移コールバック
  onRequestEditTone?: (id: number) => void;
  onRequestEditVolEnv?: (id: number) => void;
  onRequestEditPitchEnv?: (id: number) => void;
  onRequestNewTone?: (newId: number) => void;
  onRequestNewVolEnv?: (newId: number) => void;
  onRequestNewPitchEnv?: (newId: number) => void;
  /** 下部エリアのアクティブタブ (外部制御可能) */
  activeBottomTab?: BottomTab;
  /** 下部エリアのアクティブタブ変更コールバック */
  onChangeBottomTab?: (tab: BottomTab) => void;
  /** 下部エリアの折りたたみ状態 (外部制御可能) */
  isBottomCollapsed?: boolean;
  /** 下部エリアの折りたたみ状態変更コールバック */
  onChangeBottomCollapsed?: (collapsed: boolean) => void;
  /** MMLスニペットをカーソル位置に挿入するためのエディタインスタンス取得コールバック */
  onEditorMount?: (editorInstance: editor.IStandaloneCodeEditor) => void;
  /** アクティブファイルの MML ソースが変化したときに通知する (BUILD / EXPORT 用) */
  onActiveSourceChange?: (source: string, fileName: string) => void;
  /** MMLエディタ領域 (上部エディタ/エクスプローラー) にフォーカスが当たった時の通知コールバック */
  onFocusEditor?: () => void;
  /** キャレット位置解析結果 (コンテキスト) が更新された時の通知コールバック */
  onCaretContextChange?: (context?: MmlCaretContext) => void;
  /** 演奏中かどうか (演奏位置ハイライト・トラッキングの有効化) */
  isPlaying?: boolean;
  /** トラックの現在データオフセット取得 (演奏位置ハイライト用、停止中は -1) */
  getTrackOffset?: (trackIndex: number) => number;
  /** 演奏位置 → MML 対応情報 (コンパイル成功時に App から渡される) */
  playbackMap?: PlaybackMapInfo | null;
}

export function MmlEditor({ 
  songMetadata, 
  onChangeSongMetadata,
  showRightPane,
  onToggleRightPane,
  logs,
  onClearLogs,
  errors,
  onClearErrors,
  onSelectError,
  onTogglePlay,
  activeTabContext = 'mml',
  activeFmTone,
  activePitchEnv,
  activePitchEnvLoop,
  activeVolEnv,
  activeVolEnvLoop,
  testMidiNote,
  onChangeTestMidiNote,
  onRequestEditTone,
  onRequestEditVolEnv,
  onRequestEditPitchEnv,
  onRequestNewTone,
  onRequestNewVolEnv,
  onRequestNewPitchEnv,
  activeBottomTab: propActiveBottomTab,
  onChangeBottomTab,
  isBottomCollapsed: propIsBottomCollapsed,
  onChangeBottomCollapsed,
  onEditorMount,
  onActiveSourceChange,
  onFocusEditor,
  onCaretContextChange,
  isPlaying = false,
  getTrackOffset,
  playbackMap,
}: MmlEditorProps) {
  const [files, setFiles] = useState<MmlFile[]>(DUMMY_FILES);
  const [activeFileId, setActiveFileId] = useState<string>(DUMMY_FILES[0].id);
  const [isExplorerOpen, setIsExplorerOpen] = useState<boolean>(true);
  const [explorerWidth, setExplorerWidth] = useState<number>(240);
  const [isDraggingExplorer, setIsDraggingExplorer] = useState<boolean>(false);

  // 下部エリア タブ化 & 上下リサイズ用ステート (controlled / uncontrolled 両立)
  const [internalActiveBottomTab, setInternalActiveBottomTab] = useState<BottomTab>('keyboard');
  const activeBottomTab = propActiveBottomTab ?? internalActiveBottomTab;
  const setActiveBottomTab = useCallback((tab: BottomTab) => {
    setInternalActiveBottomTab(tab);
    onChangeBottomTab?.(tab);
  }, [onChangeBottomTab]);

  const [bottomHeight, setBottomHeight] = useState<number>(180);
  const [isDraggingBottomSplitter, setIsDraggingBottomSplitter] = useState<boolean>(false);

  // 下部エリアの折りたたみ (タブバーのみ表示) とコンソールログコピーのフィードバック
  const [internalIsBottomCollapsed, setInternalIsBottomCollapsed] = useState<boolean>(false);
  const isBottomCollapsed = propIsBottomCollapsed ?? internalIsBottomCollapsed;
  const setIsBottomCollapsed = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof val === 'function' ? val(isBottomCollapsed) : val;
    setInternalIsBottomCollapsed(nextVal);
    onChangeBottomCollapsed?.(nextVal);
  }, [isBottomCollapsed, onChangeBottomCollapsed]);

  const [isLogsCopied, setIsLogsCopied] = useState<boolean>(false);


  // コンソールログ全文をクリップボードへコピーする
  const handleCopyLogs = useCallback((): void => {
    navigator.clipboard.writeText(logs.join('\n')).then(() => {
      setIsLogsCopied(true);
      window.setTimeout(() => setIsLogsCopied(false), 1500);
    }).catch(() => { /* ignore: クリップボードが利用できない環境 */ });
  }, [logs]);

  // MMLキャレットコンテキスト
  const [mmlCaretContext, setMmlCaretContext] = useState<MmlCaretContext | undefined>(undefined);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingFromExternalRef = useRef<boolean>(false);

  // Monaco Editor インスタンスの参照 (MMLスニペット挿入用)
  const monacoEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // 演奏中 MML ハイライト・トラッキング (Monaco デコレーション管理)
  const playbackHighlighterRef = useRef<MmlPlaybackHighlighter | null>(null);

  // 右クリックコンテキストメニュー コールバックの ref (stale closure 回避)
  const onRequestEditToneRef = useRef(onRequestEditTone);
  const onRequestEditVolEnvRef = useRef(onRequestEditVolEnv);
  const onRequestEditPitchEnvRef = useRef(onRequestEditPitchEnv);
  const onRequestNewToneRef = useRef(onRequestNewTone);
  const onRequestNewVolEnvRef = useRef(onRequestNewVolEnv);
  const onRequestNewPitchEnvRef = useRef(onRequestNewPitchEnv);
  const onTogglePlayRef = useRef(onTogglePlay);
  const onFocusEditorRef = useRef(onFocusEditor);
  const onCaretContextChangeRef = useRef(onCaretContextChange);

  // コールバック更新時にrefを同期
  useEffect(() => { onRequestEditToneRef.current = onRequestEditTone; }, [onRequestEditTone]);
  useEffect(() => { onRequestEditVolEnvRef.current = onRequestEditVolEnv; }, [onRequestEditVolEnv]);
  useEffect(() => { onRequestEditPitchEnvRef.current = onRequestEditPitchEnv; }, [onRequestEditPitchEnv]);
  useEffect(() => { onRequestNewToneRef.current = onRequestNewTone; }, [onRequestNewTone]);
  useEffect(() => { onRequestNewVolEnvRef.current = onRequestNewVolEnv; }, [onRequestNewVolEnv]);
  useEffect(() => { onRequestNewPitchEnvRef.current = onRequestNewPitchEnv; }, [onRequestNewPitchEnv]);
  useEffect(() => { onTogglePlayRef.current = onTogglePlay; }, [onTogglePlay]);
  useEffect(() => { onFocusEditorRef.current = onFocusEditor; }, [onFocusEditor]);
  useEffect(() => { onCaretContextChangeRef.current = onCaretContextChange; }, [onCaretContextChange]);

  // MMLキャレットコンテキスト変更を親コンポーネント (App) へ通知
  useEffect(() => {
    onCaretContextChangeRef.current?.(mmlCaretContext);
  }, [mmlCaretContext]);

  /** Monaco editor beforeMount: MML 言語定義・Monarch トークナイザー・テーマを登録 */
  const handleBeforeMount = useCallback((monaco: Monaco) => {
    setupMmlLanguage(monaco);
  }, []);

  /** Monaco editor onMount: インスタンス保持・Ctrl+Enter再生キーバインド・キャレットコンテキスト解析をセットアップする */
  const handleEditorMount = useCallback((editorInstance: editor.IStandaloneCodeEditor, _monaco: Monaco) => {
    setupMmlLanguage(_monaco);
    monacoEditorRef.current = editorInstance;
    playbackHighlighterRef.current = new MmlPlaybackHighlighter(editorInstance);
    onEditorMount?.(editorInstance);

    // Ctrl + Enter で再生/停止トグル (ref経由で最新のハンドラを実行して確実に停止可能に)
    editorInstance.addCommand(_monaco.KeyMod.CtrlCmd | _monaco.KeyCode.Enter, () => {
      onTogglePlayRef.current?.();
    });

    // エディタにフォーカスが当たった時にペインフォーカスを MML に切り替える
    editorInstance.onDidFocusEditorWidget(() => {
      onFocusEditorRef.current?.();
    });

    // カーソル位置変更時にMMLキャレットコンテキストを更新
    editorInstance.onDidChangeCursorPosition((e) => {
      const model = editorInstance.getModel();
      if (model) {
        const content = model.getValue();
        const ctx = parseMmlCaretContext(content, e.position.lineNumber, e.position.column);
        setMmlCaretContext(ctx);
      }
    });

    // 初期マウント時のカーソル位置解析
    const model = editorInstance.getModel();
    if (model) {
      const pos = editorInstance.getPosition() || { lineNumber: 1, column: 1 };
      setMmlCaretContext(parseMmlCaretContext(model.getValue(), pos.lineNumber, pos.column));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // クリップボード: 切り取り (Cut)
  const handleCut = useCallback(async () => {
    const ed = monacoEditorRef.current;
    if (!ed) return;
    ed.focus();
    const selection = ed.getSelection();
    const model = ed.getModel();
    if (!selection || !model) return;

    if (!selection.isEmpty()) {
      const selectedText = model.getValueInRange(selection);
      try {
        await navigator.clipboard.writeText(selectedText);
      } catch {
        document.execCommand('cut');
        return;
      }
      ed.executeEdits('cut', [{ range: selection, text: '', forceMoveMarkers: true }]);
    } else {
      // 選択範囲がない場合はカーソル行全体を切り取り
      const lineNumber = selection.startLineNumber;
      const lineContent = model.getLineContent(lineNumber);
      try {
        await navigator.clipboard.writeText(lineContent + '\n');
      } catch {
        document.execCommand('cut');
        return;
      }
      const totalLines = model.getLineCount();
      let range;
      if (lineNumber < totalLines) {
        range = {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber + 1,
          endColumn: 1,
        };
      } else if (lineNumber > 1) {
        const prevLineLen = model.getLineContent(lineNumber - 1).length + 1;
        range = {
          startLineNumber: lineNumber - 1,
          startColumn: prevLineLen,
          endLineNumber: lineNumber,
          endColumn: lineContent.length + 1,
        };
      } else {
        range = {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: lineContent.length + 1,
        };
      }
      ed.executeEdits('cut', [{ range, text: '', forceMoveMarkers: true }]);
    }
  }, []);

  // クリップボード: コピー (Copy)
  const handleCopy = useCallback(async () => {
    const ed = monacoEditorRef.current;
    if (!ed) return;
    ed.focus();
    const selection = ed.getSelection();
    const model = ed.getModel();
    if (!selection || !model) return;

    if (!selection.isEmpty()) {
      const selectedText = model.getValueInRange(selection);
      try {
        await navigator.clipboard.writeText(selectedText);
      } catch {
        document.execCommand('copy');
      }
    } else {
      // 選択範囲がない場合はカーソル行全体をコピー
      const lineNumber = selection.startLineNumber;
      const lineContent = model.getLineContent(lineNumber);
      try {
        await navigator.clipboard.writeText(lineContent + '\n');
      } catch {
        document.execCommand('copy');
      }
    }
  }, []);

  // クリップボード: 貼り付け (Paste)
  const handlePaste = useCallback(async () => {
    const ed = monacoEditorRef.current;
    if (!ed) return;
    ed.focus();
    try {
      const text = await navigator.clipboard.readText();
      if (text != null) {
        const selection = ed.getSelection() || {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
        };
        ed.executeEdits('paste', [{ range: selection, text, forceMoveMarkers: true }]);
        ed.focus();
        return;
      }
    } catch {
      // クリップボードAPIが拒否された場合は execCommand をフォールバック
      try {
        document.execCommand('paste');
      } catch {
        // ignore
      }
    }
  }, []);

  // 右クリックコンテキストメニューの表示状態 (overlay 方式)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entries: MmlContextMenuEntry[];
  } | null>(null);

  /** エディタ右クリック: 対象行の解析結果からメニュー項目を構築して表示 (overlay 方式) */
  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const ed = monacoEditorRef.current;
    if (!ed) return;

    // 右クリック位置の行を特定 (マウス座標ベースでカーソル位置に依存しない)
    const target = ed.getTargetAtClientPoint(e.clientX, e.clientY);
    const lineNumber = target?.position?.lineNumber;
    const position = target?.position;

    // もし右クリックした位置が既存の選択範囲外なら、右クリック位置にカーソルを合わせる (VS Code標準挙動)
    const currentSelection = ed.getSelection();
    if (position && currentSelection) {
      const isInsideSelection = !currentSelection.isEmpty() && 
        position.lineNumber >= currentSelection.startLineNumber &&
        position.lineNumber <= currentSelection.endLineNumber &&
        (position.lineNumber > currentSelection.startLineNumber || position.column >= currentSelection.startColumn) &&
        (position.lineNumber < currentSelection.endLineNumber || position.column <= currentSelection.endColumn);

      if (!isInsideSelection) {
        ed.setPosition(position);
      }
    }

    // 「編集」項目はマクロ定義ブロック (@N / @VEN / @PEN = { ... }) の行でのみ表示する。
    // 定義が複数行 (折り返し) にわたる場合はブロック内のどの行でも表示する。
    const definition = lineNumber != null
      ? findDefinitionAt(findDefinitionBlocks(ed.getModel()?.getValue() ?? ''), lineNumber)
      : null;

    // MML全文から新規採番用の未使用IDを算出
    const usedIds = collectUsedIds(ed.getModel()?.getValue() ?? '');
    const newToneId = nextAvailableId(usedIds.toneIds);
    const newVolEnvId = nextAvailableId(usedIds.volEnvIds);
    const newPitchEnvId = nextAvailableId(usedIds.pitchEnvIds);

    const entries: MmlContextMenuEntry[] = [];

    // 定義ブロック内の行のみ「編集」項目を表示 (利用箇所では表示しない)
    if (definition !== null) {
      const definitionId = definition.id;
      switch (definition.kind) {
        case 'tone':
          entries.push({
            id: 'edit-tone',
            label: `@${definitionId} を TONE エディタで編集`,
            icon: AudioWaveform,
            onSelect: () => onRequestEditToneRef.current?.(definitionId),
          });
          break;
        case 'volEnv':
          entries.push({
            id: 'edit-vol-env',
            label: `@VE${definitionId} を VOL ENV エディタで編集`,
            icon: TrendingUp,
            onSelect: () => onRequestEditVolEnvRef.current?.(definitionId),
          });
          break;
        case 'pitchEnv':
          entries.push({
            id: 'edit-pitch-env',
            label: `@PE${definitionId} を PITCH ENV エディタで編集`,
            icon: ChartLine,
            onSelect: () => onRequestEditPitchEnvRef.current?.(definitionId),
          });
          break;
      }
    }
    if (entries.length > 0) {
      entries.push({ type: 'separator' });
    }

    // クリップボード標準アクション (切り取り・コピー・貼り付け)
    entries.push(
      {
        id: 'cut',
        label: '切り取り',
        icon: Scissors,
        shortcut: 'Ctrl+X',
        onSelect: () => { void handleCut(); },
      },
      {
        id: 'copy',
        label: 'コピー',
        icon: Copy,
        shortcut: 'Ctrl+C',
        onSelect: () => { void handleCopy(); },
      },
      {
        id: 'paste',
        label: '貼り付け',
        icon: ClipboardPaste,
        shortcut: 'Ctrl+V',
        onSelect: () => { void handlePaste(); },
      },
    );

    entries.push({ type: 'separator' });

    // 新規作成 (常時表示・メニューを開いた時点で未使用IDを採番)
    entries.push(
      {
        id: 'new-tone',
        label: '新規 FM TONE を挿入...',
        icon: AudioWaveform,
        onSelect: () => onRequestNewToneRef.current?.(newToneId),
      },
      {
        id: 'new-vol-env',
        label: '新規 VOL ENV を挿入...',
        icon: TrendingUp,
        onSelect: () => onRequestNewVolEnvRef.current?.(newVolEnvId),
      },
      {
        id: 'new-pitch-env',
        label: '新規 PITCH ENV を挿入...',
        icon: ChartLine,
        onSelect: () => onRequestNewPitchEnvRef.current?.(newPitchEnvId),
      },
    );

    setContextMenu({ x: e.clientX, y: e.clientY, entries });
  }, [handleCut, handleCopy, handlePaste]);

  const activeFile = files.find(f => f.id === activeFileId) || files[0];

  // アクティブファイルの MML ソース変化を App へ通知 (BUILD / EXPORT で使用)
  const onActiveSourceChangeRef = useRef(onActiveSourceChange);
  useEffect(() => {
    onActiveSourceChangeRef.current = onActiveSourceChange;
  });

  useEffect(() => {
    onActiveSourceChangeRef.current?.(activeFile.content, activeFile.name);
  }, [activeFile.content, activeFile.name]);

  // ---- 演奏中 MML ハイライト・トラッキング (100ms ポーリング) ----

  // ポーリング内で参照する最新の props / アクティブソース (stale closure 回避)
  const playbackTrackingRef = useRef({
    isPlaying,
    getTrackOffset,
    playbackMap,
    activeSource: activeFile.content,
  });

  useEffect(() => {
    playbackTrackingRef.current = {
      isPlaying,
      getTrackOffset,
      playbackMap,
      activeSource: activeFile.content,
    };
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const highlighter = playbackHighlighterRef.current;
      if (highlighter === null) {
        return;
      }

      const tracking = playbackTrackingRef.current;
      const map = tracking.playbackMap?.map ?? null;
      // コンパイル時のソースと現在のエディタ内容が一致しない場合は位置ズレ防止のためハイライトを消す
      const isSourceCurrent = tracking.playbackMap != null && tracking.playbackMap.source === tracking.activeSource;

      if (!tracking.isPlaying || tracking.getTrackOffset === undefined || map === null || !isSourceCurrent) {
        highlighter.clear();
        return;
      }

      highlighter.update(resolvePlaybackPositions(map, tracking.getTrackOffset));
    }, 100);

    return () => clearInterval(timer);
  }, []);

  // アンマウント時にデコレーションを破棄
  useEffect(() => {
    return () => {
      playbackHighlighterRef.current?.dispose();
      playbackHighlighterRef.current = null;
    };
  }, []);


  // SongSetupPanel から songMetadata が変更された時に MML ファイル内容を同期
  const prevMetadataRef = useRef<SongMetadata>(songMetadata);
  const isInitialMountRef = useRef<boolean>(true);

  if (isInitialMountRef.current) {
    isInitialMountRef.current = false;
    prevMetadataRef.current = songMetadata;
  } else if (
    prevMetadataRef.current.title !== songMetadata.title ||
    prevMetadataRef.current.composer !== songMetadata.composer ||
    prevMetadataRef.current.octaveDirection !== songMetadata.octaveDirection ||
    prevMetadataRef.current.enableYM2151 !== songMetadata.enableYM2151
  ) {
    prevMetadataRef.current = songMetadata;

    const curContent = activeFile.content;
    const updatedContent = applyMetadataToContent(curContent, songMetadata);

    if (updatedContent !== curContent) {
      isUpdatingFromExternalRef.current = true;
      setFiles(prev => prev.map(f => 
        f.id === activeFileId ? { ...f, content: updatedContent } : f
      ));
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    const newContent = value || '';
    setFiles(prev => prev.map(f => 
      f.id === activeFileId ? { ...f, content: newContent } : f
    ));

    if (!isUpdatingFromExternalRef.current) {
      const parsed = parseSongMetadata(newContent);
      if (
        parsed.title !== prevMetadataRef.current.title ||
        parsed.composer !== prevMetadataRef.current.composer ||
        parsed.octaveDirection !== prevMetadataRef.current.octaveDirection ||
        parsed.enableYM2151 !== prevMetadataRef.current.enableYM2151
      ) {
        prevMetadataRef.current = parsed;
        onChangeSongMetadata(parsed);
      }
    }
    isUpdatingFromExternalRef.current = false;
  };

  // エクスプローラーとエディタ間の左右スプリッタードラッグハンドラ
  const handleExplorerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingExplorer(true);

    const startX = e.clientX;
    const startWidth = explorerWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(140, Math.min(460, startWidth + deltaX));
      setExplorerWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsDraggingExplorer(false);
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

  // 下部パネル (エディタ ⇔ 下部タブエリア) 上下ドラッグハンドラ
  const handleBottomSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingBottomSplitter(true);

    const startY = e.clientY;
    const startHeight = bottomHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const deltaY = moveEvent.clientY - startY;
      // 上にドラッグすると下部パネルが拡大、下にドラッグすると縮小
      const newHeight = Math.max(60, Math.min(480, startHeight - deltaY));
      setBottomHeight(newHeight);
    };

    const onMouseUp = () => {
      setIsDraggingBottomSplitter(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  // エクスプローラーからファイルを選択した時のハンドラ
  const handleSelectFile = (fileItem: { id: string; name: string; content?: string }) => {
    const existing = files.find(f => f.id === fileItem.id);
    if (existing) {
      setActiveFileId(existing.id);
      const parsed = parseSongMetadata(existing.content);
      prevMetadataRef.current = parsed;
      onChangeSongMetadata(parsed);
    } else {
      const newFile: MmlFile = {
        id: fileItem.id,
        name: fileItem.name,
        content: fileItem.content ?? `; MML Source: ${fileItem.name}\n\n#TITLE "${fileItem.name}"\n\nP1 t120 l8 o4 c d e\n`,
      };
      setFiles(prev => [...prev, newFile]);
      setActiveFileId(newFile.id);
      const parsed = parseSongMetadata(newFile.content);
      prevMetadataRef.current = parsed;
      onChangeSongMetadata(parsed);
    }
  };

  // タブを閉じる
  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (files.length <= 1) return;
    const nextFiles = files.filter(f => f.id !== id);
    setFiles(nextFiles);
    if (activeFileId === id) {
      setActiveFileId(nextFiles[0].id);
      const parsed = parseSongMetadata(nextFiles[0].content);
      prevMetadataRef.current = parsed;
      onChangeSongMetadata(parsed);
    }
  };

  // 新規タブ追加
  const handleAddNewTab = () => {
    const newId = `new-${Date.now()}`;
    const newName = `untitled_${files.length + 1}.mml`;
    const newFile: MmlFile = {
      id: newId,
      name: newName,
      content: `; New MML File\n\nP1 t120 l8 o4 c d e f\n`,
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newId);
  };

  /** PROBLEMS パネルのエラー行選択時: 対象ファイルタブへ切替し、MMLエディタの該当箇所 (Line, Col) を選択・スクロール・フォーカスする */
  const handleSelectErrorItem = useCallback((item: CompileErrorItem) => {
    // 1. ファイルが異なる場合は該当ファイルタブへ切り替え
    const targetFile = files.find(f => f.name === item.sourceFile);
    const fileSwitched = targetFile != null && targetFile.id !== activeFileId;
    if (fileSwitched && targetFile) {
      setActiveFileId(targetFile.id);
      const parsed = parseSongMetadata(targetFile.content);
      prevMetadataRef.current = parsed;
      onChangeSongMetadata(parsed);
    }

    // 2. Monaco Editor 上で該当箇所を選択・スクロール・フォーカス
    const applyJump = () => {
      const ed = monacoEditorRef.current;
      if (!ed) return;
      const model = ed.getModel();
      if (!model) return;

      const lineCount = model.getLineCount();
      const line = Math.max(1, Math.min(item.line, lineCount));
      const maxCol = model.getLineMaxColumn(line);
      const col = Math.max(1, Math.min(item.column, maxCol));

      let startCol = col;
      let endCol = col;

      // 該当位置の単語または文字を選択範囲として特定
      const word = model.getWordAtPosition({ lineNumber: line, column: col });
      if (word && word.startColumn <= col && col <= word.endColumn) {
        startCol = word.startColumn;
        endCol = word.endColumn;
      } else if (col < maxCol) {
        startCol = col;
        endCol = col + 1;
      } else if (maxCol > 1) {
        startCol = Math.max(1, maxCol - 1);
        endCol = maxCol;
      }

      ed.setSelection({
        startLineNumber: line,
        startColumn: startCol,
        endLineNumber: line,
        endColumn: endCol,
      });
      ed.revealPositionInCenter({ lineNumber: line, column: startCol });
      ed.focus();
    };

    if (fileSwitched) {
      // ファイル切り替え時はモデルのバインド完了を待ってから実行
      window.setTimeout(applyJump, 50);
    } else {
      applyJump();
    }

    // 外部コールバック (App側のログ記録等) も実行
    onSelectError?.(item);
  }, [files, activeFileId, onChangeSongMetadata, onSelectError]);

  return (

    <div ref={editorContainerRef} className="flex flex-col h-full w-full bg-[#090a0f] overflow-hidden relative">
      {/* リサイズ中の全画面オーバーレイ */}
      {(isDraggingExplorer || isDraggingBottomSplitter) && (
        <div className={`fixed inset-0 z-50 select-none ${
          isDraggingExplorer ? 'cursor-col-resize' : 'cursor-row-resize'
        }`} />
      )}

      {/* 上部エリア (横並び): エクスプローラー + エディタ主ペイン。
           下部タブエリア (PROBLEMS / CONSOLE / KEYBOARD) はこの外側に配置し、エクスプローラーを含む左ペイン全幅で表示する */}
      <div 
        className="flex flex-row flex-1 min-h-0 overflow-hidden"
        onMouseDownCapture={() => onFocusEditorRef.current?.()}
      >

      {/* 左ペイン内 エクスプローラー (開閉可能 & 幅リサイズ可能) */}
      {isExplorerOpen && (
        <>
          <FileExplorer
            onSelectFile={handleSelectFile}
            activeFileId={activeFileId}
            width={explorerWidth}
          />
          {/* エクスプローラーのリサイザーバー */}
          <div
            onMouseDown={handleExplorerMouseDown}
            onDoubleClick={() => setExplorerWidth(240)}
            className="w-2 -mx-1 h-full cursor-col-resize z-20 shrink-0 flex items-center justify-center group select-none relative"
            title="エクスプローラー幅をドラッグして変更 (ダブルクリックで初期化)"
          >
            <div className={`w-0.5 h-full transition-colors duration-150 ${
              isDraggingExplorer 
                ? 'bg-[#00A8FF] shadow-[0_0_8px_rgba(0,168,255,0.8)]' 
                : 'bg-white/[0.08] group-hover:bg-[#00A8FF]/60'
            }`} />
          </div>
        </>
      )}

      {/* エディタ主ペイン (EXPLORER の右側エリア: タブバー + Monaco) */}
      <div className="flex flex-col flex-1 h-full min-w-0 overflow-hidden bg-[#1E1E1E]">
        {/* Tab Bar */}
        <div className="h-9 flex flex-row items-stretch bg-[#282828] border-b border-[#3C3C3C] overflow-x-auto shrink-0">
          {/* エクスプローラー開閉トグルボタン (最左端) */}
          <button
            onClick={() => setIsExplorerOpen(prev => !prev)}
            className={`px-2.5 text-xs font-mono border-r border-[#3C3C3C] transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
              isExplorerOpen 
                ? 'text-[#00A8FF] bg-[#1E1E1E]' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#333333]'
            }`}
            title={isExplorerOpen ? 'Close Explorer Sidebar' : 'Open Explorer Sidebar'}
          >
            {isExplorerOpen ? (
              <PanelLeftClose className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <PanelLeftOpen className="w-3.5 h-3.5 shrink-0" />
            )}
          </button>

          {/* ファイルタブ一覧 */}
          {files.map(file => {
            const isActive = file.id === activeFileId;
            return (
              <div
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                className={`px-3.5 text-xs font-mono cursor-pointer transition-colors border-r border-[#3C3C3C] flex items-center gap-2 select-none shrink-0 ${
                  isActive 
                    ? 'bg-[#1E1E1E] text-zinc-100 border-b-2 border-b-[#00A8FF] font-semibold' 
                    : 'bg-[#282828] text-zinc-400 hover:text-zinc-200 hover:bg-[#333333]'
                }`}
              >
                <FileCode className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#00A8FF]' : 'text-zinc-500'}`} />
                <span>{file.name}</span>
                {files.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(e, file.id)}
                    className="ml-1 text-zinc-500 hover:text-zinc-200 hover:bg-[#383838] rounded p-0.5 transition-colors cursor-pointer"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* 新規タブ作成ボタン */}
          <button
            onClick={handleAddNewTab}
            className="w-8 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-[#333333] transition-colors shrink-0 cursor-pointer"
            title="New untitled file"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* 右ペイン開閉トグルボタン (最右端) */}
          <button
            onClick={onToggleRightPane}
            className={`px-2.5 text-xs font-mono border-l border-[#3C3C3C] transition-colors flex items-center gap-1.5 shrink-0 ml-auto cursor-pointer ${
              showRightPane 
                ? 'text-[#00A8FF] bg-[#1E1E1E]' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#333333]'
            }`}
            title={showRightPane ? '右側パネルを閉じる (Hide Right Pane)' : '右側パネルを開く (Show Right Pane)'}
          >
            {showRightPane ? (
              <PanelRightClose className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5 shrink-0 text-[#00A8FF]" />
            )}
            <span className="text-[10px] hidden sm:inline">{showRightPane ? 'HIDE' : 'PANE'}</span>
          </button>
        </div>

        {/* 1. Monaco Editor Area (自動伸縮) / 右クリックでカスタムコンテキストメニュー */}
        <div
          className="flex-1 relative bg-[#1e1e1e] min-h-[100px] overflow-hidden"
          onContextMenu={handleEditorContextMenu}
        >
          <Editor
            height="100%"
            language={MML_LANGUAGE_ID}
            theme={MML_THEME_NAME}
            beforeMount={handleBeforeMount}
            value={activeFile.content}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 12.5,
              fontFamily: '"Cascadia Code", "Fira Code", monospace',
              lineHeight: 20,
              padding: { top: 12 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              renderLineHighlight: 'all',
              mouseWheelZoom: true,
              contextmenu: false,
            }}
          />

          {/* カスタム右クリックコンテキストメニュー (右ペインタブと同一の Lucide アイコン) */}
          {contextMenu && (
            <MmlContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              entries={contextMenu.entries}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
      </div>
      </div>

      {/* 上下スプリッター (エディタ ⇔ 下部タブエリア) ※折りたたみ中は非表示・左ペイン全幅 */}
        <div
          hidden={isBottomCollapsed}
          onMouseDown={handleBottomSplitterMouseDown}
          onDoubleClick={() => setBottomHeight(160)}
          className="h-2 -my-1 w-full cursor-row-resize z-20 shrink-0 flex items-center justify-center group select-none relative"
          title="ドラッグして下部エリアの高さを変更 (ダブルクリックで160pxにリセット)"
        >
          <div className={`h-0.5 w-full transition-colors duration-150 ${
            isDraggingBottomSplitter
              ? 'bg-[#00A8FF] shadow-[0_0_8px_rgba(0,168,255,0.8)]'
              : 'bg-[#3C3C3C] group-hover:bg-[#00A8FF]/60'
          }`} />
        </div>

        {/* 下部エリア (タブバー + コンテンツ: PROBLEMS / CONSOLE + 今後の拡張エリア) */}
        <div 
          style={{ height: `${isBottomCollapsed ? BOTTOM_COLLAPSED_HEIGHT_PX : bottomHeight}px` }} 
          className="bg-[#1E1E1E] border-t border-[#3C3C3C] flex flex-col font-mono text-xs select-none shrink-0 overflow-hidden"
        >
          {/* 下部タブバー */}
          <div className="h-7 px-2 bg-[#242424] border-b border-[#3C3C3C] flex items-center justify-between shrink-0">
            {/* タブ切り替えボタン一覧 */}
            <div className="flex items-center gap-1 h-full">
              {/* 1. PROBLEMS タブ */}
              <button
                onClick={() => setActiveBottomTab('problems')}
                className={`h-full px-2.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
                  activeBottomTab === 'problems'
                    ? 'text-zinc-100 bg-[#1E1E1E] border-b-[#00A8FF]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#2C2C2C] border-b-transparent'
                }`}
                title="コンパイルエラー・問題一覧を表示"
              >
                <AlertCircle className="w-3.5 h-3.5 text-zinc-400" />
                <span>PROBLEMS</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                  errors.filter(e => e.severity === 'error').length > 0 
                    ? 'bg-red-950/80 text-red-300 border border-red-700/60' 
                    : errors.filter(e => e.severity === 'warning').length > 0 
                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/60' 
                      : 'bg-[#333333] text-zinc-400'
                }`}>
                  {errors.length}
                </span>
              </button>

              {/* 2. SYSTEM CONSOLE タブ */}
              <button
                onClick={() => setActiveBottomTab('console')}
                className={`h-full px-2.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
                  activeBottomTab === 'console'
                    ? 'text-zinc-100 bg-[#1E1E1E] border-b-[#00A8FF]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#2C2C2C] border-b-transparent'
                }`}
                title="システムコンソールログを表示"
              >
                <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                <span>CONSOLE</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#333333] text-zinc-400 font-mono">
                  {logs.length}
                </span>
              </button>

              {/* 3. VIRTUAL KEYBOARD タブ */}
              <button
                onClick={() => setActiveBottomTab('keyboard')}
                className={`h-full px-2.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
                  activeBottomTab === 'keyboard'
                    ? 'text-zinc-100 bg-[#1E1E1E] border-b-[#00A8FF]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#2C2C2C] border-b-transparent'
                }`}
                title="バーチャルキーボードを表示"
              >
                <Music className={`w-3.5 h-3.5 ${activeBottomTab === 'keyboard' ? 'text-[#00A8FF]' : 'text-zinc-400'}`} />
                <span>KEYBOARD</span>
              </button>
            </div>

            {/* タブ右側 アクションボタン */}
            <div className="flex items-center gap-1.5">
              {activeBottomTab === 'console' && (
                <button
                  onClick={handleCopyLogs}
                  className="h-5 px-2 rounded bg-[#333333] hover:bg-[#3E3E3E] text-zinc-400 hover:text-zinc-200 text-[10px] font-mono border border-[#484848] transition-colors cursor-pointer flex items-center gap-1"
                  title="コンソールログ全文をクリップボードへコピー"
                >
                  {isLogsCopied
                    ? <Check className="w-3 h-3 text-emerald-400" />
                    : <Copy className="w-3 h-3" />}
                  {isLogsCopied ? 'COPIED' : 'COPY'}
                </button>
              )}
              {activeBottomTab === 'problems' && errors.length > 0 && onClearErrors && (
                <button
                  onClick={onClearErrors}
                  className="h-5 px-2 rounded bg-[#333333] hover:bg-[#3E3E3E] text-zinc-400 hover:text-zinc-200 text-[10px] font-mono border border-[#484848] transition-colors cursor-pointer"
                  title="エラー一覧をクリア"
                >
                  CLEAR
                </button>
              )}
              {activeBottomTab === 'console' && (
                <button 
                  onClick={onClearLogs}
                  className="h-5 px-2 rounded bg-[#333333] hover:bg-[#3E3E3E] text-zinc-400 hover:text-zinc-200 text-[10px] font-mono border border-[#484848] transition-colors cursor-pointer"
                  title="コンソールログをクリア"
                >
                  CLEAR
                </button>
              )}

              {/* 下部エリアの折りたたみトグル (タブに依存せず常時表示) */}
              <button
                onClick={() => setIsBottomCollapsed(prev => !prev)}
                className="h-5 w-5 rounded bg-[#333333] hover:bg-[#3E3E3E] text-zinc-400 hover:text-zinc-200 border border-[#484848] transition-colors cursor-pointer flex items-center justify-center"
                title={isBottomCollapsed ? '下部エリアを展開' : '下部エリアを折りたたむ'}
              >
                {isBottomCollapsed
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* タブコンテンツ */}
          <div className="flex-1 overflow-hidden relative">
            {activeBottomTab === 'keyboard' && (
              <VirtualKeyboard
                activeTabContext={activeTabContext}
                mmlContext={mmlCaretContext}
                activeFmTone={activeFmTone}
                activePitchEnv={activePitchEnv}
                activePitchEnvLoop={activePitchEnvLoop}
                activeVolEnv={activeVolEnv}
                activeVolEnvLoop={activeVolEnvLoop}
                testMidiNote={testMidiNote}
                onChangeTestMidiNote={onChangeTestMidiNote}
              />
            )}

            {activeBottomTab === 'problems' && (
              <CompileErrorPanel 
                errors={errors}
                onSelectError={handleSelectErrorItem}
                onClearErrors={onClearErrors}
                embedded
              />
            )}

            {activeBottomTab === 'console' && (
              <ConsolePanel logs={logs} />
            )}
          </div>
        </div>
    </div>
  );
}
