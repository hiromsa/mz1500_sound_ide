import { describe, expect, it } from 'vitest';
import { perceptualMasterGain, sustainEnvelopeIndex } from '../virtualSynth';

/**
 * sustainEnvelopeIndex (仮想キーボードの @VE サステイン区間インデックス算出) のテスト。
 * MZSD 演奏エンジン (TrackSequencer / mzsd_driver.asm) と同一のループ挙動を固定する。
 */
describe('sustainEnvelopeIndex', () => {
  const length = 9; // @VE1 = { 15, 14, 13, |, 12, 11, >, 8, 5, 2, 0 } (loop=3, release=5)

  it('returns the frame index while advancing through the sustain section', () => {
    expect(sustainEnvelopeIndex(0, length, 3, 5)).toBe(0);
    expect(sustainEnvelopeIndex(3, length, 3, 5)).toBe(3);
    expect(sustainEnvelopeIndex(4, length, 3, 5)).toBe(4);
  });

  it('cycles the sustain section without entering the release section', () => {
    expect(sustainEnvelopeIndex(5, length, 3, 5)).toBe(3);
    expect(sustainEnvelopeIndex(6, length, 3, 5)).toBe(4);
    expect(sustainEnvelopeIndex(7, length, 3, 5)).toBe(3);
    expect(sustainEnvelopeIndex(38, length, 3, 5)).toBe(4);
  });

  it('holds the last sustain value when the loop is not defined', () => {
    expect(sustainEnvelopeIndex(5, length, undefined, 5)).toBe(4);
    expect(sustainEnvelopeIndex(99, length, undefined, 5)).toBe(4);
  });

  it('loops from the loop point to the end when the release is not defined', () => {
    expect(sustainEnvelopeIndex(9, length, 3, undefined)).toBe(3);
    expect(sustainEnvelopeIndex(10, length, 3, undefined)).toBe(4);
    expect(sustainEnvelopeIndex(14, length, 3, undefined)).toBe(8);
    expect(sustainEnvelopeIndex(15, length, 3, undefined)).toBe(3);
  });

  it('holds the last value when neither loop nor release is defined', () => {
    expect(sustainEnvelopeIndex(9, length, undefined, undefined)).toBe(8);
    expect(sustainEnvelopeIndex(20, length, undefined, undefined)).toBe(8);
  });

  it('treats an out-of-range release as absent', () => {
    expect(sustainEnvelopeIndex(9, length, 3, 255)).toBe(3);
    expect(sustainEnvelopeIndex(9, length, 3, -1)).toBe(3);
  });
});

/**
 * perceptualMasterGain (仮想キーボードのマスター音量ゲイン算出) のテスト。
 * Player.setMasterVolume と同一の知覚カーブ (2 乗) / クランプ規約を固定する。
 */
describe('perceptualMasterGain', () => {
  it('applies the perceptual square curve identical to Player.setMasterVolume', () => {
    expect(perceptualMasterGain(0)).toBe(0);
    expect(perceptualMasterGain(0.5)).toBeCloseTo(0.25, 12);
    expect(perceptualMasterGain(0.8)).toBeCloseTo(0.64, 12);
    expect(perceptualMasterGain(1)).toBe(1);
  });

  it('clamps out-of-range volumes into the 0-1 range', () => {
    expect(perceptualMasterGain(-1)).toBe(0);
    expect(perceptualMasterGain(-0.001)).toBe(0);
    expect(perceptualMasterGain(1.001)).toBe(1);
    expect(perceptualMasterGain(2)).toBe(1);
  });
});
