/**
 * MIDI 試聴 (smplr GM SoundFont) のスケジュール生成テスト。
 * (AudioContext に依存する再生部分はブラウザ実行でのみ確認可能なため、
 *  純粋関数 `buildPreviewSchedule` のみを検証する)
 */
import { describe, expect, it } from 'vitest';
import { buildPreviewSchedule } from '../midiPreview';
import type { MidiNoteEvent } from '../midiToMmlConverter';

const note = (midi: number, startBeat: number, durationBeats = 1, velocity = 0.8): MidiNoteEvent => ({
  midi,
  startBeat,
  durationBeats,
  velocity,
});

describe('buildPreviewSchedule', () => {
  it('converts beats to seconds at the given bpm', () => {
    // 120 BPM = 0.5 秒 / 拍
    const schedule = buildPreviewSchedule([note(60, 0, 1, 0.8)], 120);
    expect(schedule).toEqual([
      { note: 60, time: 0, duration: 0.5, velocity: 102 },
    ]);
  });

  it('sorts notes by start beat then midi note', () => {
    const schedule = buildPreviewSchedule(
      [note(64, 1), note(60, 1), note(48, 0)],
      120,
    );
    expect(schedule.map((event) => event.note)).toEqual([48, 60, 64]);
    expect(schedule[1].time).toBe(0.5);
  });

  it('clamps bpm into the 30-255 range', () => {
    // 30 BPM = 2 秒 / 拍
    expect(buildPreviewSchedule([note(60, 1, 1)], 10)[0].time).toBe(2);
    // 255 BPM ≒ 0.235 秒 / 拍
    expect(buildPreviewSchedule([note(60, 1, 1)], 300)[0].time).toBeCloseTo(60 / 255, 6);
  });

  it('clamps notes into the representable mml note range (12-131)', () => {
    const schedule = buildPreviewSchedule([note(5, 0), note(200, 1)], 120);
    expect(schedule[0].note).toBe(12);
    expect(schedule[1].note).toBe(131);
  });

  it('converts velocity (0-1) to 1-127', () => {
    const schedule = buildPreviewSchedule([note(60, 0, 1, 0), note(62, 1, 1, 1.5)], 120);
    expect(schedule[0].velocity).toBe(1);
    expect(schedule[1].velocity).toBe(127);
  });

  it('clamps non-positive durations to the minimum duration', () => {
    const schedule = buildPreviewSchedule([note(60, 0, 0)], 120);
    expect(schedule[0].duration).toBe(0.05);
  });

  it('returns an empty schedule for empty notes', () => {
    expect(buildPreviewSchedule([], 120)).toEqual([]);
  });
});