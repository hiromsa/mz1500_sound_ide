/**
 * Z80DriverPlayback (Z80 サウンドドライバのリアルタイム演奏駆動) のテスト。
 * ドライバのブート完了 (STAT_PLAY 待ち)、フレーム駆動によるチップへの書き込み、
 * 演奏終了 (HALT) 検知、演奏位置取得の契約を検証する。
 */
import { describe, expect, it } from 'vitest';
import { ChipBank } from '../../chips/ChipBank';
import { SongBuilder } from './SongBuilder';
import { Z80DriverPlayback } from '../Z80DriverPlayback';

/** P1 に短いノート列を含む MZSD データを生成する。 */
function buildSimpleSong(): Uint8Array {
  const builder = new SongBuilder();
  builder.addTrack(
    0,
    SongBuilder.volume(10),
    SongBuilder.note(69, 6, 6),
    SongBuilder.rest(3),
    SongBuilder.trackEnd(),
  );

  return builder.build();
}

describe('Z80DriverPlayback', () => {
  it('boots the driver and writes to the chips while frames advance', () => {
    const chips = new ChipBank();
    const playback = new Z80DriverPlayback(chips);

    playback.play(buildSimpleSong(), false);
    for (let frame = 0; frame < 3; frame++) {
      playback.tick();
    }

    // P1 のノート発音中は減衰レジスタが最大 (15) にならない
    expect(chips.psg1.attenuationRegister(0)).toBeLessThan(15);
  });

  it('reports the playback position while frames advance', () => {
    const playback = new Z80DriverPlayback(new ChipBank());
    playback.play(buildSimpleSong(), false);
    playback.tick();

    expect(playback.getTrackOffset(0)).toBeGreaterThan(0);
  });

  it('finishes a non-looping song after all tracks end', () => {
    const playback = new Z80DriverPlayback(new ChipBank());
    playback.play(buildSimpleSong(), false);

    let guard = 0;
    while (!playback.isFinished && guard++ < 60) {
      playback.tick();
    }

    expect(playback.isFinished).toBe(true);
    expect(guard).toBeLessThanOrEqual(60);
  });
});
