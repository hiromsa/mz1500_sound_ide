/**
 * 4 演算子 FM チャンネル: 接続アルゴリズムのルーティング、フィードバック、
 * キーコード処理。(fmgen.cpp の Channel4 クラスより移植 — Copyright (C) cisc
 * 1998, 2003。移植元: MzSound.Player/Chips/Fm/FmChannel4.cs +
 * FmChannel4.Calc.cs を 1 モジュールへ統合)
 */
import { FmChip } from './FmChip';
import { FmOpType, FmOperator } from './FmOperator';
import { FbTable, KfTable, PmTable } from './FmTables';

export class FmChannel4 {
  /** 接続アルゴリズム: [in 0, out 0, in 1, out 1, in 2, out 2] バッファインデックス。 */
  private static readonly algorithmTable: number[][] = [
    [0, 1, 1, 2, 2, 3],
    [1, 0, 0, 1, 1, 2],
    [1, 1, 1, 0, 0, 2],
    [0, 1, 2, 1, 1, 2],
    [0, 1, 2, 2, 2, 1],
    [0, 1, 0, 1, 0, 1],
    [0, 1, 2, 1, 2, 1],
    [1, 0, 1, 0, 1, 0],
  ];

  /** キーコード → 基本位相ステップ (fmgen.cpp の kctable)。 */
  private static readonly kcTable: number[] = [
    5197, 5506, 5833, 6180, 6180, 6547, 6937, 7349,
    7349, 7786, 8249, 8740, 8740, 9259, 9810, 10394,
  ];

  private readonly ops: FmOperator[] = [
    new FmOperator(),
    new FmOperator(),
    new FmOperator(),
    new FmOperator(),
  ];

  private readonly buf: number[] = new Array<number>(4).fill(0);

  private readonly inIndex: number[] = new Array<number>(3).fill(0);

  private readonly outIndex: number[] = new Array<number>(3).fill(0);

  private pms = PmTable[0][0];

  private fb = 0;

  private algorithm = 0;

  private chip!: FmChip;

  constructor() {
    this.setAlgorithm(0);
  }

  getOp(slot: number): FmOperator {
    return this.ops[slot];
  }

  setChip(chip: FmChip): void {
    this.chip = chip;
    for (const op of this.ops) {
      op.setChip(chip);
    }
  }

  setType(type: FmOpType): void {
    for (const op of this.ops) {
      op.setType(type);
    }
  }

  setFb(feedback: number): void {
    this.fb = FbTable[feedback];
  }

  setMs(ms: number): void {
    for (const op of this.ops) {
      op.setMs(ms);
    }
  }

  mute(mute: boolean): void {
    for (const op of this.ops) {
      op.mute(mute);
    }
  }

  /** クロック比率変更後に全パラメータを再計算対象へマークする。 */
  refresh(): void {
    for (const op of this.ops) {
      op.refresh();
    }
  }

  reset(): void {
    for (const op of this.ops) {
      op.reset();
    }
  }

  /** パラメータを再計算する。キーオン | LFO 使用中フラグ (奇数/偶数ビットペア) を返す。 */
  prepare(): number {
    for (const op of this.ops) {
      op.prepare();
    }

    this.pms = PmTable[this.ops[0].getType()][this.ops[0].getMs() & 7];
    const key =
      this.ops[0].isOn() | this.ops[1].isOn() | this.ops[2].isOn() | this.ops[3].isOn() ? 1 : 0;
    const anyAmon =
      this.ops[0].getAmon() || this.ops[1].getAmon() || this.ops[2].getAmon() || this.ops[3].getAmon();
    const lfo = (this.ops[0].getMs() & (anyAmon ? 0x37 : 7)) !== 0 ? 2 : 0;
    return key | lfo;
  }

  setKcKf(kc: number, kf: number): void {
    const oct = 19 - ((kc >> 4) & 7);
    // C# uint 演算を再現: kcv = (kcv + 2) / 4 * 4 (整数除算)
    let kcv = FmChannel4.kcTable[kc & 0x0f] >>> 0;
    kcv = (((kcv + 2) / 4) | 0) * 4;
    // dp = kcv * KfTable[kf] (32bit 内に収まる積)
    let dp = Math.imul(kcv, KfTable[kf & 0x3f]) >>> 0;
    dp >>>= 16 + 3;
    dp = (dp << (16 + 3)) >>> 0;
    dp >>>= oct;
    const bn = (kc >> 2) & 31;
    for (const op of this.ops) {
      op.setDpBn(dp, bn);
    }
  }

  keyControl(key: number): void {
    if ((key & 0x1) !== 0) this.ops[0].keyOn(); else this.ops[0].keyOff();
    if ((key & 0x2) !== 0) this.ops[1].keyOn(); else this.ops[1].keyOff();
    if ((key & 0x4) !== 0) this.ops[2].keyOn(); else this.ops[2].keyOff();
    if ((key & 0x8) !== 0) this.ops[3].keyOn(); else this.ops[3].keyOff();
  }

  setAlgorithm(algo: number): void {
    const table = FmChannel4.algorithmTable[algo];
    this.inIndex[0] = table[0];
    this.outIndex[0] = table[1];
    this.inIndex[1] = table[2];
    this.outIndex[1] = table[3];
    this.inIndex[2] = table[4];
    this.outIndex[2] = table[5];
    this.ops[0].resetFb();
    this.algorithm = algo;
  }

  // ------------------------------------------------------- 標本計算 (Calc)

  /** チャンネル出力の標本 1 つ分 (LFO なし)。 */
  calc(): number {
    let r: number;
    switch (this.algorithm) {
      case 0:
        this.ops[2].calc(this.ops[1].getOut());
        this.ops[1].calc(this.ops[0].getOut());
        r = this.ops[3].calc(this.ops[2].getOut());
        this.ops[0].calcFb(this.fb);
        break;
      case 1:
        this.ops[2].calc(this.ops[0].getOut() + this.ops[1].getOut());
        this.ops[1].calc(0);
        r = this.ops[3].calc(this.ops[2].getOut());
        this.ops[0].calcFb(this.fb);
        break;
      case 2:
        this.ops[2].calc(this.ops[1].getOut());
        this.ops[1].calc(0);
        r = this.ops[3].calc(this.ops[0].getOut() + this.ops[2].getOut());
        this.ops[0].calcFb(this.fb);
        break;
      case 3:
        this.ops[2].calc(0);
        this.ops[1].calc(this.ops[0].getOut());
        r = this.ops[3].calc(this.ops[1].getOut() + this.ops[2].getOut());
        this.ops[0].calcFb(this.fb);
        break;
      case 4:
        this.ops[2].calc(0);
        r = this.ops[1].calc(this.ops[0].getOut());
        r += this.ops[3].calc(this.ops[2].getOut());
        this.ops[0].calcFb(this.fb);
        break;
      case 5:
        r = this.ops[2].calc(this.ops[0].getOut());
        r += this.ops[1].calc(this.ops[0].getOut());
        r += this.ops[3].calc(this.ops[0].getOut());
        this.ops[0].calcFb(this.fb);
        break;
      case 6:
        r = this.ops[2].calc(0);
        r += this.ops[1].calc(this.ops[0].getOut());
        r += this.ops[3].calc(0);
        this.ops[0].calcFb(this.fb);
        break;
      default: // 7
        r = this.ops[2].calc(0);
        r += this.ops[1].calc(0);
        r += this.ops[3].calc(0);
        r += this.ops[0].calcFb(this.fb);
        break;
    }

    return r;
  }

  /** チャンネル出力の標本 1 つ分 (LFO あり)。 */
  calcL(): number {
    this.chip.setPmv(this.pms[this.chip.getPml()]);
    let r: number;
    switch (this.algorithm) {
      case 0:
        this.ops[2].calcL(this.ops[1].getOut());
        this.ops[1].calcL(this.ops[0].getOut());
        r = this.ops[3].calcL(this.ops[2].getOut());
        this.ops[0].calcFbL(this.fb);
        break;
      case 1:
        this.ops[2].calcL(this.ops[0].getOut() + this.ops[1].getOut());
        this.ops[1].calcL(0);
        r = this.ops[3].calcL(this.ops[2].getOut());
        this.ops[0].calcFbL(this.fb);
        break;
      case 2:
        this.ops[2].calcL(this.ops[1].getOut());
        this.ops[1].calcL(0);
        r = this.ops[3].calcL(this.ops[0].getOut() + this.ops[2].getOut());
        this.ops[0].calcFbL(this.fb);
        break;
      case 3:
        this.ops[2].calcL(0);
        this.ops[1].calcL(this.ops[0].getOut());
        r = this.ops[3].calcL(this.ops[1].getOut() + this.ops[2].getOut());
        this.ops[0].calcFbL(this.fb);
        break;
      case 4:
        this.ops[2].calcL(0);
        r = this.ops[1].calcL(this.ops[0].getOut());
        r += this.ops[3].calcL(this.ops[2].getOut());
        this.ops[0].calcFbL(this.fb);
        break;
      case 5:
        r = this.ops[2].calcL(this.ops[0].getOut());
        r += this.ops[1].calcL(this.ops[0].getOut());
        r += this.ops[3].calcL(this.ops[0].getOut());
        this.ops[0].calcFbL(this.fb);
        break;
      case 6:
        r = this.ops[2].calcL(0);
        r += this.ops[1].calcL(this.ops[0].getOut());
        r += this.ops[3].calcL(0);
        this.ops[0].calcFbL(this.fb);
        break;
      default: // 7
        r = this.ops[2].calcL(0);
        r += this.ops[1].calcL(0);
        r += this.ops[3].calcL(0);
        r += this.ops[0].calcFbL(this.fb);
        break;
    }

    return r;
  }

  /** 演算子 3 をノイズ変調したチャンネル出力の標本 1 つ分。 */
  calcN(noise: number): number {
    this.buf[1] = this.buf[2] = this.buf[3] = 0;
    this.buf[0] = this.ops[0].getOut();
    this.ops[0].calcFb(this.fb);
    this.buf[this.outIndex[0]] += this.ops[1].calc(this.buf[this.inIndex[0]]);
    this.buf[this.outIndex[1]] += this.ops[2].calc(this.buf[this.inIndex[1]]);
    const previousOut = this.ops[3].getOut();
    this.ops[3].calcN(noise);
    return this.buf[this.outIndex[2]] + previousOut;
  }

  /** チャンネル出力の標本 1 つ分 (LFO + ノイズ)。 */
  calcLn(noise: number): number {
    this.chip.setPmv(this.pms[this.chip.getPml()]);
    this.buf[1] = this.buf[2] = this.buf[3] = 0;
    this.buf[0] = this.ops[0].getOut();
    this.ops[0].calcFbL(this.fb);
    this.buf[this.outIndex[0]] += this.ops[1].calcL(this.buf[this.inIndex[0]]);
    this.buf[this.outIndex[1]] += this.ops[2].calcL(this.buf[this.inIndex[1]]);
    const previousOut = this.ops[3].getOut();
    this.ops[3].calcN(noise);
    return this.buf[this.outIndex[2]] + previousOut;
  }
}