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
  ChartLine
} from 'lucide-react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { FileExplorer } from './FileExplorer';
import { CompileErrorPanel, type CompileErrorItem } from './CompileErrorPanel';
import type { SongMetadata } from './SongSetupPanel';
import { VirtualKeyboard, type ActiveTabContext } from './VirtualKeyboard';
import { parseMmlCaretContext, type MmlCaretContext } from '../utils/mmlCaretParser';
import { analyzeMmlLine, collectUsedIds, nextAvailableId } from '../utils/mmlContextParser';
import { MmlContextMenu, type MmlContextMenuEntry } from './MmlContextMenu';
import type { FmToneData } from './FmToneEditor';

interface MmlFile {
  id: string;
  name: string;
  content: string;
}

const DUMMY_FILES: MmlFile[] = [
  {
    id: '1',
    name: 'main.mml',
    content: '; MZ-1500 MML Example\n\n#TITLE "Theme of MZ"\n#COMPOSER "User"\n#OPM OFF\n#OCTAVE NORMAL\n\n; FM音色定義 (#OPM ON 時に F1〜F8 トラックで @1 を指定して使用)\n@1 = {\n  4, 6,\n  31, 12, 3, 0, 15, 24, 1, 0, 0,\n  31, 18, 5, 0, 12, 18, 2, 3, 0,\n  31, 10, 2, 0, 15, 30, 1, 0, 0,\n  31,  8, 4, 0,  8,  0, 1, 0, 0\n}\n@v1 = { 15, 14, 13, |L 12, 12, |R 8, 5, 2, 0 }\n@PE1 = { |L 0, 2, 4, 6, 8, 6, 4, 2 }\n\n; 各行を右クリックすると対応エディタで編集できます\nP1 t120 l8 o4 @v1 @PE1\nP1 c e g > c < g e c r\nP1 L [c d e f g2]2\n'
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
  // 右クリックコンテキストメニューから各エディタへの遷移コールバック
  onRequestEditTone?: (id: number) => void;
  onRequestEditVolEnv?: (id: number) => void;
  onRequestEditPitchEnv?: (id: number) => void;
  onRequestNewTone?: (newId: number) => void;
  onRequestNewVolEnv?: (newId: number) => void;
  onRequestNewPitchEnv?: (newId: number) => void;
  /** MMLスニペットをカーソル位置に挿入するためのエディタインスタンス取得コールバック */
  onEditorMount?: (editorInstance: editor.IStandaloneCodeEditor) => void;
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
  onRequestEditTone,
  onRequestEditVolEnv,
  onRequestEditPitchEnv,
  onRequestNewTone,
  onRequestNewVolEnv,
  onRequestNewPitchEnv,
  onEditorMount,
}: MmlEditorProps) {
  const [files, setFiles] = useState<MmlFile[]>(DUMMY_FILES);
  const [activeFileId, setActiveFileId] = useState<string>(DUMMY_FILES[0].id);
  const [isExplorerOpen, setIsExplorerOpen] = useState<boolean>(true);
  const [explorerWidth, setExplorerWidth] = useState<number>(240);
  const [isDraggingExplorer, setIsDraggingExplorer] = useState<boolean>(false);

  // 下部エリア タブ化 & 上下リサイズ用ステート (デフォルトで KEYBOARD タブを選択可能に)
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('keyboard');
  const [bottomHeight, setBottomHeight] = useState<number>(180);
  const [isDraggingBottomSplitter, setIsDraggingBottomSplitter] = useState<boolean>(false);

  // MMLキャレットコンテキスト
  const [mmlCaretContext, setMmlCaretContext] = useState<MmlCaretContext | undefined>(undefined);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingFromExternalRef = useRef<boolean>(false);

  // Monaco Editor インスタンスの参照 (MMLスニペット挿入用)
  const monacoEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // 右クリックコンテキストメニュー コールバックの ref (stale closure 回避)
  const onRequestEditToneRef = useRef(onRequestEditTone);
  const onRequestEditVolEnvRef = useRef(onRequestEditVolEnv);
  const onRequestEditPitchEnvRef = useRef(onRequestEditPitchEnv);
  const onRequestNewToneRef = useRef(onRequestNewTone);
  const onRequestNewVolEnvRef = useRef(onRequestNewVolEnv);
  const onRequestNewPitchEnvRef = useRef(onRequestNewPitchEnv);

  // コールバック更新時にrefを同期
  useEffect(() => { onRequestEditToneRef.current = onRequestEditTone; }, [onRequestEditTone]);
  useEffect(() => { onRequestEditVolEnvRef.current = onRequestEditVolEnv; }, [onRequestEditVolEnv]);
  useEffect(() => { onRequestEditPitchEnvRef.current = onRequestEditPitchEnv; }, [onRequestEditPitchEnv]);
  useEffect(() => { onRequestNewToneRef.current = onRequestNewTone; }, [onRequestNewTone]);
  useEffect(() => { onRequestNewVolEnvRef.current = onRequestNewVolEnv; }, [onRequestNewVolEnv]);
  useEffect(() => { onRequestNewPitchEnvRef.current = onRequestNewPitchEnv; }, [onRequestNewPitchEnv]);

  /** Monaco editor onMount: インスタンス保持・Ctrl+Enter再生キーバインド・キャレットコンテキスト解析をセットアップする */
  const handleEditorMount = useCallback((editorInstance: editor.IStandaloneCodeEditor, _monaco: Monaco) => {
    monacoEditorRef.current = editorInstance;
    onEditorMount?.(editorInstance);

    // Ctrl + Enter で再生/停止トグル
    editorInstance.addCommand(_monaco.KeyMod.CtrlCmd | _monaco.KeyCode.Enter, () => {
      onTogglePlay?.();
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
    const lineContent = lineNumber != null
      ? ed.getModel()?.getLineContent(lineNumber) ?? ''
      : '';
    const analysis = analyzeMmlLine(lineContent);

    // MML全文から新規採番用の未使用IDを算出
    const usedIds = collectUsedIds(ed.getModel()?.getValue() ?? '');
    const newToneId = nextAvailableId(usedIds.toneIds);
    const newVolEnvId = nextAvailableId(usedIds.volEnvIds);
    const newPitchEnvId = nextAvailableId(usedIds.pitchEnvIds);

    const entries: MmlContextMenuEntry[] = [];

    // 対象IDを含む行のみ「編集」項目を表示
    if (analysis.toneId != null) {
      const toneId = analysis.toneId;
      entries.push({
        id: 'edit-tone',
        label: `@${toneId} を TONE エディタで編集`,
        icon: AudioWaveform,
        onSelect: () => onRequestEditToneRef.current?.(toneId),
      });
    }
    if (analysis.volEnvId != null) {
      const volEnvId = analysis.volEnvId;
      entries.push({
        id: 'edit-vol-env',
        label: `@VE${volEnvId} を VOL ENV エディタで編集`,
        icon: TrendingUp,
        onSelect: () => onRequestEditVolEnvRef.current?.(volEnvId),
      });
    }
    if (analysis.pitchEnvId != null) {
      const pitchEnvId = analysis.pitchEnvId;
      entries.push({
        id: 'edit-pitch-env',
        label: `@PE${pitchEnvId} を PITCH ENV エディタで編集`,
        icon: ChartLine,
        onSelect: () => onRequestEditPitchEnvRef.current?.(pitchEnvId),
      });
    }
    if (entries.length > 0) {
      entries.push({ type: 'separator' });
    }

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
  }, []);

  const activeFile = files.find(f => f.id === activeFileId) || files[0];


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
  const handleSelectFile = (fileItem: { id: string; name: string }) => {
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
        content: `; MML Source: ${fileItem.name}\n\n#TITLE "${fileItem.name}"\n\nP1 t120 l8 o4 c d e\n`,
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

  return (
    <div ref={editorContainerRef} className="flex flex-row h-full w-full bg-[#090a0f] overflow-hidden relative">
      {/* リサイズ中の全画面オーバーレイ */}
      {(isDraggingExplorer || isDraggingBottomSplitter) && (
        <div className={`fixed inset-0 z-50 select-none ${
          isDraggingExplorer ? 'cursor-col-resize' : 'cursor-row-resize'
        }`} />
      )}

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

      {/* エディタ主ペイン (EXPLORER の右側エリア: タブバー + Monaco + エラーパネル + コンソール) */}
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
            language="plaintext"
            theme="vs-dark"
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

        {/* スプリッター (エディタ ⇔ 下部タブエリア) */}
        <div
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
          style={{ height: `${bottomHeight}px` }} 
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
              />
            )}

            {activeBottomTab === 'problems' && (
              <CompileErrorPanel 
                errors={errors}
                onSelectError={onSelectError}
                onClearErrors={onClearErrors}
                embedded
              />
            )}

            {activeBottomTab === 'console' && (
              <div className="h-full p-3 font-mono text-xs overflow-y-auto space-y-1 bg-[#1A1A1A]">
                {logs.map((log, index) => {
                  const isError = log.includes('[ERROR]');
                  const isBuild = log.includes('[BUILD]');
                  const isSuccess = log.includes('SUCCESS');
                  return (
                    <div 
                      key={index} 
                      className={
                        isError 
                          ? 'text-red-400' 
                          : isSuccess 
                            ? 'text-emerald-400' 
                            : isBuild 
                              ? 'text-cyan-300' 
                              : 'text-zinc-400'
                      }
                    >
                      {'>'} {log}
                    </div>
                  );
                })}
                <div className="animate-pulse text-zinc-400 font-bold">{'_'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
