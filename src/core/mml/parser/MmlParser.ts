/**
 * MML 本体のパーサ (マクロ定義除去済みソースを処理する)。
 * (移植元: MzSound.MmlCompiler/Internal/MmlParser*.cs — partial class を統合)
 */
import {
  DiagnosticSeverity,
  type MmlDiagnostic,
  type TrackId,
  parseTrackId,
} from '../TrackId';
import type { FmTone, PitchEnvelope, VolumeEnvelope } from '../Envelopes';
import { ParseResult, TrackBuilder, type TrackState } from './MmlParserTypes';

const OpNote = 0x00;
const OpRest = 0x01;
const OpTempo = 0x02;
const OpVolume = 0x03;
const OpVenv = 0x04;
const OpPenv = 0x05;
const OpSweep = 0x06;
const OpDetune = 0x07;
const OpTranspose = 0x08;
const OpTone = 0x09;
const OpNoiseCtl = 0x0a;
const OpLoopStart = 0x0b;
const OpLoopEnd = 0x0c;
const OpTrackEnd = 0x0e;

const MaxLoopDepth = 8;

const isDigitChar = (ch: string): boolean => ch >= '0' && ch <= '9';
const isWhiteSpaceChar = (ch: string): boolean => /\s/.test(ch);

/** エラー診断を生成する。 */
export function mmlError(line: number, message: string): MmlDiagnostic {
  return { severity: DiagnosticSeverity.Error, line, column: 1, message };
}

/** 警告診断を生成する。 */
export function mmlWarn(line: number, message: string): MmlDiagnostic {
  return { severity: DiagnosticSeverity.Warning, line, column: 1, message };
}

export class MmlParser {
  private readonly source: string;
  private readonly diagnostics: MmlDiagnostic[];
  private readonly venvIndexByNumber = new Map<number, number>();
  private readonly penvIndexByNumber = new Map<number, number>();
  private readonly toneIndexByNumber = new Map<number, number>();

  private result = new ParseResult();

  constructor(
    source: string,
    volumeEnvelopes: readonly VolumeEnvelope[],
    pitchEnvelopes: readonly PitchEnvelope[],
    fmTones: readonly FmTone[],
    diagnostics: MmlDiagnostic[],
  ) {
    this.source = source;
    this.diagnostics = diagnostics;

    volumeEnvelopes.forEach((env, i) => {
      this.venvIndexByNumber.set(env.number, i);
    });
    pitchEnvelopes.forEach((env, i) => {
      this.penvIndexByNumber.set(env.number, i);
    });
    fmTones.forEach((tone, i) => {
      this.toneIndexByNumber.set(tone.number, i);
    });
  }

  /** パースを実行する。致命的エラー時は null。 */
  parse(): ParseResult | null {
    this.result = new ParseResult();
    const lines = this.source.split('\n');
    let current: TrackBuilder[] | null = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex].replace(/\r$/, '');
      const { ids, contentStart } = detectTrackSpec(line);

      if (ids !== null) {
        current = [];
        for (const id of ids) {
          let existing = this.result.tracks.get(id.index);
          if (!existing) {
            existing = new TrackBuilder(id);
            this.result.tracks.set(id.index, existing);
          }

          current.push(existing);
        }
      }

      if (current === null || current.length === 0) {
        // トラック未指定の行では、曲全体設定であるテンポ (t / @t) のみ許可する
        if (!this.tryProcessGlobalTempo(line, lineIndex + 1)
          && stripComment(line).trim().length > 0) {
          this.diagnostics.push(mmlError(
            lineIndex + 1,
            'トラック指定がありません (行頭に P1 などのトラック記号を書いてください)',
          ));
        }

        continue;
      }

      this.parseLine(line, contentStart, lineIndex + 1, current);
    }

    for (const track of this.result.tracks.values()) {
      if (track.loopDepth > 0) {
        this.diagnostics.push(mmlError(1, '[ に対応する ] がありません'));
      }

      track.code.push(OpTrackEnd);
    }

    if (this.result.tracks.size === 0) {
      this.diagnostics.push(mmlError(1, 'トラックが 1 つも定義されていません'));
      return null;
    }

    return this.result;
  }

  /** トラック未指定行の曲全体テンポ設定 (t120 / @t1,86) を処理する。テンポ行であれば true を返す。 */
  private tryProcessGlobalTempo(line: string, lineNo: number): boolean {
    const trimmed = stripComment(line).replace(/^\s+/, '');

    if (trimmed.startsWith('@t')) {
      return this.processFrameTempo(trimmed, 2, lineNo, []) >= 0;
    }

    if (trimmed.startsWith('t')
      && (trimmed.length === 1 || isDigitChar(trimmed[1]))) {
      return this.processTempo(trimmed, 0, lineNo, []) >= 0;
    }

    return false;
  }

  private parseLine(line: string, start: number, lineNo: number, tracks: TrackBuilder[]): void {
    let pos = start;
    while (pos < line.length) {
      const c = line[pos];
      if (c === ';' || c === '/') {
        break;
      }

      if (isWhiteSpaceChar(c)) {
        pos++;
        continue;
      }

      const next = this.processToken(line, pos, lineNo, tracks);
      if (next < 0) {
        break;
      }

      pos = next;
    }
  }

  private processToken(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const c = line[pos];

    switch (true) {
      case c === '[': return this.processLoopStart(pos, lineNo, tracks);
      case c === ']': return this.processLoopEnd(line, pos, lineNo, tracks);
      case c === 'L': return this.processWholeLoopMark(pos, tracks);
      case c === 'o': return this.processOctave(line, pos, lineNo, tracks);
      case c === '<': return this.processOctaveShift(line, pos, -1, tracks);
      case c === '>': return this.processOctaveShift(line, pos, 1, tracks);
      case c === 'l': return this.processDefaultLength(line, pos, lineNo, tracks);
      case c === 't': return this.processTempo(line, pos, lineNo, tracks);
      case c === 'v': return this.processVolume(line, pos, lineNo, tracks);
      case c === 'q': return this.processQuantize(line, pos, lineNo, tracks);
      case c === 'K': return this.processTranspose(line, pos, lineNo, tracks);
      case c === 'D': return this.processDetune(line, pos, lineNo, tracks);
      case c === 'r': return this.emitRestSequence(line, pos, lineNo, tracks);
      case c === '^': return this.emitTie(line, pos, lineNo, tracks);
      case c === '{': return this.emitTuplet(line, pos, lineNo, tracks);
      case c === '@': return this.processAt(line, pos + 1, lineNo, tracks);
      case c >= 'a' && c <= 'g': return this.emitNoteSequence(line, pos, lineNo, tracks);
      default:
        this.diagnostics.push(mmlError(lineNo, `不明な文字 '${c}' があります`));
        return -1;
    }
  }

  // ---- 音符・休符・タイ・連符 ----

  private emitNoteSequence(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const col = pos + 1;
    const letter = line[pos];
    let cursor = pos + 1;
    let accidental = 0;
    if (cursor < line.length && (line[cursor] === '+' || line[cursor] === '#' || line[cursor] === '-')) {
      accidental = line[cursor] === '-' ? -1 : 1;
      cursor++;
    }

    const read = this.readNoteLength(line, cursor, lineNo, tracks[0].state);
    if (read === null) {
      return -1;
    }

    for (const t of tracks) {
      this.emitNote(t, noteNumber(t.state.octave, letter, accidental), read.units, lineNo, col);
    }

    return read.next;
  }

  private emitRestSequence(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const col = pos + 1;
    const read = this.readNoteLength(line, pos + 1, lineNo, tracks[0].state);
    if (read === null) {
      return -1;
    }

    for (const t of tracks) {
      this.emitRest(t, read.units, lineNo, col);
    }

    return read.next;
  }

  private emitTie(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    if (tracks.some((t) => t.notePatch === null)) {
      this.diagnostics.push(mmlWarn(lineNo, 'タイ ^ の対象となる音符/休符がありません'));
    }

    const read = this.readNoteLength(line, pos + 1, lineNo, tracks[0].state);
    if (read === null) {
      return -1;
    }

    for (const t of tracks) {
      const patch = t.notePatch;
      if (patch === null) {
        continue;
      }

      const added = this.advance(t, read.units);
      const len = Math.min(65535, readLengthAt(t, patch.offset) + added);
      t.code[patch.offset] = len & 0xff;
      t.code[patch.offset + 1] = len >> 8;

      if (patch.isNote) {
        const gate = computeGate(len, t.state);
        t.code[patch.offset + 2] = gate & 0xff;
        t.code[patch.offset + 3] = gate >> 8;
      }
    }

    return read.next;
  }

  private emitTuplet(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    let cursor = pos + 1; // skip '{'
    const letters: Array<{ letter: string; accidental: number }> = [];

    while (true) {
      if (cursor >= line.length) {
        this.diagnostics.push(mmlError(lineNo, '連符 { に対応する } がありません'));
        return -1;
      }

      const ch = line[cursor];
      if (ch === '}') {
        cursor++;
        break;
      }

      if (isWhiteSpaceChar(ch)) {
        cursor++;
        continue;
      }

      if (ch === ';' || ch === '/') {
        this.diagnostics.push(mmlError(lineNo, '連符内にコメントは書けません (} の後に書いてください)'));
        return -1;
      }

      if ((ch >= 'a' && ch <= 'g') || ch === 'r') {
        let acc = 0;
        cursor++;
        if (cursor < line.length && (line[cursor] === '+' || line[cursor] === '#' || line[cursor] === '-')) {
          acc = line[cursor] === '-' ? -1 : 1;
          cursor++;
        }

        letters.push({ letter: ch, accidental: acc });
        continue;
      }

      this.diagnostics.push(mmlError(lineNo, `連符内では音符 (a-g, r) のみ指定できます ('${ch}')`));
      return -1;
    }

    if (letters.length === 0) {
      this.diagnostics.push(mmlError(lineNo, '連符の要素がありません'));
      return -1;
    }

    const read = this.readNoteLength(line, cursor, lineNo, tracks[0].state);
    if (read === null) {
      return -1;
    }

    const each = read.units / letters.length;
    for (const t of tracks) {
      for (const { letter, accidental } of letters) {
        if (letter === 'r') {
          this.emitRest(t, each, lineNo, 0);
        } else {
          this.emitNote(t, noteNumber(t.state.octave, letter, accidental), each, lineNo, 0);
        }
      }
    }

    return read.next;
  }

  // ---- @ で始まるコマンド ----

  private processAt(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    // 長い語から先に判定する
    if (startsWithWord(line, pos, 'EP')) return this.processPitchEnvelopeCmd(line, pos + 2, lineNo, tracks);
    if (startsWithWord(line, pos, 'SW')) return this.processSweep(line, pos + 2, lineNo, tracks);
    if (startsWithWord(line, pos, 'wn')) return this.processNoiseWave(line, pos + 2, lineNo, tracks);
    if (startsWithWord(line, pos, 'in')) return this.processNoiseSync(line, pos + 2, lineNo, tracks);
    if (startsWithWord(line, pos, 't')) return this.processFrameTempo(line, pos + 1, lineNo, tracks);
    if (startsWithWord(line, pos, 'q')) return this.processFrameQuantize(line, pos + 1, lineNo, tracks);
    if (startsWithWord(line, pos, 'v')) return this.processVolumeEnvelopeCmd(line, pos + 1, lineNo, tracks);

    // @<n> : FM 音色指定
    const read = readUnsigned(line, pos, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, '不明な @ コマンドです'));
      return -1;
    }

    const toneIndex = this.toneIndexByNumber.get(read.value);
    if (toneIndex === undefined) {
      this.diagnostics.push(mmlError(lineNo, `未定義の FM 音色 @FM${read.value} です`));
      return -1;
    }

    for (const t of tracks) {
      if (!t.track.isFm) {
        this.diagnostics.push(mmlWarn(lineNo, '@ (FM 音色) は FM トラック (F1-F8) でのみ有効です'));
        break;
      }

      t.code.push(OpTone);
      t.code.push(toneIndex);
    }

    return read.next;
  }

  private processFrameTempo(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const denomRead = readUnsigned(line, pos, -1);
    if (denomRead === null) {
      this.diagnostics.push(mmlError(lineNo, '@t は @t<N分音符>,<フレーム数> の形式で指定します'));
      return -1;
    }

    if (denomRead.next >= line.length || line[denomRead.next] !== ',') {
      this.diagnostics.push(mmlError(lineNo, '@t は @t1,86 の形式で指定します'));
      return -1;
    }

    const framesRead = readUnsigned(line, denomRead.next + 1, -1);
    if (framesRead === null || denomRead.value <= 0) {
      this.diagnostics.push(mmlError(lineNo, '@t のフレーム数が不正です'));
      return -1;
    }

    const quarter = Math.min(4095, Math.max(1, Math.round((framesRead.value * 4) / denomRead.value)));
    this.result.quarterFrames = quarter;
    for (const t of tracks) {
      t.code.push(OpTempo);
      writeW16(t.code, quarter);
    }

    return framesRead.next;
  }

  private processFrameQuantize(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, '@q にはゲートカット フレーム数が必要です'));
      return -1;
    }

    for (const t of tracks) {
      t.state.quantizeFrames = Math.min(255, Math.max(0, read.value));
    }

    return read.next;
  }

  private processVolumeEnvelopeCmd(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos, -1);
    if (read === null) {
      // 引数なし → 解除
      for (const t of tracks) {
        t.state.volumeEnvIndex = -1;
        t.code.push(OpVenv);
        t.code.push(0xff);
      }

      return pos;
    }

    const index = this.venvIndexByNumber.get(read.value);
    if (index === undefined) {
      this.diagnostics.push(mmlError(lineNo, `未定義の音量エンベロープ @v${read.value} です`));
      return -1;
    }

    for (const t of tracks) {
      t.state.volumeEnvIndex = index;
      t.code.push(OpVenv);
      t.code.push(index);
    }

    return read.next;
  }

  private processPitchEnvelopeCmd(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, '@EP には番号が必要です (解除は @EP255)'));
      return -1;
    }

    if (read.value === 255) {
      for (const t of tracks) {
        t.state.pitchEnvIndex = -1;
        t.code.push(OpPenv);
        t.code.push(0xff);
      }

      return read.next;
    }

    const index = this.penvIndexByNumber.get(read.value);
    if (index === undefined) {
      this.diagnostics.push(mmlError(lineNo, `未定義のピッチエンベロープ @EP${read.value} です`));
      return -1;
    }

    for (const t of tracks) {
      t.state.pitchEnvIndex = index;
      t.code.push(OpPenv);
      t.code.push(index);
    }

    return read.next;
  }

  // ---- @SW / @wn / @in ----

  private processSweep(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readSigned(line, pos, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, '@SW には数値が必要です'));
      return -1;
    }

    const sweep = Math.min(127, Math.max(-128, read.value));
    for (const t of tracks) {
      t.state.sweep = sweep;
      t.code.push(OpSweep);
      t.code.push(sweep & 0xff);
    }

    return read.next;
  }

  private processNoiseWave(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos, -1);
    if (read === null || (read.value !== 0 && read.value !== 1)) {
      this.diagnostics.push(mmlError(lineNo, '@wn には 0 (周期ノイズ) または 1 (ホワイトノイズ) が必要です'));
      return -1;
    }

    let hasNoise = false;
    for (const t of tracks) {
      t.state.noiseFlags = (t.state.noiseFlags & ~0x01) | read.value;
      if (!t.track.isNoise) {
        continue;
      }

      hasNoise = true;
      t.code.push(OpNoiseCtl);
      t.code.push(t.state.noiseFlags);
    }

    if (!hasNoise) {
      this.diagnostics.push(mmlWarn(lineNo, '@wn はノイズ トラック (N1, N2) でのみ有効です'));
    }

    return read.next;
  }

  private processNoiseSync(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos, -1);
    if (read === null || (read.value !== 0 && read.value !== 1 && read.value !== 2)) {
      this.diagnostics.push(mmlError(lineNo, '@in には 0 (オフ) / 1 (周期連動) / 2 (ホワイト連動) が必要です'));
      return -1;
    }

    let hasNoise = false;
    for (const t of tracks) {
      t.state.noiseFlags = (t.state.noiseFlags & ~0x06) | (read.value << 1);
      if (!t.track.isNoise) {
        continue;
      }

      hasNoise = true;
      t.code.push(OpNoiseCtl);
      t.code.push(t.state.noiseFlags);
    }

    if (!hasNoise) {
      this.diagnostics.push(mmlWarn(lineNo, '@in はノイズ トラック (N1, N2) でのみ有効です'));
    }

    return read.next;
  }

  // ---- 基本コマンド ([ ] L o l) ----

  private processLoopStart(pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    for (const t of tracks) {
      t.loopDepth++;
      if (t.loopDepth > MaxLoopDepth) {
        this.diagnostics.push(mmlError(lineNo, 'ループのネストが深すぎます (上限 8)'));
        return -1;
      }

      t.code.push(OpLoopStart);
    }

    return pos + 1;
  }

  private processLoopEnd(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos + 1, 2);
    if (read === null) {
      return -1;
    }

    for (const t of tracks) {
      t.loopDepth--;
      if (t.loopDepth < 0) {
        this.diagnostics.push(mmlError(lineNo, '] に対応する [ がありません'));
        return -1;
      }

      t.code.push(OpLoopEnd);
      t.code.push(Math.min(255, Math.max(2, read.value)));
    }

    return read.next;
  }

  private processWholeLoopMark(pos: number, tracks: TrackBuilder[]): number {
    for (const t of tracks) {
      if (t.wholeLoopOffset < 0) {
        t.wholeLoopOffset = t.code.length;
      }
    }

    this.result.wholeLoopEnabled = true;
    return pos + 1;
  }

  private processOctave(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 'o の後にオクターブ番号が必要です'));
      return -1;
    }

    let octave = read.value;
    if (octave < 0 || octave > 10) {
      this.diagnostics.push(mmlWarn(lineNo, `オクターブ ${octave} は 0-10 の範囲外です (制限しました)`));
      octave = Math.min(10, Math.max(0, octave));
    }

    for (const t of tracks) {
      t.state.octave = octave;
    }

    return read.next;
  }

  private processOctaveShift(_line: string, pos: number, delta: number, tracks: TrackBuilder[]): number {
    for (const t of tracks) {
      t.state.octave = Math.min(10, Math.max(0, t.state.octave + delta));
    }

    return pos + 1;
  }

  private processDefaultLength(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 'l の後に音長が必要です'));
      return -1;
    }

    let len = read.value;
    if (len < 1 || len > 64) {
      this.diagnostics.push(mmlWarn(lineNo, `音長 ${len} は 1-64 の範囲外です (制限しました)`));
      len = Math.min(64, Math.max(1, len));
    }

    for (const t of tracks) {
      t.state.defaultLength = len;
    }

    return read.next;
  }

  // ---- テンポ・音量・ゲート・移調・ディチューン ----

  private processTempo(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 't の後にテンポ (BPM) が必要です'));
      return -1;
    }

    let bpm = read.value;
    if (bpm < 30 || bpm > 255) {
      this.diagnostics.push(mmlWarn(lineNo, `テンポ ${bpm} は 30-255 BPM に制限しました`));
      bpm = Math.min(255, Math.max(30, bpm));
    }

    const quarter = Math.min(4095, Math.max(1, Math.round(3600.0 / bpm)));
    this.result.quarterFrames = quarter;
    for (const t of tracks) {
      t.code.push(OpTempo);
      writeW16(t.code, quarter);
    }

    return read.next;
  }

  private processVolume(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 'v の後に音量 (0-15) が必要です'));
      return -1;
    }

    let vol = read.value;
    if (vol < 0 || vol > 15) {
      this.diagnostics.push(mmlWarn(lineNo, `音量 ${vol} は 0-15 の範囲外です (制限しました)`));
      vol = Math.min(15, Math.max(0, vol));
    }

    for (const t of tracks) {
      t.state.volume = vol;
      t.state.volumeEnvIndex = -1; // 即値指定でエンベロープ解除
      t.code.push(OpVolume);
      t.code.push(vol);
      t.code.push(OpVenv);
      t.code.push(0xff);
    }

    return read.next;
  }

  private processQuantize(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readUnsigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 'q の後にゲート比 (1-8) が必要です'));
      return -1;
    }

    let q = read.value;
    if (q < 1 || q > 8) {
      this.diagnostics.push(mmlWarn(lineNo, `ゲート比 ${q} は 1-8 に制限しました`));
      q = Math.min(8, Math.max(1, q));
    }

    for (const t of tracks) {
      t.state.quantize = q;
      t.state.quantizeFrames = -1;
    }

    return read.next;
  }

  private processTranspose(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readSigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 'K の後に移調量 (半音) が必要です'));
      return -1;
    }

    const transpose = Math.min(127, Math.max(-127, read.value));
    for (const t of tracks) {
      t.state.transpose = transpose;
      t.code.push(OpTranspose);
      t.code.push(transpose & 0xff);
    }

    return read.next;
  }

  private processDetune(line: string, pos: number, lineNo: number, tracks: TrackBuilder[]): number {
    const read = readSigned(line, pos + 1, -1);
    if (read === null) {
      this.diagnostics.push(mmlError(lineNo, 'D の後にディチューン量が必要です'));
      return -1;
    }

    const detune = Math.min(32767, Math.max(-32768, read.value));
    for (const t of tracks) {
      t.state.detune = detune;
      t.code.push(OpDetune);
      t.code.push(detune & 0xff);
      t.code.push((detune >> 8) & 0xff);
    }

    return read.next;
  }

  // ---- コード emit と読み取りヘルパ ----

  private emitNote(t: TrackBuilder, rawNote: number, units: number, lineNo: number, col: number): void {
    const len = this.advance(t, units);
    const gate = computeGate(len, t.state);
    const offset = t.code.length;
    t.code.push(OpNote);
    t.code.push(Math.min(127, Math.max(0, rawNote + t.state.transpose)));
    t.code.push(len & 0xff);
    t.code.push(len >> 8);
    t.code.push(gate & 0xff);
    t.code.push(gate >> 8);
    t.events.push({ offset, line: lineNo, column: col, length: 0, kind: 'note' });
    t.notePatch = { offset: offset + 2, isNote: true };
  }

  private emitRest(t: TrackBuilder, units: number, lineNo: number, col: number): void {
    const len = this.advance(t, units);
    const offset = t.code.length;
    t.code.push(OpRest);
    t.code.push(len & 0xff);
    t.code.push(len >> 8);
    t.events.push({ offset, line: lineNo, column: col, length: 0, kind: 'rest' });
    t.notePatch = { offset: offset + 1, isNote: false };
  }

  /** 時間を進め、増分フレーム数を返す。 */
  private advance(t: TrackBuilder, units: number): number {
    const startFrame = Math.round(t.tickSeconds * 60.0);
    const endSeconds = t.tickSeconds + ((units * 4.0 * this.result.quarterFrames) / 60.0);
    const endFrame = Math.round(endSeconds * 60.0);
    t.tickSeconds = endSeconds;
    return Math.max(1, endFrame - startFrame);
  }

  private readNoteLength(
    line: string,
    pos: number,
    lineNo: number,
    state: TrackState,
  ): { next: number; units: number } | null {
    const read = readUnsigned(line, pos, -1);
    let len: number;
    let next: number;
    if (read === null) {
      len = state.defaultLength;
      next = pos;
    } else {
      len = read.value;
      next = read.next;
    }

    if (len < 1 || len > 64) {
      this.diagnostics.push(mmlWarn(lineNo, `音長 ${len} は 1-64 の範囲外です (制限しました)`));
      len = Math.min(64, Math.max(1, len));
    }

    let dots = 0;
    while (next < line.length && line[next] === '.') {
      dots++;
      next++;
    }

    if (dots > 3) {
      this.diagnostics.push(mmlWarn(lineNo, '付点は 3 個までに制限しました'));
      dots = 3;
    }

    const units = (1.0 / len) * (2.0 - 0.5 ** dots);
    return { next, units };
  }
}

// [MMLPARSER-HELPERS]

function computeGate(len: number, state: TrackState): number {
  if (state.quantizeFrames >= 0) {
    return Math.min(len, Math.max(1, len - state.quantizeFrames));
  }

  return Math.min(len, Math.max(1, Math.floor((len * state.quantize) / 8.0)));
}

function readLengthAt(t: TrackBuilder, offset: number): number {
  return t.code[offset] | (t.code[offset + 1] << 8);
}

function noteNumber(octave: number, letter: string, accidental: number): number {
  const semitone = (() => {
    switch (letter) {
      case 'c': return 0;
      case 'd': return 2;
      case 'e': return 4;
      case 'f': return 5;
      case 'g': return 7;
      case 'a': return 9;
      case 'b': return 11;
      default: return 0;
    }
  })();

  return Math.min(127, Math.max(0, ((octave + 1) * 12) + semitone + accidental));
}

/** 符号なし整数を読み取る。見つからない場合は defaultValue (>= 0) を返し、それも無い場合は null。 */
function readUnsigned(line: string, pos: number, defaultValue: number): { next: number; value: number } | null {
  const start = pos;
  while (pos < line.length && isDigitChar(line[pos])) {
    pos++;
  }

  if (pos === start) {
    if (defaultValue >= 0) {
      return { next: pos, value: defaultValue };
    }

    return null;
  }

  return { next: pos, value: parseInt(line.slice(start, pos), 10) };
}

/** 符号付き整数を読み取る (+/- 接頭辞可)。 */
function readSigned(line: string, pos: number, defaultValue: number): { next: number; value: number } | null {
  const start = pos;
  if (pos < line.length && (line[pos] === '-' || line[pos] === '+')) {
    pos++;
  }

  const digitsStart = pos;
  while (pos < line.length && isDigitChar(line[pos])) {
    pos++;
  }

  if (pos === digitsStart) {
    if (defaultValue >= 0) {
      return { next: pos, value: defaultValue };
    }

    return null;
  }

  return { next: pos, value: parseInt(line.slice(start, pos), 10) };
}

function writeW16(code: number[], value: number): void {
  code.push(value & 0xff);
  code.push((value >> 8) & 0xff);
}

function startsWithWord(line: string, pos: number, word: string): boolean {
  if (pos + word.length > line.length) {
    return false;
  }

  return line.slice(pos, pos + word.length).toLowerCase() === word.toLowerCase();
}


/** 行頭のトラック指定を検出する。 */
function detectTrackSpec(line: string): { ids: TrackId[] | null; contentStart: number } {
  let pos = 0;
  const ids: TrackId[] = [];

  while (pos < line.length) {
    const c = line[pos];

    if (isWhiteSpaceChar(c)) {
      if (ids.length > 0) {
        // トラック記号列の後の空白で指定終了
        return { ids, contentStart: pos + 1 };
      }

      pos++;
      continue;
    }

    // トラック記号は大文字のみ (小文字 f4 などは音符として解釈させる)
    if ((c === 'P' || c === 'N' || c === 'B' || c === 'F')
      && pos + 1 < line.length && isDigitChar(line[pos + 1])) {
      const id = parseTrackId(line.slice(pos, pos + 2));
      if (id === null) {
        break; // P7 / N9 など無効なトラック → トラック指定ではない
      }

      if (!ids.includes(id)) {
        ids.push(id);
      }

      pos += 2;
      continue;
    }

    if (c === ',') {
      pos++;
      continue;
    }

    break;
  }

  return ids.length > 0 ? { ids, contentStart: pos } : { ids: null, contentStart: 0 };
}

function stripComment(line: string): string {
  const semi = line.indexOf(';');
  const slash = line.indexOf('/');
  const index = semi < 0 ? slash : slash < 0 ? semi : Math.min(semi, slash);
  return index < 0 ? line : line.slice(0, index);
}
