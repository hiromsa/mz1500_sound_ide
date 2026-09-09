/**
 * 部分再生 (キャレット位置から / 選択範囲のみ) のプリシーク / 範囲終端処理のテスト。
 * SourceInterpreter (MzsdSequencer) と Z80Driver (Z80DriverPlayback) の両エンジンで、
 * 「開始フレームまでを発音なしで高速シミュレートし v / o / @ 等の状態を引き継ぐこと」
 * 「範囲終端フレームで全パート消音して演奏終了すること」を検証する。
 */
import { describe, expect, it } from 'vitest';
import { ChipBank } from '../../chips/ChipBank';
import { MzsdSong } from '../MzsdSong';
import { MzsdSequencer } from '../MzsdSequencer';
import { SongBuilder } from './SongBuilder';
import { Z80DriverPlayback } from '../Z80DriverPlayback';

/**
 * P1 に「音量が途中で変わる 2 音」を含む MZSD データ。
 * 音符 1: v10 A4 (len 4) = startFrame 0 / 音符 2: v5 B4 (len 4) = startFrame 4。
 */
function buildVolumeTransitionSong(): Uint8Array {
  const builder = new SongBuilder();
  builder.addTrack(
    0,
    SongBuilder.volume(10),
    SongBuilder.note(69, 4, 4),
    SongBuilder.volume(5),
    SongBuilder.note(71, 4, 4),
    SongBuilder.trackEnd(),
  );
  return builder.build();
}

/** A4 の DCSG トーン周期レジスタ値 (= 253)。 */
const A4Period = 253;

/** B4 の DCSG トーン周期レジスタ値 (= round(3579545 / 32 / 493.88) - 1)。 */
const B4Period = 225;

describe('partial playback preseek (SourceInterpreter)', () => {
  it('applies all preceding commands without sounding during preseek', () => {
    const chips = new ChipBank();
    // 音符 2 (startFrame 4) の直前までプリシーク
    new MzsdSequencer(MzsdSong.parse(buildVolumeTransitionSong()), chips, false, 4);

    // プリシーク中に音符 1 (v10) まで処理済み → 減衰 = 15 - 10 = 5 がレジスタへ反映されている
    expect(chips.psg1.attenuationRegister(0)).toBe(5);
    // 音符 1 の音程 (A4) が書かれた状態で停止している
    expect(chips.psg1.tonePeriodRegister(0)).toBe(A4Period);
  });

  it('starts the target note with the inherited state on the first tick', () => {
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(buildVolumeTransitionSong()), chips, false, 4);

    // 本番 1 フレーム目で音符 2 (v5 / B4) が発音される
    sequencer.tick();
    expect(chips.psg1.attenuationRegister(0)).toBe(10); // 15 - 5
    expect(chips.psg1.tonePeriodRegister(0)).toBe(B4Period);
  });

  it('keeps the whole-song behaviour when no range is given', () => {
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(buildVolumeTransitionSong()), chips, false);

    // プリシークなし = 通常再生: 1 フレーム目で音符 1 (v10 / A4) が発音される
    sequencer.tick();
    expect(chips.psg1.attenuationRegister(0)).toBe(5);
    expect(chips.psg1.tonePeriodRegister(0)).toBe(A4Period);
  });
});

describe('partial playback range end (SourceInterpreter)', () => {
  it('silences the track and finishes at the range end frame', () => {
    const chips = new ChipBank();
    // 音符 1 の発音中 (3 フレーム後) に範囲終端を設定
    const sequencer = new MzsdSequencer(MzsdSong.parse(buildVolumeTransitionSong()), chips, false, 0, 3);

    sequencer.tick();
    expect(chips.psg1.attenuationRegister(0)).toBe(5);
    expect(sequencer.isFinished).toBe(false);

    sequencer.tick();
    expect(sequencer.isFinished).toBe(false);

    sequencer.tick(); // 3 フレーム目 = 範囲終端
    expect(sequencer.isFinished).toBe(true);
    expect(chips.psg1.attenuationRegister(0)).toBe(15); // 全消音
  });

  it('does not loop when the range end is reached', () => {
    const builder = new SongBuilder();
    const dataOffset = builder.addTrack(
      0,
      SongBuilder.volume(10),
      SongBuilder.note(69, 2, 2),
      SongBuilder.trackEnd(),
    );
    builder.setLoop(0, dataOffset);
    const chips = new ChipBank();
    const sequencer = new MzsdSequencer(MzsdSong.parse(builder.build()), chips, true, 0, 1);

    // 範囲終端 (1 フレーム) に到達したら L ループへ復帰せず終了する
    sequencer.tick();
    expect(sequencer.isFinished).toBe(true);
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });
});

describe('partial playback (Z80Driver)', () => {
  it('matches the SourceInterpreter register state after preseek', () => {
    const data = buildVolumeTransitionSong();

    const siChips = new ChipBank();
    new MzsdSequencer(MzsdSong.parse(data), siChips, false, 4);

    const z80Chips = new ChipBank();
    const playback = new Z80DriverPlayback(z80Chips);
    playback.play(data, false, 4);

    // 両エンジンとも「音符 1 (v10 / A4) 発音済み・音符 2 未発音」の同一状態で停止している
    expect(z80Chips.psg1.attenuationRegister(0)).toBe(siChips.psg1.attenuationRegister(0));
    expect(z80Chips.psg1.attenuationRegister(0)).toBe(5);
    expect(z80Chips.psg1.tonePeriodRegister(0)).toBe(A4Period);
  });

  it('advances to the target note from the preseek state', () => {
    const chips = new ChipBank();
    const playback = new Z80DriverPlayback(chips);
    playback.play(buildVolumeTransitionSong(), false, 4);

    playback.tick();
    expect(chips.psg1.attenuationRegister(0)).toBe(10);
    expect(chips.psg1.tonePeriodRegister(0)).toBe(B4Period);
  });

  it('silences all channels and finishes at the range end', () => {
    const chips = new ChipBank();
    const playback = new Z80DriverPlayback(chips);
    playback.play(buildVolumeTransitionSong(), false, 0, 3);

    playback.tick();
    expect(playback.isFinished).toBe(false);
    expect(chips.psg1.attenuationRegister(0)).toBeLessThan(15);

    playback.tick();
    playback.tick(); // 3 フレーム目 = 範囲終端
    expect(playback.isFinished).toBe(true);
    expect(chips.psg1.attenuationRegister(0)).toBe(15); // ChipBank.silenceAll で消音
  });

  it('ignores ticks after the range end', () => {
    const chips = new ChipBank();
    const playback = new Z80DriverPlayback(chips);
    playback.play(buildVolumeTransitionSong(), false, 0, 3);

    for (let frame = 0; frame < 10; frame++) {
      playback.tick();
    }

    // 範囲終端後の tick でドライバが再開・再発音しない
    expect(playback.isFinished).toBe(true);
    expect(chips.psg1.attenuationRegister(0)).toBe(15);
  });
});
