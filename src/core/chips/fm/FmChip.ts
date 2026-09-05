/**
 * 全チャンネル共有のチップリソース: チップクロックと出力サンプルレートから
 * 導かれるピッチ比 (FM_RATIOBITS 固定小数点) と現在の LFO 深度。
 * (fmgen.cpp の Chip クラス / 移植元: MzSound.Player/Chips/Fm/FmChip.cs)
 */
import { LfoEnts } from './FmTables';

export class FmChip {
  /** 位相ステップ表: multiTable[dt2][multiple] (C# uint 相当・32bit 未満の値)。 */
  private readonly multiTable: number[][] = [
    new Array<number>(16).fill(0),
    new Array<number>(16).fill(0),
    new Array<number>(16).fill(0),
    new Array<number>(16).fill(0),
  ];

  private ratio = 0;

  private aml = 0;

  private pml = 0;

  private pmv = 0;

  /** 比率 (FM_RATIOBITS 固定小数点) を設定し、乗算表を作り直す。 */
  setRatio(ratio: number): void {
    if (this.ratio === ratio) {
      return;
    }

    this.ratio = ratio;
    this.makeTable();
  }

  setAml(level: number): void {
    this.aml = level & (LfoEnts - 1);
  }

  setPml(level: number): void {
    this.pml = level & (LfoEnts - 1);
  }

  setPmv(value: number): void {
    this.pmv = value;
  }

  getAml(): number {
    return this.aml;
  }

  getPml(): number {
    return this.pml;
  }

  getPmv(): number {
    return this.pmv;
  }

  getRatio(): number {
    return this.ratio;
  }

  getMulValue(dt2: number, multiple: number): number {
    return this.multiTable[dt2][multiple];
  }

  private makeTable(): void {
    // 位相発生器のステップ表: multiple × ratio × DT2 係数。
    const dt2Levels = [1.0, 1.414, 1.581, 1.732];
    for (let h = 0; h < 4; h++) {
      const rr = dt2Levels[h] * this.ratio;
      for (let l = 0; l < 16; l++) {
        const multiple = l !== 0 ? l * 2 : 1;
        // C# の (uint) キャスト相当 (値は 32bit 未満に収まる)
        this.multiTable[h][l] = (multiple * rr) >>> 0;
      }
    }
  }
}