/**
 * AudioEngine (Web Audio 出力 + 60Hz シーケンサ駆動) のテスト。
 * AudioContext が無い環境を想定し、ミキサー直駆動での
 * 演奏終了検知 → sequencerFinished コールバック中継のみ検証する。
 */
import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../AudioEngine';
import type { FrameDriver } from '../FrameDriver';

/** 生成直後に終了状態を報告するドライバ。 */
class FinishedDriver implements FrameDriver {
  tick(): void {
    // 終了済みのため何もしない
  }

  get isFinished(): boolean {
    return true;
  }

  getTrackOffset(): number {
    return -1;
  }
}

describe('AudioEngine', () => {
  it('relays the mixer finish detection to sequencerFinished', () => {
    const engine = new AudioEngine();
    const finished = vi.fn();
    engine.sequencerFinished = finished;

    engine.mixer.attachDriver(new FinishedDriver());
    // 800 サンプル = 1 フレーム (48kHz / 60Hz)。2 フレーム分読み込んで確実に検知させる
    engine.mixer.read(new Float32Array(1600 * 2));

    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('keeps working when no sequencerFinished listener is registered', () => {
    const engine = new AudioEngine();
    engine.mixer.attachDriver(new FinishedDriver());

    expect(() => engine.mixer.read(new Float32Array(1600 * 2))).not.toThrow();
  });
});
