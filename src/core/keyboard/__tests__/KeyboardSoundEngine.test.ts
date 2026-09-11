import { describe, expect, it } from 'vitest';
import { KeyboardSoundEngine } from '../KeyboardSoundEngine';
import { DcsgChip } from '../../chips/DcsgChip';
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
  it('初期状態で全チップは無音 (DCSG の減衰レジスタ初期値 0 = 最大音量のノイズ ch を無音化する)', () => {
    const engine = new KeyboardSoundEngine();
    const { psg1, psg2, beep } = engine.mixer.chips;

    // DCSG は減衰 0 (= 最大音量) だとノイズ ch が最初から鳴り続けるため、
    // MZSD ドライバと同様に全チャンネル減衰 15 で開始しなければならない
    for (const chip of [psg1, psg2]) {
      for (let channel = 0; channel < 4; channel++) {
        expect(chip.attenuationRegister(channel)).toBe(15);
        expect(chip.renderSample(48000)).toBe(0);
      }
    }
    expect(beep.renderSample(48000)).toBe(0);
  });

  it('FM 発音中に DCSG ノイズが混入しない (L/R の標本が独立ノイズで汚染されない)', () => {
    const engine = new KeyboardSoundEngine();
    engine.fmNoteOn(72, { fmTone: testTone, volume: 15 });

    const buffer = tick(engine, 10);

    // PSG の減衰レジスタは書き換えられていない (FM 発音は DCSG に触れない)
    for (const chip of [engine.mixer.chips.psg1, engine.mixer.chips.psg2]) {
      for (let channel = 0; channel < 4; channel++) {
        expect(chip.attenuationRegister(channel)).toBe(15);
      }
    }

    // 出力は FM (中央) のみ: L と R は完全一致する
    for (let i = 0; i < buffer.length; i += 2) {
      if (buffer[i] !== 0 || buffer[i + 1] !== 0) {
        expect(buffer[i]).toBe(buffer[i + 1]);
        break;
      }
    }
  });

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

describe('KeyboardSoundEngine — PSG (DCSG)', () => {
  it('psgNoteOn はトーン周期レジスタと減衰レジスタへ書き込む (実機レジスタ式)', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(69, { volume: 15 }); // A4 = period 253

    const psg1 = engine.mixer.chips.psg1;
    expect(psg1.tonePeriodRegister(0)).toBe(253); // DcsgChip.tonePeriodForFrequency と同一式
    expect(psg1.attenuationRegister(0)).toBe(0); // v15 → 減衰 0
    expect(engine.activeVoiceCount).toBe(1);
  });

  it('音量 v は減衰 = 15 - v として書き込まれる', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(60, { volume: 8 });
    expect(engine.mixer.chips.psg1.attenuationRegister(0)).toBe(7);
  });

  it('@IN 統合モードは tone2 連動クロックでノイズ ch へ発音を切替える (トーン 3 は無音)', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(69, { volume: 10, noiseIntegrate: 2 });

    const psg1 = engine.mixer.chips.psg1;
    expect(psg1.attenuationRegister(3)).toBe(5); // ノイズ ch へ減衰
    expect(psg1.attenuationRegister(2)).toBe(15); // トーン 3 は無音化
    expect(psg1.tonePeriodRegister(2)).toBe(253); // tone2 へ音程 (ノイズシフトクロック源)
    expect(psg1.noiseClock).toBeCloseTo(psg1.toneFrequency(2) * 16.0, 3); // rate 3 = tone2 × 16 連動
  });

  it('PSG トーンは実機どおり 6 音声 (psg1×3 + psg2×3)。7 音目は最古ボイスを steal', () => {
    const engine = new KeyboardSoundEngine();
    for (let note = 60; note < 66; note++) {
      engine.psgNoteOn(note, { volume: 15 });
    }
    expect(engine.activeVoiceCount).toBe(6);

    engine.psgNoteOn(66, { volume: 15 }); // 7 音目 → note 60 を steal
    expect(engine.activeVoiceCount).toBe(6);
    expect(engine.hasVoice(60)).toBe(false);
    expect(engine.hasVoice(66)).toBe(true);
  });

  it('chip: 1 指定の psgNoteOn は psg2 (DCSG2 = 右チャンネル) へ発音する', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(69, { volume: 15, chip: 1 });

    expect(engine.mixer.chips.psg2.tonePeriodRegister(0)).toBe(253);
    expect(engine.mixer.chips.psg2.attenuationRegister(0)).toBe(0);
    expect(engine.mixer.chips.psg1.attenuationRegister(0)).toBe(15); // psg1 側は無音のまま
  });

  it('chip 指定時は同一チップ内でのみ割り当て・steal する (空きのある別チップへ逃げない)', () => {
    const engine = new KeyboardSoundEngine();
    for (let note = 60; note < 63; note++) {
      engine.psgNoteOn(note, { volume: 15, chip: 1 }); // psg2 のトーン 3 音声を占有
    }
    engine.psgNoteOn(63, { volume: 15, chip: 1 }); // 4 音目 → psg2 の最古ボイス (note 60) を steal

    expect(engine.activeVoiceCount).toBe(3);
    expect(engine.hasVoice(60)).toBe(false);
    expect(engine.hasVoice(63)).toBe(true);
    // psg1 (chip 0) へは一切発音しない
    for (let channel = 0; channel < 3; channel++) {
      expect(engine.mixer.chips.psg1.attenuationRegister(channel)).toBe(15);
    }
  });

  it('chip: 0 指定の noiseNoteOn は psg1 のノイズ ch へ発音する (N1 = 左 / N2 = 右の定位)', () => {
    const engine = new KeyboardSoundEngine();
    engine.noiseNoteOn(60, { volume: 10, chip: 0 });

    expect(engine.mixer.chips.psg1.attenuationRegister(3)).toBe(5);
    expect(engine.mixer.chips.psg2.attenuationRegister(3)).toBe(15);
  });

  it('@VE は 60Hz で減衰レジスタへ反映される (サステイン末尾でホールド)', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(60, { volume: 15, volEnv: [15, 10, 5], volEnvLoop: -1 });

    const psg1 = engine.mixer.chips.psg1;
    expect(psg1.attenuationRegister(0)).toBe(0); // ノート開始 = 音量直送 (v15)

    tick(engine, 1); // frame 1 = env[0] = 15 (TrackSequencer と同一・1 フレーム遅れで反映)
    expect(psg1.attenuationRegister(0)).toBe(0);

    tick(engine, 1); // frame 2 = env[1] = 10
    expect(psg1.attenuationRegister(0)).toBe(5);

    tick(engine, 1); // frame 3 = env[2] = 5
    expect(psg1.attenuationRegister(0)).toBe(10);

    tick(engine, 5); // 末尾でホールド
    expect(psg1.attenuationRegister(0)).toBe(10);
  });

  it('キーオフで @VE リリース区間を 1 回だけ再生し、終了後に減衰 15 で解放される', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(60, { volume: 15, volEnv: [15, 12], volEnvLoop: -1, volEnvRelease: 1 });
    engine.dcsgNoteOff(60);

    const psg1 = engine.mixer.chips.psg1;
    expect(psg1.attenuationRegister(0)).toBe(3); // リリース先頭 env[1] = 12 → 減衰 3

    tick(engine, 4); // リリース 1 フレーム + マージン 2 を経過 → 解放
    expect(psg1.attenuationRegister(0)).toBe(15);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('リリース定義のないキーオフは即時消音 (減衰 15) される', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(60, { volume: 15 });
    engine.dcsgNoteOff(60);

    expect(engine.mixer.chips.psg1.attenuationRegister(0)).toBe(15);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('@PE はトーン周期をレジスタ差分単位で変調する (period = base - pitchUp)', () => {
    const engine = new KeyboardSoundEngine();
    engine.psgNoteOn(69, { volume: 15, pitchEnv: [10], pitchEnvLoop: -1 }); // A4 = period 253

    tick(engine, 1); // frame 1 → pitchUp = 10 → period 243
    expect(engine.mixer.chips.psg1.tonePeriodRegister(0)).toBe(243);
  });
});

describe('KeyboardSoundEngine — ノイズ (DCSG)', () => {
  it('noiseNoteOn はノイズ ch (ch3) へ減衰を書き、音名 3 段階の分周レートを設定する', () => {
    const engine = new KeyboardSoundEngine();
    engine.noiseNoteOn(60, { volume: 10, noiseType: 'white' }); // C4 = 低レート (2)

    const psg1 = engine.mixer.chips.psg1;
    expect(psg1.attenuationRegister(3)).toBe(5);
    // rate 2 (Clock/64) = Clock / 16 / 4
    expect(psg1.noiseClock).toBeCloseTo(DcsgChip.ClockHz / 16.0 / 4, 3);
    expect(engine.activeVoiceCount).toBe(1);
  });

  it('ノイズは実機どおり 2 音声。3 音目は最古ボイスを steal', () => {
    const engine = new KeyboardSoundEngine();
    engine.noiseNoteOn(60, { volume: 15 });
    engine.noiseNoteOn(62, { volume: 15 });
    engine.noiseNoteOn(64, { volume: 15 });

    expect(engine.activeVoiceCount).toBe(2);
    expect(engine.hasVoice(60)).toBe(false); // 最古が steal される
    expect(engine.hasVoice(64)).toBe(true);
  });
});

describe('KeyboardSoundEngine — BEEP (8253)', () => {
  it('beepNoteOn はカウンタを直書きしてゲートオン。キーオフでゲートオフ', () => {
    const engine = new KeyboardSoundEngine();
    engine.beepNoteOn(69, {}); // A4 = round(894886.25 / 440) = 2034

    const beep = engine.mixer.chips.beep;
    expect(beep.counterValue).toBe(Math.round(894886.25 / 440));
    expect(beep.isGateOn).toBe(true);

    engine.dcsgNoteOff(69);
    expect(beep.isGateOn).toBe(false);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('BEEP は同時 1 音。2 音目は前の音を上書きする', () => {
    const engine = new KeyboardSoundEngine();
    engine.beepNoteOn(69, {});
    engine.beepNoteOn(72, {});

    expect(engine.activeVoiceCount).toBe(1);
    expect(engine.mixer.chips.beep.isGateOn).toBe(true);
  });

  it('@PE は 8253 カウンタを差分単位で変調する (カウンタ増加 = 音程下降)', () => {
    const engine = new KeyboardSoundEngine();
    engine.beepNoteOn(69, { pitchEnv: [100], pitchEnvLoop: -1 });

    tick(engine, 1); // frame 1 → counter = base + 100
    expect(engine.mixer.chips.beep.counterValue).toBe(Math.round(894886.25 / 440) + 100);
  });
});
