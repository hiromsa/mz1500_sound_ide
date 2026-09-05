/// <reference types="node" />
/**
 * Z80 サウンドドライバ (driver/mzsd_driver.asm) の実ソースを
 * TypeScript 版アセンブラでビルドできることを検証するテスト。
 * (C# 版 MzSound.Player/Driver/Z80DriverImage.Build の契約と同一)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleZ80 } from '../Z80Assembler';

/** ドライバのロードアドレス (= エントリポイント、IPL 互換)。 */
const LoadAddress = 0x1200;

const driverSource = readFileSync(
  resolve(fileURLToPath(new URL('../../../../driver/mzsd_driver.asm', import.meta.url))),
  'utf-8',
);

describe('mzsd_driver.asm build', () => {
  it('assembles with origin 0x1200', () => {
    const result = assembleZ80(driverSource);
    expect(result.origin).toBe(LoadAddress);
  });

  it('has music_data label', () => {
    const result = assembleZ80(driverSource);
    const musicDataAddress = result.labels.get('music_data');
    expect(musicDataAddress).toBeDefined();
    expect(musicDataAddress as number).toBeGreaterThan(LoadAddress);
  });

  it('produces a non-empty code image (org padding stripped)', () => {
    const result = assembleZ80(driverSource);
    const binary = result.data.slice(result.origin);
    expect(binary.length).toBeGreaterThan(0x100);
    // Z80 ではアセンブル結果の先頭が NOP (0x00) の連続であることはない
    expect(binary[0]).not.toBeUndefined();
  });
});
