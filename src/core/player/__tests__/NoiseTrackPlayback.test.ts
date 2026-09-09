/**
 * 繝弱う繧ｺ繝医Λ繝・け (N1 / N2) 縺ｮ貍泌･丞屓蟶ｰ繝・せ繝医・
 * 繝ｦ繝ｼ繧ｶ繝ｼ蝣ｱ蜻翫後ヮ繧､繧ｺ繧ｵ繝ｳ繝励Ν縺・PLAY 縺ｧ魑ｴ繧峨↑縺・阪・菫ｮ豁｣繧貞崋螳壹☆繧九・
 *
 * 蜴溷屏: MmlCompiler 蛛ｴ TrackId 縺ｮ荳ｦ縺ｳ (N1=6) 縺梧ｼ泌･丞・ (TrackSequencer /
 * mzsd_driver.asm / AudioFrameMixer = N1=3, N2=7) 縺ｨ荳堺ｸ閾ｴ縺ｧ縲¨1 縺ｮ繝・・繧ｿ縺・
 * P6 (trackIndex 6 = psg2 ch2 遏ｩ蠖｢豕｢) 縺ｮ slot 縺ｸ譖ｸ縺九ｌ縲√ヮ繧､繧ｺ繝√Ε繝ｳ繝阪Ν縺・
 * 辟｡髻ｳ縺ｮ縺ｾ縺ｾ縺ｫ縺ｪ縺｣縺ｦ縺・◆縲・
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../../mml/MmlCompiler';
import { ChipBank } from '../../chips/ChipBank';
import type { FrameDriver } from '../FrameDriver';
import { MzsdSong } from '../MzsdSong';
import { MzsdSequencer } from '../MzsdSequencer';
import { Z80DriverPlayback } from '../Z80DriverPlayback';

/** 繝ｦ繝ｼ繧ｶ繝ｼ蝣ｱ蜻翫・繧ｵ繝ｳ繝励Ν (samples/mml_reference/psg/psg_noise_basic.mml)縲・*/
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

/** 1 繧ｨ繝ｳ繧ｸ繝ｳ蛻・・繝弱う繧ｺ逋ｺ髻ｳ隕ｳ蟇溽ｵ先棡縲・*/
interface NoiseObservation {
  /** 繝弱う繧ｺ繝√Ε繝ｳ繝阪Ν貂幄｡ｰ繝ｬ繧ｸ繧ｹ繧ｿ縺ｮ譛蟆丞､ (< 15 縺ｪ繧我ｽ輔ｉ縺九・髻ｳ驥上〒逋ｺ髻ｳ)縲・*/
  minAttenuation: number;

  /** 逋ｺ髻ｳ繝輔Ξ繝ｼ繝 (貂幄｡ｰ < 15) 縺ｮ邱乗焚縲・*/
  activeFrames: number;

  /**
   * 逋ｺ髻ｳ繝輔Ξ繝ｼ繝縺ｮ縺・■縲∝・蜉帙′豁｣雋縺ｫ謖ｯ繧後※縺・ｋ (AC 謖ｯ蟷・> 0.04) 繝輔Ξ繝ｼ繝謨ｰ縲・
   * LFSR 縺・0x0000 (bit0 蝗ｺ螳・ 縺ｫ關ｽ縺｡縺溽憾諷九・ DC 蜃ｺ蜉帙〒謖ｯ繧後′縺ｪ縺冗┌髻ｳ縺ｫ閨槭％縺医ｋ縺溘ａ縲・
   * 蜊倥↑繧矩撼繧ｼ繝ｭ蛻､螳壹〒縺ｯ縺ｪ縺乗険繧悟ｹ・〒蛻､螳壹☆繧九・
   */
  soundingFrames: number;
}

/** 荳｡繧ｨ繝ｳ繧ｸ繝ｳ蜈ｱ騾壹・繝弱う繧ｺ逋ｺ髻ｳ隕ｳ蟇溘・ 繝輔Ξ繝ｼ繝 = 800 讓呎悽 (@48kHz)縲・*/
function observeNoise(
  data: Uint8Array,
  chip: 'psg1' | 'psg2',
  useDriver: boolean,
  maxFrames: number,
): NoiseObservation {
  const chips = new ChipBank();
  const channel = 3; // DCSG 繝弱う繧ｺ繝√Ε繝ｳ繝阪Ν

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
  it('switches the 3-stage shift rate by note name (c=2 / e=1 / g=0) on both engines', () => {
    // 音名ベースの分周ヒント: 実用音域でも c/e/g でレートが変化する
    const data = compileToSong('N1 t120 v12 l4 q8 @WN1 o4 c4 e4 g4');

    for (const useDriver of [false, true]) {
      const chips = new ChipBank();
      let driver: FrameDriver;
      if (useDriver) {
        const playback = new Z80DriverPlayback(chips);
        playback.play(data, false);
        driver = playback;
      } else {
        driver = new MzsdSequencer(MzsdSong.parse(data), chips, false);
      }

      const rateSteps: number[] = [];
      let last = -1;
      for (let frame = 0; frame < 100 && !driver.isFinished; frame++) {
        driver.tick();
        if (chips.psg1.attenuationRegister(3) >= 15) {
          continue; // 発音前のチップ初期値は記録しない
        }
        const mode = chips.psg1.noiseRateMode;
        if (mode !== last) {
          rateSteps.push(mode);
          last = mode;
        }
      }

      expect(rateSteps).toEqual([2, 1, 0]); // c4 = 低 / e4 = 中 / g4 = 高
    }
  });

  it('maps N1 to DCSG1 noise slot (3) and keeps the P6 slot empty', () => {
    const data = compileToSong(noiseBasicSource);
    const song = MzsdSong.parse(data);

    // N1 縺ｮ繝・・繧ｿ縺ｯ trackIndex 3 (DCSG1 繝弱う繧ｺ) 縺ｸ譖ｸ縺九ｌ繧・
    expect(song.trackDataOffset(3)).toBeGreaterThan(0);
    // 菫ｮ豁｣蜑阪・ N1 繝・・繧ｿ縺・P6 (trackIndex 6) 縺ｸ譖ｸ縺九ｌ縺ｦ縺・◆ (蝗槫ｸｰ髦ｲ豁｢)
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

    // white / periodic 荳｡繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ繧貞性繧譖ｲ蜈ｨ菴薙〒縲∫匱髻ｳ繝輔Ξ繝ｼ繝縺ｯ縺吶∋縺ｦ謖∫ｶ壹＠縺ｦ魑ｴ繧・
    // (LFSR 縺・0x0000 縺ｸ蜷ｸ蠑輔＆繧後ｋ AND 繝輔ぅ繝ｼ繝峨ヰ繝・け螳溯｣・□縺ｨ DC 蜃ｺ蜉帙〒辟｡髻ｳ蛹悶☆繧・
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

  it('follows the note pitch with the tone-3 integrated periodic noise (@IN1)', () => {
    // P3 が @IN1 でノイズへ統合されると、P3 の音符音程が tone2 レジスタへ書かれ、
    // ノイズシフトクロック = 音程 × 16 で駆動される (16 ステップ循環の基本波 = 音程)。
    // 発音はノイズチャンネルへ切り替わり (減衰 = P3 の音量)、トーン 3 自体は無音化する。
    const data = compileToSong('P3 t120 v12 l4 @IN1 o4 c4 e4 g4 > c4');

    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(data), chips, false);

    const tone2Periods: number[] = [];
    let lastPeriod = -1;
    for (let frame = 0; frame < 120 && !sequencer.isFinished; frame++) {
      sequencer.tick();

      expect(chips.psg1.noiseRateMode).toBe(3); // tone2 連動
      expect(chips.psg1.isNoiseWhite).toBe(false); // periodic (@IN1)

      if (frame === 3) {
        // 発音はノイズチャンネルへ切り替わり、トーン 3 自体は無音化する
        expect(chips.psg1.attenuationRegister(2)).toBe(15);
        expect(chips.psg1.attenuationRegister(3)).toBe(3); // v12 → att 3
      }

      const period = chips.psg1.tonePeriodRegister(2);
      if (period !== lastPeriod) {
        tone2Periods.push(period);
        lastPeriod = period;
      }
    }

    // c4 (427) → e4 (338) → g4 (284) → > c4 (213) の音程変化が tone2 へ反映される
    expect(tone2Periods).toEqual([427, 338, 284, 213]);
  });

  it('follows the note pitch with the tone-3 integrated periodic noise in the Z80Driver engine', () => {
    const data = compileToSong('P3 t120 v12 l4 @IN1 o4 c4 e4 g4 > c4');

    const chips = new ChipBank();
    const playback = new Z80DriverPlayback(chips);
    playback.play(data, false);

    const tone2Periods: number[] = [];
    let lastPeriod = -1;
    for (let frame = 0; frame < 120 && !playback.isFinished; frame++) {
      playback.tick();

      expect(chips.psg1.noiseRateMode).toBe(3);
      expect(chips.psg1.isNoiseWhite).toBe(false);

      const period = chips.psg1.tonePeriodRegister(2);
      if (period !== lastPeriod) {
        tone2Periods.push(period);
        lastPeriod = period;
      }
    }

    expect(tone2Periods).toEqual([427, 338, 284, 213]);
  });

  it('switches to the integrated white noise with @IN2 and releases it with @IN0', () => {
    const data = compileToSong('P3 t120 v10 l4 @IN2 o4 c4 @IN0 c4');

    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(data), chips, false);

    let whiteSounded = false;
    let released = false;
    for (let frame = 0; frame < 160 && !sequencer.isFinished; frame++) {
      sequencer.tick();

      if (chips.psg1.isNoiseWhite && chips.psg1.noiseRateMode === 3 && chips.psg1.attenuationRegister(3) < 15) {
        whiteSounded = true; // @IN2: white 連動でノイズ発音
      }

      if (chips.psg1.attenuationRegister(3) === 15 && chips.psg1.attenuationRegister(2) < 15) {
        released = true; // @IN0: 統合解除でトーン 3 が通常発音し、ノイズは無音化
      }
    }

    expect(whiteSounded).toBe(true);
    expect(released).toBe(true);
  });

});
