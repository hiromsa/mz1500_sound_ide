/**
 * オペランド文字列の解析 (レジスタ名 / 間接指定 / 式)。
 * 対応構文: b,c,d,e,h,l,a,(hl),(ix+d),(ix-d),(iy+d),bc,de,hl,sp,af,ix,iy,
 * nz,z,nc,c,(expr),(c),high(expr),low(expr),expr。
 * (移植元: MzSound.DriverAssembler/Assembler/OperandParser.cs)
 */
import { OperandKind, Reg8, Reg16, type Operand } from './Z80Operand';

const register8Names: readonly string[] = [
  'b', 'c', 'd', 'e', 'h', 'l', '(hl)', 'a',
  'ixl', 'ixh', 'iyl', 'iyh',
];

const register16Names: readonly string[] = ['bc', 'de', 'hl', 'sp', 'af', 'ix', 'iy'];

const conditionNames: readonly string[] = ['nz', 'z', 'nc', 'c'];

/** オペランド文字列を解析する。解析できない場合は null。 */
export function parseOperand(text: string): Operand | null {
  const token = text.trim();

  // high(expr) / low(expr)
  if (token.toLowerCase().startsWith('high(') && token.endsWith(')')) {
    return { kind: OperandKind.HighExpr, index: 0, indexBase: Reg16.Bc, expression: token.slice(5, -1).trim() };
  }

  if (token.toLowerCase().startsWith('low(') && token.endsWith(')')) {
    return { kind: OperandKind.LowExpr, index: 0, indexBase: Reg16.Bc, expression: token.slice(4, -1).trim() };
  }

  // 8bit レジスタ (b / c は条件コードより先に判定 — jr のみ条件コードで、
  // ld/add 等ではレジスタが優先されるためエンコーダ側で解決する)
  for (let i = 0; i < register8Names.length; i++) {
    if (token.toLowerCase() === register8Names[i]) {
      if (i < 8) {
        return { kind: OperandKind.Register8, index: i, indexBase: Reg16.Bc, expression: '' };
      }

      const indexHigh = i % 2 === 1; // ixl/ixh, iyl/iyh の奇数番目が h
      return {
        kind: OperandKind.Register8,
        index: indexHigh ? Reg8.IndexH : Reg8.IndexL,
        indexBase: i < 10 ? Reg16.Ix : Reg16.Iy,
        expression: '',
      };
    }
  }

  for (let i = 0; i < register16Names.length; i++) {
    if (token.toLowerCase() === register16Names[i]) {
      return { kind: OperandKind.Register16, index: i, indexBase: Reg16.Bc, expression: '' };
    }
  }

  for (let i = 0; i < conditionNames.length; i++) {
    if (token.toLowerCase() === conditionNames[i]) {
      return { kind: OperandKind.ConditionCode, index: i, indexBase: Reg16.Bc, expression: '' };
    }
  }

  if (token === '(hl)') {
    return { kind: OperandKind.IndirectHl, index: 0, indexBase: Reg16.Bc, expression: '' };
  }

  if (token === '(c)') {
    return { kind: OperandKind.IndirectC, index: 0, indexBase: Reg16.Bc, expression: '' };
  }

  // (ix+d) / (iy+d) / (expr)
  if (token.startsWith('(') && token.endsWith(')')) {
    const inner = token.slice(1, -1).trim();
    if (inner.toLowerCase().startsWith('ix') || inner.toLowerCase().startsWith('iy')) {
      let disp = inner.slice(2).trim();
      if (disp.length === 0) {
        disp = '+0';
      }

      if (disp[0] !== '+' && disp[0] !== '-') {
        return null; // (ix+expr) 形式のみ対応
      }

      return {
        kind: OperandKind.Indexed,
        index: 0,
        indexBase: inner.toLowerCase().startsWith('ix') ? Reg16.Ix : Reg16.Iy,
        expression: disp,
      };
    }

    return { kind: OperandKind.IndirectExpr, index: 0, indexBase: Reg16.Bc, expression: inner };
  }

  // 式 (ラベル / 数値 / 演算)
  if (isValidExpression(token)) {
    return { kind: OperandKind.Expr, index: 0, indexBase: Reg16.Bc, expression: token };
  }

  return null;
}

function isValidExpression(token: string): boolean {
  if (token.length === 0) {
    return false;
  }

  // 文字リテラル ('A')
  if (token.length === 3 && token.startsWith("'") && token.endsWith("'")) {
    return true;
  }

  for (const ch of token) {
    if (/[a-zA-Z0-9_'+\-*]/.test(ch)) {
      continue;
    }

    return false;
  }

  return true;
}
