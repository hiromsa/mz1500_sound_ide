/**
 * ファイルエクスプローラのツリーアイテム (ローカルフォルダ・サンプル MML 共通)。
 * UI コンポーネント (view) と永続化ロジック (utils) の双方から参照されるため、
 * UI に依存しない src/types/ に配置する (レイヤリング: utils → view の逆依存を防ぐ)。
 */
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