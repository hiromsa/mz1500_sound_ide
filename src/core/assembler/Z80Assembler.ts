/**
 * 簡易 Z80 アセンブラ (2 パス)。MzSD サウンドドライバのビルドに使用する。
 * 対応ディレクティブ: org / equ / db (defb) / dw (defw) /
 * dctbl (DCSG period ノートテーブル) / beeptbl (8253 counter ノートテーブル)。
 * (移植元: MzSound.DriverAssembler/Assembler/Z80Assembler.cs)
 */
import { AssemblerException, type AssembleResult } from './AssembleResult';
import { evaluateExpression } from './ExpressionEvaluator';
import { parseOperand } from './OperandParser';
import { encodeZ80 } from './Z80Encoding';

/** 解析済みの 1 行 (ラベル / ニーモニック / オペランド文字列)。 */
export interface ParsedLine {
  lineNumber: number;
  label: string | null;
  /** 小文字化されたニーモニック / ディレクティブ (空行は null)。 */
  mnemonic: string | null;
  arguments: string[];
}

/** DCSG period 計算の分母 (Clock / 32)。TrackSequencer と同一の式。 */
export const DcsgClockDivisor = 3579545.0 / 32.0;

/** 8253 (BEEP) 入力クロック。BeepChip と同一の式。 */
export const BeepClockHz = 894886.25;

/** ソースをアセンブルする。 */
export function assembleZ80(source: string): AssembleResult {
  const lines = parseLines(source);
  // ラベル辞書 (C# の OrdinalIgnoreCase 辞書相当 → 小文字キーで正規化)
  const labels = new Map<string, number>();
  let origin = 0;

  // パス 1: ラベル / サイズ確定
  let pc = 0;
  let originSeen = false;
  for (const line of lines) {
    if (line.label !== null) {
      labels.set(line.label.toLowerCase(), pc);
    }

    switch (line.mnemonic) {
      case null:
        break;

      case 'org': {
        if (originSeen) {
          throw new AssemblerException(line.lineNumber, 'org は複数回使用できません');
        }

        originSeen = true;
        const newOrigin = evaluateArgs(line, 0, labels, pc, false)[0];
        if (newOrigin < pc) {
          throw new AssemblerException(line.lineNumber, 'org は前方アドレスである必要があります');
        }

        origin = newOrigin;
        pc = origin;
        break;
      }

      case 'equ':
        // パス 1 の暫定値は 0 (パス 2 の defineEqu で確定する)
        if (line.label === null) {
          throw new AssemblerException(line.lineNumber, 'equ にはシンボル名が必要です');
        }

        labels.set(line.label.toLowerCase(), 0);
        break;

      default: {
        if ((line.mnemonic === 'dctbl' || line.mnemonic === 'beeptbl') && line.arguments.length >= 1) {
          // テーブル先頭ラベルを登録
          labels.set(line.arguments[0].toLowerCase(), pc);
        }

        pc += lineBytes(line, labels, pc, false).length;
        break;
      }
    }
  }

  // パス 2: エンコード
  const output: number[] = [];
  pc = 0;
  for (const line of lines) {
    switch (line.mnemonic) {
      case null:
        break;

      case 'org': {
        const target = evaluateArgs(line, 0, labels, pc, true)[0];
        while (pc < target) {
          output.push(0);
          pc++;
        }

        break;
      }

      case 'equ':
        defineEqu(line, labels, pc);
        break;

      default: {
        const bytes = lineBytes(line, labels, pc, true);
        for (const b of bytes) {
          output.push(b);
        }

        pc += bytes.length;
        break;
      }
    }
  }

  labels.set('*', origin);
  return { data: Uint8Array.from(output), labels, origin };
}

// ---- 行パース ----------------------------------------------------------

/** ソーステキストを行配列へ解析する (コメント除去 / ラベル / カンマ分割)。 */
export function parseLines(source: string): ParsedLine[] {
  const result: ParsedLine[] = [];
  const rawLines = source.replace(/\r\n/g, '\n').split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    let text = stripComment(rawLines[i]).trim();
    if (text.length === 0) {
      continue;
    }

    let label: string | null = null;

    // label: 形式
    const colon = text.indexOf(':');
    if (colon >= 0 && isValidIdentifier(text.slice(0, colon).trim())) {
      label = text.slice(0, colon).trim();
      text = text.slice(colon + 1).trim();
      if (text.length === 0) {
        result.push({ lineNumber: i + 1, label, mnemonic: null, arguments: [] });
        continue;
      }
    }

    const tokens = splitTokens(text);
    if (tokens.length === 0) {
      result.push({ lineNumber: i + 1, label, mnemonic: null, arguments: [] });
      continue;
    }

    const mnemonic = tokens[0].toLowerCase();

    // name equ expr 形式 (ラベルなし)
    if (label === null && tokens.length >= 3 && tokens[1].toLowerCase() === 'equ') {
      result.push({
        lineNumber: i + 1,
        label: tokens[0],
        mnemonic: 'equ',
        arguments: [tokens.slice(2).join(' ')],
      });
      continue;
    }

    // label: equ expr 形式
    if (label !== null && mnemonic === 'equ') {
      result.push({
        lineNumber: i + 1,
        label,
        mnemonic: 'equ',
        arguments: [tokens.slice(1).join(' ')],
      });
      continue;
    }

    const rest = tokens.slice(1).join(' ');
    const args = rest.length === 0 ? [] : splitArguments(rest);

    result.push({ lineNumber: i + 1, label, mnemonic, arguments: args });
  }

  return result;
}

function stripComment(line: string): string {
  // 文字列リテラル内の ';' のみ保護する (文字リテラル ';' は未対応 — ドライバでは不使用)
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inString = !inString;
    } else if (ch === ';' && !inString) {
      return line.slice(0, i);
    }
  }

  return line;
}

function splitTokens(text: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inString = !inString;
    }

    if (!inString && /\s/.test(ch)) {
      if (start >= 0) {
        tokens.push(text.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }

  if (start >= 0) {
    tokens.push(text.slice(start));
  }

  return tokens;
}

/** 引数列をカンマ分割する (文字列リテラル内のカンマは保護)。 */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inString = !inString;
    } else if (ch === ',' && !inString) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(text.slice(start).trim());
  return parts;
}

function isValidIdentifier(token: string): boolean {
  return token.length > 0
    && /^[a-zA-Z_.]/.test(token[0])
    && [...token].every((ch) => /[a-zA-Z0-9_.]/.test(ch));
}

// ---- バイト生成 / 式評価 ------------------------------------------------

/** 1 行分のバイト列を生成する (命令 / db / dw / dctbl / beeptbl)。 */
function lineBytes(
  line: ParsedLine,
  labels: ReadonlyMap<string, number>,
  pc: number,
  resolveSymbols: boolean,
): number[] {
  switch (line.mnemonic) {
    case 'db':
    case 'defb':
      return dataBytes(line, labels, pc, resolveSymbols, false);

    case 'dw':
    case 'defw':
      return dataBytes(line, labels, pc, resolveSymbols, true);

    case 'dctbl':
    case 'beeptbl':
      return noteTableBytes(line, labels, pc, resolveSymbols);

    case 'org':
    case 'equ':
      return [];

    default: {
      const operands = line.arguments.map((arg) => {
        const operand = parseOperand(arg);
        if (operand === null) {
          throw new AssemblerException(line.lineNumber, `オペランドを解析できません: ${arg}`);
        }

        return operand;
      });

      return encodeZ80(line.mnemonic as string, operands, pc, labels, resolveSymbols, line.lineNumber);
    }
  }
}

/** dctbl / beeptbl (ノート → 音源レジスタ値テーブル) のバイト列を生成する。 */
function noteTableBytes(
  line: ParsedLine,
  labels: ReadonlyMap<string, number>,
  pc: number,
  resolveSymbols: boolean,
): number[] {
  if (line.mnemonic !== 'dctbl' && line.mnemonic !== 'beeptbl') {
    throw new AssemblerException(line.lineNumber, '内部エラー: テーブルディレクティブではありません');
  }

  expectArgs(line, 3);
  const min = evaluateArgs(line, 1, labels, pc, resolveSymbols)[0];
  const max = evaluateArgs(line, 2, labels, pc, resolveSymbols)[0];
  if (min > max) {
    throw new AssemblerException(line.lineNumber, 'テーブル範囲が不正です (min > max)');
  }

  const output: number[] = [];
  for (let note = min; note <= max; note++) {
    const value = line.mnemonic === 'dctbl' ? dcsgPeriodFor(note) : beepCounterFor(note);
    output.push(value & 0xff);
    output.push(value >> 8);
  }

  return output;
}

/** db / dw のバイト列を生成する (文字列リテラル / 式)。 */
function dataBytes(
  line: ParsedLine,
  labels: ReadonlyMap<string, number>,
  pc: number,
  resolveSymbols: boolean,
  word: boolean,
): number[] {
  const output: number[] = [];
  for (const argument of line.arguments) {
    const token = argument.trim();
    if (token.startsWith('"')) {
      for (const value of parseStringLiteral(token, line.lineNumber)) {
        if (word) {
          output.push(value & 0xff);
          output.push(value >> 8);
        } else {
          output.push(value);
        }
      }

      continue;
    }

    const number = evaluateExpression(token, labels, pc, resolveSymbols, line.lineNumber);
    if (word) {
      output.push(number & 0xff);
      output.push(number >> 8);
    } else {
      // 範囲チェックはパス 2 (シンボル確定後) のみ行う (パス 1 は未定義値 0 で通す)
      if (resolveSymbols && (number < -128 || number > 255)) {
        throw new AssemblerException(line.lineNumber, `db 値が範囲外: ${number}`);
      }

      output.push(number & 0xff);
    }
  }

  return output;
}

function* parseStringLiteral(token: string, lineNumber: number): Generator<number> {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) {
    throw new AssemblerException(lineNumber, `文字列リテラルが不正: ${token}`);
  }

  const inner = token.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      i++;
      const ch = inner[i];
      switch (ch) {
        case 'n': yield 0x0d; break;
        case '0': yield 0x00; break;
        case '"': yield 0x22; break;
        case '\\': yield 0x5c; break;
        default: yield ch.charCodeAt(0); break;
      }

      continue;
    }

    yield inner.charCodeAt(i);
  }
}

function evaluateArgs(
  line: ParsedLine,
  index: number,
  labels: ReadonlyMap<string, number>,
  pc: number,
  resolveSymbols: boolean,
): number[] {
  const list: number[] = [];
  for (let i = index; i < line.arguments.length; i++) {
    list.push(evaluateExpression(line.arguments[i], labels, pc, resolveSymbols, line.lineNumber));
  }

  return list;
}

function expectArgs(line: ParsedLine, count: number): void {
  if (line.arguments.length !== count) {
    throw new AssemblerException(line.lineNumber, `引数数が不正 (期待: ${count}、実際: ${line.arguments.length})`);
  }
}

function defineEqu(line: ParsedLine, labels: Map<string, number>, pc: number): void {
  if (line.label === null) {
    throw new AssemblerException(line.lineNumber, 'equ にはシンボル名が必要です');
  }

  const value = evaluateExpression(line.arguments[0], labels, pc, true, line.lineNumber);
  labels.set(line.label.toLowerCase(), value);
}

/** ノート番号 → 周波数 (TrackSequencer.NoteFrequency と同一式、A4 = 440Hz)。 */
export function noteFrequency(note: number): number {
  const clamped = Math.min(127, Math.max(0, note));
  return 440.0 * 2 ** ((clamped - 69) / 12.0);
}

/** ノート番号 → DCSG トーン period (TrackSequencer.PeriodFor と同一式)。 */
export function dcsgPeriodFor(note: number): number {
  const period = Math.round(DcsgClockDivisor / Math.max(1.0, noteFrequency(note))) - 1;
  return Math.min(1023, Math.max(0, period));
}

/** ノート番号 → 8253 カウンタ値 (TrackSequencer.StartNote と同一式)。 */
export function beepCounterFor(note: number): number {
  const counter = Math.round(BeepClockHz / noteFrequency(note));
  return Math.min(65535, Math.max(1, counter));
}



