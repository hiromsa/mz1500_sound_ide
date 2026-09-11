/**
 * FM (OPM) 曲の実機演奏検証プローブ。
 * IDE と同一経路 (MmlCompiler → Z80DriverMachine + ChipBank) で
 * fm_voice_macro.mml を実行し、OPM レジスタ設定と FM 音声出力を観測する。
 * 生成した .qdf は mz1500_emulator_csharp 側の実測 (QdfProbeTests.ObserveFmQdfRegisters /
 * Mz1500.Cli --wav) との比較検証に使用する。
 *
 * 使い方: npx vitest run tools/qdf-probe/fm-probe.test.ts
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MmlCompiler } from '../../src/core/mml/MmlCompiler';
import { Z80DriverImage } from '../../src/core/player/Z80DriverImage';
import { Z80DriverMachine } from '../../src/core/player/Z80DriverMachine';
import { ChipBank } from '../../src/core/chips/ChipBank';
import { buildQuickDiskImage } from '../../src/core/export/QdfImageBuilder';

describe('fm-probe', () => {
  it('plays fm_voice_macro through the internal Z80 driver machine', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const source = readFileSync(
      join(repoRoot, 'samples', 'mml_reference', 'fm', 'fm_voice_macro.mml'),
      'utf8',
    );

    const result = new MmlCompiler().compile(source);
    expect(
      result.success,
      result.diagnostics.map((d) => String(d)).join('\n'),
    ).toBe(true);
    const musicData = result.musicData!;
    console.log(`[fm-probe] musicData: ${musicData.length} bytes`);

    const chips = new ChipBank();
    chips.fm.initialize(48000);
    const machine = new Z80DriverMachine(chips);
    machine.load(Z80DriverImage.defaultDriver, musicData, false);

    let bootGuard = 0;
    while ((machine.status & 0x01) === 0 && bootGuard++ < 8) {
      machine.runFrame();
    }
    console.log(
      `[fm-probe] booted after ${bootGuard} frames, status=0x${machine.status.toString(16)}`,
    );

    // 12 秒分 (720 フレーム) 実行して FM 音声 peak を計測 (C# CLI 実測と同一条件)
    const samplesPerFrame = 800; // 48000 / 60
    const buffer = new Int32Array(samplesPerFrame * 2);
    let peak = 0;
    let keyOnSeen = -1;
    let finishedFrame = -1;
    for (let frame = 0; frame < 720; frame++) {
      machine.runFrame();
      if (machine.isFinished && finishedFrame < 0) {
        finishedFrame = frame;
      }
      if (keyOnSeen < 0) {
        for (let ch = 0; ch < 8; ch++) {
          if (chips.fm.isKeyOn(ch)) {
            keyOnSeen = frame;
            break;
          }
        }
      }

      buffer.fill(0);
      chips.fm.mix(buffer, samplesPerFrame);
      for (let i = 0; i < buffer.length; i++) {
        peak = Math.max(peak, Math.abs(buffer[i]));
      }
    }

    console.log(`[fm-probe] first key-on frame: ${keyOnSeen}`);
    console.log(`[fm-probe] finished frame: ${finishedFrame}`);
    console.log(`[fm-probe] FM peak over 12s: ${peak} (${(peak / 32768).toFixed(4)} float)`);

    // チャンネル 0 のレジスタ状態
    const reg = (r: number): string => {
      const v = chips.fm.tryGetRegister(r);
      return v === null ? '--' : `0x${v.value.toString(16).padStart(2, '0')}`;
    };
    console.log(`[fm-probe] ch0 $20 (RL/FB/ALG): ${reg(0x20)}`);
    console.log(`[fm-probe] ch0 $28 (KC): ${reg(0x28)} / $30 (KF): ${reg(0x30)}`);
    for (let op = 0; op < 4; op++) {
      const base = 0x40 + (op << 3);
      console.log(
        `[fm-probe] op${op + 1} DT1/MUL=${reg(base)} TL=${reg(base + 0x20)} KS/AR=${reg(base + 0x40)} ` +
          `D1R=${reg(base + 0x60)} DT2/D2R=${reg(base + 0x80)} D1L/RR=${reg(base + 0xa0)}`,
      );
    }

    expect(keyOnSeen).toBeGreaterThanOrEqual(0);
    expect(peak).toBeGreaterThan(0);
  });

  it('measures the psg sample peak for comparison', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const source = readFileSync(
      join(repoRoot, 'samples', 'mml_reference', 'psg', 'psg_octave_transpose.mml'),
      'utf8',
    );

    const result = new MmlCompiler().compile(source);
    expect(result.success).toBe(true);

    const chips = new ChipBank();
    const machine = new Z80DriverMachine(chips);
    machine.load(Z80DriverImage.defaultDriver, result.musicData!, false);

    let bootGuard = 0;
    while ((machine.status & 0x01) === 0 && bootGuard++ < 8) {
      machine.runFrame();
    }

    // PSG は renderSample で 1 サンプルずつ
    let peak = 0;
    let finishedFrame = -1;
    for (let frame = 0; frame < 300; frame++) {
      machine.runFrame();
      if (machine.isFinished && finishedFrame < 0) {
        finishedFrame = frame;
      }
      for (let i = 0; i < 800; i++) {
        peak = Math.max(peak, Math.abs(chips.psg1.renderSample(48000)));
      }
    }

    console.log(`[fm-probe][psg] finished frame: ${finishedFrame}`);
    console.log(`[fm-probe][psg] PSG1 peak over 5s: ${peak.toFixed(4)}`);
    expect(peak).toBeGreaterThan(0);
  });

  it('exports the fm_voice_macro sample as a .qdf image', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const source = readFileSync(
      join(repoRoot, 'samples', 'mml_reference', 'fm', 'fm_voice_macro.mml'),
      'utf8',
    );

    const result = new MmlCompiler().compile(source);
    expect(result.success).toBe(true);
    const executableImage = Z80DriverImage.buildExecutableImage(
      Z80DriverImage.defaultDriver,
      result.musicData!,
    );
    const image = buildQuickDiskImage('FM VOICE MACRO', executableImage);

    const outDir = join(repoRoot, 'tools', 'cs-probe', 'out');
    mkdirSync(outDir, { recursive: true });
    const qdfPath = join(outDir, 'fm_voice_macro.qdf');
    writeFileSync(qdfPath, image);
    console.log(`[fm-probe] qdf written: ${qdfPath} (${image.length} bytes)`);
    expect(image.length).toBe(0x14010);
  });
});
