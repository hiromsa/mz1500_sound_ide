/**
 * ノイズトラック (N1 / N2) の演奏回帰テスト。
 * ユーザー報告「ノイズサンプルが PLAY で鳴らない」の修正を固定する。
 *
 * 原因: MmlCompiler 側 TrackId の並び (N1=6) が演奏側 (TrackSequencer /
 * mzsd_driver.asm / AudioFrameMixer = N1=3, N2=7) と不一致で、N1 のデータが
 * P6 (trackIndex 6 = psg2 ch2 矩形波) の slot へ書かれ、ノイズチャンネルが
 * 無音のままになっていた。
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../../mml/MmlCompiler';
import { ChipBank } from '../../chips/ChipBank';
import { MzsdSong } from '../MzsdSong';
import { MzsdSequencer } from '../MzsdSequencer';
import { Z80DriverPlayback } from '../Z80DriverPlayback';

/** ユーザー報告のサンプル (samples/mml_reference/psg/psg_noise_basic.mml)。 */
const noiseBasicSource = `#TITLE "PSG Noise Basic"
#OPM OFF
N1 t120 v12 l4 q8
N1 @WN1 c4 e4 g4 > c4
N1 @WN0 o4 c4 e4 g4 > c4
N1 @WN1 o4 cccc
N1 v15 cccc
N1 v8  cccc
N1 v2  cccc
`;

function compileToSong(source: string): Uint8Array {
  const result = new MmlCompiler().compile(source);
  expect(result.success).toBe(true);
  expect(result.musicData).not.toBeNull();
  return result.musicData as Uint8Array;
}

/** 1 エンジン分のノイズ発音観察結果。 */
interface NoiseObservation {
  /** ノイズチャンネル減衰レジスタの最小値 (< 15 なら何らかの音量で発音)。 */
  minAttenuation: number;

  /** 再生中の波形出力の最大絶対値。 */
  maxAbsSample: number;
}

function observeSourceInterpreter(data: Uint8Array, chip: 'psg1' | 'psg2', frames: number): NoiseObservation {
  const chips = new ChipBank();
  const sequencer = new MzsdSequencer(MzsdSong.parse(data), chips, false);
  const channel = 3; // DCSG ノイズチャンネル

  let minAttenuation = 15;
  let maxAbsSample = 0;
  for (let frame = 0; frame < frames && !sequencer.isFinished; frame++) {
    sequencer.tick();

    const att = chips[chip].attenuationRegister(channel);
    if (att < minAttenuation) {
      minAttenuation = att;
    }

    for (let i = 0; i < 800; i++) {
      const sample = Math.abs(chips[chip].renderSample(48000));
      if (sample > maxAbsSample) {
        maxAbsSample = sample;
      }
    }
  }

  return { minAttenuation, maxAbsSample };
}

function observeZ80Driver(data: Uint8Array, chip: 'psg1' | 'psg2', frames: number): NoiseObservation {
  const chips = new ChipBank();
  const playback = new Z80DriverPlayback(chips);
  playback.play(data, false);
  const channel = 3;

  let minAttenuation = 15;
  let maxAbsSample = 0;
  for (let frame = 0; frame < frames && !playback.isFinished; frame++) {
    playback.tick();

    const att = chips[chip].attenuationRegister(channel);
    if (att < minAttenuation) {
      minAttenuation = att;
    }

    for (let i = 0; i < 800; i++) {
      const sample = Math.abs(chips[chip].renderSample(48000));
      if (sample > maxAbsSample) {
        maxAbsSample = sample;
      }
    }
  }

  return { minAttenuation, maxAbsSample };
}

describe('noise track playback (N1 / N2)', () => {
  it('maps N1 to DCSG1 noise slot (3) and keeps the P6 slot empty', () => {
    const data = compileToSong(noiseBasicSource);
    const song = MzsdSong.parse(data);

    // N1 のデータは trackIndex 3 (DCSG1 ノイズ) へ書かれる
    expect(song.trackDataOffset(3)).toBeGreaterThan(0);
    // 修正前は N1 データが P6 (trackIndex 6) へ書かれていた (回帰防止)
    expect(song.trackDataOffset(6)).toBe(0);
  });

  it('maps N2 to DCSG2 noise slot (7)', () => {
    const data = compileToSong('N2 t120 v12 l4 @WN1 o4 cccc');
    const song = MzsdSong.parse(data);

    expect(song.trackDataOffset(7)).toBeGreaterThan(0);
    expect(song.trackDataOffset(3)).toBe(0);
  });

  it('sounds the N1 noise channel with the SourceInterpreter engine', () => {
    const data = compileToSong(noiseBasicSource);
    const observation = observeSourceInterpreter(data, 'psg1', 480);

    expect(observation.minAttenuation).toBeLessThan(15);
    expect(observation.maxAbsSample).toBeGreaterThan(0.01);
  });

  it('sounds the N1 noise channel with the Z80Driver engine', () => {
    const data = compileToSong(noiseBasicSource);
    const observation = observeZ80Driver(data, 'psg1', 480);

    expect(observation.minAttenuation).toBeLessThan(15);
    expect(observation.maxAbsSample).toBeGreaterThan(0.01);
  });

  it('sounds the N2 noise channel on PSG2 in both engines', () => {
    const data = compileToSong('N2 t120 v15 l4 @WN1 o4 cccc');

    const sourceObservation = observeSourceInterpreter(data, 'psg2', 240);
    expect(sourceObservation.minAttenuation).toBeLessThan(15);
    expect(sourceObservation.maxAbsSample).toBeGreaterThan(0.01);

    const driverObservation = observeZ80Driver(data, 'psg2', 240);
    expect(driverObservation.minAttenuation).toBeLessThan(15);
    expect(driverObservation.maxAbsSample).toBeGreaterThan(0.01);
  });
});
