/**
 * YM2151 (OPM) 4-Operator FM 音色のデータ型とアルゴリズム純粋ロジック。
 * UI (React コンポーネント) に依存しないコア層モジュールとして切り出しており、
 * view (FmToneEditor) と utils (virtualSynth) の双方から参照される。
 */

export interface OperatorParams {
  tl: number;   // Total Level (0〜127, 0=Max, 127=Mute)
  ar: number;   // Attack Rate (0〜31)
  d1r: number;  // Decay 1 Rate (0〜31)
  d1l: number;  // Decay 1 Level (0〜15)
  d2r: number;  // Decay 2 Rate / Sustain Rate (0〜31)
  rr: number;   // Release Rate (0〜31)
  mul: number;  // Frequency Multiple (0〜15)
  dt1: number;  // Detune 1 (0〜7)
  dt2: number;  // Detune 2 (0〜3)
  ks: number;   // Key Scale (0〜3)
  ame: boolean; // Amplitude Modulation Enable
}

export interface FmToneData {
  id: number;
  name: string;
  alg: number;  // Algorithm (0〜7)
  fb: number;   // Feedback (0〜7)
  ops: [OperatorParams, OperatorParams, OperatorParams, OperatorParams];
}

/** YM2151 (OPM) アルゴリズムにおけるキャリア判定 (OP1: 0, OP2: 1, OP3: 2, OP4: 3) */
export const isOpCarrier = (alg: number, opIdx: number): boolean => {
  switch (alg) {
    case 0: return opIdx === 3; // OP4
    case 1: return opIdx === 3; // OP4
    case 2: return opIdx === 3; // OP4
    case 3: return opIdx === 3; // OP4
    case 4: return opIdx === 1 || opIdx === 3; // OP2, OP4
    case 5: return opIdx === 1 || opIdx === 2 || opIdx === 3; // OP2, OP3, OP4
    case 6: return opIdx === 1 || opIdx === 2 || opIdx === 3; // OP2, OP3, OP4
    case 7: return true; // OP1, OP2, OP3, OP4
    default: return opIdx === 3;
  }
};

/** 各アルゴリズムにおける変調関係の定義 (FM接続マトリクス) */
export const OP_MODULATION_TARGETS: Record<number, [number[], number[], number[], number[]]> = {
  0: [[1], [2], [3], []],        // 1 -> 2 -> 3 -> 4
  1: [[2], [2], [3], []],        // (1 + 2) -> 3 -> 4
  2: [[3], [2], [3], []],        // (1 + (2 -> 3)) -> 4
  3: [[1], [3], [3], []],        // ((1 -> 2) + 3) -> 4
  4: [[1], [],  [3], []],        // (1 -> 2) + (3 -> 4)
  5: [[1, 2, 3], [], [], []],    // 1 -> (2 + 3 + 4)
  6: [[1], [], [], []],          // (1 -> 2) + 3 + 4
  7: [[], [], [], []],           // 1 + 2 + 3 + 4 (All parallel)
};

/** 指定OPを変調しているソースOPの配列を取得 */
export const getOpSources = (alg: number, opIdx: number): number[] => {
  const targets = OP_MODULATION_TARGETS[alg] || [[], [], [], []];
  const sources: number[] = [];
  for (let src = 0; src < 4; src++) {
    if (targets[src].includes(opIdx)) {
      sources.push(src);
    }
  }
  return sources;
};
