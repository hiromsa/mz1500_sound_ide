import { useState, useRef, useEffect } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  ChevronRight, 
  ChevronDown, 
  FilePlus, 
  FolderPlus, 
  Pencil, 
  Trash2,
  Music2,
  FolderX
} from 'lucide-react';
import { SAMPLE_MML_FILES } from '../data/sampleMmlSongs';
import { saveWorkspaceFolder, loadWorkspaceFolder, clearWorkspaceFolder } from '../utils/workspaceStorage';

export interface FileItem {
  id: string;
  name: string;
  isFolder: boolean;
  isOpen?: boolean;
  children?: FileItem[];
  isSample?: boolean;
  file?: File;
  content?: string;
}

/** テキストファイルかどうか判定 */
function isTextFile(fileName: string): boolean {
  return /\.(mml|txt|inc|asm|h|json|md)$/i.test(fileName);
}

/** File オブジェクト群 (webkitRelativePath を持つ) から階層ツリーを構築する */
async function buildFileTreeFromFiles(fileList: File[]): Promise<{ tree: FileItem[]; folderName: string; allMmlFiles: FileItem[] }> {
  if (fileList.length === 0) {
    return { tree: [], folderName: '', allMmlFiles: [] };
  }

  const rootFolderName = fileList[0].webkitRelativePath?.split('/')[0] || 'local_project';
  const allMmlFiles: FileItem[] = [];

  const rootNode: FileItem = {
    id: `local-root-${Date.now()}`,
    name: rootFolderName,
    isFolder: true,
    isOpen: true,
    children: [],
  };

  for (const file of fileList) {
    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split('/');
    let preloadedContent: string | undefined = undefined;
    if (isTextFile(file.name) && file.size < 2 * 1024 * 1024) {
      try {
        preloadedContent = await file.text();
      } catch (e) {
        console.warn('Failed to preload file content:', e);
      }
    }

    if (parts.length <= 1) {
      const item: FileItem = {
        id: `local-file-${file.name}-${file.lastModified}`,
        name: file.name,
        isFolder: false,
        file,
        content: preloadedContent,
      };
      rootNode.children!.push(item);
      if (file.name.toLowerCase().endsWith('.mml')) allMmlFiles.push(item);
      continue;
    }

    let currentChildren = rootNode.children!;
    for (let i = 1; i < parts.length - 1; i++) {
      const folderName = parts[i];
      let folder = currentChildren.find((c) => c.isFolder && c.name === folderName);
      if (!folder) {
        folder = {
          id: `local-dir-${folderName}-${i}-${Date.now()}`,
          name: folderName,
          isFolder: true,
          isOpen: true,
          children: [],
        };
        currentChildren.push(folder);
      }
      currentChildren = folder.children!;
    }

    const fileName = parts[parts.length - 1];
    const fileItem: FileItem = {
      id: `local-file-${file.name}-${file.lastModified}-${Math.random()}`,
      name: fileName,
      isFolder: false,
      file,
      content: preloadedContent,
    };
    currentChildren.push(fileItem);
    if (fileName.toLowerCase().endsWith('.mml')) allMmlFiles.push(fileItem);
  }

  // フォルダ先行、名前順ソート
  const sortTree = (nodes: FileItem[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children) sortTree(n.children);
    });
  };
  sortTree(rootNode.children!);

  return { tree: [rootNode], folderName: rootFolderName, allMmlFiles };
}

/** File System Access API (showDirectoryPicker) から再帰的にツリーを構築する */
async function scanDirectoryPicker(dirHandle: any): Promise<{ tree: FileItem[]; folderName: string; allMmlFiles: FileItem[] }> {
  const rootFolderName = dirHandle.name;
  const rootNode: FileItem = {
    id: `local-root-${Date.now()}`,
    name: rootFolderName,
    isFolder: true,
    isOpen: true,
    children: [],
  };
  const allMmlFiles: FileItem[] = [];

  async function recurse(dir: any, parent: FileItem, path: string) {
    for await (const entry of dir.values()) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        const folderItem: FileItem = {
          id: `local-dir-${entryPath}`,
          name: entry.name,
          isFolder: true,
          isOpen: true,
          children: [],
        };
        parent.children!.push(folderItem);
        await recurse(entry, folderItem, entryPath);
      } else if (entry.kind === 'file') {
        const fileObj: File = await entry.getFile();
        let preloadedContent: string | undefined = undefined;
        if (isTextFile(fileObj.name) && fileObj.size < 2 * 1024 * 1024) {
          try {
            preloadedContent = await fileObj.text();
          } catch (e) {
            console.warn('Failed to preload file content:', e);
          }
        }
        const fileItem: FileItem = {
          id: `local-file-${entryPath}-${fileObj.lastModified}`,
          name: entry.name,
          isFolder: false,
          file: fileObj,
          content: preloadedContent,
        };
        parent.children!.push(fileItem);
        if (entry.name.toLowerCase().endsWith('.mml')) {
          allMmlFiles.push(fileItem);
        }
      }
    }
  }

  await recurse(dirHandle, rootNode, '');

  const sortTree = (nodes: FileItem[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children) sortTree(n.children);
    });
  };
  sortTree(rootNode.children!);

  return { tree: [rootNode], folderName: rootFolderName, allMmlFiles };
}

/**
 * Sample MML ファイル群からエクスプローラー表示用のフォルダツリーを構築する。
 * プロジェクトルートの samples/ 配下の実フォルダ構造がそのまま
 * 「SAMPLE MML」ツリーへ反映される (フォルダは初期展開)。
 */
function buildSampleMmlTree(): FileItem[] {
  const rootChildren: FileItem[] = [];

  // 指定位置のフォルダを取得 (無ければ作成)。fullPath はフォルダ id のユニーク化に使用
  const getOrCreateFolder = (parentChildren: FileItem[], folderName: string, fullPath: string): FileItem => {
    let folder = parentChildren.find((n) => n.isFolder && n.name === folderName);
    if (!folder) {
      folder = {
        id: `sample-folder-${fullPath}`,
        name: folderName,
        isFolder: true,
        isOpen: true,
        isSample: true,
        children: [],
      };
      parentChildren.push(folder);
    }
    return folder;
  };

  for (const file of SAMPLE_MML_FILES) {
    const segments = file.folderPath ? file.folderPath.split('/') : [];
    let currentChildren = rootChildren;
    let accumulatedPath = '';
    for (const segment of segments) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      currentChildren = getOrCreateFolder(currentChildren, segment, accumulatedPath).children!;
    }
    currentChildren.push({
      id: file.id,
      name: file.fileName,
      isFolder: false,
      isSample: true,
      content: file.content,
    });
  }

  // フォルダ先行・名前順でソート (ローカルプロジェクトツリーと同じ規則)
  const sortTree = (nodes: FileItem[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children) sortTree(n.children);
    });
  };
  sortTree(rootChildren);

  return rootChildren;
}

// Sample MML の初期ツリー (samples/ フォルダの内容から自動構築)
const INITIAL_SAMPLE_FILES: FileItem[] = buildSampleMmlTree();

interface FileExplorerProps {
  onSelectFile?: (file: { id: string; name: string; content?: string }) => void;
  activeFileId?: string;
  width?: number;
  onOpenMidiRouter?: () => void;
}

export function FileExplorer({ onSelectFile, activeFileId, width, onOpenMidiRouter }: FileExplorerProps) {
  const [samples, setSamples] = useState<FileItem[]>(INITIAL_SAMPLE_FILES);
  const [localProject, setLocalProject] = useState<FileItem[]>([]);
  const [hasOpenedLocalFolder, setHasOpenedLocalFolder] = useState<boolean>(false);
  const [openedFolderName, setOpenedFolderName] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 初回マウント時: 前回読み込んだローカルフォルダを永続化ストレージから復元
  useEffect(() => {
    let isMounted = true;
    loadWorkspaceFolder()
      .then((saved) => {
        if (isMounted && saved && saved.tree && saved.tree.length > 0) {
          setLocalProject(saved.tree);
          setOpenedFolderName(saved.folderName || 'Local Files');
          setHasOpenedLocalFolder(true);
        }
      })
      .catch((err) => {
        console.warn('Failed to restore workspace folder:', err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // フォルダ開閉トグル
  const toggleFolder = (list: FileItem[], id: string): FileItem[] => {
    return list.map(item => {
      if (item.id === id) {
        return { ...item, isOpen: !item.isOpen };
      }
      if (item.children) {
        return { ...item, children: toggleFolder(item.children, id) };
      }
      return item;
    });
  };

  // リネーム確定
  const applyRename = (list: FileItem[], id: string, newName: string): FileItem[] => {
    return list.map(item => {
      if (item.id === id) {
        return { ...item, name: newName.trim() || item.name };
      }
      if (item.children) {
        return { ...item, children: applyRename(item.children, id, newName) };
      }
      return item;
    });
  };

  // 削除
  const deleteItem = (list: FileItem[], id: string): FileItem[] => {
    return list
      .filter(item => item.id !== id)
      .map(item => {
        if (item.children) {
          return { ...item, children: deleteItem(item.children, id) };
        }
        return item;
      });
  };

  // 新規ファイル作成
  const handleCreateNewFile = () => {
    const newId = `file-${Date.now()}`;
    const newFile: FileItem = {
      id: newId,
      name: 'new_track.mml',
      isFolder: false,
      content: '; MZ-1500 MML Track\n',
    };
    setLocalProject(prev => {
      let nextTree: FileItem[];
      if (prev.length === 0) {
        nextTree = [newFile];
      } else {
        const root = prev[0];
        if (root.isFolder && root.children) {
          nextTree = [{ ...root, isOpen: true, children: [...root.children, newFile] }, ...prev.slice(1)];
        } else {
          nextTree = [...prev, newFile];
        }
      }
      saveWorkspaceFolder(openedFolderName || 'Local Files', nextTree).catch(console.error);
      return nextTree;
    });
    setEditingId(newId);
    setEditingName('new_track.mml');
    if (!hasOpenedLocalFolder) {
      setHasOpenedLocalFolder(true);
      setOpenedFolderName('my_project');
    }
  };

  // 新規フォルダ作成
  const handleCreateNewFolder = () => {
    const newId = `folder-${Date.now()}`;
    const newFolder: FileItem = {
      id: newId,
      name: 'new_folder',
      isFolder: true,
      isOpen: true,
      children: [],
    };
    setLocalProject(prev => {
      let nextTree: FileItem[];
      if (prev.length === 0) {
        nextTree = [newFolder];
      } else {
        const root = prev[0];
        if (root.isFolder && root.children) {
          nextTree = [{ ...root, isOpen: true, children: [...root.children, newFolder] }, ...prev.slice(1)];
        } else {
          nextTree = [...prev, newFolder];
        }
      }
      saveWorkspaceFolder(openedFolderName || 'Local Files', nextTree).catch(console.error);
      return nextTree;
    });
    setEditingId(newId);
    setEditingName('new_folder');
    if (!hasOpenedLocalFolder) {
      setHasOpenedLocalFolder(true);
      setOpenedFolderName('my_project');
    }
  };

  // ローカルフォルダを閉じる（アンロード & ストレージ消去）
  const handleCloseLocalFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await clearWorkspaceFolder();
    setLocalProject([]);
    setOpenedFolderName('');
    setHasOpenedLocalFolder(false);
  };

  // ローカルフォルダを開く (File System Access API 優先、input フォールバック)
  const handleOpenLocalFolder = async () => {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        const { tree, folderName, allMmlFiles } = await scanDirectoryPicker(dirHandle);
        setLocalProject(tree);
        setOpenedFolderName(folderName);
        setHasOpenedLocalFolder(true);
        // IndexedDB / localStorage に永続化
        await saveWorkspaceFolder(folderName, tree);

        // フォルダ内の最初の .mml ファイルがあれば自動ロード
        if (allMmlFiles.length > 0 && onSelectFile) {
          const first = allMmlFiles[0];
          const content = first.content ?? (first.file ? await first.file.text() : '');
          onSelectFile({ id: first.id, name: first.name, content });
        }
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // ユーザーがフォルダ選択をキャンセル
          return;
        }
        console.warn('showDirectoryPicker failed, falling back to input:', err);
      }
    }

    // フォールバック: <input type="file" webkitdirectory /> を発火
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };

  // フォールバック input によるフォルダ選択ハンドラ
  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const { tree, folderName, allMmlFiles } = await buildFileTreeFromFiles(files);
    setLocalProject(tree);
    setOpenedFolderName(folderName);
    setHasOpenedLocalFolder(true);
    // IndexedDB / localStorage に永続化
    await saveWorkspaceFolder(folderName, tree);

    if (allMmlFiles.length > 0 && onSelectFile) {
      const first = allMmlFiles[0];
      const content = first.content ?? (first.file ? await first.file.text() : '');
      onSelectFile({ id: first.id, name: first.name, content });
    }

    // 次回同一フォルダ選択時にも change が発火するようリセット
    e.target.value = '';
  };

  const renderTree = (items: FileItem[], depth = 0, isSampleTree = false) => {
    return (
      <div className="flex flex-col">
        {items.map(item => {
          const isSelected = activeFileId === item.id;
          const isEditing = editingId === item.id;

          return (
            <div key={item.id} className="flex flex-col">
              <div
                style={{ paddingLeft: `${depth * 14 + 10}px` }}
                className={`group flex items-center justify-between py-1 pr-2 text-xs font-mono cursor-pointer select-none transition-colors border-l-2 ${
                  isSelected
                    ? 'bg-cyan-950/40 text-cyan-200 border-cyan-400 font-semibold shadow-inner'
                    : 'text-slate-350 hover:bg-slate-800/60 border-transparent hover:text-white'
                }`}
                onClick={async () => {
                  if (item.isFolder) {
                    if (isSampleTree) {
                      setSamples(prev => toggleFolder(prev, item.id));
                    } else {
                      setLocalProject(prev => {
                        const updated = toggleFolder(prev, item.id);
                        saveWorkspaceFolder(openedFolderName || 'Local Files', updated).catch(console.error);
                        return updated;
                      });
                    }
                  } else {
                    if (onSelectFile) {
                      if (item.file) {
                        try {
                          const text = await item.file.text();
                          item.content = text;
                          onSelectFile({ id: item.id, name: item.name, content: text });
                          // 最新 content を永続化
                          saveWorkspaceFolder(openedFolderName || 'Local Files', localProject).catch(console.error);
                        } catch (e) {
                          console.error('Failed to read file content:', e);
                          onSelectFile({ id: item.id, name: item.name, content: item.content || '' });
                        }
                      } else {
                        // SAMPLE MML (プリセット) / リロード復元ファイルは保持済み content を渡す
                        onSelectFile({ id: item.id, name: item.name, content: item.content ?? '' });
                      }
                    }
                  }
                }}
              >
                {/* SVGアイコン & 名前 */}
                <div className="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                  {item.isFolder ? (
                    <div className="flex items-center gap-1 text-[#00A8FF] shrink-0">
                      {item.isOpen ? (
                        <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
                      )}
                      {item.isOpen ? (
                        <FolderOpen className="w-3.5 h-3.5 fill-[#00A8FF]/20 text-[#00A8FF]" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 fill-[#00A8FF]/20 text-[#00A8FF]" />
                      )}
                    </div>
                  ) : (
                    <FileCode className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 shrink-0 ml-4" />
                  )}

                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (isSampleTree) {
                            setSamples(prev => applyRename(prev, item.id, editingName));
                          } else {
                            setLocalProject(prev => {
                              const updated = applyRename(prev, item.id, editingName);
                              saveWorkspaceFolder(openedFolderName || 'Local Files', updated).catch(console.error);
                              return updated;
                            });
                          }
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => {
                        if (isSampleTree) {
                          setSamples(prev => applyRename(prev, item.id, editingName));
                        } else {
                          setLocalProject(prev => {
                            const updated = applyRename(prev, item.id, editingName);
                            saveWorkspaceFolder(openedFolderName || 'Local Files', updated).catch(console.error);
                            return updated;
                          });
                        }
                        setEditingId(null);
                      }}
                      className="bg-[#090d16] border border-[#00A8FF] text-zinc-100 px-1.5 py-0.5 text-xs rounded outline-none w-full font-mono shadow-inner"
                    />
                  ) : (
                    <span className={`truncate ${item.isFolder ? 'font-semibold text-zinc-200' : 'text-zinc-300'}`}>
                      {item.name}
                    </span>
                  )}
                </div>

                {/* 操作アクション (リネーム・削除) */}
                {!isSampleTree && !isEditing && (
                  <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(item.id);
                        setEditingName(item.name);
                      }}
                      className="p-1 hover:text-[#00A8FF] text-zinc-400 hover:bg-[#333333] rounded cursor-pointer transition-colors"
                      title="Rename"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocalProject(prev => {
                          const updated = deleteItem(prev, item.id);
                          saveWorkspaceFolder(openedFolderName || 'Local Files', updated).catch(console.error);
                          return updated;
                        });
                      }}
                      className="p-1 hover:text-red-400 text-zinc-400 hover:bg-[#333333] rounded cursor-pointer transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* サブツリーの再帰展開 */}
              {item.isFolder && item.isOpen && item.children && (
                <div>{renderTree(item.children, depth + 1, isSampleTree)}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div 
      style={width ? { width: `${width}px` } : undefined}
      className={`flex flex-col h-full bg-[#0e0f15] border-r border-white/[0.07] select-none shrink-0 font-mono ${width ? '' : 'w-60'}`}
    >
      {/* エクスプローラータイトルバー */}
      <div className="h-9 px-3 bg-[#0b0c12] border-b border-white/[0.07] flex items-center justify-between shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 tracking-wider flex items-center gap-1.5">
          <Folder className="w-3.5 h-3.5 text-zinc-500 fill-zinc-500/20" />
          EXPLORER
        </span>
        {/* 新規ファイル / 新規フォルダ アクション */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleCreateNewFile}
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors cursor-pointer shadow-xs"
            title="New File (MML)"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCreateNewFolder}
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors cursor-pointer shadow-xs"
            title="New Folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 開いているローカルフォルダの操作ツールバー */}
      <div className="p-2 border-b border-white/[0.07] bg-[#0c0d12] flex flex-col gap-1.5">
        <button
          onClick={handleOpenLocalFolder}
          className="h-6.5 w-full px-2 text-[10px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-white/10 rounded flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          title="PCのローカルフォルダを選択してMMLプロジェクトを開く"
        >
          <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
          <span>OPEN LOCAL FOLDER...</span>
        </button>
        {/* フォールバック用 ディレクトリ選択 input (showDirectoryPicker非対応ブラウザ用) */}
        <input
          ref={folderInputRef}
          type="file"
          {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
          className="hidden"
          onChange={handleFolderInputChange}
        />
        {onOpenMidiRouter && (
          <button
            onClick={onOpenMidiRouter}
            className="h-6.5 w-full px-2 text-[10px] font-bold bg-[#00A8FF]/15 hover:bg-[#00A8FF]/25 active:bg-[#00A8FF]/35 text-[#00A8FF] border border-[#00A8FF]/40 rounded flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            title="Standard MIDI File (.mid) をインポートしてMMLを生成"
          >
            <Music2 className="w-3.5 h-3.5 text-[#00A8FF]" />
            <span>IMPORT MIDI (.mid)...</span>
          </button>
        )}
      </div>

      {/* ファイルツリーリスト */}
      <div className="flex-1 overflow-y-auto py-2 flex flex-col gap-3">
        {/* セクション 1: LOCAL PROJECT */}
        <div>
          <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 tracking-wider flex items-center justify-between uppercase">
            <span className="truncate max-w-[120px]" title={openedFolderName || 'Local Files'}>
              {openedFolderName ? openedFolderName : 'Local Files'}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[9px] px-1.5 py-0.2 bg-zinc-800 text-zinc-400 border border-white/10 rounded shrink-0">
                {hasOpenedLocalFolder ? 'WORKSPACE' : 'EMPTY'}
              </span>
              {hasOpenedLocalFolder && (
                <button
                  onClick={handleCloseLocalFolder}
                  className="p-0.5 hover:bg-zinc-800 text-zinc-500 hover:text-red-400 rounded transition-colors cursor-pointer"
                  title="フォルダを閉じる (Unload Folder)"
                >
                  <FolderX className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          {hasOpenedLocalFolder && localProject.length > 0 ? (
            renderTree(localProject, 0, false)
          ) : (
            <div className="px-4 py-6 text-center text-xs text-zinc-500 flex flex-col items-center justify-center gap-2 select-none border border-dashed border-white/5 rounded mx-2.5 my-1 bg-zinc-900/30">
              <Folder className="w-6 h-6 text-zinc-600 stroke-1" />
              <span className="text-zinc-400 font-medium text-[11px]">No Folder Opened</span>
              <span className="text-[10px] text-zinc-500 max-w-[170px] leading-relaxed">
                Click &quot;OPEN LOCAL FOLDER...&quot; above to load your project.
              </span>
            </div>
          )}
        </div>

        {/* セクション 2: SAMPLES (プリセットMML) */}
        <div className="border-t border-white/[0.06] pt-2">
          <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 tracking-wider flex items-center justify-between uppercase">
            <span>Sample MML</span>
            <span className="text-[9px] px-1.5 py-0.2 bg-zinc-800 text-zinc-500 border border-white/10 rounded">PRESET</span>
          </div>
          {renderTree(samples, 0, true)}
        </div>
      </div>
    </div>
  );
}
