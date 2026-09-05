/**
 * FM 演算子 1 つ分: 位相発生器、エンベロープ発生器、サイン検索。
 * (fmgen.cpp の Operator クラスより移植 — Copyright (C) cisc 1998, 2003。
 * 移植元: MzSound.Player/Chips/Fm/FmOperator.cs + FmOperator.Calc.cs +
 * FmOperator.Eg.cs + FmOperator.Params.cs を 1 モジュールへ統合)
 */
import { FmChip } from './FmChip';
import {
  AmTable,
  AttackTable,
  buildFmTables,
  ClEnts,
  ClTable,
  DecayTable1,
  DecayTable2,
  DtTable,
  EgBottom,
  InputShift,
  Is2EcShift,
  NoteTable,
  OpSinEnts,
  PgBits,
  RatioBits,
  SineIndexShift,
  SineTable,
  SsgEnvTable,
} from './FmTables';

/** EG レベルの最大値 (無音)。 */
const MaxEgLevel = 0x3ff;

/** 演算子タイプ (C# enum FmOpType 相当)。 */
export const FmOpType = {
  Normal: 0, // typeN
  Mod: 1, // typeM
} as const;

export type FmOpType = (typeof FmOpType)[keyof typeof FmOpType];

/** エンベロープ位相 (C# enum EgPhase 相当)。 */
export const EgPhase = {
  Next: 0,
  Attack: 1,
  Decay: 2,
  Sustain: 3,
  Release: 4,
  Off: 5,
} as const;

export type EgPhase = (typeof EgPhase)[keyof typeof EgPhase];

export class FmOperator {
  private chip!: FmChip;

  // 演算子出力 / フィードバック履歴
  private outValue = 0;
  private out2 = 0;

  // 位相発生器
  private dp = 0; // 位相ステップの基底 (キーコード / キーフラクション)
  private detune = 0;
  private detune2 = 0;
  private multiple = 0;
  private pgCount = 0; // C# uint 相当 (32bit ラップ)
  private pgDiff = 0; // C# uint 相当
  private pgDiffLfo = 0;
  private bn = 0; // ブロックナンバー

  // エンベロープ発生器
  private egLevel = 0;
  private egLevelOnNextPhase = 0;
  private egCount = 0;
  private egCountDiff = 0;
  private egOut = 0; // EG+TL 合成出力レベル
  private tlOut = 0; // TL 単独の出力レベル
  private egRate = 0;
  private egCurveCount = 0;
  private ssgOffset = 0;
  private ssgVector = 1;
  private ssgPhase = 0;
  private keyScaleRate = 0;
  private egPhase: EgPhase = EgPhase.Off;
  private ams = AmTable[0][0];
  private msValue = 0;

  // パラメータ
  private opType: FmOpType = FmOpType.Normal;
  private tl = 0;
  private tlLatch = 0;
  private ar = 0;
  private dr = 0;
  private sr = 0;
  private sl = 0;
  private rr = 0;
  private ks = 0;
  private ssgType = 0;
  private keyon = false;
  private amonFlag = false;
  private paramChanged = true;
  private muteFlag = false;

  constructor() {
    buildFmTables();
  }

  setChip(chip: FmChip): void {
    this.chip = chip;
  }

  getType(): FmOpType {
    return this.opType;
  }

  getMs(): number {
    return this.msValue;
  }

  getAmon(): boolean {
    return this.amonFlag;
  }

  /** 直近 1 標本の出力値。 */
  getOut(): number {
    return this.outValue;
  }

  reset(): void {
    this.tl = this.tlLatch = 127;
    this.shiftPhase(EgPhase.Off);
    this.egCount = 0;
    this.egCurveCount = 0;
    this.ssgPhase = 0;
    this.pgCount = 0;
    this.outValue = this.out2 = 0;
    this.paramChanged = true;
  }

  resetFb(): void {
    this.outValue = this.out2 = 0;
  }

  isOn(): number {
    return this.egPhase - EgPhase.Off;
  }

  keyOn(): void {
    if (this.keyon) {
      return;
    }

    this.keyon = true;
    if (this.egPhase === EgPhase.Off || this.egPhase === EgPhase.Release) {
      this.ssgPhase = -1;
      this.shiftPhase(EgPhase.Attack);
      this.egUpdate();
      this.outValue = this.out2 = 0;
      this.pgCount = 0;
    }
  }

  keyOff(): void {
    if (!this.keyon) {
      return;
    }

    this.keyon = false;
    this.shiftPhase(EgPhase.Release);
  }

  // ---------------------------------------------------------------- 計算 (Calc)

  /** 標本 1 つ分の演算子出力 (LFO なし)。 */
  calc(input: number): number {
    this.egStep();
    this.out2 = this.outValue;
    let pgin = this.pgCalc() >> SineIndexShift;
    pgin += input >> InputShift;
    this.outValue = this.logToLin(this.egOut + this.sine(pgin));
    return this.outValue;
  }

  /** 標本 1 つ分の演算子出力 (LFO あり: 位相/振幅変調)。 */
  calcL(input: number): number {
    this.egStep();
    let pgin = this.pgCalcL() >> SineIndexShift;
    pgin += input >> InputShift;
    this.outValue = this.logToLin(this.egOut + this.sine(pgin) + this.ams[this.chip.getAml()]);
    return this.outValue;
  }

  /** ノイズチャンネルの標本 1 つ分出力。 */
  calcN(noise: number): number {
    this.egStep();
    const level = Math.max(0, MaxEgLevel - (this.tlOut + this.egLevel)) << 1;
    const sign = (noise & 1) - 1;
    this.outValue = (level + sign) ^ sign;
    return this.outValue;
  }

  /** セルフフィードバック付き演算子 (1 標本前の出力を返す)。 */
  calcFb(fb: number): number {
    this.egStep();
    const input = this.outValue + this.out2;
    this.out2 = this.outValue;
    let pgin = this.pgCalc() >> SineIndexShift;
    if (fb < 31) {
      pgin += (input << (1 + Is2EcShift)) >> fb >> SineIndexShift;
    }

    this.outValue = this.logToLin(this.egOut + this.sine(pgin));
    return this.out2;
  }

  /** セルフフィードバック + LFO 付き演算子 (現在の出力を返す)。 */
  calcFbL(fb: number): number {
    this.egStep();
    const input = this.outValue + this.out2;
    this.out2 = this.outValue;
    let pgin = this.pgCalcL() >> SineIndexShift;
    if (fb < 31) {
      pgin += (input << (1 + Is2EcShift)) >> fb >> SineIndexShift;
    }

    this.outValue = this.logToLin(this.egOut + this.sine(pgin) + this.ams[this.chip.getAml()]);
    return this.outValue;
  }

  private logToLin(a: number): number {
    return (a >>> 0) < ClEnts ? ClTable[a >>> 0] : 0;
  }

  // リファレンス実装では SINE マクロ: 位相は既にサイン表単位へシフト済みなので
  // 表のマスクを適用するのみ。
  private sine(phase: number): number {
    return SineTable[phase & (OpSinEnts - 1)];
  }

  private pgCalc(): number {
    const ret = this.pgCount;
    this.pgCount = (this.pgCount + this.pgDiff) >>> 0;
    return ret;
  }

  private pgCalcL(): number {
    const ret = this.pgCount;
    // C# : pgCount += pgDiff + (uint)(pgDiffLfo * pmv >> 5)
    const mod = ((this.pgDiffLfo * this.chip.getPmv()) >> 5) >>> 0;
    this.pgCount = (this.pgCount + this.pgDiff + mod) >>> 0;
    return ret;
  }

  // ----------------------------------------------------- エンベロープ (Eg)

  private egUpdate(): void {
    if (this.ssgType === 0) {
      this.egOut = Math.min(this.tlOut + this.egLevel, MaxEgLevel) << 3;
    } else {
      this.egOut = Math.min(this.tlOut + this.egLevel * this.ssgVector + this.ssgOffset, MaxEgLevel) << 3;
    }
  }

  private setEgRate(rate: number): void {
    this.egRate = rate;
    this.egCountDiff = DecayTable2[(rate / 4) | 0] * this.chip.getRatio();
  }

  private egStep(): void {
    this.egCount -= this.egCountDiff;
    if (this.egCount <= 0) {
      this.egCalc();
    }
  }

  private egCalc(): void {
    this.egCount = (2047 * 3) << RatioBits;

    if (this.egPhase === EgPhase.Attack) {
      const c = AttackTable[this.egRate][this.egCurveCount & 7];
      if (c >= 0) {
        this.egLevel -= 1 + (this.egLevel >> c);
        if (this.egLevel <= 0) {
          this.shiftPhase(EgPhase.Decay);
        }
      }

      this.egUpdate();
    } else {
      if (this.ssgType === 0) {
        this.egLevel += DecayTable1[this.egRate][this.egCurveCount & 7];
        if (this.egLevel >= this.egLevelOnNextPhase) {
          this.shiftPhase(this.egPhase + 1);
        }

        this.egUpdate();
      } else {
        this.egLevel += 4 * DecayTable1[this.egRate][this.egCurveCount & 7];
        if (this.egLevel >= this.egLevelOnNextPhase) {
          switch (this.egPhase) {
            case EgPhase.Decay:
              this.shiftPhase(EgPhase.Sustain);
              break;
            case EgPhase.Sustain:
              this.shiftPhase(EgPhase.Attack);
              break;
            case EgPhase.Release:
              this.shiftPhase(EgPhase.Off);
              break;
          }
        }

        this.egUpdate();
      }
    }

    this.egCurveCount++;
  }

  /** エンベロープ位相を遷移させる (C++ の switch fallthrough を明示展開)。 */
  private shiftPhase(nextPhase: number): void {
    let phase = nextPhase;
    if (phase === EgPhase.Attack) {
      this.tl = this.tlLatch;
      if (this.ssgType !== 0) {
        this.ssgPhase++;
        if (this.ssgPhase > 2) {
          this.ssgPhase = 1;
        }

        const m = this.ar >= (this.ssgType === 8 || this.ssgType === 12 ? 56 : 60) ? 1 : 0;
        this.ssgOffset = SsgEnvTable[this.ssgType & 7][m][this.ssgPhase][0] * 0x200;
        this.ssgVector = SsgEnvTable[this.ssgType & 7][m][this.ssgPhase][1];
      }

      if (this.ar + this.keyScaleRate < 62) {
        this.setEgRate(this.ar !== 0 ? Math.min(63, this.ar + this.keyScaleRate) : 0);
        this.egPhase = EgPhase.Attack;
        return;
      }

      phase = EgPhase.Decay;
    }

    if (phase === EgPhase.Decay) {
      if (this.sl !== 0) {
        this.egLevel = 0;
        this.egLevelOnNextPhase = this.ssgType !== 0 ? Math.min(this.sl * 8, 0x200) : this.sl * 8;
        this.setEgRate(this.dr !== 0 ? Math.min(63, this.dr + this.keyScaleRate) : 0);
        this.egPhase = EgPhase.Decay;
        return;
      }

      phase = EgPhase.Sustain;
    }

    if (phase === EgPhase.Sustain) {
      this.egLevel = this.sl * 8;
      this.egLevelOnNextPhase = this.ssgType !== 0 ? 0x200 : 0x400;
      this.setEgRate(this.sr !== 0 ? Math.min(63, this.sr + this.keyScaleRate) : 0);
      this.egPhase = EgPhase.Sustain;
      return;
    }

    if (phase === EgPhase.Release) {
      if (this.ssgType !== 0) {
        this.egLevel = this.egLevel * this.ssgVector + this.ssgOffset;
        this.ssgVector = 1;
        this.ssgOffset = 0;
      }

      if (this.egPhase === EgPhase.Attack || this.egLevel < EgBottom) {
        this.egLevelOnNextPhase = 0x400;
        this.setEgRate(Math.min(63, this.rr + this.keyScaleRate));
        this.egPhase = EgPhase.Release;
        return;
      }
    }

    // Off (Next は渡されない)
    this.egLevel = EgBottom;
    this.egLevelOnNextPhase = EgBottom;
    this.egUpdate();
    this.setEgRate(0);
    this.egPhase = EgPhase.Off;
  }

  // ------------------------------------------------------ パラメータ (Params)

  setType(type: FmOpType): void {
    this.opType = type;
  }

  setDt(dt: number): void {
    this.detune = dt * 0x20;
    this.paramChanged = true;
  }

  setDt2(dt2: number): void {
    this.detune2 = dt2 & 3;
    this.paramChanged = true;
  }

  setMultiple(multiple: number): void {
    this.multiple = multiple;
    this.paramChanged = true;
  }

  setTl(value: number, csm: boolean): void {
    if (!csm) {
      this.tl = value;
    }

    this.tlLatch = value;
    this.paramChanged = true;
  }

  setAr(value: number): void {
    this.ar = value;
    this.paramChanged = true;
  }

  setDr(value: number): void {
    this.dr = value;
    this.paramChanged = true;
  }

  setSr(value: number): void {
    this.sr = value;
    this.paramChanged = true;
  }

  setRr(value: number): void {
    this.rr = value;
    this.paramChanged = true;
  }

  setSl(value: number): void {
    this.sl = value;
    this.paramChanged = true;
  }

  setKs(value: number): void {
    this.ks = value;
    this.paramChanged = true;
  }

  setSsgEc(ssgec: number): void {
    if ((ssgec & 8) !== 0) {
      this.ssgType = ssgec;
      this.ssgPhase =
        this.egPhase === EgPhase.Attack ? 0 : this.egPhase === EgPhase.Decay ? 1 : 2;
    } else {
      this.ssgType = 0;
    }

    this.paramChanged = true;
  }

  setAmon(on: boolean): void {
    this.amonFlag = on;
    this.paramChanged = true;
  }

  setMs(value: number): void {
    this.msValue = value;
    this.paramChanged = true;
  }

  mute(mute: boolean): void {
    this.muteFlag = mute;
    this.paramChanged = true;
  }

  /** パラメータ変更後、次の prepare() で再計算するようマークする。 */
  refresh(): void {
    this.paramChanged = true;
  }

  setFNum(f: number): void {
    this.dp = ((f & 2047) << ((f >> 11) & 7)) >>> 0;
    this.bn = NoteTable[(f >> 7) & 127];
    this.paramChanged = true;
  }

  setDpBn(dp: number, bn: number): void {
    this.dp = dp;
    this.bn = bn;
    this.paramChanged = true;
  }

  /** パラメータ変更後にレート依存の状態を再計算する。 */
  prepare(): void {
    if (!this.paramChanged) {
      return;
    }

    this.paramChanged = false;

    // 位相発生器: (位相ステップ + デチューン) × multiple/DT2 係数。
    // C# : pgDiff = (dp + (uint)DtTable[detune + bn]) * mulValue (uint 乗算)
    const dt = DtTable[this.detune + this.bn] >>> 0;
    const sum = (this.dp + dt) >>> 0;
    this.pgDiff = Math.imul(sum, this.chip.getMulValue(this.detune2, this.multiple)) >>> 0;
    this.pgDiff >>>= 2 + RatioBits - PgBits;
    this.pgDiffLfo = this.pgDiff >>> 11;

    // エンベロープ発生器。
    this.keyScaleRate = this.bn >> (3 - this.ks);
    this.tlOut = this.muteFlag ? MaxEgLevel : this.tl * 8;

    switch (this.egPhase) {
      case EgPhase.Attack:
        this.setEgRate(this.ar !== 0 ? Math.min(63, this.ar + this.keyScaleRate) : 0);
        break;
      case EgPhase.Decay:
        this.setEgRate(this.dr !== 0 ? Math.min(63, this.dr + this.keyScaleRate) : 0);
        this.egLevelOnNextPhase = this.sl * 8;
        break;
      case EgPhase.Sustain:
        this.setEgRate(this.sr !== 0 ? Math.min(63, this.sr + this.keyScaleRate) : 0);
        break;
      case EgPhase.Release:
        this.setEgRate(Math.min(63, this.rr + this.keyScaleRate));
        break;
    }

    if (this.ssgType !== 0 && this.egPhase !== EgPhase.Release) {
      if (this.ssgPhase === -1) {
        // XXX quick fix (fmgen.cpp)
        this.ssgPhase = 0;
      }

      const m = this.ar >= (this.ssgType === 8 || this.ssgType === 12 ? 56 : 60) ? 1 : 0;
      this.ssgOffset = SsgEnvTable[this.ssgType & 7][m][this.ssgPhase][0] * 0x200;
      this.ssgVector = SsgEnvTable[this.ssgType & 7][m][this.ssgPhase][1];
    }

    this.ams = AmTable[this.opType][this.amonFlag ? (this.msValue >> 4) & 3 : 0];
    this.egUpdate();
  }
}
