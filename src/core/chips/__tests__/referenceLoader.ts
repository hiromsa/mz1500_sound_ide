/// <reference types="node" />
/**
 * C# リファレンス値 (チップ照合テスト用フィクスチャ) の読み込みヘルパー。
 * フィクスチャはリポジトリ管理しているため、クリーンチェックアウト / CI でも `npm test` が完結する。
 *
 * フィクスチャの更新方法:
 *   1. `dotnet run --project tools/cs-probe -c Release` で tools/cs-probe/out/reference.json を再生成
 *   2. `npm run update-chip-reference` で本フィクスチャへ反映
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** cs-probe が出力するリファレンス値の形式。 */
export interface ChipReference {
  randomValues: number[];
  dcsgSamples: number[];
  dcsgNoiseSamples: number[];
  beepSamples: number[];
  fm: { partials: number[]; sum: number; head: number[] };
  lfo: { sum: number; head: number[] };
  noiseLfo: { sum: number; head: number[] };
}

let cached: ChipReference | null = null;

/** C# 版のリファレンス値をロードする (キャッシュ付き)。 */
export function loadReference(): ChipReference {
  if (cached === null) {
    const path = resolve(
      fileURLToPath(new URL('./fixtures/reference.json', import.meta.url)),
    );
    cached = JSON.parse(readFileSync(path, 'utf-8')) as ChipReference;
  }

  return cached;
}
