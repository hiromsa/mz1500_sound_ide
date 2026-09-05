/**
 * MzsdSong (MZSD バイナリ解析) のテスト。
 * (移植元: tests/MzSound.Player.Tests/MzsdSequencerTests.cs — Parse_ReadsHeaderAndTrackTable)
 */
import { describe, expect, it } from 'vitest';
import { MzsdSong } from '../MzsdSong';
import { SongBuilder } from './SongBuilder';

describe('MzsdSong.parse', () => {
  it('reads the header and the track table', () => {
    const builder = new SongBuilder();
    const offset = builder.addTrack(0, SongBuilder.trackEnd());
    builder.setLoop(0, offset);
    const data = builder.build(36);

    const song = MzsdSong.parse(data);

    expect(song.initialQuarterFrames).toBe(36);
    expect(song.trackDataOffset(0)).toBe(offset);
    expect(song.trackLoopOffset(0)).toBe(offset);
    expect(song.hasWholeLoop).toBe(true);
    expect(song.trackDataOffset(1)).toBe(0);
  });

  it('rejects short data and a wrong magic', () => {
    expect(() => MzsdSong.parse(new Uint8Array(10))).toThrow();

    const data = new SongBuilder().build();
    data[0] = 0x58; // 'X'
    expect(() => MzsdSong.parse(data)).toThrow();
  });

  it('reads the envelope tables and the FM tone table', () => {
    const builder = new SongBuilder();
    builder.addVolumeEnvelope([15, 10, 5], 1, 2);
    builder.addPitchEnvelope([0, 64, -32], 1);
    builder.addFmTone([4, 3]);
    builder.addTrack(0, SongBuilder.trackEnd());

    const song = MzsdSong.parse(builder.build());

    expect(song.volumeEnvelopes.length).toBe(1);
    expect([...song.volumeEnvelopes[0].values]).toEqual([15, 10, 5]);
    expect(song.volumeEnvelopes[0].loopIndex).toBe(1);
    expect(song.volumeEnvelopes[0].releaseIndex).toBe(2);

    expect(song.pitchEnvelopes.length).toBe(1);
    expect([...song.pitchEnvelopes[0].values]).toEqual([0, 64, -32]);
    expect(song.pitchEnvelopes[0].loopIndex).toBe(1);

    expect(song.fmTones.length).toBe(1);
    expect(song.fmTones[0].parameters[0]).toBe(4);
    expect(song.fmTones[0].parameters[1]).toBe(3);
    expect(song.fmTones[0].parameters.length).toBe(46);
  });
});
