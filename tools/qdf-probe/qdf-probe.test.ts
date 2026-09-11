/**
 * QDF エクスポート実機起動検証プローブ (一時ツール・コミット対象外)。
 * IDE の EXPORT PLAYER (.qdf) と同一経路 (MmlCompiler → Z80DriverImage →
 * buildQuickDiskImage) でサンプル MML から .qdf を生成し、
 * tools/cs-probe/out/ (gitignore 済み) へ保存する。
 *
 * 使い方: npx vitest run tools/qdf-probe/qdf-probe.test.ts
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MmlCompiler } from '../../src/core/mml/MmlCompiler';
import { Z80DriverImage } from '../../src/core/player/Z80DriverImage';
import { buildQuickDiskImage } from '../../src/core/export/QdfImageBuilder';

describe('qdf-probe', () => {
  it('exports the psg_octave_transpose sample as a .qdf image', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const source = readFileSync(
      join(repoRoot, 'samples', 'mml_reference', 'psg', 'psg_octave_transpose.mml'),
      'utf8',
    );

    const result = new MmlCompiler().compile(source);
    expect(result.success).toBe(true);
    expect(result.musicData).not.toBeNull();
    writeFileSync(join(repoRoot, 'tools', 'cs-probe', 'out', 'music_data.bin'), result.musicData!);

    // 0x0D パディング版 (文字化け再現用) も出力: display code 0x0D の字形確認用
    const padded0d = new Uint8Array(0xa8c2);
    padded0d.set(result.musicData!);
    writeFileSync(join(repoRoot, 'tools', 'cs-probe', 'out', 'music_data_0d.bin'), padded0d);

    const executableImage = Z80DriverImage.buildExecutableImage(
      Z80DriverImage.defaultDriver,
      result.musicData!,
    );
    const image = buildQuickDiskImage('PSG OCT', executableImage);

    const outDir = join(repoRoot, 'tools', 'cs-probe', 'out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'music_data_embedded.bin'), executableImage);
    const qdfPath = join(outDir, 'psg_octave_transpose.qdf');
    writeFileSync(qdfPath, image);

    const driver = Z80DriverImage.defaultDriver;
    const labels = ['entry', 'init_hook', 'init_work', 'init_sound', 'init_timer', 'timer_rearm', 'isr', 'isr_jump', 'music_data'];
    for (const name of labels) {
      const addr = driver.labels.get(name);
      if (addr !== undefined) {
        console.log(`[qdf-probe] label ${name}: 0x${addr.toString(16)}`);
      }
    }
    const hex = (bytes: Uint8Array, count: number): string =>
      [...bytes.subarray(0, count)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

    console.log(`[qdf-probe] musicData: ${result.musicData!.length} bytes`);
    console.log(`[qdf-probe] musicDataAddress: 0x${driver.musicDataAddress.toString(16)}`);
    console.log(`[qdf-probe] executableImage: ${executableImage.length} bytes`);
    console.log(`[qdf-probe] last byte: 0x${executableImage[executableImage.length - 1].toString(16)} at 0x${(0x1200 + executableImage.length - 1).toString(16)}`);
    console.log(`[qdf-probe] driver head: ${hex(driver.binary, 16)}`);
    console.log(`[qdf-probe] image head: ${hex(executableImage, 16)}`);
    console.log(`[qdf-probe] qdf written: ${qdfPath} (${image.length} bytes)`);
  });
});
