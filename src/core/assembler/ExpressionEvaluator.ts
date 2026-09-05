/**
 * アセンブラ数式評価器。ラベル / 数値リテラル (10 進、0x / $ / h 16 進、% / b 2 進、'A' 文字) と
 * + - * 演算、* (現在アドレス) をサポートする。
 * (移植元: MzSound.DriverAssembler/Assembler/ExpressionEvaluator.cs)
 */
import { AssemblerException } from './AssembleResult';

/**
 * 式を評価する。パス 1 (ラベル未確定) では throwOnUnknown を false にして
 * 未定義ラベルを許容する (ダミー値 0 を返す)。
 * @param labels ラベル辞書 (キーは小文字正規化済み)
 */
export function evaluateExpression(
  expression: string,
  labels: ReadonlyMap<string, number>,
  currentAddress: number,
  throwOnUnknown: boolean,
  lineNumber: number,
): number {
  const tokens = splitTokens(expression);
  let result = 0;
  let op = '+';
  let hasValue = false;

  const apply = (value: number): void => {
    if (!hasValue) {
      result = value;
      hasValue = true;
      return;
    }

    switch (op) {
      case '+':
        result = result + value;
        break;
      case '-':
        result = result - value;
        break;
      case '*':
        result = result * value;
        break;
      default:
        throw new Error('unreachable');
    }
    op = '+';
  };

  for (const token of tokens) {
    if (token === '+' || token === '-' || token === '*') {
      if (token === '*' && !hasValue) {
        // 先頭の単独 * は現在アドレス
        apply(currentAddress);
        continue;
      }

      op = token;
      continue;
    }

    apply(evaluateToken(token, labels, currentAddress, throwOnUnknown, lineNumber));
  }

  if (!hasValue) {
    throw new AssemblerException(lineNumber, `式が空です: ${expression}`);
  }

  return result;
}

function evaluateToken(
  token: string,
  labels: ReadonlyMap<string, number>,
  currentAddress: number,
  throwOnUnknown: boolean,
  lineNumber: number,
): number {
  if (token === '*') {
    return currentAddress;
  }

  // 文字リテラル 'A'
  if (token.length === 3 && token.startsWith("'") && token.endsWith("'")) {
    return token.charCodeAt(1);
  }

  // 数値リテラル
  const number = tryParseNumber(token);
  if (number !== null) {
    return number;
  }

  // シンボル (ラベル)
  const value = labels.get(token.toLowerCase());
  if (value !== undefined) {
    return value;
  }

  if (throwOnUnknown) {
    throw new AssemblerException(lineNumber, `未定義のシンボル: ${token}`);
  }

  return 0;
}

/** 数値リテラルの解析 (10 進 / 0xHH / $HH / HHh / %BB / BBb / 0bBB)。失敗時は null。 */
export function tryParseNumber(token: string): number | null {
  if (token.length === 0) {
    return null;
  }

  const parseRadix = (text: string, radix: number): number | null => {
    if (!/^[0-9a-f]+$/i.test(text)) {
      return null;
    }

    const value = parseInt(text, radix);
    return Number.isSafeInteger(value) && value <= 0x7fffffff ? value : null;
  };

  if (/^0x[0-9a-f]+$/i.test(token)) {
    return parseRadix(token.slice(2), 16);
  }

  if (token.startsWith('$')) {
    return parseRadix(token.slice(1), 16);
  }

  if (/^0b[01]+$/i.test(token)) {
    return parseRadix(token.slice(2), 2);
  }

  if (token.startsWith('%')) {
    return parseRadix(token.slice(1), 2);
  }

  const last = token[token.length - 1].toLowerCase();
  if (last === 'h' && token.length > 1 && /[0-9]/.test(token[0])) {
    // 16 進サフィックス (0ABh 形式、先頭が数字の場合のみ — ラベル名との衝突を避ける)
    return parseRadix(token.slice(0, -1), 16);
  }

  if (last === 'b' && token.length > 1 && /^[01]+$/.test(token)) {
    return parseRadix(token.slice(0, -1), 2);
  }

  if (/^[0-9]+$/.test(token)) {
    const value = parseInt(token, 10);
    return value <= 0x7fffffff ? value : null;
  }

  return null;
}

/** 式を演算子 / 項に分割する (演算子と項の境界に空白は不要)。 */
function splitTokens(expression: string): string[] {
  const tokens: string[] = [];
  let start = 0;

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if ((ch === '+' || ch === '-' || ch === '*')) {
      if (i > start) {
        tokens.push(expression.slice(start, i).trim());
      }

      tokens.push(ch);
      start = i + 1;
    }
  }

  if (start < expression.length) {
    tokens.push(expression.slice(start).trim());
  }

  return tokens;
}
