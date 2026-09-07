/**
 * ローカルワークスペースフォルダの永続化ストレージ (IndexedDB + localStorage フォールバック)
 */
import type { FileItem } from '../view/FileExplorer';

export interface SerializableFileItem {
  id: string;
  name: string;
  isFolder: boolean;
  isOpen?: boolean;
  children?: SerializableFileItem[];
  content?: string;
  isSample?: boolean;
}

export interface SavedWorkspaceFolder {
  folderName: string;
  tree: SerializableFileItem[];
  savedAt: number;
}

const DB_NAME = 'mz1500_sound_ide_db';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';
const KEY_LOCAL_FOLDER = 'current_local_folder';
const LOCAL_STORAGE_KEY = 'mz1500_local_folder_cache';

/** IndexedDB のオープン */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** FileItem ツリーから File オブジェクト等を除去したシリアライズ可能ツリーへ変換 */
export function sanitizeTreeForStorage(items: FileItem[]): SerializableFileItem[] {
  return items.map((item) => {
    const node: SerializableFileItem = {
      id: item.id,
      name: item.name,
      isFolder: item.isFolder,
      isOpen: item.isOpen,
      content: item.content,
      isSample: item.isSample,
    };
    if (item.children) {
      node.children = sanitizeTreeForStorage(item.children);
    }
    return node;
  });
}

/** ワークスペースフォルダ情報を永続化 */
export async function saveWorkspaceFolder(folderName: string, tree: FileItem[]): Promise<void> {
  const sanitizedTree = sanitizeTreeForStorage(tree);
  const data: SavedWorkspaceFolder = {
    folderName,
    tree: sanitizedTree,
    savedAt: Date.now(),
  };

  // 1. IndexedDB に保存を試みる (サポート時)
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(data, KEY_LOCAL_FOLDER);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      return;
    } catch (err) {
      console.warn('IndexedDB save failed, attempting localStorage fallback:', err);
    }
  }

  // 2. localStorage フォールバック
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }
  } catch (lsErr) {
    console.warn('localStorage save failed:', lsErr);
  }
}

/** 永続化されたワークスペースフォルダ情報を復元 */
export async function loadWorkspaceFolder(): Promise<SavedWorkspaceFolder | null> {
  // 1. IndexedDB から読み込み (サポート時)
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openDatabase();
      const result = await new Promise<SavedWorkspaceFolder | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(KEY_LOCAL_FOLDER);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (result) return result;
    } catch (err) {
      console.warn('IndexedDB load failed, attempting localStorage fallback:', err);
    }
  }

  // 2. localStorage フォールバック
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as SavedWorkspaceFolder;
      }
    }
  } catch (lsErr) {
    console.warn('localStorage load failed:', lsErr);
  }

  return null;
}

/** 永続化されたワークスペースフォルダ情報を消去 */
export async function clearWorkspaceFolder(): Promise<void> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(KEY_LOCAL_FOLDER);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB clear failed:', err);
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch (lsErr) {
    console.warn('localStorage clear failed:', lsErr);
  }
}
