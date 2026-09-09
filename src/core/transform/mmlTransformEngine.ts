/**
 * MML TRANSFORM パネル用のテキスト変換エンジン。
 *
 * Monaco Editor 上の MML ソースを行単位で走査し、トラック宣言
 * (`P1`-`P6` / `N1`-`N2` / `B1` / `F1`-`F8` / `W1`-`W99`) に基づいて
 * 対象トラックのみを安全に書き換える純粋関数群 (UI 非依存)。
 *
 * - トラック帰属の解決は `mmlTrackScope.ts` (正式パーサ準拠) に委譲
 * - 継続行 (宣言の無い行) も直前トラックの一部として変換対象になる
 * - マクロ定義行 (`@1 = { ... }` 等)・ディレクティブ行 (`#TITLE` 等) は変換しない
 * - 行内コメント (`;` / `/` 以降) は書き換えない
 * - 戻り値の `changedCount` は実際に書き換わったトークン数 (0 = 変更なし)
 */
import {
  extractDeclarationTokens,
  resolveLineScopes,
  type MmlLineScope,
} from './mmlTrackScope';

/** 変換操作の種別 (1 リクエスト = 1 操作。複数適用は呼び出し側で順次実行する)。 */
export type MmlTransformOperation =
  /** トラック識別子の一括置換 (単一リマップ・スワップ・W→実機展開を含む)。 */
  | { kind: 'remapTracks'; mappings: Readonly<Record<string, string>> }
  /** 対象トラックの `o` コマンド値を一括シフト (0-10 にクランプ)。 */
  | { kind: 'shiftOctave'; targetTracks: readonly string[]; shift: number }
  /** 対象トラックの音符を半音単位で移調 (オクターブ跨ぎは `o` コマンド挿入で表現)。 */
  | { kind: 'transpose'; targetTracks: readonly string[]; semitones: number }
  /** 対象トラックの音量を加減算 / 割合スケーリング (PSG `v` 0-15、FM `@v` 0-127 にクランプ)。 */
  | { kind: 'scaleVolume'; targetTracks: readonly string[]; add: number; percent: number };

/** 変換結果。 */
export interface MmlTransformResult {
  /** 変換後の MML ソース。 */
  readonly source: string;
  /** 実際に書き換わったトークン数 (0 = 変更なし)。 */
  readonly changedCount: number;
}

const NOTE_LETTERS: readonly string[] = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/** オクターブの有効範囲 (正式パーサと同一)。 */
const MIN_OCTAVE = 0;
const MAX_OCTAVE = 10;
/** MML で表現可能なノート番号の範囲 (o0 c 〜 o10 b)。 */
const MIN_NOTE = (MIN_OCTAVE + 1) * 12;
const MAX_NOTE = (MAX_OCTAVE + 1) * 12 + NOTE_LETTERS.length - 1;
/** トラック冒頭の既定オクターブ (正式パーサ TrackState 初期値と同一)。 */
const DEFAULT_OCTAVE = 4;

/** PSG 音量 (`v`) の上限。 */
const PSG_VOLUME_MAX = 15;
/** FM 音量 (`@v`) の上限。 */
const FM_VOLUME_MAX = 127;

const clampOctave = (value: number): number => Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, value));

/** ノート番号を MML 表現可能範囲にクランプする。 */
const clampNote = (value: number): number => Math.min(MAX_NOTE, Math.max(MIN_NOTE, value));

/**
 * オクターブ・音名・臨時記号 (`+` / `#` / `-`) からノート番号を算出する
 * (正式パーサ `MmlParser.noteNumber` と同一の計算式)。
 */
function noteNumber(octave: number, letter: string, accidental: number): number {
  const baseSemitone = NOTE_LETTERS.indexOf(letter);
  return (octave + 1) * 12 + baseSemitone + accidental;
}

/** ノート番号を音名テキスト (臨時記号は `#` 表記に正規化) とオクターブへ分解する。 */
function noteToText(note: number): { octave: number; text: string } {
  const octave = Math.floor(note / 12) - 1;
  const semitone = note - (octave + 1) * 12;
  return { octave, text: NOTE_LETTERS[semitone] };
}

/** 位置 from から始まる 10 進数字列の終端を返す (数字が無ければ null)。 */
function readDigits(body: string, from: number): number | null {
  let i = from;
  while (i < body.length && body[i] >= '0' && body[i] <= '9') {
    i++;
  }

  return i > from ? i : null;
}

/** `@` で始まるトークン (@1 / @VE1 / @v100 等) の終端位置を返す。 */
function readAtTokenEnd(body: string, from: number): number {
  let i = from + 1; // skip '@'
  while (i < body.length && /[a-zA-Z]/.test(body[i])) {
    i++;
  }

  return readDigits(body, i) ?? i;
}

/** トークン走査時の書き換えハンドラ。null を返したトークンは無置換 (変更なし扱い)。 */
interface BodyTransformHandlers {
  /** `o` コマンドの値 (`oN` 形式の置換テキストを返す)。 */
  onOctaveValue?(value: number): string | null;
  /** `<` / `>` コマンド (オクターブ相対移動)。 */
  onOctaveShift?(direction: 1 | -1): void;
  /** 音符 (a-g + 臨時記号)。戻り値は音符本体の置換テキスト (音長・付点は保持される)。`octave` は元テキスト上、`outputOctave` は変換後テキスト上のオクターブ状態 (`o` 挿入の要否判定に使用)。 */
  onNote?(note: { letter: string; accidental: number; octave: number; outputOctave: number; inTuplet: boolean }): string | null;
  /** `v` コマンド (PSG 音量)。戻り値は値部分のみ。 */
  onPsgVolume?(value: number): string | null;
  /** `@v` コマンド (FM 音量)。戻り値は値部分のみ。 */
  onFmVolume?(value: number): string | null;
}

interface TokenCounter {
  count: number;
}

/**
 * トラック行の本体部分をトークン走査して書き換える。
 * - オクターブ状態を 2 系統で追跡する:
 *   - `sourceOctave`: 元テキスト上の状態 (正式パーサと同一の `o` / `<` / `>` 解釈)。
 *     音符ハンドラへ現在値を渡すのに使用する。
 *   - `outputOctave`: 変換後テキスト上の状態。移調結果への `o` コマンド挿入は
 *     出力上の状態のみ更新し、元テキストの解釈には影響させない。
 * - コメント開始文字 (`;` / `/`) 以降は無条件で保持する
 * - 戻り値は変換後テキストと追跡後の両オクターブ状態 (複数行で状態を引き継ぐために返す)
 */
function transformTrackBody(
  body: string,
  initialSourceOctave: number,
  initialOutputOctave: number,
  handlers: BodyTransformHandlers,
  counter: TokenCounter,
): { text: string; sourceOctave: number; outputOctave: number } {
  let out = '';
  let sourceOctave = initialSourceOctave;
  let outputOctave = initialOutputOctave;
  let tupletDepth = 0;
  let i = 0;

  while (i < body.length) {
    const c = body[i];

    if (c === ';' || c === '/') {
      out += body.slice(i);
      break;
    }

    // 連符 (`{ceg}`) の内外を追跡する (連符内は `o` コマンドを挿入できない)
    if (c === '{') {
      tupletDepth++;
      out += c;
      i++;
      continue;
    }

    if (c === '}') {
      tupletDepth = Math.max(0, tupletDepth - 1);
      out += c;
      i++;
      continue;
    }

    if (c === '@') {
      const end = readAtTokenEnd(body, i);
      const token = body.slice(i, end);
      const fmVolumeMatch = /^(@[vV])(\d+)$/.exec(token);
      if (fmVolumeMatch && handlers.onFmVolume) {
        const replaced = handlers.onFmVolume(parseInt(fmVolumeMatch[2], 10));
        if (replaced !== null) {
          counter.count++;
          out += `${fmVolumeMatch[1]}${replaced}`;
        } else {
          out += token;
        }
      } else {
        out += token;
      }

      i = end;
      continue;
    }

    if (c === 'o') {
      const end = readDigits(body, i + 1);
      if (end !== null) {
        const value = parseInt(body.slice(i + 1, end), 10);
        const replaced = handlers.onOctaveValue?.(value) ?? null;
        if (replaced !== null) {
          counter.count++;
          out += replaced;
          const replacedValue = parseInt(replaced.slice(1), 10);
          if (!Number.isNaN(replacedValue)) {
            sourceOctave = clampOctave(replacedValue);
            outputOctave = sourceOctave;
          }
        } else {
          out += body.slice(i, end);
          sourceOctave = clampOctave(value);
          outputOctave = sourceOctave;
        }

        i = end;
        continue;
      }

      out += c;
      i++;
      continue;
    }

    if (c === '<' || c === '>') {
      const direction = c === '<' ? -1 : 1;
      handlers.onOctaveShift?.(direction);
      sourceOctave = clampOctave(sourceOctave + direction);
      outputOctave = clampOctave(outputOctave + direction);
      out += c;
      i++;
      continue;
    }

    if (c === 'v') {
      const end = readDigits(body, i + 1);
      if (end !== null) {
        const value = parseInt(body.slice(i + 1, end), 10);
        const replaced = handlers.onPsgVolume?.(value) ?? null;
        if (replaced !== null) {
          counter.count++;
          out += `v${replaced}`;
        } else {
          out += body.slice(i, end);
        }

        i = end;
        continue;
      }

      out += c;
      i++;
      continue;
    }

    if (c >= 'a' && c <= 'g') {
      let cursor = i + 1;
      let accidental = 0;
      if (cursor < body.length && (body[cursor] === '+' || body[cursor] === '#' || body[cursor] === '-')) {
        accidental = body[cursor] === '-' ? -1 : 1;
        cursor++;
      }

      let end = readDigits(body, cursor) ?? cursor;
      while (end < body.length && body[end] === '.') {
        end++;
      }

      // 音符本体を置換し、音長・付点のみ保持する (臨時記号は置換側の表記に統一する)。
      // 無変換 (null) の場合は元トークン全体をそのまま出力する。
      const suffixStart = accidental === 0 ? i + 1 : cursor;
      const suffix = body.slice(suffixStart, end);
      const replaced = handlers.onNote?.({ letter: c, accidental, octave: sourceOctave, outputOctave, inTuplet: tupletDepth > 0 }) ?? null;
      if (replaced !== null) {
        counter.count++;
        out += replaced;
        // 移調によるオクターブ跨ぎ (`o5c` 等) の挿入は出力テキスト上の状態のみ
        // 更新する。元テキスト上のオクターブ状態は変わらないため sourceOctave は不変。
        const insertedOctave = /^o(\d+)/.exec(replaced);
        if (insertedOctave) {
          outputOctave = clampOctave(parseInt(insertedOctave[1], 10));
        }

        out += suffix;
      } else {
        out += body.slice(i, end);
      }

      i = end;
      continue;
    }

    out += c;
    i++;
  }

  return { text: out, sourceOctave, outputOctave };
}

/**
 * 1 行分をトラック本体 (contentStart 以降) に限定して変換する。
 * 行末の CR (CRLF 改行) は変換対象から除外して再結合する。
 * 戻り値は変換後テキストと追跡後のオクターブ状態 (元テキスト / 出力テキスト)。
 */
function transformLine(
  line: string,
  contentStart: number,
  initialSourceOctave: number,
  initialOutputOctave: number,
  handlers: BodyTransformHandlers,
  counter: TokenCounter,
): { text: string; sourceOctave: number; outputOctave: number } {
  const hasCarriageReturn = line.endsWith('\r');
  const base = hasCarriageReturn ? line.slice(0, -1) : line;
  const before = base.slice(contentStart);
  const transformed = transformTrackBody(before, initialSourceOctave, initialOutputOctave, handlers, counter);
  if (transformed.text === before) {
    return { text: line, sourceOctave: transformed.sourceOctave, outputOctave: transformed.outputOctave };
  }

  return {
    text: base.slice(0, contentStart) + transformed.text + (hasCarriageReturn ? '\r' : ''),
    sourceOctave: transformed.sourceOctave,
    outputOctave: transformed.outputOctave,
  };
}

/** 対象トラックのうち、行に含まれるものを返す。 */
function matchedTargets(scope: MmlLineScope, targetSet: ReadonlySet<string>): string[] {
  return scope.trackNames.filter((name) => targetSet.has(name));
}

/** トラック識別子の一括置換 (位置ベース置換のためスワップ等の衝突が起きない)。 */
function applyRemapTracks(source: string, mappings: Readonly<Record<string, string>>): MmlTransformResult {
  let changed = 0;
  const lines = source.split('\n').map((line) => {
    const declaration = extractDeclarationTokens(line);
    if (declaration === null) {
      return line;
    }

    let hasChange = false;
    const pieces: string[] = [];
    let last = 0;
    for (const token of declaration.tokens) {
      const target = mappings[token.name];
      pieces.push(line.slice(last, token.start));
      if (target !== undefined && target !== token.name) {
        pieces.push(target);
        hasChange = true;
        changed++;
      } else {
        pieces.push(line.slice(token.start, token.end));
      }

      last = token.end;
    }

    pieces.push(line.slice(last));
    return hasChange ? pieces.join('') : line;
  });

  return { source: lines.join('\n'), changedCount: changed };
}

/** 対象トラックの `o` コマンド値を一括シフトする (`<` / `>` は相対指定のため触らない)。 */
function applyShiftOctave(source: string, targetTracks: readonly string[], shift: number): MmlTransformResult {
  const targetSet = new Set(targetTracks);
  const scopes = resolveLineScopes(source);
  const counter: TokenCounter = { count: 0 };

  const lines = source.split('\n').map((line, index) => {
    const scope = scopes[index];
    if (scope.isSkipped || matchedTargets(scope, targetSet).length === 0) {
      return line;
    }

    return transformLine(line, scope.contentStart, DEFAULT_OCTAVE, DEFAULT_OCTAVE, {
      onOctaveValue: (value) => {
        const next = clampOctave(value + shift);
        return next === value ? null : `o${next}`;
      },
    }, counter).text;
  });

  return { source: lines.join('\n'), changedCount: counter.count };
}

/**
 * 対象トラックの音符を半音単位で移調する。
 *
 * 元テキスト上のオクターブ状態 (`o` / `<` / `>`、初期値は正式パーサと同一の o4)
 * を追跡して各音符のノート番号を算出し、移調結果が現在オクターブと異なる場合は
 * 音符直前に `o` コマンドを挿入してオクターブ跨ぎを表現する。
 * 挿入した `o` は出力テキスト上の都合であり元テキストの解釈は変わらないため、
 * 元テキストと出力テキストのオクターブ状態は独立に追跡する
 * (オクターブ跨ぎ後の継続音符・同音連打 `a+12a+12...` を誤移調しない)。
 * 複数トラック同時指定 (`F1,F2`) の行では先頭対象トラックの状態で変換し、
 * 結果のオクターブを行終端時に全対象トラックへ同期する。
 */
function applyTranspose(source: string, targetTracks: readonly string[], semitones: number): MmlTransformResult {
  const targetSet = new Set(targetTracks);
  const scopes = resolveLineScopes(source);
  const counter: TokenCounter = { count: 0 };
  const sourceOctaveByTrack = new Map<string, number>(targetTracks.map((name) => [name, DEFAULT_OCTAVE]));
  const outputOctaveByTrack = new Map<string, number>(targetTracks.map((name) => [name, DEFAULT_OCTAVE]));

  const lines = source.split('\n').map((line, index) => {
    const scope = scopes[index];
    const active = matchedTargets(scope, targetSet);
    if (scope.isSkipped || active.length === 0) {
      return line;
    }

    const track = active[0];
    const result = transformLine(
      line,
      scope.contentStart,
      sourceOctaveByTrack.get(track) ?? DEFAULT_OCTAVE,
      outputOctaveByTrack.get(track) ?? DEFAULT_OCTAVE,
      {
      onNote: ({ letter, accidental, octave, outputOctave, inTuplet }) => {
        const current = noteNumber(octave, letter, accidental);

        // 連符 (`{ceg}`) 内は `o` コマンドを挿入できないため現在オクターブの音域にクランプする
        if (inTuplet) {
          const low = (octave + 1) * 12;
          const bounded = Math.min(low + 11, Math.max(low, current + semitones));
          const text = noteToText(bounded).text;
          if (text === letter && accidental === 0) {
            return null;
          }

          return text;
        }

        const target = clampNote(current + semitones);
        const { octave: outOctave, text } = noteToText(target);
        if (outOctave === octave && text === letter && accidental === 0) {
          return null;
        }

        // 出力テキスト上のオクターブ状態と異なる場合のみ `o` を挿入する
        // (挿入済み `o` によるずれを、元テキストの解釈に基づいて打ち消す)
        return outOctave === outputOctave ? text : `o${outOctave}${text}`;
      },
    }, counter);

    active.forEach((name) => {
      sourceOctaveByTrack.set(name, result.sourceOctave);
      outputOctaveByTrack.set(name, result.outputOctave);
    });
    return result.text;
  });

  return { source: lines.join('\n'), changedCount: counter.count };
}

/**
 * 対象トラックの音量を一括スケーリングする。
 * - `v` (PSG 音量): 0-15 にクランプ
 * - `@v` (FM 音量): 行に FM トラックが含まれる場合のみ 0-127 にクランプして適用
 */
function applyScaleVolume(
  source: string,
  targetTracks: readonly string[],
  add: number,
  percent: number,
): MmlTransformResult {
  const targetSet = new Set(targetTracks);
  const scopes = resolveLineScopes(source);
  const counter: TokenCounter = { count: 0 };

  const scale = (max: number, value: number): string | null => {
    const next = Math.min(max, Math.max(0, Math.round((value * percent) / 100) + add));
    return next === value ? null : String(next);
  };

  const lines = source.split('\n').map((line, index) => {
    const scope = scopes[index];
    const active = matchedTargets(scope, targetSet);
    if (scope.isSkipped || active.length === 0) {
      return line;
    }

    const hasFmTrack = active.some((name) => /^F[1-8]$/.test(name));
    return transformLine(line, scope.contentStart, DEFAULT_OCTAVE, DEFAULT_OCTAVE, {
      onPsgVolume: (value) => scale(PSG_VOLUME_MAX, value),
      onFmVolume: hasFmTrack ? (value) => scale(FM_VOLUME_MAX, value) : undefined,
    }, counter).text;
  });

  return { source: lines.join('\n'), changedCount: counter.count };
}

/** MML ソースへ変換操作を適用する (エントリポイント)。 */
export function applyMmlTransform(source: string, operation: MmlTransformOperation): MmlTransformResult {
  switch (operation.kind) {
    case 'remapTracks':
      return applyRemapTracks(source, operation.mappings);
    case 'shiftOctave':
      return applyShiftOctave(source, operation.targetTracks, operation.shift);
    case 'transpose':
      return applyTranspose(source, operation.targetTracks, operation.semitones);
    case 'scaleVolume':
      return applyScaleVolume(source, operation.targetTracks, operation.add, operation.percent);
  }
}