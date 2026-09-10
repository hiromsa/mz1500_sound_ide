import { describe, expect, it } from 'vitest';
import { KeyboardSoundEngine } from '../KeyboardSoundEngine';
import type { FmToneData } from '../../fm/FmTone';

/** テスト用の簡易音色 (ALG 0 直列 / OP4 キャリア)。 */
const testTone: FmToneData = {
  id: 1,
  name: 'TEST',
  alg: 0,
  fb: 0,
  ops: [
    { tl: 20, ar: 31, d1r: 10, d1l: 5, d2r: 3, rr: 10, mul: 1, dt1: 0, dt2: 0, ks: 0, ame: false },
    { tl: 20, ar: 31, d1r: 10, d1l: 5, d2r: 3, rr: 10, mul: 1, dt1: 0, dt2: 0, ks: 0, ame: false },
    { tl: 20, ar: 31, d1r: 10, d1l: 5, d2r: 3, rr: 10, mul: 1, dt1: 0, dt2: 0, ks: 0, ame: false },
    { tl: 0, ar: 31, d1r: 10, d1l: 5, d2r: 3, rr: 10, mul: 1, dt1: 0, dt2: 0, ks: 0, ame: false },
  ],
};

/** 1 tick = 800 frames (48kHz / 60Hz)。 */
function tick(engine: KeyboardSoundEngine, frames = 1): Float32Array {
  const buffer = new Float32Array(frames * 800 * 2);
  engine.read(buffer);
  return buffer;
}

describe('KeyboardSoundEngine', () => {
  it('fmNoteOn で音色レジスタ / KC-KF / KEY ON が書かれる', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15 });

    const fm = engine.mixer.chips.fm;
    expect(fm.isKeyOn(0)).toBe(true);
    expect(fm.tryGetRegister(0x28 + 0)?.value).toBe(0x40); // C4
    expect(fm.tryGetRegister(0x30 + 0)?.value).toBe(0); // KF
    expect(fm.tryGetRegister(0x60 + (3 << 3) + 0)?.value).toBe(0); // OP4 TL = 音色 TL (v15 はオフセット 0)
    expect(engine.activeVoiceCount).toBe(1);
  });

  it('音量 v は (15 - v) × 8 の TL オフセットとして合成される (TrackSequencer と同一式)', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 8 });

    const tl = engine.mixer.chips.fm.tryGetRegister(0x60 + (3 << 3) + 0)?.value;
    expect(tl).toBe(0 + (15 - 8) * 8); // OP4 の音色 TL 0 + 56
  });

  it('OP ミュートは TL +127 (クランプ) で表現される', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15, opMuted: [true, false, false, false] });

    expect(engine.mixer.chips.fm.tryGetRegister(0x60 + 0)?.value).toBe(127);
    expect(engine.mixer.chips.fm.tryGetRegister(0x60 + 8)?.value).toBe(20); // ミュート外は音色 TL のまま
  });

  it('同音のリトリガーは即時停止してから発音し直す', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15 });
    engine.fmNoteOn(60, { fmTone: testTone, volume: 5 });

    expect(engine.activeVoiceCount).toBe(1);

    const fm = engine.mixer.chips.fm;
    const keyOnChannels = [0, 1, 2, 3, 4, 5, 6, 7].filter((ch) => fm.isKeyOn(ch));
    expect(keyOnChannels).toHaveLength(1);
    expect(fm.tryGetRegister(0x60 + (3 << 3) + keyOnChannels[0])?.value).toBe((15 - 5) * 8);
  });

  it('FM 8ch を round-robin で割り当て、9 音目は最古ボイスを steal する', () => {
    const engine = new KeyboardSoundEngine();
    for (let note = 60; note < 68; note++) {
      engine.fmNoteOn(note, { fmTone: testTone, volume: 15 });
    }
    expect(engine.activeVoiceCount).toBe(8);

    // 9 音目: 最古 (note 60) が steal 対象
    engine.fmNoteOn(68, { fmTone: testTone, volume: 15 });
    expect(engine.activeVoiceCount).toBe(8);
    expect(engine.hasVoice(60)).toBe(false);
    expect(engine.hasVoice(68)).toBe(true);
  });

  it('全チャンネル使用時はリリース中のボイスを優先して steal する', () => {
    const engine = new KeyboardSoundEngine();
    for (let note = 60; note < 68; note++) {
      engine.fmNoteOn(note, { fmTone: testTone, volume: 15 });
    }

    // note 61 をキーオフ (リリース中) → 次の発音は note 61 のチャンネルを再利用する
    engine.fmNoteOff(61);
    engine.fmNoteOn(69, { fmTone: testTone, volume: 15 });

    expect(engine.hasVoice(61)).toBe(false);
    expect(engine.hasVoice(60)).toBe(true); // 発音中の最古は steal されない
    expect(engine.hasVoice(69)).toBe(true);
  });

  it('fmNoteOff は KEY OFF し、推定 RR 減衰時間の経過後にボイスを解放する', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15 });
    engine.fmNoteOff(60);

    expect(engine.mixer.chips.fm.isKeyOn(0)).toBe(false);
    expect(engine.activeVoiceCount).toBe(1); // まだリリース中

    // RR=10 → 0.6 × (1 - 10/31) ≒ 0.406 秒 ≒ 25 フレーム + マージン 8 → 33 フレームで解放
    tick(engine, 34);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('read は発音中に非ゼロの標本を出力し、マスター音量 0 で無音になる', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15 });

    const audible = tick(engine, 4);
    expect(Math.max(...audible.map(Math.abs))).toBeGreaterThan(0);

    engine.setMasterVolume(0);
    const muted = tick(engine, 4);
    expect(Math.max(...muted.map(Math.abs))).toBe(0);
  });

  it('ピッチエンベロープが 60Hz で KC/KF へ反映される (@EP 相当)', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15, pitchEnv: [64, 128], pitchEnvLoop: -1 });

    tick(engine, 1); // 1 フレーム経過 → env[0] = 64 (1 semitone 上)

    const fm = engine.mixer.chips.fm;
    expect(fm.tryGetRegister(0x28)?.value).toBe(0x41); // C#4
    expect(fm.tryGetRegister(0x30)?.value).toBe(0);

    tick(engine, 1); // 2 フレーム経過 → env[1] = 128 (2 semitones 上)
    expect(fm.tryGetRegister(0x28)?.value).toBe(0x42); // D4
  });

  it('allNotesOff は全ボイスを即時解放する (PANIC)', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15 });
    engine.fmNoteOn(64, { fmTone: testTone, volume: 15 });

    engine.allNotesOff();

    expect(engine.activeVoiceCount).toBe(0);
    expect(engine.mixer.chips.fm.isKeyOn(0)).toBe(false);
    expect(engine.mixer.chips.fm.isKeyOn(1)).toBe(false);
  });

  it('releaseAllNotes は全ボイスをキーオフする (RR 減衰へ遷移)', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(60, { fmTone: testTone, volume: 15 });
    engine.fmNoteOn(64, { fmTone: testTone, volume: 15 });

    engine.releaseAllNotes();

    expect(engine.activeVoiceCount).toBe(2); // 減衰中もボイスは保持
    expect(engine.mixer.chips.fm.isKeyOn(0)).toBe(false);
    expect(engine.mixer.chips.fm.isKeyOn(1)).toBe(false);
  });
});
