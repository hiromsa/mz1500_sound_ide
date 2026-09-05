/**
 * AudioFrameMixer (チップ合成 + 60Hz フレーム駆動 + ミックス + VU) のテスト。
 * (移植元: MzSound.Player/Audio/AudioEngine.cs — MixerProvider.Read / UpdateTrackLevels の契約)
 */
import { describe, expect, it, vi } from 'vitest';
import { AudioFrameMixer } from '../AudioFrameMixer';
import { MzsdSequencer } from '../MzsdSequencer';
import { MzsdSong } from '../MzsdSong';
import { SongBuilder } from './SongBuilder';

function attach(builder: SongBuilder, loop: boolean, mixer: AudioFrameMixer): MzsdSequencer {
  const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), mixer.chips, loop);
  mixer.attachDriver(sequencer);
  return sequencer;
}

describe('AudioFrameMixer', () => {
  it('ticks the sequencer at 60Hz (800 samples per frame at 48kHz)', () => {
    const mixer = new AudioFrameMixer(48000);
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 100, 100), SongBuilder.trackEnd());
    const sequencer = attach(builder, false, mixer);
    const tickSpy = vi.spyOn(sequencer, 'tick');

    mixer.read(new Float32Array(1600 * 2));

    expect(tickSpy).toHaveBeenCalledTimes(2);
  });

  it('mixes psg1 to the left channel only', () => {
    const mixer = new AudioFrameMixer(48000);
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 100, 100), SongBuilder.trackEnd());
    attach(builder, false, mixer);

    const buffer = new Float32Array(800 * 2);
    mixer.read(buffer);

    let leftMax = 0;
    let rightMax = 0;
    for (let i = 0; i < 800; i++) {
      leftMax = Math.max(leftMax, Math.abs(buffer[i * 2]));
      rightMax = Math.max(rightMax, Math.abs(buffer[(i * 2) + 1]));
    }

    expect(leftMax).toBeGreaterThan(0);
    expect(rightMax).toBe(0); // PSG2 / BEEP / FM は無音
  });

  it('reports finished when all tracks end', () => {
    const mixer = new AudioFrameMixer(48000);
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.trackEnd());
    attach(builder, false, mixer);
    const finished = vi.fn();
    mixer.onSequencerFinished = finished;

    mixer.read(new Float32Array(800 * 2));

    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('applies the track gain to the chip channel and the VU level', () => {
    const mixer = new AudioFrameMixer(48000);
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 100, 100), SongBuilder.trackEnd());
    attach(builder, false, mixer);
    mixer.setTrackGain(0, 0.5);

    mixer.read(new Float32Array(800 * 2));

    // VU = volumeGain(0) × チップゲイン 0.5 × トラックゲイン 0.5 = 0.25 (C# 版と同一の二重適用)
    expect(mixer.getTrackLevel(0)).toBeCloseTo(0.25, 9);

    mixer.setTrackGain(0, 0);
    mixer.read(new Float32Array(800 * 2));
    expect(mixer.getTrackLevel(0)).toBe(0);
  });

  it('resets the levels', () => {
    const mixer = new AudioFrameMixer(48000);
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 100, 100), SongBuilder.trackEnd());
    attach(builder, false, mixer);

    mixer.read(new Float32Array(800 * 2));
    expect(mixer.getMasterLevel()).toBeGreaterThan(0);

    mixer.resetLevels();
    expect(mixer.getMasterLevel()).toBe(0);
    expect(mixer.getTrackLevel(0)).toBe(0);
  });
});
