import { describe, expect, it } from 'vitest';
import {
  fmKcKfForPitch,
  fmToneDataToParameters,
  writeFmToneRegisters,
} from '../FmToneRegisters';
import { FmToneParameterCount } from '../MzsdSong';
import type { FmToneData } from '../../fm/FmTone';

/** レジスタ書き込みを記録する setReg モック。 */
function createRegisterSink() {
  const writes = new Map<number, number>();
  const setReg = (register: number, value: number) => {
    writes.set(register, value);
  };
  return { writes, setReg };
}

describe('writeFmToneRegisters', () => {
  it('46 パラメータを OPM レジスタへ正しく展開する', () => {
    // ALG=5 / FB=3、OP3 (index 2) に特徴的な値を設定
    const p = new Uint8Array(FmToneParameterCount);
    p[0] = 5;
    p[1] = 3;
    const o = 2 + 2 * 11;
    p[o + 0] = 10; // AR
    p[o + 1] = 11; // D1R
    p[o + 2] = 12; // D2R
    p[o + 3] = 13; // RR
    p[o + 4] = 3; // D1L
    p[o + 5] = 45; // TL
    p[o + 6] = 2; // KS
    p[o + 7] = 14; // MUL
    p[o + 8] = 5; // DT1
    p[o + 9] = 2; // DT2
    p[o + 10] = 1; // AME

    const { writes, setReg } = createRegisterSink();
    const state = writeFmToneRegisters(p, 2, setReg);

    // RL (pan 3) / FB / ALG: (3 << 6) | (3 << 3) | 5
    expect(writes.get(0x20 + 2)).toBe(0xdd);
    expect(state.algFb).toBe((3 << 3) | 5);

    // OP3 の各レジスタ (チャンネル 2 = +0x10)
    expect(writes.get(0x40 + 16 + 2)).toBe((1 << 7) | (5 << 4) | 14); // AME / DT1 / MUL
    expect(writes.get(0x60 + 16 + 2)).toBe(45); // TL 基準値
    expect(writes.get(0x80 + 16 + 2)).toBe((2 << 6) | 10); // KS / AR
    expect(writes.get(0xa0 + 16 + 2)).toBe(11); // D1R
    expect(writes.get(0xc0 + 16 + 2)).toBe((2 << 6) | 12); // DT2 / D2R
    expect(writes.get(0xe0 + 16 + 2)).toBe((3 << 4) | 13); // D1L / RR

    expect(state.toneLevels[2]).toBe(45);
  });

  it('pan 指定で $20 の RL bit が変わる', () => {
    const p = new Uint8Array(FmToneParameterCount);
    const { writes, setReg } = createRegisterSink();
    writeFmToneRegisters(p, 0, setReg, 1); // 左出力
    expect(writes.get(0x20)).toBe(1 << 6);
  });
});

describe('fmKcKfForPitch', () => {
  it('C4 (pitch 0) は KC=$40 / KF=0', () => {
    expect(fmKcKfForPitch(0)).toEqual({ kc: 0x40, kf: 0 });
  });

  it('A4 (9 semitones) は KC=$4C / KF=0', () => {
    expect(fmKcKfForPitch(9 * 64)).toEqual({ kc: 0x4c, kf: 0 });
  });

  it('半音未満の端数は KF へ展開される', () => {
    expect(fmKcKfForPitch(32)).toEqual({ kc: 0x40, kf: 32 });
  });

  it('負のピッチ (B2 = -10 semitones) は下のオクターブへ展開される', () => {
    expect(fmKcKfForPitch(-10 * 64)).toEqual({ kc: 0x32, kf: 0 });
  });

  it('音域外はクランプされる', () => {
    expect(fmKcKfForPitch(-100000)).toEqual({ kc: 0x00, kf: 0 });
    expect(fmKcKfForPitch(100000)).toEqual({ kc: 0x7e, kf: 63 }); // Octave 7 / B
  });
});

describe('fmToneDataToParameters', () => {
  it('エディタ形式の音色を MZSD 46 パラメータ順へ変換する', () => {
    const tone: FmToneData = {
      id: 1,
      name: 'TEST',
      alg: 4,
      fb: 6,
      ops: [
        { tl: 45, ar: 31, d1r: 12, d1l: 3, d2r: 4, rr: 10, mul: 1, dt1: 0, dt2: 0, ks: 1, ame: false },
        { tl: 24, ar: 30, d1r: 18, d1l: 6, d2r: 2, rr: 8, mul: 2, dt1: 3, dt2: 1, ks: 2, ame: true },
        { tl: 32, ar: 29, d1r: 14, d1l: 4, d2r: 3, rr: 9, mul: 14, dt1: 5, dt2: 2, ks: 3, ame: false },
        { tl: 0, ar: 28, d1r: 8, d1l: 2, d2r: 1, rr: 7, mul: 15, dt1: 7, dt2: 3, ks: 0, ame: false },
      ],
    };

    const p = fmToneDataToParameters(tone);
    expect(p.length).toBe(FmToneParameterCount);
    expect(p[0]).toBe(4); // ALG
    expect(p[1]).toBe(6); // FB

    // OP2 (index 1): AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME の順
    const o = 2 + 11;
    expect([...p.slice(o, o + 11)]).toEqual([30, 18, 2, 8, 6, 24, 2, 2, 3, 1, 1]);
  });
});
