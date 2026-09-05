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

  it('renders the same noise samples as the C# reference', () => {
    const chip = new DcsgChip();
    chip.setAttenuation(0, 15);
    chip.setAttenuation(1, 15);
    chip.setAttenuation(2, 15);
    chip.setNoiseControl(true, 0);

    const samples = Array.from({ length: 100 }, () => chip.renderSample(48000.0));
    expect(samples).toEqual(loadReference().dcsgNoiseSamples);
  });
});
