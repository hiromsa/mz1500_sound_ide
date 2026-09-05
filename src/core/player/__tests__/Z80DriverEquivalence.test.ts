/**
 * C# リファレンス実装 (MzsdSequencer) と Z80 サウンドドライバの
 * フレーム単位の等価性検証。同一 MZSD データを両エンジンで演奏し、
 * 全フレームのチップレジスタ状態 (PSG x2 / BEEP / YM2151 全レジスタ) を比較する。
 * (移植元: tests/MzSound.Player.Tests/Z80DriverEquivalenceTests.cs)
 */
import { describe, expect, it } from 'vitest';
import { ChipBank } from '../../chips/ChipBank';
import { MmlCompiler } from '../../mml/MmlCompiler';
import { FmToneParameterCount, MzsdSong } from '../MzsdSong';
import { MzsdSequencer } from '../MzsdSequencer';
import { SongBuilder } from './SongBuilder';
import { Z80DriverImage } from '../Z80DriverImage';
import { Z80DriverMachine } from '../Z80DriverMachine';

/** 両エンジンで同一曲を演奏し、全フレームのチップ状態を比較する。 */
function runBoth(builder: SongBuilder, frames: number, loop: boolean, scenario: string): void {
  runBothData(builder.build(), frames, loop, scenario);
}

function runBothData(data: Uint8Array, frames: number, loop: boolean, scenario: string): void {
  const referenceChips = new ChipBank();
  const reference = new MzsdSequencer(MzsdSong.parse(data), referenceChips, loop);

  const z80Chips = new ChipBank();
  const machine = new Z80DriverMachine(z80Chips);
  machine.load(Z80DriverImage.defaultDriver, data, loop);

  // ドライバのブート (ワーク / FM 初期化) が完了し STAT_PLAY (bit0) が立つまで実行する。
  // (完了後は各 RunFrame の先頭で H-BLANK エッジ -> 演奏フレーム 1 回分が処理される
  // = MzsdSequencer.tick() と 1:1 に対応する)
  let bootGuard = 0;
  while ((machine.status & 0x01) === 0 && bootGuard++ < 4) {
    machine.runFrame();
  }

  const diffs: string[] = [];
  for (let frame = 0; frame < frames; frame++) {
    reference.tick();
    machine.runFrame();
    compareChips(referenceChips, z80Chips, frame, diffs);
  }

  expect(diffs.join('\n'), scenario).toBe('');
}

function compareChips(
  expected: ChipBank,
  actual: ChipBank,
  frame: number,
  diffs: string[],
): void {
  comparePsg('PSG1', expected.psg1, actual.psg1, frame, diffs);
  comparePsg('PSG2', expected.psg2, actual.psg2, frame, diffs);

  if (expected.beep.counterValue !== actual.beep.counterValue) {
    diffs.push(
      `frame ${frame}: BEEP counter ${expected.beep.counterValue} != ${actual.beep.counterValue}`,
    );
  }

  if (expected.beep.isGateOn !== actual.beep.isGateOn) {
    diffs.push(`frame ${frame}: BEEP gate ${expected.beep.isGateOn} != ${actual.beep.isGateOn}`);
  }

  // YM2151 の書き込み済み全レジスタ (0x00-0xFF) を比較する
  for (let reg = 0; reg < 0x100; reg++) {
    const expectedValue = expected.fm.tryGetRegister(reg);
    const actualValue = actual.fm.tryGetRegister(reg);
    if ((expectedValue === null) !== (actualValue === null)) {
      diffs.push(
        `frame ${frame}: FM reg ${reg.toString(16)}h written ${expectedValue !== null} != ${actualValue !== null}`,
      );
    } else if (expectedValue !== null && actualValue !== null && expectedValue.value !== actualValue.value) {
      diffs.push(`frame ${frame}: FM reg ${reg.toString(16)}h ${expectedValue.value} != ${actualValue.value}`);
    }
  }
}

function comparePsg(
  name: string,
  expected: ChipBank['psg1'],
  actual: ChipBank['psg1'],
  frame: number,
  diffs: string[],
): void {
  for (let ch = 0; ch < 3; ch++) {
    if (expected.tonePeriodRegister(ch) !== actual.tonePeriodRegister(ch)) {
      diffs.push(
        `frame ${frame}: ${name} tone${ch} period ${expected.tonePeriodRegister(ch)} != ${actual.tonePeriodRegister(ch)}`,
      );
    }
  }

  for (let ch = 0; ch < 4; ch++) {
    if (expected.attenuationRegister(ch) !== actual.attenuationRegister(ch)) {
      diffs.push(
        `frame ${frame}: ${name} att${ch} ${expected.attenuationRegister(ch)} != ${actual.attenuationRegister(ch)}`,
      );
    }
  }

  if (expected.isNoiseWhite !== actual.isNoiseWhite) {
    diffs.push(
      `frame ${frame}: ${name} noise white ${expected.isNoiseWhite} != ${actual.isNoiseWhite}`,
    );
  }

  if (expected.noiseRateMode !== actual.noiseRateMode) {
    diffs.push(
      `frame ${frame}: ${name} noise rate ${expected.noiseRateMode} != ${actual.noiseRateMode}`,
    );
  }
}

describe('Z80Driver 等価性 (SourceInterpreter vs Z80Driver)', () => {
  it('全チャンネル NOTE/REST/VOLUME がリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addTrack(
      0,
      SongBuilder.volume(10),
      SongBuilder.note(69, 6, 6),
      SongBuilder.rest(3),
      SongBuilder.note(72, 8, 4),
      SongBuilder.note(67, 4, 4),
      SongBuilder.trackEnd(),
    ); // P1
    builder.addTrack(
      1,
      SongBuilder.note(60, 10, 8),
      SongBuilder.note(64, 10, 10),
      SongBuilder.trackEnd(),
    ); // P2
    builder.addTrack(
      4,
      SongBuilder.volume(12),
      SongBuilder.note(48, 8, 8),
      SongBuilder.rest(4),
      SongBuilder.note(53, 8, 8),
      SongBuilder.trackEnd(),
    ); // P4 (PSG2)
    builder.addTrack(5, SongBuilder.note(55, 12, 12), SongBuilder.trackEnd()); // P5 (PSG2)
    builder.addTrack(
      3,
      SongBuilder.note(80, 5, 5),
      SongBuilder.rest(5),
      SongBuilder.note(81, 5, 3),
      SongBuilder.trackEnd(),
    ); // N1
    builder.addTrack(7, SongBuilder.note(90, 6, 6), SongBuilder.trackEnd()); // N2
    builder.addTrack(
      8,
      SongBuilder.note(69, 4, 4),
      SongBuilder.rest(4),
      SongBuilder.note(72, 6, 6),
      SongBuilder.trackEnd(),
    ); // B1

    runBoth(builder, 40, false, '全チャンネル NOTE/REST/VOLUME');
  });

  it('音量エンベロープ (ループ/リリース) がリファレンスと一致する', () => {
    const builder = new SongBuilder();
    // サステインループ (2..7) + リリース (5 から)
    builder.addVolumeEnvelope([0, 3, 6, 8, 10, 12, 14, 15], 2, 5);
    builder.addVolumeEnvelope([15, 12, 9, 6, 3, 0]); // ループ / リリースなし
    builder.addTrack(
      0,
      SongBuilder.venv(0),
      SongBuilder.note(69, 20, 20), // 発音中にループエンベロープ
      SongBuilder.rest(6), // REST でもリリース再始動 (C# KeyOff 準拠)
      SongBuilder.venv(1),
      SongBuilder.note(72, 12, 5), // ゲート短め -> キーオフ後は無音
      SongBuilder.venv(0xff), // エンベロープ解除
      SongBuilder.volume(8),
      SongBuilder.note(74, 6, 6),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      1,
      SongBuilder.venv(2), // 存在しない番号 (クランプ -> 1)
      SongBuilder.note(60, 15, 15),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      8,
      SongBuilder.venv(0), // BEEP でもエンベロープ (ゲート ON/OFF に反映)
      SongBuilder.note(69, 10, 10),
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 50, false, '音量エンベロープ (ループ/リリース)');
  });

  it('ピッチエンベロープ / スイープ / ディチューンがリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addPitchEnvelope([0, 8, 16, -8], 1);
    builder.addPitchEnvelope([0, -4, -8, -12, -16]); // ループなし (末尾ホールド)
    builder.addTrack(
      0,
      SongBuilder.penv(0),
      SongBuilder.note(60, 14, 14), // 発音中にループピッチエンベロープ
      SongBuilder.penv(1),
      SongBuilder.note(62, 10, 8),
      SongBuilder.penv(0xff),
      SongBuilder.detune(-6),
      SongBuilder.note(64, 8, 8), // ディチューンのみ
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      1,
      SongBuilder.sweep(2),
      SongBuilder.note(55, 12, 12), // 上昇スイープ
      SongBuilder.sweep(-3),
      SongBuilder.note(57, 12, 12), // 下降スイープ
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      8,
      SongBuilder.penv(0),
      SongBuilder.sweep(5),
      SongBuilder.detune(10),
      SongBuilder.note(69, 16, 16), // BEEP: PENV + スイープ + ディチューン
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 45, false, 'ピッチエンベロープ / スイープ / ディチューン');
  });

  it('ノイズモード (同期 / 非同期) がリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addTrack(
      3,
      SongBuilder.noiseCtl(0x06), // 同期 (white)
      SongBuilder.note(69, 6, 6),
      SongBuilder.noiseCtl(0x04), // 同期 (periodic)
      SongBuilder.note(72, 6, 6),
      SongBuilder.noiseCtl(0x01), // 非同期 white (ヒントは音程から)
      SongBuilder.note(60, 6, 6),
      SongBuilder.noiseCtl(0x00), // 非同期 periodic
      SongBuilder.note(48, 6, 6),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      7,
      SongBuilder.noiseCtl(0x07),
      SongBuilder.note(84, 8, 8),
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 30, false, 'ノイズモード (同期 / 非同期)');
  });

  it('全体ループ (L) がリファレンスと一致する', () => {
    const builder = new SongBuilder();
    const noteOffset = builder.addTrack(
      0,
      SongBuilder.note(69, 5, 5),
      SongBuilder.note(72, 5, 5),
      SongBuilder.trackEnd(),
    );
    builder.setLoop(0, noteOffset);
    builder.addTrack(
      1,
      SongBuilder.note(60, 4, 4),
      SongBuilder.rest(6),
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 60, true, '全体ループ (L)');
  });

  it('ネストループがリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addTrack(
      0,
      SongBuilder.note(60, 3, 3),
      SongBuilder.loopStart(),
      SongBuilder.note(62, 2, 2),
      SongBuilder.loopStart(),
      SongBuilder.note(64, 2, 2),
      SongBuilder.loopEnd(3),
      SongBuilder.note(65, 2, 2),
      SongBuilder.loopEnd(2),
      SongBuilder.note(67, 4, 4),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      8,
      SongBuilder.loopStart(),
      SongBuilder.note(69, 2, 2),
      SongBuilder.loopEnd(4),
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 60, false, 'ネストループ');
  });

  it('トランスポーズ / FM トラックがリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addTrack(
      0,
      SongBuilder.transpose(-12),
      SongBuilder.note(72, 5, 5),
      SongBuilder.transpose(5),
      SongBuilder.note(60, 5, 5),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(9, SongBuilder.note(60, 8, 8), SongBuilder.trackEnd()); // FM トラック

    runBoth(builder, 25, false, 'トランスポーズ / FM トラック');
  });

  // C# 版も同一理由 (Z80 apply_fm_tone のレジスタマッピング未一致) でスキップしている
  it.skip('FM 音色 / ノート / 音量がリファレンスと一致する (TODO: Z80 apply_fm_tone のレジスタマッピング)', () => {
    const builder = new SongBuilder();
    // @FM0: ALG4 / FB3 (パラメータ差がレジスタへ反映されることを確認)
    const tone0 = new Uint8Array(FmToneParameterCount);
    tone0[0] = 4;
    tone0[1] = 3;
    for (let op = 0; op < 4; op++) {
      const o = 2 + op * 11;
      tone0[o] = 31;
      tone0[o + 1] = 10 + op;
      tone0[o + 5] = 40 - op * 5; // TL
      tone0[o + 7] = op + 1; // MUL
      tone0[o + 8] = op & 3; // DT1
    }

    // @FM1: ALG0 / FB7 (AME / D1L / RR など bit 合成を含む)
    const tone1 = new Uint8Array(FmToneParameterCount);
    tone1[0] = 0;
    tone1[1] = 7;
    for (let op = 0; op < 4; op++) {
      const o = 2 + op * 11;
      tone1[o] = 31;
      tone1[o + 1] = 15;
      tone1[o + 2] = 5;
      tone1[o + 3] = 7;
      tone1[o + 4] = 8;
      tone1[o + 5] = 20;
      tone1[o + 6] = 1;
      tone1[o + 7] = 15;
      tone1[o + 8] = 3;
      tone1[o + 9] = 2;
      tone1[o + 10] = 1;
    }

    builder.addFmTone(tone0);
    builder.addFmTone(tone1);
    builder.addTrack(
      9,
      SongBuilder.tone(0),
      SongBuilder.note(60, 6, 6),
      SongBuilder.note(72, 6, 6),
      SongBuilder.tone(1),
      SongBuilder.note(69, 6, 6),
      SongBuilder.volume(8),
      SongBuilder.note(64, 6, 6),
      SongBuilder.rest(4),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      10,
      SongBuilder.tone(1),
      SongBuilder.note(48, 10, 8),
      SongBuilder.note(55, 10, 8),
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 40, false, 'FM 音色 / ノート / 音量');
  });

  it('FM ピッチエンベロープ / スイープ / ディチューン / トランスポーズがリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addFmTone(new Uint8Array(FmToneParameterCount)); // 音色 0 (全 0)
    const penv = builder.addPitchEnvelope([0, 32, -32, 64], 255);
    builder.addTrack(
      9,
      SongBuilder.penv(penv),
      SongBuilder.sweep(-8),
      SongBuilder.detune(100),
      SongBuilder.note(60, 10, 10),
      SongBuilder.sweep(16),
      SongBuilder.detune(-250),
      SongBuilder.note(67, 10, 10),
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      15,
      SongBuilder.transpose(-12),
      SongBuilder.note(72, 8, 8),
      SongBuilder.transpose(24),
      SongBuilder.note(48, 8, 8),
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 40, false, 'FM ピッチエンベロープ / スイープ / ディチューン / トランスポーズ');
  });

  it('FM ピッチクランプ境界がリファレンスと一致する', () => {
    const builder = new SongBuilder();
    builder.addFmTone(new Uint8Array(FmToneParameterCount));
    builder.addTrack(
      9,
      SongBuilder.transpose(-127),
      SongBuilder.note(0, 6, 6), // note+trans = -127 -> octave < 0 クランプ
      SongBuilder.transpose(127),
      SongBuilder.note(127, 6, 6), // note+trans = 254 -> octave > 7 クランプ
      SongBuilder.transpose(0),
      SongBuilder.note(60, 6, 6), // 境界内 (C4)
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      10,
      SongBuilder.transpose(-48),
      SongBuilder.note(48, 8, 8), // note+trans = 0 -> semitones -60 -> octave < 0 クランプ
      SongBuilder.transpose(48),
      SongBuilder.note(72, 8, 8), // note+trans = 120 -> semitones 60 -> octave > 7 クランプ
      SongBuilder.trackEnd(),
    );
    builder.addTrack(
      11,
      SongBuilder.transpose(-48),
      SongBuilder.note(60, 8, 8), // note+trans = 12 -> semitones -48 = octave 0 ちょうど (クランプなし)
      SongBuilder.trackEnd(),
    );

    runBoth(builder, 28, false, 'FM ピッチクランプ境界');
  });

  // C# 版も同一理由 (@FM 音色レジスタマッピング未一致、上記 skip と同一原因) でスキップしている
  it.skip('MML コンパイル曲がリファレンスと一致する (TODO: @FM 音色レジスタマッピング)', () => {
    // MML → コンパイラで生成した実データで両エンジンを比較 (エンベロープ / ノイズ / BEEP / FM / L ループ含む)
    const mml = [
      '@v0 = {15, 12, 9, |, 6, 3}',
      '@v1 = {12, 9, 6, 3, 0}',
      '@EP0 = {0, 6, 12, 6}',
      '@FM0 = {',
      '  4, 3',
      '  31, 10, 0, 0, 0, 40, 0, 1, 0, 0, 0',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0',
      '  31, 12, 0, 0, 0, 30, 0, 2, 0, 0, 0',
      '}',
      '',
      't140',
      'P1 @v0 o4 l8 [c d e f]2 @v1 g2 e4',
      'P2 @EP0 o3 l8 c c d d e2',
      'P4 o2 l4 c c',
      'N1 @in2 o8 l8 c c g g',
      'N2 @wn1 o10 l16 c c c c',
      'B1 l4 c r c r',
      'F1 @0 o4 l8 c d e c g2',
      'L',
    ].join('\n');

    const result = new MmlCompiler().compile(mml);
    expect(result.success, result.diagnostics.map((d) => String(d)).join('\n')).toBe(true);
    expect(result.musicData).not.toBeNull();

    runBothData(result.musicData as Uint8Array, 120, true, 'MML コンパイル曲');
  });
});
