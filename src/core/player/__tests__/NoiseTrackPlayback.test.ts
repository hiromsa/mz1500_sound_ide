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
import type { FrameDriver } from '../FrameDriver';
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

  /** 発音フレーム (減衰 < 15) の総数。 */
  activeFrames: number;

  /**
   * 発音フレームのうち、出力が正負に振れている (AC 振幅 > 0.04) フレーム数。
   * LFSR が 0x0000 (bit0 固定) に落ちた状態は DC 出力で振れがなく無音に聞こえるため、
   * 単なる非ゼロ判定ではなく振れ幅で判定する。
   */
  soundingFrames: number;
}

/** 両エンジン共通のノイズ発音観察。1 フレーム = 800 標本 (@48kHz)。 */
function observeNoise(
  data: Uint8Array,
  chip: 'psg1' | 'psg2',
  useDriver: boolean,
  maxFrames: number,
): NoiseObservation {
  const chips = new ChipBank();
  const channel = 3; // DCSG ノイズチャンネル

  let driver: FrameDriver;
  if (useDriver) {
    const playback = new Z80DriverPlayback(chips);
    playback.play(data, false);
    driver = playback;
  } else {
    driver = new MzsdSequencer(MzsdSong.parse(data), chips, false);
  }

  const observation: NoiseObservation = {
    minAttenuation: 15,
    activeFrames: 0,
    soundingFrames: 0,
  };

  for (let frame = 0; frame < maxFrames && !driver.isFinished; frame++) {
    driver.tick();

    const att = chips[chip].attenuationRegister(channel);
    if (att < observation.minAttenuation) {
      observation.minAttenuation = att;
    }

    if (att >= 15) {
      continue;
    }

    observation.activeFrames++;

    let frameMin = Infinity;
    let frameMax = -Infinity;
    for (let i = 0; i < 800; i++) {
      const sample = chips[chip].renderSample(48000);
      if (sample < frameMin) {
        frameMin = sample;
      }
      if (sample > frameMax) {
        frameMax = sample;
      }
    }

    if (frameMax - frameMin > 0.04) {
      observation.soundingFrames++;
    }
  }

  return observation;
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
    const observation = observeNoise(data, 'psg1', false, 480);

    // white / periodic 両セクションを含む曲全体で、発音フレームはすべて持続して鳴る
    // (LFSR が 0x0000 へ吸引される AND フィードバック実装だと DC 出力で無音化する)
    expect(observation.minAttenuation).toBeLessThan(15);
    expect(observation.activeFrames).toBeGreaterThan(50);
    expect(observation.soundingFrames).toBe(observation.activeFrames);
  });

  it('sounds the N1 noise channel with the Z80Driver engine', () => {
    const data = compileToSong(noiseBasicSource);
    const observation = observeNoise(data, 'psg1', true, 480);

    expect(observation.minAttenuation).toBeLessThan(15);
    expect(observation.activeFrames).toBeGreaterThan(50);
    expect(observation.soundingFrames).toBe(observation.activeFrames);
  });

  it('sounds the N2 noise channel on PSG2 in both engines', () => {
    const data = compileToSong('N2 t120 v15 l4 @WN1 o4 cccc');

    const sourceObservation = observeNoise(data, 'psg2', false, 240);
    expect(sourceObservation.minAttenuation).toBeLessThan(15);
    expect(sourceObservation.soundingFrames).toBe(sourceObservation.activeFrames);

    const driverObservation = observeNoise(data, 'psg2', true, 240);
    expect(driverObservation.minAttenuation).toBeLessThan(15);
    expect(driverObservation.soundingFrames).toBe(driverObservation.activeFrames);
  });
});
