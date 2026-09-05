/**
 * Z80 サウンドドライバの内蔵コア実行検証。
 * (移植元: tests/MzSound.Player.Tests/Z80DriverMachineTests.cs)
 */
import { describe, expect, it } from 'vitest';
import { beepCounterFor, dcsgPeriodFor } from '../../assembler/Z80Assembler';
import { ChipBank } from '../../chips/ChipBank';
import { SongBuilder } from './SongBuilder';
import { Z80DriverImage } from '../Z80DriverImage';
import { Z80DriverMachine } from '../Z80DriverMachine';

/** マシン + チップを生成してドライバをロードする。 */
function create(
  builder: SongBuilder,
  loop: boolean,
): { machine: Z80DriverMachine; chips: ChipBank } {
  const chips = new ChipBank();
  const machine = new Z80DriverMachine(chips);
  machine.load(Z80DriverImage.defaultDriver, builder.build(), loop);
  return { machine, chips };
}

/** 完了するまでフレームを実行する。 */
function runFrames(machine: Z80DriverMachine, maxFrames: number): void {
  // ブート完了 (STAT_PLAY) を待つ (FM 初期化で 2 フレーム必要な場合がある)
  for (let i = 0; i < 4 && (machine.status & 0x01) === 0; i++) {
    machine.runFrame();
  }

  for (let i = 0; i < maxFrames && !machine.isFinished; i++) {
    machine.runFrame();
  }
}

describe('Z80DriverMachine', () => {
  it('既定ドライバをビルドできる', () => {
    const image = Z80DriverImage.defaultDriver;
    expect(image.binary.length).toBeGreaterThan(0);
    expect(image.musicDataAddress).toBeGreaterThan(Z80DriverImage.LoadAddress);
    expect(image.musicDataAddress).toBeLessThanOrEqual(0xf7ff);
  });

  it('buildExecutableImage が music_data 位置へ MZSD データを埋め込む', () => {
    const image = Z80DriverImage.defaultDriver;
    const musicData = Uint8Array.from([0x4d, 0x5a, 0x53, 0x44]);
    const executable = Z80DriverImage.buildExecutableImage(image, musicData);

    // 先頭はドライババイナリと同一
    expect([...executable.subarray(0, image.binary.length)]).toEqual([...image.binary]);

    // music_data 位置 (絶対アドレス - LoadAddress) に MZSD データが配置される
    const musicDataOffset = image.musicDataAddress - Z80DriverImage.LoadAddress;
    expect([...executable.subarray(musicDataOffset, musicDataOffset + musicData.length)]).toEqual([
      ...musicData,
    ]);
    expect(executable.length).toBe(musicDataOffset + musicData.length);
  });

  it('PSG1 ch0 で NOTE を発音する', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 10, 10), SongBuilder.trackEnd()); // A4 10 フレーム
    const { machine, chips } = create(builder, false);

    runFrames(machine, 2);

    // 1 フレーム目で NOTE が実行され DCSG へ period / attenuation が書き込まれる
    expect(chips.psg1.tonePeriodRegister(0)).toBe(dcsgPeriodFor(69));
    expect(chips.psg1.attenuationRegister(0)).toBe(0); // volume 15 -> att 0
  });

  it('ゲート終了でキーオフする', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 10, 3), SongBuilder.trackEnd());
    const { machine, chips } = create(builder, false);

    runFrames(machine, 2);
    expect(chips.psg1.attenuationRegister(0)).toBe(0);

    runFrames(machine, 4);
    expect(chips.psg1.attenuationRegister(0)).toBe(15); // gate 終了 -> 無音
  });

  it('REST 後にトラックが終了する', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 5, 5), SongBuilder.rest(3), SongBuilder.trackEnd());
    const { machine, chips } = create(builder, false);

    runFrames(machine, 2);
    expect(chips.psg1.attenuationRegister(0)).toBe(0);

    runFrames(machine, 8); // NOTE 5 フレーム + REST 3 フレーム + 終了判定 (9 フレーム目)
    expect(machine.isFinished).toBe(true);
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
    expect(machine.status & 0x01).toBe(0); // 演奏中ビット OFF
  });

  it('BEEP で NOTE を発音する', () => {
    const builder = new SongBuilder();
    builder.addTrack(8, SongBuilder.note(69, 10, 10), SongBuilder.trackEnd());
    const { machine, chips } = create(builder, false);

    runFrames(machine, 2);

    expect(chips.beep.counterValue).toBe(beepCounterFor(69));
    expect(chips.beep.isGateOn).toBe(true);
  });

  it('ノイズトラックは音程ヒント付きで発音する', () => {
    const builder = new SongBuilder();
    builder.addTrack(3, SongBuilder.note(69, 10, 10), SongBuilder.trackEnd()); // N1 = PSG1 noise ch
    const { machine, chips } = create(builder, false);

    runFrames(machine, 2);

    expect(chips.psg1.attenuationRegister(3)).toBe(0);
    expect(chips.psg1.isNoiseWhite).toBe(false); // flags 初期値 0 = periodic
    expect(chips.psg1.noiseRateMode).toBe(2); // A4 の period から hint 2
  });

  it('全体ループ (L) でトラックが巻き戻る', () => {
    const builder = new SongBuilder();
    const noteOffset = builder.addTrack(0, SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    builder.setLoop(0, noteOffset);
    const { machine } = create(builder, true);

    // 十分に回しても終了しない (L ループで先頭に戻り続ける)
    runFrames(machine, 40);
    expect(machine.isFinished).toBe(false);
    expect(machine.status & 0x01).toBe(1); // 演奏中のまま

    // 演奏位置ハイライト用 ptr がループ内 (トラック先頭〜TRACK_END) に復帰している
    expect(machine.getTrackOffset(0)).toBeGreaterThanOrEqual(noteOffset);
    expect(machine.getTrackOffset(0)).toBeLessThanOrEqual(noteOffset + 6);
  });

  it('ネストループを抜けて終了する', () => {
    // NOTE(3f) [NOTE(2f) LOOP_END 2] REST(2) TRACK_END
    const builder = new SongBuilder();
    builder.addTrack(
      0,
      SongBuilder.note(69, 3, 3),
      SongBuilder.loopStart(),
      SongBuilder.note(72, 2, 2),
      SongBuilder.loopEnd(2),
      SongBuilder.rest(2),
      SongBuilder.trackEnd(),
    );
    const { machine, chips } = create(builder, false);

    runFrames(machine, 30);
    expect(machine.isFinished).toBe(true);

    // 次回発音待ちではなく終了状態であること (ネストループが正しく抜けた)
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });

  it('VOLUME コマンドで減衰量が変わる', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.volume(8), SongBuilder.note(69, 5, 5), SongBuilder.trackEnd());
    const { machine, chips } = create(builder, false);

    runFrames(machine, 2);
    expect(chips.psg1.attenuationRegister(0)).toBe(15 - 8);
  });

  it('FM トラックが演奏され曲も終了する', () => {
    const builder = new SongBuilder();
    builder.addTrack(0, SongBuilder.note(69, 4, 4), SongBuilder.trackEnd());
    builder.addTrack(9, SongBuilder.note(60, 8, 8), SongBuilder.trackEnd()); // FM トラック
    const { machine, chips } = create(builder, false);

    runFrames(machine, 20);
    expect(machine.isFinished).toBe(true);
    // track 0 (PSG) は影響を受けない
    expect(chips.psg1.tonePeriodRegister(0)).toBe(dcsgPeriodFor(69));
    // track 9 (FM ch0) の KC/KF が YM2151 に出力されている
    const kc = chips.fm.tryGetRegister(0x28);
    expect(kc).not.toBeNull();
    expect(kc?.value).not.toBe(0);
  });

  it('演奏位置ハイライト用のトラックオフセットを更新する', () => {
    const builder = new SongBuilder();
    const trackOffset = builder.addTrack(
      0,
      SongBuilder.note(69, 6, 6),
      SongBuilder.note(72, 6, 6),
      SongBuilder.trackEnd(),
    );
    const { machine } = create(builder, false);

    runFrames(machine, 2);
    const offset = machine.getTrackOffset(0);
    expect(offset).toBeGreaterThanOrEqual(trackOffset);
    expect(offset).toBeLessThanOrEqual(trackOffset + 20);
  });
});
