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
  private disposed = false;

  /**
   * ノート列を試聴再生する。
   * @param notes 再生するノート列 (拍単位)
   * @param bpm 再生テンポ
   * @param isPercussion パーカッション (ch10) トラックかどうか (GM 楽器を切り替える)
   */
  async play(
    notes: readonly MidiNoteEvent[],
    bpm: number,
    isPercussion: boolean,
    callbacks: MidiPreviewCallbacks,
  ): Promise<void> {
    this.stop();
    if (this.disposed || notes.length === 0) {
      callbacks.onFinished();
      return;
    }

    try {
      const context = this.ensureContext();
      const instrument = await this.ensureInstrument(isPercussion);
      const schedule = buildPreviewSchedule(notes, bpm);
      if (schedule.length === 0) {
        callbacks.onFinished();
        return;
      }

      const startTime = context.currentTime + START_DELAY_SEC;
      for (const event of schedule) {
        instrument.start({
          note: event.note,
          time: startTime + event.time,
          duration: event.duration,
          velocity: event.velocity,
        });
      }

      const last = schedule[schedule.length - 1];
      const totalSeconds = START_DELAY_SEC + last.time + last.duration + 0.25;
      this.endTimer = setTimeout(() => {
        this.endTimer = null;
        callbacks.onFinished();
      }, totalSeconds * 1000);
    } catch {
      // SoundFont 取得失敗 (オフライン / CDN 障害) などを UI へ通知する
      callbacks.onError(SOUND_FONT_ERROR_MESSAGE);
    }
  }

  /** 再生を即停止する (未再生 / 完了済みなら何もしない)。 */
  stop(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }

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