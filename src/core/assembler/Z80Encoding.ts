/**
 * Z80 命令のエンコーダ。MzSD ドライバで使用する命令サブセットに対応する。
 * パス 1 では未定義ラベルを 0 としてエンコードしサイズのみを確定する。
 * (移植元: MzSound.DriverAssembler/Assembler/Z80Encoding.cs)
 */
import { AssemblerException, operandToString } from './AssembleResult';
import { evaluateExpression } from './ExpressionEvaluator';
import { OperandKind, Reg8, Reg16, type Operand } from './Z80Operand';

/** 算術 / 論理命令 (add adc sub sbc and xor or cp) の 8bit ベースオペコード。 */
const aluBase = [0x80, 0x88, 0x90, 0x98, 0xa0, 0xa8, 0xb0, 0xb8];
const aluNames = ['add', 'adc', 'sub', 'sbc', 'and', 'xor', 'or', 'cp'];

/** 回転 / シフト命令 (CB プレフィックス) の下位オペコード。 */
const shiftBase: Record<string, number> = {
  rlc: 0x00, rrc: 0x08, rl: 0x10, rr: 0x18,
  sla: 0x20, sra: 0x28, sll: 0x30, srl: 0x38,
};

/** ブロック転送 / 比較命令 (ED プレフィックス)。 */
const blockOpcodes: Record<string, number> = {
  ldi: 0xa0, ldir: 0xb0, ldd: 0xa8, lddr: 0xb8,
  cpi: 0xa1, cpir: 0xb1, cpd: 0xa9, cpdr: 0xb9,
};

/** エンコードのコンテキスト。 */
interface EncodeContext {
  labels: ReadonlyMap<string, number>;
  resolveSymbols: boolean;
  lineNumber: number;
}

/** 命令をエンコードする。 */
export function encodeZ80(
  mnemonic: string,
  operands: Operand[],
  pc: number,
  labels: ReadonlyMap<string, number>,
  resolveSymbols: boolean,
  lineNumber: number,
): number[] {
  const output: number[] = [];
  const prefix = determinePrefix(operands, lineNumber);
  const ctx: EncodeContext = { labels, resolveSymbols, lineNumber };

  switch (mnemonic) {
    case 'ld':
      encodeLd(operands, prefix, output, ctx);
      break;

    case 'add':
    case 'adc':
    case 'sub':
    case 'sbc':
    case 'and':
    case 'xor':
    case 'or':
    case 'cp':
      encodeAlu(mnemonic, operands, prefix, output, ctx);
      break;

    case 'inc':
    case 'dec':
      encodeIncDec(mnemonic, operands, prefix, output, ctx);
      break;

    case 'jr':
      // 無条件 jr = 0x18 / 条件付き jr (nz/z/nc/c) = 0x20 | (cond << 3)
      encodeRelative(operands, output, pc, 0x18, 0x20, ctx);
      break;

    case 'djnz':
      expectOperandCount(operands, 1, lineNumber);
      output.push(0x10);
      output.push(relativeByte(evalOperand(operands[0], ctx), pc + 2, ctx));
      break;

    case 'jp':
      encodeJump(operands, output, ctx);
      break;

    case 'call':
      encodeCall(operands, output, ctx);
      break;

    case 'ret':
      if (operands.length === 0) {
        output.push(0xc9);
      } else {
        expectOperandCount(operands, 1, lineNumber);
        output.push(0xc0 | (conditionCode(operands[0], lineNumber) << 3));
      }

      break;

    case 'push':
    case 'pop':
      encodePushPop(mnemonic, operands, prefix, output, lineNumber);
      break;

    case 'ex':
      encodeEx(operands, output, lineNumber);
      break;

    case 'exx': output.push(0xd9); break;
    case 'nop': output.push(0x00); break;
    case 'halt': output.push(0x76); break;
    case 'di': output.push(0xf3); break;
    case 'ei': output.push(0xfb); break;
    case 'cpl': output.push(0x2f); break;
    case 'daa': output.push(0x27); break;
    case 'rlca': output.push(0x07); break;
    case 'rla': output.push(0x17); break;
    case 'rrca': output.push(0x0f); break;
    case 'rra': output.push(0x1f); break;

    case 'neg':
      expectOperandCount(operands, 0, lineNumber);
      output.push(0xed);
      output.push(0x44);
      break;

    case 'in':
      encodeIn(operands, output, ctx);
      break;

    case 'out':
      encodeOut(operands, output, ctx);
      break;

    case 'bit':
    case 'res':
    case 'set':
      encodeBitOps(mnemonic, operands, prefix, output, ctx);
      break;

    default:
      if (mnemonic in shiftBase) {
        encodeShift(mnemonic, shiftBase[mnemonic], operands, prefix, output, ctx);
      } else if (mnemonic in blockOpcodes) {
        expectOperandCount(operands, 0, lineNumber);
        output.push(0xed);
        output.push(blockOpcodes[mnemonic]);
      } else {
        throw new AssemblerException(lineNumber, `未対応のニーモニック: ${mnemonic}`);
      }

      break;
  }

  return output;
}

// ---- LD ---------------------------------------------------------------

function encodeLd(
  operands: Operand[],
  prefix: number | null,
  output: number[],
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;
  expectOperandCount(operands, 2, lineNumber);
  const dst = operands[0];
  const src = operands[1];

  // 16bit ← 即値
  if (dst.kind === OperandKind.Register16) {
    const reg = dst.index as Reg16;
    switch (reg) {
      case Reg16.Hl:
      case Reg16.Bc:
      case Reg16.De:
      case Reg16.Sp:
        if (src.kind === OperandKind.Expr) {
          output.push(0x01 | ((reg & 3) << 4));
          addWord(output, evalOperand(src, ctx), lineNumber);
          return;
        }
        break;
      case Reg16.Ix:
      case Reg16.Iy:
        if (src.kind === OperandKind.Expr) {
          output.push(reg === Reg16.Ix ? 0xdd : 0xfd);
          output.push(0x21);
          addWord(output, evalOperand(src, ctx), lineNumber);
          return;
        }
        break;
      default:
        break;
    }

    if (reg === Reg16.Sp && src.kind === OperandKind.Register16 && src.index === Reg16.Hl) {
      output.push(0xf9);
      return;
    }

    if (reg === Reg16.Sp && src.kind === OperandKind.Register16
      && (src.index === Reg16.Ix || src.index === Reg16.Iy)) {
      output.push(src.index === Reg16.Ix ? 0xdd : 0xfd);
      output.push(0xf9);
      return;
    }
  }

  // (nn) ← A / (nn) ← rr
  if (dst.kind === OperandKind.IndirectExpr && src.kind === OperandKind.Register8
    && src.index === Reg8.A && dst.expression !== 'bc' && dst.expression !== 'de') {
    output.push(0x32);
    addWord(output, evalOperand(dst, ctx), lineNumber);
    return;
  }

  if (dst.kind === OperandKind.IndirectExpr && src.kind === OperandKind.Register16) {
    switch (src.index as Reg16) {
      case Reg16.Hl: output.push(0x22); break;
      case Reg16.Bc: output.push(0xed); output.push(0x43); break;
      case Reg16.De: output.push(0xed); output.push(0x53); break;
      case Reg16.Sp: output.push(0xed); output.push(0x73); break;
      case Reg16.Ix:
      case Reg16.Iy:
        output.push(src.index === Reg16.Ix ? 0xdd : 0xfd);
        output.push(0x22);
        break;
      default: throw new AssemblerException(lineNumber, `LD (nn) に使えないレジスタ: ${operandToString(src)}`);
    }

    addWord(output, evalOperand(dst, ctx), lineNumber);
    return;
  }

  // A ← (nn) / A ← (bc) / A ← (de) / rr ← (nn)
  if (src.kind === OperandKind.IndirectExpr && dst.kind === OperandKind.Register8
    && dst.index === Reg8.A) {
    if (src.expression === 'bc') {
      output.push(0x0a);
      return;
    }

    if (src.expression === 'de') {
      output.push(0x1a);
      return;
    }

    output.push(0x3a);
    addWord(output, evalOperand(src, ctx), lineNumber);
    return;
  }

  if (src.kind === OperandKind.IndirectExpr && dst.kind === OperandKind.Register16) {
    switch (dst.index as Reg16) {
      case Reg16.Hl: output.push(0x2a); break;
      case Reg16.Bc: output.push(0xed); output.push(0x4b); break;
      case Reg16.De: output.push(0xed); output.push(0x5b); break;
      case Reg16.Sp: output.push(0xed); output.push(0x7b); break;
      case Reg16.Ix:
      case Reg16.Iy:
        output.push(dst.index === Reg16.Ix ? 0xdd : 0xfd);
        output.push(0x2a);
        break;
      default: throw new AssemblerException(lineNumber, `LD ← (nn) に使えないレジスタ: ${operandToString(dst)}`);
    }

    addWord(output, evalOperand(src, ctx), lineNumber);
    return;
  }

  encodeLd8(dst, src, prefix, output, ctx);
}

// ---- LD 8bit ----------------------------------------------------------

function encodeLd8(
  dst: Operand,
  src: Operand,
  prefix: number | null,
  output: number[],
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;

  if (dst.kind === OperandKind.Register8) {
    const r = dst.index;

    if (src.kind === OperandKind.Register8) {
      pushMaybe(output, prefix);
      output.push(0x40 | (dst.index << 3) | src.index);
      return;
    }

    if (src.kind === OperandKind.Expr) {
      if (r === Reg8.IndexH || r === Reg8.IndexL) {
        throw new AssemblerException(lineNumber, 'IXH/IXL への即値ロードは未対応です');
      }

      pushMaybe(output, prefix);
      output.push(0x06 | (dst.index << 3));
      output.push(byte(evalOperand(src, ctx), lineNumber));
      return;
    }

    if (src.kind === OperandKind.IndirectHl) {
      if (r === Reg8.IndexH || r === Reg8.IndexL) {
        throw new AssemblerException(lineNumber, 'IXH/IXL ← (HL) は未対応です');
      }

      pushMaybe(output, prefix);
      output.push(0x40 | (dst.index << 3) | 0x06);
      return;
    }

    if (src.kind === OperandKind.Indexed) {
      if (r === Reg8.H || r === Reg8.L || r === Reg8.IndexH || r === Reg8.IndexL) {
        throw new AssemblerException(lineNumber, '(IX+d) と H/L の組み合わせは未対応です');
      }

      pushMaybe(output, prefix);
      output.push(0x40 | (dst.index << 3) | 0x06);
      output.push(displacement(src, ctx));
      return;
    }
  }

  if (dst.kind === OperandKind.IndirectHl) {
    if (src.kind === OperandKind.Register8) {
      if (src.index === Reg8.IndexH || src.index === Reg8.IndexL) {
        throw new AssemblerException(lineNumber, '(HL) ← IXH/IXL は未対応です');
      }

      pushMaybe(output, prefix);
      output.push(0x70 | src.index);
      return;
    }

    if (src.kind === OperandKind.Expr) {
      pushMaybe(output, prefix);
      output.push(0x36);
      output.push(byte(evalOperand(src, ctx), lineNumber));
      return;
    }
  }

  if (dst.kind === OperandKind.Indexed) {
    if (src.kind === OperandKind.Register8) {
      if (src.index === Reg8.H || src.index === Reg8.L || src.index === Reg8.IndexH || src.index === Reg8.IndexL) {
        throw new AssemblerException(lineNumber, '(IX+d) ← H/L は未対応です');
      }

      pushMaybe(output, prefix);
      output.push(0x70 | src.index);
      output.push(displacement(dst, ctx));
      return;
    }

    if (src.kind === OperandKind.Expr) {
      pushMaybe(output, prefix);
      output.push(0x36);
      output.push(displacement(dst, ctx));
      output.push(byte(evalOperand(src, ctx), lineNumber));
      return;
    }
  }

  throw new AssemblerException(lineNumber, `未対応の LD 形式: ${operandToString(dst)}, ${operandToString(src)}`);
}

// ---- 算術 / 論理 -------------------------------------------------------

function encodeAlu(
  mnemonic: string,
  operands: Operand[],
  prefix: number | null,
  output: number[],
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;
  const opIndex = aluNames.indexOf(mnemonic);

  // 16bit ADD/ADC/SBC (HL/IX/IY, rr)
  if ((opIndex === 0 || opIndex === 1 || opIndex === 3) && operands.length === 2
    && operands[0].kind === OperandKind.Register16) {
    const dst = operands[0].index as Reg16;
    const src = operands[1];
    if ((dst === Reg16.Hl || dst === Reg16.Ix || dst === Reg16.Iy) && src.kind === OperandKind.Register16) {
      const srcReg = src.index as Reg16;
      const rr = srcReg === Reg16.Bc ? 0
        : srcReg === Reg16.De ? 1
        : (srcReg === Reg16.Hl || srcReg === Reg16.Ix || srcReg === Reg16.Iy) ? 2
        : srcReg === Reg16.Sp ? 3
        : -1;

      if (rr < 0) {
        throw new AssemblerException(lineNumber, `ADD に使えないレジスタ: ${operandToString(src)}`);
      }

      if (dst === Reg16.Hl) {
        if (mnemonic === 'add') {
          output.push(0x09 | (rr << 4));
          return;
        }

        output.push(0xed);
        output.push((mnemonic === 'adc' ? 0x0a : 0x42) | (rr << 4));
        return;
      }

      // IX/IY は ADD のみ (src は同一インデックスレジスタのとき rr=2)
      if (mnemonic !== 'add' || (rr === 2 && srcReg !== dst)) {
        throw new AssemblerException(lineNumber, 'IX/IY は ADD HL 形式のみ対応です');
      }

      output.push(dst === Reg16.Ix ? 0xdd : 0xfd);
      output.push(0x09 | (rr << 4));
      return;
    }
  }

  // 8bit ALU: 最後のオペランドがソース (先頭の A は省略可)
  const source = operands[operands.length - 1];

  switch (source.kind) {
    case OperandKind.Register8:
      pushMaybe(output, prefix);
      output.push(aluBase[opIndex] | source.index);
      return;
    case OperandKind.IndirectHl:
      pushMaybe(output, prefix);
      output.push(aluBase[opIndex] + 6);
      return;
    case OperandKind.Indexed:
      pushMaybe(output, prefix);
      output.push(aluBase[opIndex] + 6);
      output.push(displacement(source, ctx));
      return;
    case OperandKind.Expr:
      pushMaybe(output, prefix);
      output.push(aluBase[opIndex] - 0x80 + 0xc6);
      output.push(byte(evalOperand(source, ctx), lineNumber));
      return;
    default:
      break;
  }

  throw new AssemblerException(lineNumber, `未対応の ${mnemonic.toUpperCase()} 形式: ${operandToString(source)}`);
}

// ---- INC / DEC ---------------------------------------------------------

function encodeIncDec(
  mnemonic: string,
  operands: Operand[],
  prefix: number | null,
  output: number[],
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;
  expectOperandCount(operands, 1, lineNumber);
  const op = operands[0];
  const inc = mnemonic === 'inc';

  switch (op.kind) {
    case OperandKind.Register8:
      pushMaybe(output, prefix);
      output.push((inc ? 0x04 : 0x05) | (op.index << 3));
      return;
    case OperandKind.IndirectHl:
      pushMaybe(output, prefix);
      output.push(inc ? 0x34 : 0x35);
      return;
    case OperandKind.Indexed:
      pushMaybe(output, prefix);
      output.push(inc ? 0x34 : 0x35);
      output.push(displacement(op, ctx));
      return;
    case OperandKind.Register16: {
      const reg = op.index as Reg16;
      if (reg === Reg16.Bc || reg === Reg16.De || reg === Reg16.Hl || reg === Reg16.Sp) {
        output.push((inc ? 0x03 : 0x0b) | ((reg & 3) << 4));
        return;
      }

      if (reg === Reg16.Ix || reg === Reg16.Iy) {
        output.push(reg === Reg16.Ix ? 0xdd : 0xfd);
        output.push(inc ? 0x23 : 0x2b);
        return;
      }

      break;
    }
    default:
      break;
  }

  throw new AssemblerException(lineNumber, `未対応の ${mnemonic.toUpperCase()} 形式: ${operandToString(op)}`);
}

// ---- ジャンプ / スタック ----------------------------------------------

function encodeRelative(
  operands: Operand[],
  output: number[],
  pc: number,
  baseOpcode: number,
  conditionalBaseOpcode: number,
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;
  if (operands.length === 1) {
    output.push(baseOpcode);
    output.push(relativeByte(evalOperand(operands[0], ctx), pc + 2, ctx));
    return;
  }

  expectOperandCount(operands, 2, lineNumber);
  const cond = conditionCode(operands[0], lineNumber);
  output.push(conditionalBaseOpcode | (cond << 3));
  output.push(relativeByte(evalOperand(operands[1], ctx), pc + 2, ctx));
}

function encodeJump(operands: Operand[], output: number[], ctx: EncodeContext): void {
  const { lineNumber } = ctx;
  if (operands.length === 1) {
    if (operands[0].kind === OperandKind.IndirectHl) {
      output.push(0xe9);
      return;
    }

    output.push(0xc3);
    addWord(output, evalOperand(operands[0], ctx), lineNumber);
    return;
  }

  expectOperandCount(operands, 2, lineNumber);
  output.push(0xc2 | (conditionCode(operands[0], lineNumber) << 3));
  addWord(output, evalOperand(operands[1], ctx), lineNumber);
}

function encodeCall(operands: Operand[], output: number[], ctx: EncodeContext): void {
  const { lineNumber } = ctx;
  if (operands.length === 1) {
    output.push(0xcd);
    addWord(output, evalOperand(operands[0], ctx), lineNumber);
    return;
  }

  expectOperandCount(operands, 2, lineNumber);
  output.push(0xc4 | (conditionCode(operands[0], lineNumber) << 3));
  addWord(output, evalOperand(operands[1], ctx), lineNumber);
}

function encodePushPop(
  mnemonic: string,
  operands: Operand[],
  prefix: number | null,
  output: number[],
  lineNumber: number,
): void {
  expectOperandCount(operands, 1, lineNumber);
  const op = operands[0];
  if (op.kind !== OperandKind.Register16) {
    throw new AssemblerException(lineNumber, `${mnemonic} に使えないレジスタ: ${operandToString(op)}`);
  }

  const reg = op.index as Reg16;
  const baseOp = mnemonic === 'push' ? 0xc5 : 0xc1;
  switch (reg) {
    case Reg16.Af: output.push(baseOp | 0x30); break;
    case Reg16.Bc: output.push(baseOp | 0x00); break;
    case Reg16.De: output.push(baseOp | 0x10); break;
    case Reg16.Hl: output.push(baseOp | 0x20); break;
    case Reg16.Ix:
      requirePrefix(prefix, 0xdd, lineNumber);
      output.push(baseOp | 0x20);
      break;
    case Reg16.Iy:
      requirePrefix(prefix, 0xfd, lineNumber);
      output.push(baseOp | 0x20);
      break;
    default: throw new AssemblerException(lineNumber, `${mnemonic} に使えないレジスタ: ${operandToString(op)}`);
  }
}

function encodeEx(operands: Operand[], output: number[], lineNumber: number): void {
  expectOperandCount(operands, 2, lineNumber);
  const a = operands[0];
  const b = operands[1];

  if (a.kind === OperandKind.Register16 && a.index === Reg16.De
    && b.kind === OperandKind.Register16 && b.index === Reg16.Hl) {
    output.push(0xeb);
    return;
  }

  if (a.kind === OperandKind.Register16 && a.index === Reg16.Af
    && b.kind === OperandKind.Expr && b.expression === "af'") {
    output.push(0x08);
    return;
  }

  if (a.kind === OperandKind.IndirectExpr && a.expression === 'sp'
    && b.kind === OperandKind.Register16) {
    switch (b.index as Reg16) {
      case Reg16.Hl: output.push(0xe3); return;
      case Reg16.Ix:
        output.push(0xdd);
        output.push(0xe3);
        return;
      case Reg16.Iy:
        output.push(0xfd);
        output.push(0xe3);
        return;
      default:
        break;
    }
  }

  throw new AssemblerException(lineNumber, `未対応の EX 形式: ${operandToString(a)}, ${operandToString(b)}`);
}

// ---- I/O --------------------------------------------------------------

function encodeIn(operands: Operand[], output: number[], ctx: EncodeContext): void {
  const { lineNumber } = ctx;
  expectOperandCount(operands, 2, lineNumber);
  const dst = operands[0];
  const src = operands[1];

  if (src.kind === OperandKind.IndirectC && dst.kind === OperandKind.Register8) {
    output.push(0xed);
    output.push(0x40 | (dst.index << 3));
    return;
  }

  if (src.kind === OperandKind.IndirectExpr && dst.kind === OperandKind.Register8 && dst.index === Reg8.A) {
    output.push(0xdb);
    output.push(byte(evalOperand(src, ctx), lineNumber));
    return;
  }

  throw new AssemblerException(lineNumber, `未対応の IN 形式: ${operandToString(dst)}, ${operandToString(src)}`);
}

function encodeOut(operands: Operand[], output: number[], ctx: EncodeContext): void {
  const { lineNumber } = ctx;
  expectOperandCount(operands, 2, lineNumber);
  const dst = operands[0];
  const src = operands[1];

  if (dst.kind === OperandKind.IndirectC && src.kind === OperandKind.Register8) {
    output.push(0xed);
    output.push(0x41 | (src.index << 3));
    return;
  }

  if (dst.kind === OperandKind.IndirectExpr && src.kind === OperandKind.Register8 && src.index === Reg8.A) {
    output.push(0xd3);
    output.push(byte(evalOperand(dst, ctx), lineNumber));
    return;
  }

  throw new AssemblerException(lineNumber, `未対応の OUT 形式: ${operandToString(dst)}, ${operandToString(src)}`);
}

// ---- BIT / 回転 --------------------------------------------------------

function encodeBitOps(
  mnemonic: string,
  operands: Operand[],
  prefix: number | null,
  output: number[],
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;
  expectOperandCount(operands, 2, lineNumber);
  const bit = evalOperand(operands[0], ctx);
  if (bit < 0 || bit > 7) {
    throw new AssemblerException(lineNumber, `ビット番号が不正: ${bit}`);
  }

  const baseOp = mnemonic === 'bit' ? 0x40 : mnemonic === 'res' ? 0x80 : 0xc0;

  const op = operands[1];
  switch (op.kind) {
    case OperandKind.Register8:
      output.push(0xcb);
      output.push(baseOp | (bit << 3) | op.index);
      return;
    case OperandKind.IndirectHl:
      output.push(0xcb);
      output.push(baseOp | (bit << 3) | 6);
      return;
    case OperandKind.Indexed:
      pushMaybe(output, prefix);
      output.push(0xcb);
      output.push(displacement(op, ctx));
      output.push(baseOp | (bit << 3) | 6);
      return;
    default:
      break;
  }

  throw new AssemblerException(lineNumber, `未対応の ${mnemonic.toUpperCase()} 形式: ${operandToString(op)}`);
}

function encodeShift(
  mnemonic: string,
  shiftOp: number,
  operands: Operand[],
  prefix: number | null,
  output: number[],
  ctx: EncodeContext,
): void {
  const { lineNumber } = ctx;
  expectOperandCount(operands, 1, lineNumber);
  const op = operands[0];

  switch (op.kind) {
    case OperandKind.Register8:
      output.push(0xcb);
      output.push(shiftOp | op.index);
      return;
    case OperandKind.IndirectHl:
      output.push(0xcb);
      output.push(shiftOp | 6);
      return;
    case OperandKind.Indexed:
      pushMaybe(output, prefix);
      output.push(0xcb);
      output.push(displacement(op, ctx));
      output.push(shiftOp | 6);
      return;
    default:
      break;
  }

  throw new AssemblerException(lineNumber, `未対応の ${mnemonic.toUpperCase()} 形式: ${operandToString(op)}`);
}

// ---- ヘルパー ----------------------------------------------------------

/** オペランド列から IX/IY プレフィックス (0xDD / 0xFD) を決定する。 */
function determinePrefix(operands: Operand[], lineNumber: number): number | null {
  let result: number | null = null;

  for (const op of operands) {
    let candidate: number | null = null;
    switch (op.kind) {
      case OperandKind.Indexed:
        candidate = op.indexBase === Reg16.Ix ? 0xdd : 0xfd;
        break;
      case OperandKind.Register8:
        if (op.index === Reg8.IndexH || op.index === Reg8.IndexL) {
          candidate = op.indexBase === Reg16.Ix ? 0xdd : 0xfd;
        }
        break;
      case OperandKind.Register16:
        if (op.index === Reg16.Ix || op.index === Reg16.Iy) {
          candidate = op.index === Reg16.Ix ? 0xdd : 0xfd;
        }
        break;
      default:
        break;
    }

    if (candidate !== null) {
      if (result !== null && result !== candidate) {
        throw new AssemblerException(lineNumber, 'IX と IY の混在は未対応です');
      }

      result = candidate;
    }
  }

  return result;
}

function requirePrefix(prefix: number | null, expected: number, lineNumber: number): void {
  if (prefix === null || prefix !== expected) {
    const hex = expected.toString(16).toUpperCase().padStart(2, '0');
    throw new AssemblerException(lineNumber, `IX/IY プレフィックスの不一致 (期待: ${hex}h)`);
  }
}

function evalOperand(operand: Operand, ctx: EncodeContext): number {
  let expression: string;
  if (operand.kind === OperandKind.HighExpr || operand.kind === OperandKind.LowExpr
    || operand.kind === OperandKind.Expr || operand.kind === OperandKind.IndirectExpr) {
    expression = operand.expression;
  } else {
    throw new AssemblerException(ctx.lineNumber, `式ではないオペランド: ${operandToString(operand)}`);
  }

  const value = evaluateExpression(expression, ctx.labels, 0, ctx.resolveSymbols, ctx.lineNumber);
  if (operand.kind === OperandKind.HighExpr) {
    return (value >> 8) & 0xff;
  }

  if (operand.kind === OperandKind.LowExpr) {
    return value & 0xff;
  }

  return value;
}

function conditionCode(operand: Operand, lineNumber: number): number {
  if (operand.kind === OperandKind.ConditionCode) {
    return operand.index;
  }

  // jp c / call c / ret c の "c" はレジスタ C としてパースされるため文脈で変換
  if (operand.kind === OperandKind.Register8 && operand.index === Reg8.C) {
    return 3;
  }

  throw new AssemblerException(lineNumber, `条件コード (nz/z/nc/c) が必要: ${operandToString(operand)}`);
}

function expectOperandCount(operands: Operand[], count: number, lineNumber: number): void {
  if (operands.length !== count) {
    throw new AssemblerException(lineNumber, `オペランド数が不正 (期待: ${count}、実際: ${operands.length})`);
  }
}

function addWord(output: number[], value: number, lineNumber: number): void {
  if (value < -32768 || value > 65535) {
    throw new AssemblerException(lineNumber, `16bit 範囲外の値: ${value}`);
  }

  const v = value & 0xffff;
  output.push(v & 0xff);
  output.push(v >> 8);
}

function byte(value: number, lineNumber: number): number {
  if (value < -128 || value > 255) {
    throw new AssemblerException(lineNumber, `8bit 範囲外の値: ${value}`);
  }

  return value & 0xff;
}

function displacement(operand: Operand, ctx: EncodeContext): number {
  const value = evaluateExpression(operand.expression, ctx.labels, 0, ctx.resolveSymbols, ctx.lineNumber);
  if (value < -128 || value > 127) {
    // パス 1 (サイズ確定) ではラベルが未確定のため範囲チェックしない
    if (ctx.resolveSymbols) {
      throw new AssemblerException(ctx.lineNumber, `変位が 8bit 符号付き範囲外: ${value}`);
    }

    return 0;
  }

  return value & 0xff;
}

function relativeByte(target: number, instructionEnd: number, ctx: EncodeContext): number {
  const offset = target - instructionEnd;
  if (offset < -128 || offset > 127) {
    if (ctx.resolveSymbols) {
      const from = instructionEnd.toString(16).toUpperCase().padStart(4, '0');
      const to = target.toString(16).toUpperCase().padStart(4, '0');
      throw new AssemblerException(ctx.lineNumber, `相対ジャンプ範囲外: ${offset} (${from}h → ${to}h)`);
    }

    // パス 1 (サイズ確定) ではラベルが未確定のため範囲チェックしない
    return 0;
  }

  return offset & 0xff;
}

/** IX/IY プレフィックスをバイト列へ書き込む (不要なら無視)。 */
function pushMaybe(output: number[], prefix: number | null): void {
  if (prefix !== null) {
    output.push(prefix);
  }
}





