/**
 * BeepChip (Intel 8253 PIT Ch.0 相当) のテスト。
 * (移植元: tools/cs-probe による C# 版との標本一致検証)
 */
import { describe, expect, it } from 'vitest';
import { loadReference } from './referenceLoader';
import { BeepChip } from '../BeepChip';

describe('BeepChip', () => {
  it('computes frequency from the 8253 counter', () => {
    // A4 = 440Hz → counter = round(894886.25 / 440) = 2034 (シーケンサの式)
    const chip = new BeepChip();
    chip.setCounter(2034);

    expect(chip.frequency).toBeCloseTo(BeepChip.ClockHz / 2034, 6);
  });

  it('clamps the counter to 0..65535', () => {
    const chip = new BeepChip();
    chip.setCounter(-10);
    expect(chip.counterValue).toBe(0);
    chip.setCounter(70000);
    expect(chip.counterValue).toBe(65535);
  });

  it('gate off silences and resets the phase', () => {
    const chip = new BeepChip();
    chip.setCounter(2034);
    chip.setGate(true);
    expect(chip.renderSample(48000.0)).toBeGreaterThan(0);

    chip.setGate(false);
    expect(chip.currentLevel).toBe(0);
    expect(chip.renderSample(48000.0)).toBe(0);

    // ゲート再オープンで位相は先頭から始まる
    chip.setGate(true);
    expect(chip.renderSample(48000.0)).toBe(0.5);
  });

  it('renders the same samples as the C# reference', () => {
    const chip = new BeepChip();
    chip.setCounter(2034);
    chip.setGate(true);

    const samples = Array.from({ length: 96 }, () => chip.renderSample(48000.0));
    expect(samples).toEqual(loadReference().beepSamples);
  });
});
