import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
import { ConfirmDialog } from './components/ConfirmDialog';
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
  /** File System Access API のファイルハンドル (Ctrl+S での書き込み保存に使用) */
  fileHandle?: FileSystemFileHandle;
  /** 親ディレクトリのハンドル (リネームや削除時に使用) */
  parentHandle?: FileSystemDirectoryHandle;
  /** フォルダ自身の場合のディレクトリハンドル (そのフォルダ内での新規作成に使用) */
  dirHandle?: FileSystemDirectoryHandle;
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
    dirHandle,
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
          parentHandle: dir,
          dirHandle: entry as FileSystemDirectoryHandle,
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
          fileHandle: entry as FileSystemFileHandle,
          parentHandle: dir,
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

/** ディスク上のファイルをリネームし、新しい FileSystemFileHandle を返す */
async function renameFileOnDisk(
  fileItem: FileItem,
  newName: string,
  parentDirHandle?: FileSystemDirectoryHandle
): Promise<FileSystemFileHandle | undefined> {
  if (!fileItem.fileHandle) return undefined;
  const oldName = fileItem.name;
  if (oldName === newName) return fileItem.fileHandle;

  const handle = fileItem.fileHandle;
  const parent = parentDirHandle || fileItem.parentHandle;

  // 1. Chromium 111+ の move() API を試みる
  if (typeof (handle as any).move === 'function') {
    try {
      await (handle as any).move(newName);
      return handle;
    } catch (err) {
      console.warn('fileHandle.move failed, falling back to copy & delete:', err);
    }
  }

  // 2. move が使えない、または失敗した場合: copy & delete
  if (parent) {
    try {
      const newFileHandle = await parent.getFileHandle(newName, { create: true });
      const oldFile = await handle.getFile();
      const content = await oldFile.arrayBuffer();
      const writable = await newFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      await parent.removeEntry(oldName);
      return newFileHandle;
    } catch (err) {
      console.error('Failed to rename file via copy & delete:', err);
      throw err;
    }
  }

  return undefined;
}

/** 指定した ID の FileItem を再帰的に検索する */
function findItemById(list: FileItem[], id: string): FileItem | undefined {
  for (const item of list) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

interface FileExplorerProps {
  onSelectFile?: (file: { id: string; name: string; content?: string; fileHandle?: FileSystemFileHandle }) => void;
  onRenameFile?: (id: string, newName: string, newFileHandle?: FileSystemFileHandle) => void;
  onDeleteFile?: (id: string) => void;
  activeFileId?: string;
  width?: number;
  onOpenMidiRouter?: () => void;
}

export function FileExplorer({ 
  onSelectFile, 
  onRenameFile,
  onDeleteFile,
  activeFileId, 
  width, 
  onOpenMidiRouter 
}: FileExplorerProps) {
  const [samples, setSamples] = useState<FileItem[]>(INITIAL_SAMPLE_FILES);
  const [localProject, setLocalProject] = useState<FileItem[]>([]);
  const [hasOpenedLocalFolder, setHasOpenedLocalFolder] = useState<boolean>(false);
  const [openedFolderName, setOpenedFolderName] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // 右クリックコンテキストメニューの状態
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item?: FileItem;
    isSample?: boolean;
  } | null>(null);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  /** showDirectoryPicker で取得したルートフォルダのハンドル (新規ファイル作成・書き込みに使用) */
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  // 削除確認ダイアログの状態
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
    isFolder: boolean;
    parentHandle?: FileSystemDirectoryHandle;
  } | null>(null);

  // フォルダ閉じる確認ダイアログの状態
  const [closeConfirm, setCloseConfirm] = useState<boolean>(false);

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

  // 実ディスクから最新のツリーを再スキャンして同期する
  const rescanLocalFolder = useCallback(async () => {
    if (!dirHandleRef.current) return;
    try {
      const { tree, folderName } = await scanDirectoryPicker(dirHandleRef.current);
      setLocalProject(tree);
      await saveWorkspaceFolder(folderName, tree);
    } catch (err) {
      console.warn('Failed to rescan directory picker:', err);
    }
  }, []);

  // リネーム開始
  const startRename = useCallback((item: FileItem) => {
    setSelectedItemId(item.id);
    setEditingId(item.id);
    setEditingName(item.name);
  }, []);

  // コンテキストメニュー外クリックまたは Esc で閉じる
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      } else if (e.key === 'F2' && !editingId) {
        const targetId = selectedItemId || activeFileId;
        if (targetId) {
          const item = findItemById([...localProject, ...samples], targetId);
          if (item && !item.isSample) {
            e.preventDefault();
            startRename(item);
          }
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [editingId, selectedItemId, activeFileId, localProject, samples, startRename]);

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

  // リネーム実行中フラグ (Enter と Blur の二重実行防止)
  const isCommittingRenameRef = useRef<boolean>(false);

  // リネーム確定
  const applyRename = (list: FileItem[], id: string, newName: string, newHandle?: FileSystemFileHandle): FileItem[] => {
    return list.map(item => {
      if (item.id === id) {
        item.name = newName.trim() || item.name;
        if (newHandle) item.fileHandle = newHandle;
        return { 
          ...item, 
          name: newName.trim() || item.name,
          ...(newHandle ? { fileHandle: newHandle } : {}),
        };
      }
      if (item.children) {
        return { ...item, children: applyRename(item.children, id, newName, newHandle) };
      }
      return item;
    });
  };

  // リネーム確定処理 (実ディスク・IndexedDB・エディタ同期)
  const handleConfirmRename = async (item: FileItem, rawNewName: string, isSampleTree: boolean) => {
    if (isCommittingRenameRef.current) return;
    isCommittingRenameRef.current = true;

    try {
      const trimmed = rawNewName.trim();
      if (!trimmed || trimmed === item.name) {
        setEditingId(null);
        return;
      }

      const newName = trimmed;
      let newHandle: FileSystemFileHandle | undefined = item.fileHandle;

      if (!isSampleTree && !item.isFolder && item.fileHandle) {
        try {
          const updatedHandle = await renameFileOnDisk(item, newName, item.parentHandle || dirHandleRef.current || undefined);
          if (updatedHandle) {
            newHandle = updatedHandle;
          }
        } catch (err) {
          console.error('Failed to rename file on disk:', err);
        }
      }

      // オブジェクトの name も直接更新
      item.name = newName;
      if (newHandle) item.fileHandle = newHandle;

      if (isSampleTree) {
        setSamples(prev => applyRename(prev, item.id, newName));
      } else {
        setLocalProject(prev => {
          const updated = applyRename(prev, item.id, newName, newHandle);
          saveWorkspaceFolder(openedFolderName || 'Local Files', updated).catch(console.error);
          return updated;
        });
      }

      // エディタのタブ・親コンポーネントへ通知
      onRenameFile?.(item.id, newName, newHandle);
      setEditingId(null);

      // 実ディスクを開いている場合は最新状態に再同期
      if (dirHandleRef.current) {
        void rescanLocalFolder();
      }
    } finally {
      isCommittingRenameRef.current = false;
    }
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

  // 指定フォルダ内へのアイテム追加ヘルパー
  const insertItemIntoTree = (tree: FileItem[], targetFolderId: string | undefined, newItem: FileItem): FileItem[] => {
    if (!targetFolderId) {
      if (tree.length === 0) return [newItem];
      const root = tree[0];
      if (root.isFolder && root.children) {
        return [{ ...root, isOpen: true, children: [...root.children, newItem] }, ...tree.slice(1)];
      }
      return [...tree, newItem];
    }
    return tree.map(node => {
      if (node.id === targetFolderId) {
        return {
          ...node,
          isOpen: true,
          children: [...(node.children || []), newItem],
        };
      }
      if (node.children) {
        return { ...node, children: insertItemIntoTree(node.children, targetFolderId, newItem) };
      }
      return node;
    });
  };

  // 新規ファイル作成 (parentFolder 指定時はそのフォルダ内へ作成)
  const handleCreateNewFile = async (parentFolder?: FileItem) => {
    const newId = `file-${Date.now()}`;
    const initialContent = '; MZ-1500 MML Track\n';
    let fileHandle: FileSystemFileHandle | undefined = undefined;
    let fileName = 'new_track.mml';

    const targetDir = parentFolder?.dirHandle || parentFolder?.parentHandle || dirHandleRef.current;

    // File System Access API が利用可能な場合はディスク上にファイルを作成
    if (targetDir) {
      try {
        let candidate = 'new_track.mml';
        let counter = 1;
        while (true) {
          try {
            await targetDir.getFileHandle(candidate, { create: false });
            counter++;
            candidate = `new_track_${counter}.mml`;
          } catch {
            fileName = candidate;
            break;
          }
        }

        fileHandle = await targetDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(initialContent);
        await writable.close();
      } catch (e) {
        console.warn('Failed to create file on disk:', e);
        fileHandle = undefined;
      }
    }

    const newFile: FileItem = {
      id: newId,
      name: fileHandle?.name ?? fileName,
      isFolder: false,
      fileHandle,
      parentHandle: targetDir ?? undefined,
      content: initialContent,
    };

    setLocalProject(prev => {
      const nextTree = insertItemIntoTree(prev, parentFolder?.id, newFile);
      saveWorkspaceFolder(openedFolderName || 'Local Files', nextTree).catch(console.error);
      return nextTree;
    });

    // 新規作成されたファイルを即座にエディタで開く
    if (onSelectFile) {
      onSelectFile({
        id: newFile.id,
        name: newFile.name,
        content: newFile.content,
        fileHandle: newFile.fileHandle,
      });
    }

    setSelectedItemId(newId);
    setEditingId(newId);
    setEditingName(newFile.name);
    if (!hasOpenedLocalFolder) {
      setHasOpenedLocalFolder(true);
      setOpenedFolderName('my_project');
    }
  };

  // 新規フォルダ作成 (parentFolder 指定時はそのフォルダ内へ作成)
  const handleCreateNewFolder = async (parentFolder?: FileItem) => {
    const newId = `folder-${Date.now()}`;
    let folderName = 'new_folder';
    let folderDirHandle: FileSystemDirectoryHandle | undefined = undefined;

    const targetDir = parentFolder?.dirHandle || parentFolder?.parentHandle || dirHandleRef.current;

    if (targetDir) {
      try {
        let candidate = 'new_folder';
        let counter = 1;
        while (true) {
          try {
            await targetDir.getDirectoryHandle(candidate, { create: false });
            counter++;
            candidate = `new_folder_${counter}`;
          } catch {
            folderName = candidate;
            break;
          }
        }
        folderDirHandle = await targetDir.getDirectoryHandle(folderName, { create: true });
      } catch (e) {
        console.warn('Failed to create directory on disk:', e);
      }
    }

    const newFolder: FileItem = {
      id: newId,
      name: folderName,
      isFolder: true,
      isOpen: true,
      parentHandle: targetDir ?? undefined,
      dirHandle: folderDirHandle,
      children: [],
    };

    setLocalProject(prev => {
      const nextTree = insertItemIntoTree(prev, parentFolder?.id, newFolder);
      saveWorkspaceFolder(openedFolderName || 'Local Files', nextTree).catch(console.error);
      return nextTree;
    });

    setSelectedItemId(newId);
    setEditingId(newId);
    setEditingName(folderName);
    if (!hasOpenedLocalFolder) {
      setHasOpenedLocalFolder(true);
      setOpenedFolderName('my_project');
    }
  };

  // ローカルフォルダを閉じる（確認ダイアログを表示）
  const handleCloseLocalFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCloseConfirm(true);
  };

  // フォルダ閉じる確認後の実処理
  const executeCloseLocalFolder = async () => {
    setCloseConfirm(false);
    await clearWorkspaceFolder();
    setLocalProject([]);
    setOpenedFolderName('');
    setHasOpenedLocalFolder(false);
    dirHandleRef.current = null;
  };

  // ローカルフォルダを開く (File System Access API 優先、input フォールバック)
  const handleOpenLocalFolder = async () => {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker() as FileSystemDirectoryHandle;
        const { tree, folderName, allMmlFiles } = await scanDirectoryPicker(dirHandle);
        dirHandleRef.current = dirHandle;
        setLocalProject(tree);
        setOpenedFolderName(folderName);
        setHasOpenedLocalFolder(true);
        // IndexedDB / localStorage に永続化
        await saveWorkspaceFolder(folderName, tree);

        // フォルダ内の最初の .mml ファイルがあれば自動ロード
        if (allMmlFiles.length > 0 && onSelectFile) {
          const first = allMmlFiles[0];
          const content = first.content ?? (first.file ? await first.file.text() : '');
          onSelectFile({ id: first.id, name: first.name, content, fileHandle: first.fileHandle });
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
          const isSelected = activeFileId === item.id || selectedItemId === item.id;
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedItemId(item.id);
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    item,
                    isSample: isSampleTree,
                  });
                }}
                onClick={async () => {
                  setSelectedItemId(item.id);
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
                      if (item.fileHandle) {
                        // fileHandle から最新のファイル内容を読み込む (File System Access API)
                        try {
                          const fileObj = await item.fileHandle.getFile();
                          const text = await fileObj.text();
                          item.content = text;
                          onSelectFile({ id: item.id, name: item.name, content: text, fileHandle: item.fileHandle });
                        } catch (e) {
                          console.error('Failed to read file via fileHandle:', e);
                          onSelectFile({ id: item.id, name: item.name, content: item.content || '', fileHandle: item.fileHandle });
                        }
                      } else if (item.file) {
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
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleConfirmRename(item, editingName, isSampleTree);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => {
                        void handleConfirmRename(item, editingName, isSampleTree);
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
                        startRename(item);
                      }}
                      className="p-1 hover:text-[#00A8FF] text-zinc-400 hover:bg-[#333333] rounded cursor-pointer transition-colors"
                      title="Rename (F2)"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm({
                          id: item.id,
                          name: item.name,
                          isFolder: item.isFolder,
                          parentHandle: item.parentHandle || dirHandleRef.current || undefined,
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

  // 削除確認 → 実行
  const executeDelete = async () => {
    if (!deleteConfirm) return;
    const target = deleteConfirm;
    setDeleteConfirm(null);

    // 実ディスクから削除
    const parent = target.parentHandle || dirHandleRef.current;
    if (parent) {
      try {
        await parent.removeEntry(target.name, { recursive: target.isFolder });
      } catch (e) {
        console.warn('Failed to remove entry from disk:', e);
      }
    }

    setLocalProject(prev => {
      const updated = deleteItem(prev, target.id);
      saveWorkspaceFolder(openedFolderName || 'Local Files', updated).catch(console.error);
      return updated;
    });

    onDeleteFile?.(target.id);
  };

  return (
    <div 
      style={width ? { width: `${width}px` } : undefined}
      className={`flex flex-col h-full bg-[#0e0f15] border-r border-white/[0.07] select-none shrink-0 font-mono relative ${width ? '' : 'w-60'}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
        });
      }}
    >
      {/* 右クリックコンテキストメニュー */}
      {contextMenu && (typeof document !== 'undefined' ? createPortal(
        <div
          ref={contextMenuRef}
          style={{
            left: `${Math.max(10, Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 200))}px`,
            top: `${Math.max(10, Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220))}px`,
          }}
          className="fixed z-[9999] min-w-[180px] bg-[#12131a] border border-white/10 rounded-lg shadow-2xl py-1 text-xs font-mono text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-75 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 1. ファイル上での右クリック */}
          {contextMenu.item && !contextMenu.item.isFolder && !contextMenu.isSample && (
            <>
              <button
                onClick={() => {
                  const target = contextMenu.item!;
                  setContextMenu(null);
                  startRename(target);
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                  <span>名称変更</span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">F2</span>
              </button>
              <button
                onClick={() => {
                  const target = contextMenu.item!;
                  setContextMenu(null);
                  setDeleteConfirm({
                    id: target.id,
                    name: target.name,
                    isFolder: target.isFolder,
                    parentHandle: target.parentHandle || dirHandleRef.current || undefined,
                  });
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-red-500/20 hover:text-red-300 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>削除</span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">Del</span>
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                onClick={() => {
                  setContextMenu(null);
                  void handleCreateNewFile();
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <FilePlus className="w-3.5 h-3.5 text-cyan-400" />
                <span>新規ファイル</span>
              </button>
              <button
                onClick={() => {
                  setContextMenu(null);
                  void handleCreateNewFolder();
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
                <span>新規フォルダ</span>
              </button>
            </>
          )}

          {/* 2. フォルダ上での右クリック */}
          {contextMenu.item && contextMenu.item.isFolder && !contextMenu.isSample && (
            <>
              <button
                onClick={() => {
                  const target = contextMenu.item!;
                  setContextMenu(null);
                  void handleCreateNewFile(target);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <FilePlus className="w-3.5 h-3.5 text-cyan-400" />
                <span>新規ファイル</span>
              </button>
              <button
                onClick={() => {
                  const target = contextMenu.item!;
                  setContextMenu(null);
                  void handleCreateNewFolder(target);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
                <span>新規フォルダ</span>
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                onClick={() => {
                  const target = contextMenu.item!;
                  setContextMenu(null);
                  startRename(target);
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                  <span>名称変更</span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">F2</span>
              </button>
              <button
                onClick={() => {
                  const target = contextMenu.item!;
                  setContextMenu(null);
                  setDeleteConfirm({
                    id: target.id,
                    name: target.name,
                    isFolder: target.isFolder,
                    parentHandle: target.parentHandle || dirHandleRef.current || undefined,
                  });
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-red-500/20 hover:text-red-300 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>削除</span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">Del</span>
              </button>
            </>
          )}

          {/* 3. 背景（空き領域）での右クリック */}
          {!contextMenu.item && (
            <>
              <button
                onClick={() => {
                  setContextMenu(null);
                  void handleCreateNewFile();
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <FilePlus className="w-3.5 h-3.5 text-cyan-400" />
                <span>新規ファイル</span>
              </button>
              <button
                onClick={() => {
                  setContextMenu(null);
                  void handleCreateNewFolder();
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-200 text-left transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
                <span>新規フォルダ</span>
              </button>
            </>
          )}

          {/* 4. SAMPLE MML プリセットでの右クリック */}
          {contextMenu.isSample && (
            <div className="px-3 py-1.5 text-[11px] text-zinc-500 italic">
              プリセット (読み取り専用)
            </div>
          )}
        </div>,
        document.body
      ) : null)}

      {/* 削除確認ダイアログ */}
      {deleteConfirm && (
        <ConfirmDialog
          type="confirm"
          title={deleteConfirm.isFolder ? 'フォルダを削除' : 'ファイルを削除'}
          fileName={deleteConfirm.name}
          message={`"${deleteConfirm.name}" を削除しますか？\nこの操作は元に戻せません。`}
          confirmLabel="削除"
          onConfirm={executeDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
      {/* フォルダ閉じる確認ダイアログ */}
      {closeConfirm && (
        <ConfirmDialog
          type="confirm"
          title="フォルダを閉じる"
          fileName={openedFolderName}
          message={`"${openedFolderName}" をアンロードします。\nエクスプローラーからフォルダが閉じられます。`}
          confirmLabel="閉じる"
          onConfirm={() => { void executeCloseLocalFolder(); }}
          onCancel={() => setCloseConfirm(false)}
        />
      )}

      {/* エクスプローラータイトルバー */}
      <div className="h-9 px-3 bg-[#0b0c12] border-b border-white/[0.07] flex items-center justify-between shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 tracking-wider flex items-center gap-1.5">
          <Folder className="w-3.5 h-3.5 text-zinc-500 fill-zinc-500/20" />
          EXPLORER
        </span>
        {/* 新規ファイル / 新規フォルダ アクション */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleCreateNewFile()}
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors cursor-pointer shadow-xs"
            title="New File (MML)"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => void handleCreateNewFolder()}
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
