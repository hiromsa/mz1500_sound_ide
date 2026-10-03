/**
 * C# リファレンス値 (tools/cs-probe/out/reference.json) を
 * チップ照合テストのフィクスチャ (src/core/chips/__tests__/fixtures/reference.json) へ反映する。
 *
 * 事前に `dotnet run --project tools/cs-probe -c Release` で参照ファイルを生成しておくこと。
 * 使い方: `npm run update-chip-reference`
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'tools', 'cs-probe', 'out', 'reference.json');
const target = join(repoRoot, 'src', 'core', 'chips', '__tests__', 'fixtures', 'reference.json');

if (!existsSync(source)) {
  console.error(`[update-chip-reference] 参照ファイルが見つかりません: ${source}`);
  console.error('[update-chip-reference] 先に `dotnet run --project tools/cs-probe -c Release` を実行してください。');
  process.exit(1);
}

copyFileSync(source, target);
console.log(`[update-chip-reference] updated: ${target}`);