/**
 * mmlContextParser ロジック検証スクリプト (一時ファイル)
 * 実行: node scripts/verify-mml-parser.mjs
 * Node v24+ の type stripping 機能で .ts を直接 import する。
 */
import { analyzeMmlLine, collectUsedIds, nextAvailableId } from '../src/utils/mmlContextParser.ts';

let failed = 0;
const assert = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`[FAIL] ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`[OK]   ${name}`);
  }
};

// ── analyzeMmlLine: 行解析 ──
assert('P1 @1 o4 c d e -> toneId=1',
  analyzeMmlLine('P1 @1 o4 c d e'),
  { toneId: 1, volEnvId: null, pitchEnvId: null });

assert('@FM3 C D E -> toneId=3',
  analyzeMmlLine('@FM3 C D E'),
  { toneId: 3, volEnvId: null, pitchEnvId: null });

assert('@VE2 C -> volEnvId=2',
  analyzeMmlLine('@VE2 C'),
  { toneId: null, volEnvId: 2, pitchEnvId: null });

assert('@v5 C -> volEnvId=5',
  analyzeMmlLine('@v5 C'),
  { toneId: null, volEnvId: 5, pitchEnvId: null });

assert('@PE4 C -> pitchEnvId=4',
  analyzeMmlLine('@PE4 C'),
  { toneId: null, volEnvId: null, pitchEnvId: 4 });

assert('混在行 @1 @v2 @PE3 C -> すべて抽出',
  analyzeMmlLine('@1 @v2 @PE3 C'),
  { toneId: 1, volEnvId: 2, pitchEnvId: 3 });

assert('混在行 @FM7 @VE8 @PE9 C -> すべて抽出',
  analyzeMmlLine('@FM7 @VE8 @PE9 C'),
  { toneId: 7, volEnvId: 8, pitchEnvId: 9 });

assert('コメント行 ; @1 -> null',
  analyzeMmlLine('; @1 O4 C'),
  { toneId: null, volEnvId: null, pitchEnvId: null });

assert('行内コメント @1 C ; @2 -> toneId=1 (コメント後無視)',
  analyzeMmlLine('@1 C ; @2'),
  { toneId: 1, volEnvId: null, pitchEnvId: null });

assert('他コマンド @WN1 @SW15 は音色IDに誤検出しない',
  analyzeMmlLine('@WN1 @SW15 C'),
  { toneId: null, volEnvId: null, pitchEnvId: null });

assert('トーン無し行 -> すべてnull',
  analyzeMmlLine('P1 o4 c d e f g'),
  { toneId: null, volEnvId: null, pitchEnvId: null });

assert('空行 -> すべてnull',
  analyzeMmlLine(''),
  { toneId: null, volEnvId: null, pitchEnvId: null });

// ── collectUsedIds: 全文走査 ──
const sample = `; コメント
#TITLE "Test"
@1 = { /* tone */ }
@3 = { /* tone */ }
P1 @1 @FM2 o4 c
P2 @v1 @VE2 c
@v4 = { 15, |L 10, |R 5 }
P3 @PE5 c
@PE7 = { 0, 3, 6 }
@WN1 @SW15 @q8
`;
const used = collectUsedIds(sample);
assert('collectUsedIds toneIds = {1,2,3}',
  [...used.toneIds].sort((a, b) => a - b), [1, 2, 3]);
assert('collectUsedIds volEnvIds = {1,2,4}',
  [...used.volEnvIds].sort((a, b) => a - b), [1, 2, 4]);
assert('collectUsedIds pitchEnvIds = {5,7}',
  [...used.pitchEnvIds].sort((a, b) => a - b), [5, 7]);

// ── nextAvailableId ──
assert('nextAvailableId({1,2,3}) = 4', nextAvailableId(new Set([1, 2, 3])), 4);
assert('nextAvailableId(空) = 1', nextAvailableId(new Set()), 1);

// ── 結果 ──
if (failed > 0) {
  console.error(`\n${failed} tests FAILED`);
  process.exit(1);
}
console.log('\nAll tests passed!');
