/**
 * MIDI トラックの GM 試聴再生 (smplr SoundFont)。
 *
 * MIDI ROUTING STUDIO のテスト再生ボタンから使用する。
 * - 音源は General MIDI SoundFont (`acoustic_grand_piano` / パーカッションは `synth_drum`)
 * - SoundFont データはネットワークから取得するため、オフライン / CDN 障害時は
 *   `callbacks.onError` でエラーを通知する (ロードはブラウザ Cache API でキャッシュされる)
 * - 再生は AudioContext 時間基準でノート列をプリスケジュールし、
 *   トラック末尾の到達で `onFinished` を呼ぶ (ループなし・`stop()` で即停止)
 */
import { Soundfont, type Smplr } from 'smplr';
import type { MidiNoteEvent } from './midiToMmlConverter';

/** 旋律トラック用の GM 楽器。 */
const MELODY_INSTRUMENT = 'acoustic_grand_piano';
/** パーカッション (ch10) トラック用の GM 楽器 (音程付きドラム音でリズムを確認できる)。 */
const PERCUSSION_INSTRUMENT = 'synth_drum';

const MIN_BPM = 30;
const MAX_BPM = 255;
/** MML で表現可能なノート番号の範囲 (o0 c 〜 o10 b)。 */
const MIN_NOTE = 12;
const MAX_NOTE = 131;
const MIN_DURATION_SEC = 0.05;
/** 再生開始までの遅延 (秒)。スケジューリングの時間ずれを吸収する。 */
const START_DELAY_SEC = 0.15;

/** 展開済みの 1 ノート分のスケジュール (再生開始からの相対秒)。 */
export interface PreviewScheduleEvent {
  /** MIDI ノート番号 (12-131 にクランプ済み)。 */
  readonly note: number;
  /** 開始時刻 (秒)。 */
  readonly time: number;
  /** 発音長 (秒)。 */
  readonly duration: number;
  /** ベロシティ (1-127)。 */
  readonly velocity: number;
}

/** 試聴する 1 パート (ノート列と音源種別)。 */
export interface MidiPreviewPart {
  readonly notes: readonly MidiNoteEvent[];
  /** パーカッション (ch10) トラックかどうか (GM 楽器を切り替える)。 */
  readonly isPercussion: boolean;
}

/** パート別に展開した試聴スケジュール。 */
export interface MultiPartPreviewSchedule {
  /** 旋律楽器 (acoustic_grand_piano) で鳴らすノート列。 */
  readonly melody: PreviewScheduleEvent[];
  /** パーカッション楽器 (synth_drum) で鳴らすノート列。 */
  readonly percussion: PreviewScheduleEvent[];
  /** 全ノートのうち最も遅い終了時刻 (秒)。 */
  readonly totalDurationSec: number;
}

/**
 * ノート列 (拍単位) を再生スケジュール (秒単位) へ展開する。
 * 開始拍順にソートし、BPM を 30-255 にクランプ、ノート番号は 12-131、
 * ベロシティ (0-1) は 1-127 へ変換する。
 */
export function buildPreviewSchedule(
  notes: readonly MidiNoteEvent[],
  bpm: number,
): PreviewScheduleEvent[] {
  const safeBpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
  const secondsPerBeat = 60 / safeBpm;

  return [...notes]
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
    .map((note) => ({
      note: Math.min(MAX_NOTE, Math.max(MIN_NOTE, Math.round(note.midi))),
      time: Math.max(0, note.startBeat) * secondsPerBeat,
      duration: Math.max(MIN_DURATION_SEC, Math.max(0, note.durationBeats) * secondsPerBeat),
      velocity: Math.min(127, Math.max(1, Math.round(note.velocity * 127))),
    }));
}

/**
 * 複数パートのノート列を、旋律 / パーカッションの 2 系統に分離した
 * 再生スケジュールへ展開する (全パート試聴用)。
 */
export function buildMultiPartSchedule(
  parts: readonly MidiPreviewPart[],
  bpm: number,
): MultiPartPreviewSchedule {
  const safeBpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

  const melody: PreviewScheduleEvent[] = [];
  const percussion: PreviewScheduleEvent[] = [];
  let totalDurationSec = 0;

  for (const part of parts) {
    const events = buildPreviewSchedule(part.notes, safeBpm);
    if (events.length === 0) {
      continue;
    }

    if (part.isPercussion) {
      percussion.push(...events);
    } else {
      melody.push(...events);
    }

    const last = events[events.length - 1];
    totalDurationSec = Math.max(totalDurationSec, last.time + last.duration);
  }

  return { melody, percussion, totalDurationSec };
}

/** 試聴再生のコールバック。 */
export interface MidiPreviewCallbacks {
  /** SoundFont のロード失敗などのエラー通知 (メッセージはそのまま UI 表示に使える)。 */
  onError(message: string): void;
  /** トラック末尾まで再生が完了したときの通知。 */
  onFinished(): void;
}

const SOUND_FONT_ERROR_MESSAGE =
  'GM SoundFont のロードに失敗しました。ネットワーク接続を確認してください。';

type SoundfontInstrument = ReturnType<typeof Soundfont>;

/**
 * MIDI トラック 1 本分の GM 試聴プレイヤー。
 * `play()` を呼ぶと AudioContext を遅延生成し、smplr SoundFont の
 * ロード完了後にノート列をプリスケジュールする。`stop()` で即停止。
 */
export class MidiPreviewPlayer {
  private context: AudioContext | null = null;
  private melodyInstrument: SoundfontInstrument | null = null;
  private percussionInstrument: SoundfontInstrument | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  /** スケジュール済みノートの停止関数 (smplr `start()` の戻り値)。 */
  private activeStopFns: ReadonlyArray<() => void> = [];
  /** 再生要求の世代 (stop() で進め、await 後の古い再生を無効化する)。 */
  private playGeneration = 0;
  private disposed = false;

  /**
   * 複数パートを GM SoundFont で試聴再生する。
   * 旋律パートは `acoustic_grand_piano`、パーカッションパートは `synth_drum` で鳴らす。
   * @param parts 再生するパート群 (ノート列は拍単位)
   * @param bpm 再生テンポ
   */
  async playParts(
    parts: readonly MidiPreviewPart[],
    bpm: number,
    callbacks: MidiPreviewCallbacks,
  ): Promise<void> {
    this.stop();
    const generation = ++this.playGeneration;
    if (this.disposed || parts.length === 0) {
      callbacks.onFinished();
      return;
    }

    try {
      const context = this.ensureContext();
      const schedule = buildMultiPartSchedule(parts, bpm);
      if (schedule.melody.length === 0 && schedule.percussion.length === 0) {
        callbacks.onFinished();
        return;
      }

      // SoundFont のロード (既にロード済みなら即解決)。待ちの間に stop されたら中止。
      const melody = schedule.melody.length > 0 ? await this.ensureInstrument(false) : null;
      if (generation !== this.playGeneration) {
        return;
      }

      const percussion = schedule.percussion.length > 0 ? await this.ensureInstrument(true) : null;
      if (generation !== this.playGeneration) {
        return;
      }

      const startTime = context.currentTime + START_DELAY_SEC;
      // smplr の `stop()` は発音中の voice しか止めないため、
      // `start()` の戻り値 (スケジュールキャンセル + voice 停止) を保持して
      // `stop()` 時に全呼び出しすることで未来のノートも確実に止める。
      const stopFns: Array<() => void> = [];
      for (const event of schedule.melody) {
        stopFns.push(
          melody!.start({
            note: event.note,
            time: startTime + event.time,
            duration: event.duration,
            velocity: event.velocity,
          }),
        );
      }

      for (const event of schedule.percussion) {
        stopFns.push(
          percussion!.start({
            note: event.note,
            time: startTime + event.time,
            duration: event.duration,
            velocity: event.velocity,
          }),
        );
      }

      if (generation !== this.playGeneration) {
        for (const stopFn of stopFns) {
          stopFn();
        }

        return;
      }

      this.activeStopFns = stopFns;
      const totalSeconds = START_DELAY_SEC + schedule.totalDurationSec + 0.25;
      this.endTimer = setTimeout(() => {
        this.endTimer = null;
        callbacks.onFinished();
      }, totalSeconds * 1000);
    } catch {
      // SoundFont 取得失敗 (オフライン / CDN 障害) などを UI へ通知する
      if (generation === this.playGeneration) {
        callbacks.onError(SOUND_FONT_ERROR_MESSAGE);
      }
    }
  }

  /** 再生を即停止する (スケジュール済みの未来ノートも含めて止める)。 */
  stop(): void {
    this.playGeneration++;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }

    for (const stopFn of this.activeStopFns) {
      stopFn();
    }

    this.activeStopFns = [];
    this.melodyInstrument?.stop();
    this.percussionInstrument?.stop();
  }

  /** プレイヤーを破棄する (インスタンスの再利用は不可)。 */
  dispose(): void {
    this.stop();
    this.disposed = true;
    this.melodyInstrument?.dispose();
    this.percussionInstrument?.dispose();
    this.melodyInstrument = null;
    this.percussionInstrument = null;
    void this.context?.close();
    this.context = null;
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      const AudioContextConstructor =
        window.AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new AudioContextConstructor();
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }

    return this.context;
  }

  /** 楽器インスタンスを遅延生成し、SoundFont のロード完了を待つ。 */
  private async ensureInstrument(isPercussion: boolean): Promise<Smplr> {
    const existing = isPercussion ? this.percussionInstrument : this.melodyInstrument;
    if (existing !== null) {
      await existing.ready;
      return existing;
    }

    const context = this.ensureContext();
    const instrument: Smplr = Soundfont(context, {
      instrument: isPercussion ? PERCUSSION_INSTRUMENT : MELODY_INSTRUMENT,
    });

    if (isPercussion) {
      this.percussionInstrument = instrument;
    } else {
      this.melodyInstrument = instrument;
    }

    await instrument.ready;
    return instrument;
  }
}