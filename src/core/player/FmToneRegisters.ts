/**
 * YM2151 (OPM) FM 音色パラメータ (46 個) のレジスタ展開とピッチ内部値 → KC/KF 展開の純粋関数群。
 * MML 演奏 (TrackSequencer) と仮想キーボード / エディタ試聴 (KeyboardSoundEngine) の
 * 双方から参照される「単一の正」として、UI 非依存の core 層に配置する。
 */
import type { FmToneData } from '../fm/FmTone';
import { FmToneParameterCount } from './MzsdSong';

/** MIDI ノート 60 (C4) に対応する OPM オクターブコード。 */
export const FM_C4_OCTAVE = 4;

/** ピッチ内部値の 1 セミトーン (= KC/KF 展開の分解能)。 */
export const FM_PITCH_UNIT = 64;

/** OPM ノートコード (C=0, C#=1, D=2, D#=4, E=5, F=6, F#=8, G=9, G#=10, A=12, A#=13, B=14)。 */
export const FM_NOTE_CODES = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14] as const;

/** @FM 音色パラメータのレジスタ展開結果 (音量オフセット合成 / PAN 再合成用)。 */
export interface FmToneRegisterState {
  /** $20 下位 5bit 再合成用の ALG/FB 合成値。 */
  readonly algFb: number;

  /** OP ごとの音色 TL (音量オフセット合成の基準)。 */
  readonly toneLevels: readonly [number, number, number, number];
}

/**
 * @FM 音色パラメータ (46 個) を OPM レジスタ ($20 / $40 / $60 / $80 / $A0 / $C0 / $E0 系) へ
 * 展開し、setReg 経由で書き込む。TL は音色の基準値を書き、音量オフセット合成は呼び出し側の責務。
 */
export function writeFmToneRegisters(
  parameters: Uint8Array,
  channel: number,
  setReg: (register: number, value: number) => void,
  pan: number = 3,
): FmToneRegisterState {
  const p = parameters;

  // RL (PAN: p コマンド値) / FB / ALG
  const algFb = ((p[1] & 7) << 3) | (p[0] & 7);
  setReg(0x20 + channel, (pan << 6) | algFb);

  const toneLevels = [0, 0, 0, 0] as [number, number, number, number];
  for (let op = 0; op < 4; op++) {
    const o = 2 + op * 11; // AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME
    setReg(0x40 + (op << 3) + channel, ((p[o + 10] & 1) << 7) | ((p[o + 8] & 7) << 4) | (p[o + 7] & 15));
    toneLevels[op] = p[o + 5] & 127; // 音色 TL を返す (呼び出し側で音量オフセットと合成)
    setReg(0x60 + (op << 3) + channel, p[o + 5] & 127); // TL 基準値 (ノート開始時に音量合成値へ置換)
    setReg(0x80 + (op << 3) + channel, ((p[o + 6] & 3) << 6) | (p[o + 0] & 31));
    setReg(0xa0 + (op << 3) + channel, p[o + 1] & 31);
    setReg(0xc0 + (op << 3) + channel, ((p[o + 9] & 3) << 6) | (p[o + 2] & 31));
    setReg(0xe0 + (op << 3) + channel, ((p[o + 4] & 15) << 4) | (p[o + 3] & 15));
  }

  return { algFb, toneLevels };
}

/** ピッチ内部値 (C4 = 0、1 semitone = 64) を KC / KF へ展開する (音域外はクランプ)。 */
export function fmKcKfForPitch(pitch: number): { kc: number; kf: number } {
  const semitones = Math.floor(pitch / FM_PITCH_UNIT);
  let fraction = pitch - semitones * FM_PITCH_UNIT;
  let octave = FM_C4_OCTAVE + Math.floor(semitones / 12);
  let noteIndex = semitones - (octave - FM_C4_OCTAVE) * 12;

  if (octave < 0) {
    octave = 0;
    noteIndex = 0;
    fraction = 0;
  } else if (octave > 7) {
    octave = 7;
    noteIndex = 11;
    fraction = FM_PITCH_UNIT - 1;
  }

  return { kc: (octave << 4) | FM_NOTE_CODES[noteIndex], kf: fraction };
}

/** エディタ形式の音色 (FmToneData) を MZSD の 46 パラメータ列へ変換する。 */
export function fmToneDataToParameters(tone: FmToneData): Uint8Array {
  const p = new Uint8Array(FmToneParameterCount);
  p[0] = tone.alg & 7;
  p[1] = tone.fb & 7;
  for (let op = 0; op < 4; op++) {
    const o = 2 + op * 11; // AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME
    const src = tone.ops[op];
    p[o + 0] = src.ar & 31;
    p[o + 1] = src.d1r & 31;
    p[o + 2] = src.d2r & 31;
    p[o + 3] = src.rr & 31;
    p[o + 4] = src.d1l & 15;
    p[o + 5] = src.tl & 127;
    p[o + 6] = src.ks & 3;
    p[o + 7] = src.mul & 15;
    p[o + 8] = src.dt1 & 7;
    p[o + 9] = src.dt2 & 3;
    p[o + 10] = src.ame ? 1 : 0;
  }
  return p;
}
