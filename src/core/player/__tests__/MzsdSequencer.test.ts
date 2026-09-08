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

    sequencer.tick(); // NOTE 開始 (開始フレーム自体が 1 発音フレーム)
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    sequencer.tick();
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    sequencer.tick(); // 3 フレーム目 = ゲート指定の最終発音フレーム
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    sequencer.tick(); // 4 フレーム目 → ゲート終端でキーオフ
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });

  it('sounds a gate=1 note for exactly one frame', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 10, 1), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick(); // NOTE 開始フレームが唯一の発音フレーム
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    sequencer.tick(); // ゲート終端でキーオフ
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });

  it('keeps sounding across consecutive notes when the gate equals the length', () => {
    const builder = new SongBuilder();
    builder.addTrack(
      0,
      SongBuilder.note(69, 15, 15),
      SongBuilder.note(69, 15, 15),
      SongBuilder.trackEnd(),
    );
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    // q8 相当 (gate == len): 音符境界に無音フレームが入ってはならない
    for (let frame = 1; frame <= 30; frame++) {
      sequencer.tick();
      expect(chips.psg1.attenuationRegister(0), `frame ${frame}`).toBe(0);
    }

    sequencer.tick(); // 31 フレーム目: トラック終了でキーオフ
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

    // NOTE の 8 フレーム目 (gate == len) まで発音が継続する (無音フレームなし)
    expect(chips.psg1.attenuationRegister(0)).toBe(0);
    sequencer.tick(); // 9 フレーム目 → REST 開始でキーオフ
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

    sequencer.tick(); // NOTE (キーオン)
    expect(chips.fm.tryGetRegister(0x08)?.value).toBe(0x78);

    sequencer.tick(); // 2 フレーム目 (ゲート指定の最終発音フレーム) は発音持続
    expect(chips.fm.tryGetRegister(0x08)?.value).toBe(0x78);

    sequencer.tick(); // 3 フレーム目 → ゲート終端でキーオフ
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

  it('applies the pan command to the RL bits and keeps ALG/FB', () => {
    // p1 (左) → $20+ch = (1 << 6) | (3 << 3) | 4 = 0x5C
    const builder = new SongBuilder();
    const parameters = new Uint8Array(46);
    parameters[0] = 4;
    parameters[1] = 3;
    const toneIndex = builder.addFmTone(parameters);
    builder.addTrack(
      9,
      SongBuilder.tone(toneIndex),
      SongBuilder.pan(1),
      SongBuilder.note(69, 4, 4),
      SongBuilder.trackEnd(),
    );
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    // tick 1 回で TONE / PAN / NOTE まで連続実行され、最後の PAN (左) が最終値になる
    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x20)?.value).toBe(0x5c);
  });

  it('writes the @v total level to all four operators', () => {
    // @v100 → TL = 127 - 100 = 27 を 4 op すべてへ
    const builder = new SongBuilder();
    builder.addTrack(9, SongBuilder.fmVolume(100), SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    sequencer.tick();
    for (let op = 0; op < 4; op++) {
      expect(chips.fm.tryGetRegister(0x60 + (op << 3))?.value).toBe(27);
    }
  });

  it('switches back to the coarse volume when v follows @v', () => {
    // 後勝ち: @v100 (TL=27) の後 v10 → TL = (15-10) × 8 = 40
    const builder = new SongBuilder();
    builder.addTrack(
      9,
      SongBuilder.fmVolume(100),
      SongBuilder.note(69, 2, 2),
      SongBuilder.volume(10),
      SongBuilder.note(69, 2, 2),
      SongBuilder.trackEnd(),
    );
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    // tick 1 回目で FMVOL / NOTE まで実行 → @v100 (TL = 27)
    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x60)?.value).toBe(27);

    // tick 2 回で残りフレームを消費し、3 つ目の tick で VOLUME / NOTE まで実行 → v10 (TL = 40)
    sequencer.tick();
    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x60)?.value).toBe(40);
  });

  it('clears the volume envelope with the @v command', () => {
    // 即値指定 (@v) で音量エンベロープが解除され、TL は @v ベースになる
    const builder = new SongBuilder();
    const venv = builder.addVolumeEnvelope([15, 8, 0], 255, 255);
    builder.addTrack(
      9,
      SongBuilder.venv(venv),
      SongBuilder.note(69, 2, 2),
      SongBuilder.fmVolume(100),
      SongBuilder.note(69, 2, 2),
      SongBuilder.trackEnd(),
    );
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    // tick 1 回目で VENV / NOTE まで実行 → venv 適用中 (venv 値 15 → att 0 → TL = 0)
    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x60)?.value).toBe(0);

    // tick 2 回で残りフレームを消費し、3 つ目の tick で FMVOL / NOTE まで実行 → @v100 (TL = 27)
    sequencer.tick();
    sequencer.tick();
    expect(chips.fm.tryGetRegister(0x60)?.value).toBe(27);
  });

  it('loops the key-on envelope before the release section and plays the release after key off', () => {
    // ユーザー報告の @VE1 = { 15, 14, 13, |, 12, 11, >, 8, 5, 2, 0 }
    // KEY ON 中は 12,11 をループし、リリース区間 (8,5,2,0) はキーオフ後に 1 回だけ再生する
    const builder = new SongBuilder();
    const venv = builder.addVolumeEnvelope([15, 14, 13, 12, 11, 8, 5, 2, 0], 3, 5);
    builder.addTrack(
      0,
      SongBuilder.venv(venv),
      SongBuilder.note(69, 40, 40),
      SongBuilder.rest(10),
      SongBuilder.trackEnd(),
    );
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, false);

    const attenuations: number[] = [];
    // 50 フレーム分を検証 (51 フレーム目以降は TRACK_END キーオフ = C# 準拠のリリース再始動となるため対象外)
    for (let frame = 0; frame < 50; frame++) {
      sequencer.tick();
      attenuations.push(chips.psg1.attenuationRegister(0));
    }

    // KEY ON 中 (1..5 フレーム目): 15,14,13,12,11 (att 0,1,2,3,4)
    expect(attenuations.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    // 6 フレーム目以降は 12 <-> 11 をループ (att 3,4,3,4...) し、リリース区間 (att 7 以上) に入らない
    for (let frame = 5; frame < 40; frame++) {
      expect(attenuations[frame], `frame ${frame + 1}`).toBe(3 + ((frame - 5) % 2));
    }

    // キーオフ後: リリース 8,5,2,0 (att 7,10,13,15) を再生して末尾 (0) でホールド
    // (41 フレーム目にゲート終端キーオフと REST キーオフが同時発生)
    expect(attenuations.slice(40)).toEqual([7, 10, 13, 15, 15, 15, 15, 15, 15, 15]);
  });
});
