/**
 * DcsgChip (SN76489AN 相当) のテスト。
 * (移植元: tests/MzSound.Player.Tests/MzsdSequencerTests.cs の DcsgChipTests +
 * tools/cs-probe による C# 版との標本一致検証)
 */
import { describe, expect, it } from 'vitest';
import { loadReference } from './referenceLoader';
import { DcsgChip } from '../DcsgChip';

describe('DcsgChip', () => {
  // (C# DcsgChipTests.SetTonePeriod_ComputesFrequency)
  it('setTonePeriod computes frequency', () => {
    const chip = new DcsgChip();
    chip.setTonePeriod(0, 253);

    expect(chip.toneFrequency(0)).toBeCloseTo(DcsgChip.ClockHz / 32.0 / 254.0, 3);
  });

  // (C# DcsgChipTests.Attenuation15_IsSilent)
  it('attenuation 15 is silent', () => {
    const chip = new DcsgChip();
    chip.setTonePeriod(0, 253);
    chip.setAttenuation(0, 15);

    expect(chip.channelLevel(0)).toBe(0);
  });

  // (C# DcsgChipTests.NoiseControl_StoresMode)
  it('noise control stores mode', () => {
    const chip = new DcsgChip();
    chip.setNoiseControl(true, 2);

    expect(chip.noiseClock).toBeCloseTo(DcsgChip.ClockHz / 16.0 / 4.0, 3);
  });

  it('clamps registers to valid ranges', () => {
    const chip = new DcsgChip();
    chip.setTonePeriod(0, -5);
    expect(chip.tonePeriodRegister(0)).toBe(0);
    chip.setTonePeriod(0, 2000);
    expect(chip.tonePeriodRegister(0)).toBe(1023);

    chip.setAttenuation(1, -1);
    expect(chip.attenuationRegister(1)).toBe(0);
    chip.setAttenuation(1, 16);
    expect(chip.attenuationRegister(1)).toBe(15);

    chip.setNoiseControl(false, 9);
    expect(chip.isNoiseWhite).toBe(false);
    expect(chip.noiseRateMode).toBe(3);

    chip.setChannelGain(0, 2.5);
    expect(chip.channelLevel(0)).toBe(1); // attenuation 0 / gain 1 (クランプ) → 最大レベル 1
  });

  it('noise clock follows tone 2 in mode 3', () => {
    const chip = new DcsgChip();
    chip.setTonePeriod(2, 253);
    chip.setNoiseControl(true, 3);

    expect(chip.noiseClock).toBeCloseTo(chip.toneFrequency(2) * 16.0, 3);
  });

  it('renders silence while the UI channel gain is muted', () => {
    const chip = new DcsgChip();
    chip.setTonePeriod(0, 253);
    chip.setAttenuation(0, 0);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setAttenuation(3, 15);

    // 既定は鳴る状態 (BEEP / FM と同じ初期ゲイン)
    expect(chip.channelLevel(0)).toBeGreaterThan(0);
    expect(chip.renderSample(48000.0)).not.toBe(0);

    // チャンネルゲイン 0 (プレビューミュート) で VU / 実音ともに無音
    chip.setChannelGain(0, 0);
    expect(chip.channelLevel(0)).toBe(0);
    expect(chip.renderSample(48000.0)).toBe(0);
  });

  it('renders silence when the noise channel gain is muted', () => {
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(true, 0);

    expect(chip.renderSample(48000.0)).not.toBe(0);

    chip.setChannelGain(3, 0);
    expect(chip.channelLevel(3)).toBe(0);
    expect(chip.renderSample(48000.0)).toBe(0);
  });

  it('renders the same tone samples as the C# reference', () => {
    const chip = new DcsgChip();
    chip.setTonePeriod(0, 253);
    chip.setAttenuation(0, 0);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setAttenuation(3, 15);

    const samples = Array.from({ length: 200 }, () => chip.renderSample(48000.0));
    expect(samples).toEqual(loadReference().dcsgSamples);
  });

  // C# オリジナルの LFSR は AND フィードバック実装のため、白噪開始から数標本で
  // LFSR が 0x0000 (bit0 固定) に落ちて DC 出力 (-0.25 定常) となり無音化する
  // (reference.json の dcsgNoiseSamples が全標本 -0.25 固定であることが証拠)。
  // 本移植は実機準拠の XOR フィードバック (bit0 ^ bit3) へ修正したため、
  // C# 標本との一致検証は意図的な差分としてスキップする (web_core_port.md §3.1)。
  it.skip('renders the same noise samples as the C# reference (intentional difference: LFSR XOR feedback)', () => {
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(true, 0);

    const samples = Array.from({ length: 100 }, () => chip.renderSample(48000.0));
    expect(samples).toEqual(loadReference().dcsgNoiseSamples);
  });

  it('keeps the white noise LFSR running without the zero attractor', () => {
    // XOR フィードバック (bit0 ^ bit3) では LFSR が 0x0000 に落ちないため、
    // 白噪は長時間にわたり正負が変動する出力を保つ (実機準拠)
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(true, 0);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 48000; i++) {
      const sample = chip.renderSample(48000.0); // 1 秒分
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    expect(max).toBeGreaterThan(0.2);
    expect(min).toBeLessThan(-0.2);
  });

  it('keeps the periodic noise running through the feedback bit', () => {
    // 周期ノイズ (bit0 パススルー) も 15bit 循環で鳴り続ける
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(false, 2);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 48000; i++) {
      const sample = chip.renderSample(48000.0); // 1 秒分
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    expect(max).toBeGreaterThan(0.2);
    expect(min).toBeLessThan(-0.2);
  });

  it('attenuates the alias high band of the noise output', () => {
    // シフトクロック (55.9〜223.7kHz) は音声ナイキスト (24kHz) を大きく超えるため、
    // そのまま出力すると標本化エイリアスが金属的な高音として聞こえる。
    // 出力段のローパス (8kHz 2 段) により隣接標本差 (高周波エネルギーの代理) を抑制する。
    // (フィルタ無しの白噪 ±1 ランダム列では隣接差の平均が約 1.0 になる)
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(true, 0); // 最悪ケース: 223.7kHz

    let diffSum = 0;
    let prev = chip.renderSample(48000.0);
    for (let i = 0; i < 48000; i++) {
      const sample = chip.renderSample(48000.0);
      diffSum += Math.abs(sample - prev);
      prev = sample;
    }

    expect(diffSum / 48000).toBeLessThan(0.3);
  });

  it('blocks the DC component of the periodic noise', () => {
    // 周期ノイズ (bit0 循環) は初期位相により大きな DC 成分を持つため、
    // 出力コンデンサ相当の DC ブロックで平均値を 0 に保つ
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(false, 2);

    let sum = 0;
    for (let i = 0; i < 48000; i++) {
      sum += chip.renderSample(48000.0);
    }

    expect(Math.abs(sum / 48000)).toBeLessThan(0.05);
  });
});
