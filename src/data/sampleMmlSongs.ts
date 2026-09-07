/**
 * SAMPLE MML (プリセット) ローダー。
 *
 * プロジェクトルートの `samples/` フォルダ配下の `*.mml` を
 * Vite の import.meta.glob によりビルド時に全件取り込む。
 * ファイルやサブフォルダを `samples/` に追加するだけで、
 * エクスプローラーの「SAMPLE MML」ツリーへ自動反映される。
 *
 * UI (FileExplorer) とデータを疎結合に保つため、本モジュールは
 * ファイル群の解決 (id / パス / ソース本文) のみを担い、
 * ツリー構造の構築は UI 側で行う。
 */

/** SAMPLE MML 1 ファイル分の定義。 */
export interface SampleMmlFile {
  /** エクスプローラー / エディタタブの識別子 (`samples/` からの相対パス、例: `classics/classic_fur_elise.mml`)。 */
  readonly id: string;
  /** 表示用ファイル名 (例: `classic_fur_elise.mml`)。 */
  readonly fileName: string;
  /** `samples/` 直下からの親フォルダパス (例: `classics`)。ルート直下のファイルは空文字。 */
  readonly folderPath: string;
  /** プロジェクトルートからの相対パス (例: `samples/classics/classic_fur_elise.mml`)。 */
  readonly relativePath: string;
  /** MML ソース全文。 */
  readonly content: string;
}

/** 読み込み対象のサンプルルートフォルダ名。 */
const SAMPLE_ROOT_DIR = 'samples';

const rawModules = import.meta.glob('/samples/**/*.mml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** glob のモジュールパス (例: `/samples/classics/foo.mml`) を SampleMmlFile へ変換する。 */
function toSampleMmlFile(modulePath: string, content: string): SampleMmlFile {
  const relativePath = modulePath.replace(/^\//, '');
  const withoutRoot = relativePath.startsWith(`${SAMPLE_ROOT_DIR}/`)
    ? relativePath.slice(SAMPLE_ROOT_DIR.length + 1)
    : relativePath;
  const segments = withoutRoot.split('/');
  const fileName = segments[segments.length - 1];
  const folderPath = segments.slice(0, -1).join('/');

  return { id: withoutRoot, fileName, folderPath, relativePath, content };
}

/** `samples/` 配下の全サンプル MML (フォルダパス・ファイル名順にソート済み)。 */
export const SAMPLE_MML_FILES: readonly SampleMmlFile[] = Object.entries(rawModules)
  .map(([modulePath, content]) => toSampleMmlFile(modulePath, content))
  .sort((a, b) =>
    a.folderPath.localeCompare(b.folderPath) || a.fileName.localeCompare(b.fileName),
  );

/** id からサンプル MML を検索する (見つからない場合は undefined)。 */
export function findSampleFileById(id: string): SampleMmlFile | undefined {
  return SAMPLE_MML_FILES.find((file) => file.id === id);
}

/** プロジェクトルートからの相対パスでサンプル MML を検索する (見つからない場合は undefined)。 */
export function findSampleFileByRelativePath(relativePath: string): SampleMmlFile | undefined {
  return SAMPLE_MML_FILES.find((file) => file.relativePath === relativePath);
}
