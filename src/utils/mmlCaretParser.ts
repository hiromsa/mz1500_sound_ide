import type { SoundEngineType } from './virtualSynth';

/**
 * MML キャレット位置の演奏コンテキスト (トラック名・音源・オクターブ・音量・各ID等)。
 * 仮想キーボードおよび右ペイン各エディタ (FM TONE / VOL ENV / PITCH ENV) との連動に使用する。
 */
export interface MmlCaretContext {
  trackName: string;
  engine: SoundEngineType;
  octave: number;
  volume: number;
  voiceId?: number;
  volEnvId?: number;
  pitchEnvId?: number;
  detune: number;
  noiseType?: 'periodic' | 'white';
  /** FM 専用音量 (@v コマンド、0-127、127 = 最大)。FM トラックのみ更新される。 */
  fmVolume: number;
}

/** トラックごとに保持される演奏状態 (キャレット位置までのコマンド適用結果) */
export interface TrackPlayState {
  octave: number;
  volume: number;
  voiceId: number | undefined;
  volEnvId: number | undefined;
  pitchEnvId: number | undefined;
  detune: number;
  noiseType: 'periodic' | 'white';
  fmVolume: number;
}

/** 有効なトラック名 (P1-P6 / N1-N2 / B1 / F1-F8 / W1-W99) のパターン (大文字のみ) */
const TRACK_NAME_PATTERN = /^(?:P[1-6]|N[1-2]|B1|F[1-8]|W\d+)$/;

/**
 * 演奏状態に影響するコマンドトークンのパターン。
 * - `@` 系コマンドは正式パーサ同様に大文字小文字を区別しない
 * - `D` (ディチューン) は音符 `d` と区別するため大文字のみ (正式パーサ準拠)
 * - `f2` / `d4` のような音長付き音符はどのパターンにも誤マッチしない
 */
const COMMAND_PATTERN = /@[fF][mM]\d+|@[pP][eE]\d+|@[eE][pP]\d+|@[vV][eE]\d+|@[wW][nN]\d+|@[vV]\d+|@\d+|[oO][1-8]|[<>]|[vV]\d+|D-?\d+/g;

/** トラック名から音源種別を判定する (mml_reference.md 2節準拠) */
export function resolveEngineFromTrackName(trackName: string): SoundEngineType {
  if (/^F[1-8]$/.test(trackName)) return 'fm';
  if (/^B1$/.test(trackName)) return 'beep';
  if (/^N[1-2]$/.test(trackName)) return 'noise';
  return 'psg'; // P1-P6 (DCSG 矩形波)
}

/**
 * デフォルトの演奏状態を生成する。
 * voiceId は全トラック共通で 1 を初期値とする (各エディタ連動用の既定値)。
 */
function createDefaultTrackState(): TrackPlayState {
  return {
    octave: 4,
    volume: 12,
    voiceId: 1,
    volEnvId: undefined,
    pitchEnvId: undefined,
    detune: 0,
    noiseType: 'white',
    fmVolume: 127,
  };
}

/** 数値接尾辞をパースする (失敗時は undefined) */
function parseOptionalInt(text: string): number | undefined {
  const value = parseInt(text, 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * 行内コメント (`;` または `/` 以降) を除去する (正式パーサ `MmlParser.stripComment` 準拠)。
 */
function stripLineComment(line: string): string {
  const semi = line.indexOf(';');
  const slash = line.indexOf('/');
  const index = semi < 0 ? slash : slash < 0 ? semi : Math.min(semi, slash);
  return index < 0 ? line : line.slice(0, index);
}

/**
 * マクロ定義行 (`@VE1 = { ... }` / `@PE1 = { ... }` / `@1 = { ... }` 等) かどうか。
 * 定義行はトラックの演奏状態へ影響しないため走査対象から除外する。
 */
function isMacroDefinitionLine(line: string): boolean {
  return /^\s*@(?:VE|EP|PE|FM)?\d*\s*=/i.test(line);
}

/** 行頭のトラック指定の検出結果 */
interface TrackSpecDetection {
  /** 宣言されたトラック名 (例: ['F1'] / ['F1', 'F2']) */
  trackNames: string[];
  /** トラック指定直後の MML 本体の開始位置 */
  contentStart: number;
}

/**
 * 行頭のトラック指定を検出する (正式パーサ `MmlParser.detectTrackSpec` と同等の判定)。
 * - トラック記号は大文字のみ (小文字の `f4` などは音長付き音符として扱う)
 * - カンマ区切りによる複数トラック指定 (`F1,F2`) に対応
 * - トラック指定が無い行は null を返す
 */
function detectTrackSpecAtLineStart(line: string): TrackSpecDetection | null {
  let pos = 0;
  const trackNames: string[] = [];

  while (pos < line.length) {
    const c = line[pos];

    if (c === ' ' || c === '\t') {
      if (trackNames.length > 0) {
        // トラック記号列の後の空白で指定終了
        return { trackNames, contentStart: pos + 1 };
      }
      pos++;
      continue;
    }

    if ((c === 'P' || c === 'N' || c === 'B' || c === 'F')
      && pos + 1 < line.length && line[pos + 1] >= '0' && line[pos + 1] <= '9') {
      const name = line.slice(pos, pos + 2);
      if (!TRACK_NAME_PATTERN.test(name)) {
        break; // P7 / N9 など無効なトラック → トラック指定ではない
      }
      if (!trackNames.includes(name)) {
        trackNames.push(name);
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

  return trackNames.length > 0 ? { trackNames, contentStart: pos } : null;
}

/**
 * MML テキストを行単位で走査し、トラックごとの演奏状態を追跡するクラス。
 *
 * 行頭のトラック宣言でカレントトラックを切り替えつつ、各トラックの状態を独立に保持するため、
 * - 同一トラックの記述が複数行に分かれていても (2行目以降の `F1` による継続行)
 * - 複数トラックが交互に現れても (`F1` → `P1` → `F1` …)
 * それぞれの直近のコマンド状態 (オクターブ・音量・音色/エンベロープID等) を正しく復元できる。
 */
export class MmlCaretContextTracker {
  private readonly trackStates = new Map<string, TrackPlayState>();
  /** 現在走査中のトラック (行頭のトラック宣言で切り替わる。`F1,F2` のような複数指定を保持) */
  private currentTrackNames: string[] = ['P1'];
  private readonly isReverseOctave: boolean;

  constructor(isReverseOctave = false) {
    this.isReverseOctave = isReverseOctave;
  }

  /** 現在のトラック名 (複数指定時は最後のトラック) */
  get currentTrackName(): string {
    return this.currentTrackNames[this.currentTrackNames.length - 1];
  }

  /** 1 行分の MML を走査して状態を更新する */
  feedLine(line: string): void {
    const content = stripLineComment(line);
    if (isMacroDefinitionLine(content)) return;

    const spec = detectTrackSpecAtLineStart(content);
    if (spec) {
      this.currentTrackNames = spec.trackNames;
    }
    const body = spec ? content.slice(spec.contentStart) : content;

    // 複数トラック指定 (`F1,F2`) 時は全指定トラックへ同一コマンドが適用される (正式パーサ準拠)
    for (const name of this.currentTrackNames) {
      this.applyCommands(body, this.getOrCreateState(name), name);
    }
  }

  /** 現在のトラックの演奏状態をキャレットコンテキストとして取得する */
  getSnapshot(): MmlCaretContext {
    const trackName = this.currentTrackName;
    return {
      trackName,
      engine: resolveEngineFromTrackName(trackName),
      ...this.getOrCreateState(trackName),
    };
  }

  /** 指定トラックの状態を取得する (未出現ならデフォルト値で初期化) */
  private getOrCreateState(trackName: string): TrackPlayState {
    let state = this.trackStates.get(trackName);
    if (!state) {
      state = createDefaultTrackState();
      this.trackStates.set(trackName, state);
    }
    return state;
  }

  /** テキスト中の状態変更コマンドを順に適用する */
  private applyCommands(text: string, state: TrackPlayState, trackName: string): void {
    COMMAND_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COMMAND_PATTERN.exec(text)) !== null) {
      this.applyCommand(match[0], state, trackName);
    }
  }

  /** 1 トークンのコマンドを状態へ適用する */
  private applyCommand(token: string, state: TrackPlayState, trackName: string): void {
    const upper = token.toUpperCase();

    if (upper === '<' || upper === '>') {
      // オクターブ相対移動 (#OCTAVE REVERSE 指定時は方向が反転する)
      const isDown = (upper === '<') !== this.isReverseOctave;
      state.octave = isDown ? Math.max(1, state.octave - 1) : Math.min(8, state.octave + 1);
    } else if (upper.startsWith('@PE') || upper.startsWith('@EP')) {
      state.pitchEnvId = parseOptionalInt(upper.slice(3));
    } else if (upper.startsWith('@VE')) {
      state.volEnvId = parseOptionalInt(upper.slice(3));
    } else if (upper.startsWith('@V')) {
      // @v: FM 専用音量 (0-127、127 = 最大)。即値指定で音量エンベロープ解除 (正式パーサ準拠)
      const v = parseOptionalInt(upper.slice(2));
      if (v !== undefined) {
        state.volEnvId = undefined;
        if (resolveEngineFromTrackName(trackName) === 'fm') {
          state.fmVolume = Math.max(0, Math.min(127, v));
        }
      }
    } else if (upper.startsWith('@WN')) {
      state.noiseType = parseInt(upper.slice(3), 10) === 1 ? 'white' : 'periodic';
    } else if (upper.startsWith('@FM')) {
      this.applyFmToneId(parseOptionalInt(upper.slice(3)), trackName, state);
    } else if (upper.startsWith('@')) {
      this.applyFmToneId(parseOptionalInt(upper.slice(1)), trackName, state);
    } else if (upper.startsWith('O')) {
      const o = parseOptionalInt(upper.slice(1));
      if (o !== undefined) state.octave = o;
    } else if (upper.startsWith('V')) {
      const v = parseOptionalInt(upper.slice(1));
      if (v !== undefined) state.volume = Math.max(0, Math.min(15, v));
    } else if (upper.startsWith('D')) {
      const d = parseOptionalInt(upper.slice(1));
      if (d !== undefined) state.detune = d;
    }
  }

  /**
   * FM 音色指定 (@ / @FM) を適用する。
   * 正式パーサ (`MmlParser.processTone`) 準拠で FM トラック (F1-F8) でのみ有効。
   */
  private applyFmToneId(id: number | undefined, trackName: string, state: TrackPlayState): void {
    if (id === undefined) return;
    if (resolveEngineFromTrackName(trackName) === 'fm') {
      state.voiceId = id;
    }
  }
}

/**
 * MML 文字列とキャレット位置 (1-indexed の行・列) から、その位置での演奏コンテキストを解析する。
 *
 * キャレットより前のテキストを走査し、キャレットが属するトラックの直近コマンド状態を返す。
 * 同一トラックが複数行に分かれていても、また複数トラックが交互に現れても正しく解析できる。
 */
export function parseMmlCaretContext(content: string, lineNumber: number, column: number): MmlCaretContext {
  const lines = content.split(/\r?\n/);

  // キャレット位置 (1-indexed) までのテキストを取得 (最終行は列で切り詰める)
  const targetLines = lines.slice(0, lineNumber);
  if (targetLines.length > 0) {
    const caretLine = targetLines.length - 1;
    targetLines[caretLine] = targetLines[caretLine].slice(0, Math.max(0, column - 1));
  }

  // #OCTAVE REVERSE 判定 (ヘッダーディレクティブ)
  const isReverseOctave = /#OCTAVE\s+REVERSE\b/i.test(content);

  const tracker = new MmlCaretContextTracker(isReverseOctave);
  for (const line of targetLines) {
    tracker.feedLine(line);
  }
  return tracker.getSnapshot();
}
