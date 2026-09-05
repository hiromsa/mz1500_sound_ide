import { useState } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  ChevronRight, 
  ChevronDown, 
  FilePlus, 
  FolderPlus, 
  Pencil, 
  Trash2 
} from 'lucide-react';

export interface FileItem {
  id: string;
  name: string;
  isFolder: boolean;
  isOpen?: boolean;
  children?: FileItem[];
  isSample?: boolean;
}

// サンプルMMLとローカルフォルダの初期モックデータ
const INITIAL_SAMPLE_FILES: FileItem[] = [
  {
    id: 'sample-folder-demo',
    name: 'demos',
    isFolder: true,
    isOpen: true,
    isSample: true,
    children: [
      { id: 's1', name: 'mz_theme_song.mml', isFolder: false, isSample: true },
      { id: 's2', name: 'fm_fantasy_stage1.mml', isFolder: false, isSample: true },
      { id: 's3', name: 'dcsg_retro_action.mml', isFolder: false, isSample: true },
    ],
  },
  {
    id: 'sample-folder-tpl',
    name: 'templates',
    isFolder: true,
    isOpen: false,
    isSample: true,
    children: [
      { id: 's4', name: 'template_all_17ch.mml', isFolder: false, isSample: true },
      { id: 's5', name: 'template_opm_only.mml', isFolder: false, isSample: true },
    ],
  },
];

const INITIAL_LOCAL_PROJECT: FileItem[] = [
  {
    id: 'local-folder-root',
    name: 'my_game_bgm',
    isFolder: true,
    isOpen: true,
    children: [
      { id: '1', name: 'main.mml', isFolder: false },
      { id: '2', name: 'drums.mml', isFolder: false },
      {
        id: 'local-subfolder-tones',
        name: 'tones',
        isFolder: true,
        isOpen: true,
        children: [
          { id: 'local-f3', name: 'opm_instruments.mml', isFolder: false },
          { id: 'local-f4', name: 'psg_envelopes.mml', isFolder: false },
        ],
      },
    ],
  },
];

interface FileExplorerProps {
  onSelectFile?: (file: { id: string; name: string }) => void;
  activeFileId?: string;
  width?: number;
}

export function FileExplorer({ onSelectFile, activeFileId, width }: FileExplorerProps) {
  const [samples, setSamples] = useState<FileItem[]>(INITIAL_SAMPLE_FILES);
  const [localProject, setLocalProject] = useState<FileItem[]>(INITIAL_LOCAL_PROJECT);
  const [hasOpenedLocalFolder, setHasOpenedLocalFolder] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

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
    };
    setLocalProject(prev => {
      if (prev.length === 0) return [newFile];
      const root = prev[0];
      if (root.isFolder && root.children) {
        return [{ ...root, isOpen: true, children: [...root.children, newFile] }];
      }
      return [...prev, newFile];
    });
    setEditingId(newId);
    setEditingName('new_track.mml');
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
      if (prev.length === 0) return [newFolder];
      const root = prev[0];
      if (root.isFolder && root.children) {
        return [{ ...root, isOpen: true, children: [...root.children, newFolder] }];
      }
      return [...prev, newFolder];
    });
    setEditingId(newId);
    setEditingName('new_folder');
  };

  const handleOpenFolder = () => {
    setHasOpenedLocalFolder(true);
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
                onClick={() => {
                  if (item.isFolder) {
                    if (isSampleTree) {
                      setSamples(prev => toggleFolder(prev, item.id));
                    } else {
                      setLocalProject(prev => toggleFolder(prev, item.id));
                    }
                  } else {
                    if (onSelectFile) {
                      onSelectFile({ id: item.id, name: item.name });
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
                            setLocalProject(prev => applyRename(prev, item.id, editingName));
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
                          setLocalProject(prev => applyRename(prev, item.id, editingName));
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
                        setLocalProject(prev => deleteItem(prev, item.id));
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
      <div className="p-2 border-b border-white/[0.07] bg-[#0c0d12]">
        <button
          onClick={handleOpenFolder}
          className="h-6.5 w-full px-2 text-[10px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-white/10 rounded flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
          <span>OPEN FOLDER...</span>
        </button>
      </div>

      {/* ファイルツリーリスト */}
      <div className="flex-1 overflow-y-auto py-2 flex flex-col gap-3">
        {/* セクション 1: LOCAL PROJECT */}
        <div>
          <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 tracking-wider flex items-center justify-between uppercase">
            <span>Local Files</span>
            <span className="text-[9px] px-1.5 py-0.2 bg-zinc-800 text-zinc-400 border border-white/10 rounded">WORKSPACE</span>
          </div>
          {hasOpenedLocalFolder ? (
            renderTree(localProject, 0, false)
          ) : (
            <div className="px-4 py-3 text-[11px] text-zinc-600 italic">
              No folder opened.
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
