/**
 * ChipBank (MZ-1500 サウンドデバイス一式) のテスト。
 * (移植元: MzSound.Player/Chips/ChipBank.cs の契約)
 */
import { describe, expect, it } from 'vitest';
import { ChipBank } from '../ChipBank';

describe('ChipBank', () => {
  it('provides the MZ-1500 sound devices', () => {
    const chips = new ChipBank();
    expect(chips.psg1).toBeDefined();
    expect(chips.psg2).toBeDefined();
    expect(chips.beep).toBeDefined();
    expect(chips.fm.name).toBe('YM2151 (OPM)');
    // C# 版と同様: cpuClock は PSG クロック (busy 期間計算用)、チップクロック既定は 4MHz リファレンス
    expect(chips.fm.cpuClock).toBe(3579545);
    expect(chips.fm.chipClock).toBe(4000000);
  });

  it('computes the FM trim from the mixer gain', () => {
    const chips = new ChipBank();
    expect(chips.getFmTrim(0)).toBe(0); // gain 1 → TL なし
    chips.setFmGain(0, 0.5);
    expect(chips.getFmTrim(0)).toBe(64); // round(0.5 * 127) = 64
    chips.setFmGain(0, 0);
    expect(chips.getFmTrim(0)).toBe(127);
  });

  it('mutes FM channels via the channel mask', () => {
    const chips = new ChipBank();
    chips.setFmGain(0, 0);
    chips.setFmGain(3, 0);
    expect(chips.currentFmMuteMask).toBe(0b1001);
    chips.setFmGain(3, 0.8);
    expect(chips.currentFmMuteMask).toBe(0b0001);
  });

  it('reports the FM level only while key on', () => {
    const chips = new ChipBank();
    expect(chips.getFmLevel(0)).toBe(0); // 未発音

    // KEYON ($08): channel 0 / 4 op、TL = 40 (減衰)
    chips.fm.setReg(0x08, 0x78);
    chips.fm.setReg(0x60, 40);
    const level = chips.getFmLevel(0);
    expect(level).toBeCloseTo(1 - 40 / 127, 9);

    // channel 1 の KEYON では channel 0 は無音
    chips.fm.setReg(0x08, 0x71);
    expect(chips.getFmLevel(0)).toBe(0);

    // ミュート時は常に 0
    chips.fm.setReg(0x08, 0x78);
    chips.setFmGain(0, 0);
    expect(chips.getFmLevel(0)).toBe(0);
  });
});
