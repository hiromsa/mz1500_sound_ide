import { describe, expect, it } from 'vitest';
import {
  perceptualMasterGain,
  sustainEnvelopeIndex,
  VolumeEnvelopePlayback,
} from '../virtualSynth';

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
 * VolumeEnvelopePlayback (@VE 1 発音分の進行) のテスト。
 * ユーザー報告パターン `@VE1 = {13,14,15,14,13,|,12,>,7,6,5,4,3,2,1}`
 * (loop=5 / release=6) を使って KEY ON 中はリリース区間に入らず、
 * KEY OFF でリリース区間 (7,6,5,4,3,2,1) を 1 回だけ再生することを固定する。
 */
describe('VolumeEnvelopePlayback', () => {
  const values = [13, 14, 15, 14, 13, 12, 7, 6, 5, 4, 3, 2, 1]; // loop=5, release=6

  it('reports the release definition and its length in frames', () => {
    const env = new VolumeEnvelopePlayback(values, 5, 6);
    expect(env.hasRelease).toBe(true);
    expect(env.releaseLengthFrames).toBe(values.length - 6); // 7,6,5,4,3,2,1 = 7 frames
  });

  it('cycles the sustain section without entering the release section on key on', () => {
    const env = new VolumeEnvelopePlayback(values, 5, 6);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push(values[env.currentIndex()]);
      env.advance();
    }
    // 13,14,15,14,13 → 12 でループし続け、リリース区間 (7 以下) には到達しない
    expect(samples).toEqual([
      13, 14, 15, 14, 13, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
    ]);
  });

  it('plays the release section once on key off and holds the last value', () => {
    const env = new VolumeEnvelopePlayback(values, 5, 6);
    for (let i = 0; i < 10; i++) env.advance();
    expect(env.beginRelease()).toBe(true);
    const releaseSamples: number[] = [];
    for (let i = 0; i < 12; i++) {
      releaseSamples.push(values[env.currentIndex()]);
      env.advance();
    }
    // KEY OFF 後に 7,6,5,4,3,2,1 を 1 回だけ再生し、末尾 (1) でホールド
    expect(releaseSamples).toEqual([7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1]);
  });

  it('is idempotent on repeated key off while already releasing', () => {
    const env = new VolumeEnvelopePlayback(values, 5, 6);
    expect(env.beginRelease()).toBe(true);
    env.advance();
    expect(values[env.currentIndex()]).toBe(6);
    // マウスアップ後処理などの 2 回目のキーオフでリリースが巻き戻らない
    expect(env.beginRelease()).toBe(true);
    expect(values[env.currentIndex()]).toBe(6);
  });

  it('reports no release transition when the release is not defined', () => {
    const env = new VolumeEnvelopePlayback(values, 5, undefined);
    expect(env.hasRelease).toBe(false);
    expect(env.beginRelease()).toBe(false);
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
