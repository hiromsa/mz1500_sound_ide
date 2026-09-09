import { isReverseOctaveDirective, parseMmlCaretContext } from './mmlCaretParser';

/**
 * 仮想キーボード [MML INSERT] モードのロジック層。
 * 押下 MIDI ノートを MML エディタのキャレット位置へ挿入する音符テキスト (c / c# / < / >) を生成する。
 * Monaco 等の UI に依存しない純粋関数群。
 */

/** MML オクターブコマンド (o1-o8) の有効範囲 (正式パーサと同一) */
const MML_MIN_OCTAVE = 1;
const MML_MAX_OCTAVE = 8;

/** MIDI ノート番号 (12 毎に 1 オクターブ / 60 = C4) を MML オクターブ (o4) へ変換する */
export function midiNoteToMmlOctave(midiNote: number): number {
  return Math.floor(midiNote / 12) - 1;
}

/** MIDI ノート番号を MML 音名 (小文字・黒鍵はシャープ表記) へ変換する */
export function midiNoteToMmlNoteName(midiNote: number): string {
  const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  return names[((midiNote % 12) + 12) % 12];
}

/** [MML INSERT] モードの有効条件パラメータ */
export interface MmlNoteInsertModeParams {
  /** MML エディタ (MML CARET コンテキスト) を選択中か */
  isMmlEditorMode: boolean;
  /** Ctrl キー押下中か */
  isControlKeyHeld: boolean;
  /** キャレットがチャンネル行 (行頭トラック宣言行) にあるか */
  isTrackSpecLine?: boolean;
}

/**
 * [MML INSERT] モードの有効判定。
 * 「MML エディタモード & Ctrl 押下中 & キャレットがチャンネル行」の 3 条件が揃ったときのみ有効。
 */
export function isMmlNoteInsertModeActive(params: MmlNoteInsertModeParams): boolean {
  return params.isMmlEditorMode && params.isControlKeyHeld && params.isTrackSpecLine === true;
}

/** 1 音挿入の生成結果 */
export interface MmlNoteInsertion {
  /** キャレット位置へ挿入するテキスト (例: 'c' / '<c#' / '>>g') */
  text: string;
  /** 挿入後のオクターブ (相対指定適用後。連続入力時の基準) */
  octave: number;
}

/**
 * 現在オクターブと押下 MIDI ノートから、オクターブ相対指定 (< / >) を含む挿入テキストを生成する。
 * - オクターブ差分は 1 段 = 1 記号の < / > で表現 (#OCTAVE REVERSE 時は方向を反転)
 * - 相対指定は正式パーサと同一条件で MML のオクターブ範囲 (1-8) にクランプする
 * - 音長は付与しない (仮想キーボード入力は音長無し音符)
 */
export function buildMmlNoteInsertion(
  currentOctave: number,
  targetMidiNote: number,
  isReverseOctave = false,
): MmlNoteInsertion {
  // 正式パーサの < / > 適用と同一条件でオクターブをクランプ
  const clampOctave = (octave: number) =>
    Math.max(MML_MIN_OCTAVE, Math.min(MML_MAX_OCTAVE, octave));
  const from = clampOctave(currentOctave);
  const to = clampOctave(midiNoteToMmlOctave(targetMidiNote));
  const diff = to - from;

  // < は下がる / > は上がる (#OCTAVE REVERSE 時は逆)
  const downSymbol = isReverseOctave ? '>' : '<';
  const upSymbol = isReverseOctave ? '<' : '>';
  const symbol = diff < 0 ? downSymbol : upSymbol;

  return {
    text: symbol.repeat(Math.abs(diff)) + midiNoteToMmlNoteName(targetMidiNote),
    octave: to,
  };
}

/**
 * MML 全文とキャレット位置から、その位置へ挿入すべき音符テキストを生成する。
 * キャレットがチャンネル行 (行頭トラック宣言行) でない場合は null を返す。
 */
export function buildMmlNoteInsertionAtCaret(
  content: string,
  lineNumber: number,
  column: number,
  targetMidiNote: number,
): MmlNoteInsertion | null {
  const context = parseMmlCaretContext(content, lineNumber, column);
  if (!context.isTrackSpecLine) return null;
  return buildMmlNoteInsertion(context.octave, targetMidiNote, isReverseOctaveDirective(content));
}
