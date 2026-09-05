/**
 * Z80 アセンブラで扱うレジスタ / 条件コード / オペランドの型定義。
 * (移植元: MzSound.DriverAssembler/Assembler/Z80Operand.cs)
 */

/** 8bit レジスタ (0-7 は Z80 エンコード順に一致) */
export const Reg8 = {
  B: 0,
  C: 1,
  D: 2,
  E: 3,
  H: 4,
  L: 5,
  Hli: 6,
  A: 7,
  /** IXH / IYH (indexBase で区別) */
  IndexH: 8,
  /** IXL / IYL (indexBase で区別) */
  IndexL: 9,
} as const;
export type Reg8 = (typeof Reg8)[keyof typeof Reg8];

/** 16bit レジスタ */
export const Reg16 = {
  Bc: 0,
  De: 1,
  Hl: 2,
  Sp: 3,
  Af: 4,
  Ix: 5,
  Iy: 6,
} as const;
export type Reg16 = (typeof Reg16)[keyof typeof Reg16];

/** 条件コード (jr / jp / call / ret 用) */
export const Condition = {
  Nz: 0,
  Z: 1,
  Nc: 2,
  C: 3,
} as const;
export type Condition = (typeof Condition)[keyof typeof Condition];

/** オペランドの種別 */
export const OperandKind = {
  Register8: 0,
  Register16: 1,
  ConditionCode: 2,
  /** (HL) */
  IndirectHl: 3,
  /** (IX+d) / (IY+d) */
  Indexed: 4,
  /** (nn) — 絶対アドレス間接 */
  IndirectExpr: 5,
  /** (C) */
  IndirectC: 6,
  /** 即値 / 絶対アドレス式 */
  Expr: 7,
  /** high(expr) */
  HighExpr: 8,
  /** low(expr) */
  LowExpr: 9,
} as const;
export type OperandKind = (typeof OperandKind)[keyof typeof OperandKind];

/** オペランド。種別 + 式テキスト + インデックス変位を持つ。 */
export interface Operand {
  kind: OperandKind;

  /** Register8 / Register16 / ConditionCode の場合の値。 */
  index: number;

  /** Indexed の場合のベースレジスタ (Ix / Iy)。 */
  indexBase: Reg16;

  /** 式テキスト (Expr / IndirectExpr / Indexed の変位)。 */
  expression: string;
}
