/**
 * Player (UI 向けファサード) のテスト。
 * Web Audio が無い環境では play できないため、解析と dispose 契約のみ検証する
 * (再生経路の実機検証は Phase 5 の UI 接続時に行う)。
 * (移植元: tests/MzSound.Player.Tests 相当の契約 + Player.cs)
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../Player';

describe('Player', () => {
  it('behaves as disposed after dispose', async () => {
    const player = new Player();
    await player.dispose();

    expect(() => player.stop()).toThrow();
    expect(() => player.setTrackVolume(0, 1, false)).toThrow();
    expect(() => player.setMasterVolume(1)).toThrow();
    expect(player.getTrackOffset(0)).toBe(-1);
    expect(player.getTrackLevel(0)).toBe(0);
    expect(player.getMasterLevel()).toBe(0);
  });

  it('starts in the idle state', () => {
    const player = new Player();

    expect(player.isPlaying).toBe(false);
    expect(player.currentSong).toBeNull();
    expect(player.getTrackOffset(0)).toBe(-1);
  });
});
