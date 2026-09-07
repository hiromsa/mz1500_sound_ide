/**
 * MIDI → MML 変換エンジン。
 *
 * `@tonejs/midi` で解析した Standard MIDI File (Format 0 / 1) を
 * MZ-1500 向け MML (P1-P6 / N1-N2 / B1 / F1-F8 / W1-W99 トラック) へ変換する
 * 純粋ロジック (UI 非依存)。MidiRouterModal から使用する。
 *
 * 変換の単位:
 * - 1 つの MIDI トラック = 1 つの MidiTrackSummary (mono / poly 判定つき)
 * - poly トラックは `extractVoice` で Top / Middle / Bottom の単音列へ分解可能
 * - `AssignedPart` (出力先トラック + ノート列) のリストから MML 文字列を生成する
 * - 拍単位 (quarter note = 1 beat) で正規化するためテンポ変化の影響を受けない
 *   (テンポ値自体は先頭のテンポイベントを採用)
 */
import { Midi } from '@tonejs/midi';

/** 変換対象の 1 ノートイベント (拍単位に正規化済み)。 */
export interface MidiNoteEvent {
  /** MIDI ノート番号 (0-127)。 */
  readonly midi: number;
  /** 開始位置 (拍、四分音符 = 1)。 */
  readonly startBeat: number;
  /** 発音長 (拍)。 */
  readonly durationBeats: number;
  /** ベロシティ (0-1)。 */
  readonly velocity: number;
}

/** 解析済みの 1 MIDI トラック分のサマリ。 */
export interface MidiTrackSummary {
  readonly trackIndex: number;
  readonly name: string;
  /** MIDI チャンネル (0-15)。 */
  readonly channel: number;
  /** ドラムパート (チャンネル 10 = index 9) かどうか。 */
  readonly isPercussion: boolean;
  /** 同時発音数 1 (単音) / 2 以上 (和音)。 */
  readonly type: 'mono' | 'poly';
  /** 最大同時発音数。 */
  readonly maxPolyphony: number;
  readonly noteCount: number;
  readonly lowestNote: number;
  readonly highestNote: number;
  readonly notes: readonly MidiNoteEvent[];
}

/** MIDI ファイル全体の解析結果。 */
export interface MidiParseSummary {
  readonly fileName: string;
  /** 先頭テンポイベントの BPM (30-255 にクランプ済み)。 */
  readonly bpm: number;
  /** 曲の全長 (拍)。 */
  readonly durationBeats: number;
  readonly tracks: readonly MidiTrackSummary[];
}

const MIN_BPM = 30;
const MAX_BPM = 255;

/** MML で表現可能なノート番号の範囲 (o0 c 〜 o10 b)。 */
const MIN_NOTE = 12;
const MAX_NOTE = 131;

const clampBpm = (bpm: number): number => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

const clampNote = (note: number): number => Math.min(MAX_NOTE, Math.max(MIN_NOTE, Math.round(note)));

/** MIDI ノート番号を MML 音名 (シャープ表記) へ変換する。 */
export function midiNoteToMmlName(note: number): string {
  const letters = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  return letters[((clampNote(note) % 12) + 12) % 12];
}

/** 同時発音数の最大値をイベントスイープで求める (note off を先に数える)。 */
function computeMaxPolyphony(notes: readonly MidiNoteEvent[]): number {
  const events = notes.flatMap((note) => [
    { beat: note.startBeat, delta: 1 },
    { beat: note.startBeat + note.durationBeats, delta: -1 },
  ]);
  events.sort((a, b) => a.beat - b.beat || a.delta - b.delta);

  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    max = Math.max(max, current);
  }

  return max;
}

/**
 * MIDI ファイル (SMF Format 0 / 1) を解析してサマリを返す。
 * ノート時刻は ticks / ppq で拍単位へ正規化する (テンポ変化に依存しない)。
 * ノートを 1 つも含まないトラックは除外する。
 */
export function parseMidiFile(
  fileName: string,
  data: ArrayBuffer | ArrayLike<number>,
): MidiParseSummary {
  const midi = new Midi(data);
  const ppq = midi.header.ppq;
  const tempos = midi.header.tempos;
  const bpm = clampBpm(tempos.length > 0 ? tempos[0].bpm : 120);

  const tracks: MidiTrackSummary[] = [];
  midi.tracks.forEach((track) => {
    if (track.notes.length === 0) {
      return;
    }

    const notes: MidiNoteEvent[] = track.notes.map((note) => ({
      midi: note.midi,
      startBeat: note.ticks / ppq,
      durationBeats: note.durationTicks / ppq,
      velocity: note.velocity,
    }));

    const maxPolyphony = computeMaxPolyphony(notes);
    const midiNotes = notes.map((note) => note.midi);
    tracks.push({
      trackIndex: tracks.length,
      name: track.name.length > 0 ? track.name : `Track ${tracks.length + 1}`,
      channel: track.channel,
      isPercussion: track.channel === 9,
      type: maxPolyphony > 1 ? 'poly' : 'mono',
      maxPolyphony,
      noteCount: notes.length,
      lowestNote: Math.min(...midiNotes),
      highestNote: Math.max(...midiNotes),
      notes,
    });
  });

  return {
    fileName,
    bpm,
    durationBeats: midi.durationTicks / ppq,
    tracks,
  };
}

/** poly トラックのボイス抽出種別 (Top = 最高音 / Middle = 中央 / Bottom = 最低音)。 */
export type VoicePart = 'top' | 'middle' | 'bottom';

/**
 * 和音トラックから指定ボイスの単音列を抽出する。
 * 開始拍が重なるノートを同一グループとみなし、グループごとに音高順で
 * top = 最高音 / bottom = 最低音 / middle = 中央 (奇数以外は低め) を選ぶ。
 */
export function extractVoice(notes: readonly MidiNoteEvent[], part: VoicePart): MidiNoteEvent[] {
  if (notes.length === 0) {
    return [];
  }

  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const groups: MidiNoteEvent[][] = [];
  let currentGroup: MidiNoteEvent[] = [];
  let groupEndBeat = -1;

  for (const note of sorted) {
    if (currentGroup.length > 0 && note.startBeat >= groupEndBeat) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push(note);
    groupEndBeat = Math.max(groupEndBeat, note.startBeat + note.durationBeats);
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  const picked: MidiNoteEvent[] = [];
  for (const group of groups) {
    const byPitch = [...group].sort((a, b) => a.midi - b.midi);
    const index = part === 'top'
      ? byPitch.length - 1
      : part === 'bottom'
      ? 0
      : Math.floor((byPitch.length - 1) / 2);
    picked.push(byPitch[index]);
  }

  return picked;
}

/**
 * 発音長 (拍) を最も近い MML 音長テキスト (音長 + 付点最大2個) へ量子化する。
 * 最小は 32 分音符の付点 (0.1875 拍)。
 */
export function quantizeNoteLength(durationBeats: number): { text: string; beats: number } {
  const candidates: ReadonlyArray<{ beats: number; text: string }> = [
    { beats: 4, text: '1' },
    { beats: 6, text: '1.' },
    { beats: 7, text: '1..' },
    { beats: 2, text: '2' },
    { beats: 3, text: '2.' },
    { beats: 3.5, text: '2..' },
    { beats: 1, text: '4' },
    { beats: 1.5, text: '4.' },
    { beats: 1.75, text: '4..' },
    { beats: 0.5, text: '8' },
    { beats: 0.75, text: '8.' },
    { beats: 0.875, text: '8..' },
    { beats: 0.25, text: '16' },
    { beats: 0.375, text: '16.' },
    { beats: 0.4375, text: '16..' },
    { beats: 0.125, text: '32' },
    { beats: 0.1875, text: '32.' },
  ];

  const value = Math.max(0, durationBeats);
  let best = candidates[candidates.length - 1];
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const diff = Math.abs(candidate.beats - value);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }

  return { text: best.text, beats: best.beats };
}

/** 量子化の最小単位 (32 分音符)。 */
const QUANTIZE_BEAT = 0.125;

/** 量子化を考慮した最小休符長 (これ未満の隙間は無視する)。 */
const MIN_REST_BEAT = 0.25;

/**
 * ノート列を 1 トラック分の MML ボディ (o / 音符 / 休符) へ変換する。
 * - 開始拍は 32 分音符グリッドへスナップ
 * - 量子化最小単位以上の隙間は休符 (`r`) で埋める
 * - オクターブが変わるタイミングでのみ `o` コマンドを出力
 */
export function convertNotesToMmlBody(notes: readonly MidiNoteEvent[]): string {
  if (notes.length === 0) {
    return '';
  }

  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  const snap = (beat: number): number => Math.round(beat / QUANTIZE_BEAT) * QUANTIZE_BEAT;

  let cursor = 0;
  let lastOctave = -1;
  let out = '';

  for (const note of sorted) {
    const startBeat = snap(note.startBeat);
    const restBeats = startBeat - cursor;
    if (restBeats >= MIN_REST_BEAT) {
      const rest = quantizeNoteLength(restBeats);
      out += `r${rest.text} `;
      cursor += rest.beats;
    } else if (restBeats > 0) {
      cursor = startBeat;
    }

    const noteNumber = clampNote(note.midi);
    const octave = Math.floor(noteNumber / 12) - 1;
    if (octave !== lastOctave) {
      out += `o${octave} `;
      lastOctave = octave;
    }

    const length = quantizeNoteLength(Math.max(QUANTIZE_BEAT, snap(note.durationBeats)));
    out += `${midiNoteToMmlName(noteNumber)}${length.text} `;
    cursor = Math.max(cursor, startBeat + length.beats);
  }

  return out.trim();
}

/** MML 出力の 1 パート (出力先トラック + ボイス分解済みノート列)。 */
export interface AssignedPart {
  /** 出力先トラック名 (`P1` / `N1` / `W1` 等)。 */
  readonly targetTrack: string;
  /** 元 MIDI トラックの表示ラベル (コメント用)。 */
  readonly sourceLabel: string;
  /** 出力するノート列 (ボイス分解済み)。 */
  readonly notes: readonly MidiNoteEvent[];
  /** パート代表音量 (0-1 のベロシティ平均など)。 */
  readonly velocity: number;
}

const velocityToMmlVolume = (velocity: number): number =>
  Math.min(15, Math.max(1, Math.round(velocity * 15)));

/**
 * 割り当て済みパート群から MML 文字列を生成する。
 * - 実機トラック (P/F/N/B) を先に、ワークトラック (W1-W99) を後にグループ化
 * - テンポ (`t`) は最初の実機トラック行にのみ出力 (ドライバで全体テンポとして扱う)
 * - トラック行の書式: `P1  t120 v12 q7 l16 o4 c8 d8 ...  ; from <元トラック名>`
 */
export function generateMml(
  meta: { readonly fileName: string; readonly bpm: number },
  parts: readonly AssignedPart[],
): string {
  const bpm = clampBpm(meta.bpm);
  const hardware = parts.filter((part) => !part.targetTrack.startsWith('W'));
  const work = parts.filter((part) => part.targetTrack.startsWith('W'));

  const routingSummary = parts.map((part) => `${part.sourceLabel}→${part.targetTrack}`).join(',');

  const lines: string[] = [];
  lines.push('; ==============================================================================');
  lines.push('; MZ-1500 MML Generated by MIDI Routing Studio');
  lines.push(`; Source: ${meta.fileName} (${bpm} BPM)`);
  lines.push(`; @router_metadata: {"file":"${meta.fileName}","bpm":${bpm},"routes":"${routingSummary}"}`);
  lines.push('; ==============================================================================');
  lines.push('');

  lines.push('; --- [MZ-1500 HARDWARE TRACKS] ---');
  let first = true;
  for (const part of hardware) {
    if (part.notes.length === 0) {
      continue;
    }

    const body = convertNotesToMmlBody(part.notes);
    const tempoPrefix = first ? `t${bpm} ` : '';
    const volume = velocityToMmlVolume(part.velocity);
    lines.push(`${part.targetTrack}  ${tempoPrefix}v${volume} q7 l16 ${body}  ; from ${part.sourceLabel}`);
    first = false;
  }

  if (work.length > 0) {
    lines.push('');
    lines.push('; --- [WORK TRACKS (作業用・MML TRANSFORM で後から実機へ配分可能)] ---');
    lines.push('; 文法は PSG 準拠。実機演奏・エクスポート時は自動的にスキップされます。');
    for (const part of work) {
      if (part.notes.length === 0) {
        continue;
      }

      const body = convertNotesToMmlBody(part.notes);
      const volume = velocityToMmlVolume(part.velocity);
      lines.push(`${part.targetTrack}  v${volume} q7 l16 ${body}  ; from ${part.sourceLabel}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/** 自動ルーティングの結果 (MIDI トラックごとの割り当て先)。 */
export type RoutingSlot = string;

/**
 * MIDI トラック群を実機スロットへ自動割り当てする。
 * - ドラムパート (チャンネル 10) → `N1`, `N2`
 * - 最初の和音トラック → `SPLIT(3)` (3 ボイスへ分割、既定 P2/P3/P4 相当)
 * - 単音トラック → `P1`, `P5`, `P6` (P2-P4 はスプリット用に予約) → FM 有効時は `F1`-`F8`
 * - 実機に収まらない分 → `W1`-`W4` → それでも溢れたら `Unassigned`
 * - `fmFirst` = true の場合は FM スロットを DCSG 残りより優先して割り当てる
 */
export function autoAssignRouting(
  tracks: ReadonlyArray<{ readonly isPercussion: boolean; readonly type: 'mono' | 'poly' }>,
  enableFm: boolean,
  fmFirst = false,
): readonly RoutingSlot[] {
  const monoQueue = ['P1', 'P5', 'P6'];
  const fmQueue = enableFm ? ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'] : [];
  const noiseQueue = ['N1', 'N2'];
  const workQueue = ['W1', 'W2', 'W3', 'W4'];
  let firstPolyAssigned = false;

  const takeNext = (): RoutingSlot =>
    fmFirst
      ? fmQueue.shift() ?? monoQueue.shift() ?? workQueue.shift() ?? 'Unassigned'
      : monoQueue.shift() ?? fmQueue.shift() ?? workQueue.shift() ?? 'Unassigned';

  return tracks.map((track) => {
    if (track.isPercussion) {
      return noiseQueue.shift() ?? workQueue.shift() ?? 'Unassigned';
    }

    if (track.type === 'poly') {
      if (!firstPolyAssigned) {
        firstPolyAssigned = true;
        return 'SPLIT(3)';
      }

      return fmQueue.shift() ?? workQueue.shift() ?? 'Unassigned';
    }

    return takeNext();
  });
}