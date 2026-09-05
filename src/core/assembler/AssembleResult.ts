/**
 * アセンブル結果とアセンブラ例外。
 * (移植元: MzSound.DriverAssembler/AssembleResult.cs)
 */
import { OperandKind, type Operand } from './Z80Operand';

/** アセンブル結果。生成バイナリとラベル / シンボル辞書。 */
export interface AssembleResult {
  /** 生成されたバイナリ (0 から開始。ロードアドレスは labels の "*" / origin を参照)。 */
  data: Uint8Array;

  /** ラベル / シンボル → アドレス (キーは小文字正規化)。"star" は開始アドレス (org 値)。 */
  labels: ReadonlyMap<string, number>;

  /** org で指定された開始アドレス。 */
  origin: number;
}

/** アセンブルエラー (行番号付き)。 */
export class AssemblerException extends Error {
  readonly lineNumber: number;

  constructor(lineNumber: number, message: string) {
    super(`line ${lineNumber}: ${message}`);
    this.name = 'AssemblerException';
    this.lineNumber = lineNumber;
  }
}

/** オペランドのデバッグ表示 (C# Operand.ToString 相当)。 */
export function operandToString(operand: Operand): string {
  switch (operand.kind) {
    case OperandKind.Register8:
      return String(operand.index);
    case OperandKind.Register16:
      return Reg16Label(operand.index);
    case OperandKind.ConditionCode:
      return String(operand.index);
    case OperandKind.IndirectHl:
      return '(hl)';
    case OperandKind.Indexed:
      return `(${Reg16Label(operand.indexBase).toLowerCase()}${operand.expression})`;
    case OperandKind.IndirectExpr:
      return `(${operand.expression})`;
    case OperandKind.IndirectC:
      return '(c)';
    case OperandKind.HighExpr:
      return `high(${operand.expression})`;
    case OperandKind.LowExpr:
      return `low(${operand.expression})`;
    default:
      return operand.expression;
  }
}

function Reg16Label(index: number): string {
  return ['bc', 'de', 'hl', 'sp', 'af', 'ix', 'iy'][index] ?? String(index);
}

