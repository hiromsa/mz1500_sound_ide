/**
 * MzsdSequencer (17ch 60Hz シーケンサ) のテスト。
 * (移植元: tests/MzSound.Player.Tests/MzsdSequencerTests.cs — MzsdSequencerTests + FmSequencerTests。
 *  DcsgChipTests / Ym2151_ProducesOutputAfterKeyOn は Phase 2 で chips 側へ移植済み)
 */
import { describe, expect, it } from 'vitest';
import { ChipBank } from '../../chips/ChipBank';
import { MzsdSequencer } from '../MzsdSequencer';
import { MzsdSong } from '../MzsdSong';
import { SongBuilder } from './SongBuilder';

function createSequencer(data: Uint8Array, loop: boolean): MzsdSequencer {
  return new MzsdSequencer(MzsdSong.parse(data), new ChipBank(), loop);
}

describe('MzsdSequencer', () => {
  it('writes the tone period and the attenuation on a note', () => {
    // A4 = 440Hz → period = round(3579545 / 32 / 440) - 1 = 253
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 10, 7), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick();

    expect(chips.psg1.tonePeriodRegister(0)).toBe(253);
    expect(chips.psg1.attenuationRegister(0)).toBe(0); // 初期音量 v15 → 減衰 0
  });

  it('turns a note off after the gate frames', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 10, 3), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick(); // NOTE 開始
    sequencer.tick();
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    sequencer.tick(); // 3 フレーム目 → ゲート終端でキーオフ
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });

  it('sets the attenuation with the volume command', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.volume(10), SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick(); // VOLUME
    expect(chips.psg1.attenuationRegister(0)).toBe(5);

    sequencer.tick(); // NOTE
    expect(chips.psg1.attenuationRegister(0)).toBe(5);
  });

  it('writes the beep counter and gate on a note', () => {
    // A4 = 440Hz → counter = round(894886.25 / 440) = 2034
    const builder = new SongBuilder();
    builder.addTrack(8, SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick();

    expect(chips.beep.counterValue).toBe(2034);
    expect(chips.beep.isGateOn).toBe(true);
  });

  it('keys the channel off on a rest', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 8, 8), SongBuilder.rest(4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick(); // NOTE
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    for (let i = 0; i < 7; i++) {
      sequencer.tick();
    }

    // NOTE の len/gate 8 フレーム経過 → キーオフ
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });

  it('restarts the track at the loop offset when the loop is enabled', () => {
    const builder = new SongBuilder();
    const start = builder.addTrack(0, SongBuilder.note(69, 2, 2), SongBuilder.trackEnd());
    builder.setLoop(0, start);
    const sequencer = createSequencer(builder.build(), true);

    for (let i = 0; i < 10; i++) {
      sequencer.tick();
    }

    expect(sequencer.isFinished).toBe(false); // L ループで演奏が継続する
  });

  it('finishes at the track end when the loop is disabled', () => {
    const builder = new SongBuilder();
    const start = builder.addTrack(0, SongBuilder.note(69, 2, 2), SongBuilder.trackEnd());
    builder.setLoop(0, start);
    const sequencer = createSequencer(builder.build(), false);

    for (let i = 0; i < 10; i++) {
      sequencer.tick();
    }

    expect(sequencer.isFinished).toBe(true);
  });

  it('lets empty tracks not block the loop restart', () => {
    const builder = new SongBuilder();
    const start = builder.addTrack(0, SongBuilder.note(69, 2, 2), SongBuilder.trackEnd());
    builder.setLoop(0, start);
    // トラック 1 以降はデータなし (offset 0)
    const sequencer = createSequencer(builder.build(), true);

    for (let i = 0; i < 20; i++) {
      sequencer.tick();
    }

    expect(sequencer.isFinished).toBe(false);
    expect(sequencer.tracks[1].isEnded).toBe(true);
  });
});

describe('FM sequencer', () => {
  it('writes KC, KF and the key on for an FM note', () => {
    // A4 (MIDI 69): C4 から +9 セミトーン → オクターブ 4、ノートコード A = 12 → KC = 0x4C
    const builder = new SongBuilder();
    builder.addTrack(9, SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick();

    expect(chips.fm.tryGetRegister(0x28)?.value).toBe(0x4c);
    expect(chips.fm.tryGetRegister(0x30)?.value).toBe(0);
    // KEYON ($08): channel 0 + slot 4op = 0x78
    expect(chips.fm.tryGetRegister(0x08)?.value).toBe(0x78);
  });

  it('turns the FM key off at the gate end', () => {
    const builder = new SongBuilder();
    builder.addTrack(9, SongBuilder.note(69, 2, 2), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x08)?.value).toBe(0x78);

    sequencer.tick();
    sequencer.tick(); // len/gate 2 フレーム → キーオフ
    expect(chips.fm.tryGetRegister(0x08)?.value).toBe(0x00);
  });

  it('writes the total level for the FM volume', () => {
    // v10 → 減衰 5 → TL = 5 × 8 = 40
    const builder = new SongBuilder();
    builder.addTrack(9, SongBuilder.volume(10), SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x60)?.value).toBe(40);
  });

  it('writes the ALG/FB register for an FM tone', () => {
    // @FM: ALG=4, FB=3 → $20+ch = (PAN both: 3 << 6) | (3 << 3) | 4 = 0xDC
    const builder = new SongBuilder();
    const parameters = new Uint8Array(46);
    parameters[0] = 4;
    parameters[1] = 3;
    const toneIndex = builder.addFmTone(parameters);
    builder.addTrack(9, SongBuilder.tone(toneIndex), SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick(); // TONE
    expect(chips.fm.tryGetRegister(0x20)?.value).toBe(0xdc);

    sequencer.tick(); // NOTE (発音)
  });
});
