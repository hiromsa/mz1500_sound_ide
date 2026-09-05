/// <reference types="node" />
/**
 * Ym2151 (OPM) のテスト。
 * (移植元: tests/MzSound.Player.Tests/MzsdSequencerTests.cs の
 * Ym2151_ProducesOutputAfterKeyOn + tools/cs-probe による C# 版との出力一致検証)
 */
import { describe, expect, it } from 'vitest';
import { loadReference } from './referenceLoader';
import { Ym2151 } from '../fm/Ym2151';

/** C# テスト (Ym2151_ProducesOutputAfterKeyOn) と同一のレジスタ設定。 */
function keyOnReferenceTone(fm: Ym2151): void {
  fm.setReg(0x20, 0xc4); // PAN 両方 / FB=0 / ALG=4
  for (let op = 0; op < 4; op++) {
    fm.setReg(0x40 + (op << 3), 0x01); // MUL=1
    fm.setReg(0x60 + (op << 3), 0x00); // TL=0 (最大音量)
    fm.setReg(0x80 + (op << 3), 0x1f); // KS=0 / AR=31
    fm.setReg(0xa0 + (op << 3), 0x00); // D1R=0
    fm.setReg(0xc0 + (op << 3), 0x00); // DT2=0 / D2R=0
    fm.setReg(0xe0 + (op << 3), 0xf0); // D1L=15 / RR=0
  }

  fm.setReg(0x28, 0x4c); // KC = A4
  fm.setReg(0x30, 0x00); // KF = 0
  fm.setReg(0x08, 0x78); // Key On (channel 0 / 4 op)
}

describe('Ym2151', () => {
  it('reproduces the C# reference key-on output bit-exactly', () => {
    const fm = new Ym2151(3579545);
    fm.initialize(48000);
    keyOnReferenceTone(fm);

    const buffer = new Int32Array(9600);
    const partials: number[] = [];
    for (let block = 0; block < 10; block++) {
      fm.mix(buffer.subarray(block * 960, block * 960 + 960), 480);
      let m = 0;
      for (let i = 0; i < 960; i++) {
        m = Math.max(m, Math.abs(buffer[block * 960 + i]));
      }

      partials.push(m);
    }

    const reference = loadReference().fm;
    // (C# テストのアサーション)
    expect(Math.max(...partials)).toBeGreaterThan(100);
    // (C# 版とのビット一致)
    expect(partials).toEqual(reference.partials);
    expect(buffer.reduce((sum, v) => sum + v, 0)).toBe(reference.sum);
    expect(Array.from(buffer.slice(0, 48))).toEqual(reference.head);
  });

  it('reproduces the C# reference saw-LFO output', () => {
    const fm = new Ym2151(3579545);
    fm.initialize(48000);
    fm.setReg(0x20, 0xc7); // ALG=7 (4 op 並列)
    for (let op = 0; op < 4; op++) {
      fm.setReg(0x40 + (op << 3), 0x01);
      fm.setReg(0x60 + (op << 3), 0x00);
      fm.setReg(0x80 + (op << 3), 0x1f);
      fm.setReg(0xc0 + (op << 3), 0x00);
      fm.setReg(0xe0 + (op << 3), 0xf0);
    }

    fm.setReg(0x28, 0x4c);
    fm.setReg(0x38, 0x70); // PMS=7 / AMS=0
    fm.setReg(0x18, 0x08); // LFRQ
    fm.setReg(0x19, 0x7f); // PMD=127
    fm.setReg(0x19, 0xff); // AMD=127
    fm.setReg(0x1b, 0x00); // W = saw
    fm.setReg(0x08, 0x78);

    const buffer = new Int32Array(2000);
    fm.mix(buffer, 1000);

    const reference = loadReference().lfo;
    expect(buffer.reduce((sum, v) => sum + v, 0)).toBe(reference.sum);
    expect(Array.from(buffer.slice(0, 32))).toEqual(reference.head);
  });

  it('reproduces the C# reference noise-LFO output (SystemRandom parity)', () => {
    const fm = new Ym2151(3579545);
    fm.initialize(48000);
    fm.setReg(0x20, 0xc7);
    for (let op = 0; op < 4; op++) {
      fm.setReg(0x40 + (op << 3), 0x01);
      fm.setReg(0x60 + (op << 3), 0x00);
      fm.setReg(0x80 + (op << 3), 0x1f);
      fm.setReg(0xe0 + (op << 3), 0xf0);
    }

    fm.setReg(0x28, 0x4c);
    fm.setReg(0x38, 0x70);
    fm.setReg(0x18, 0x08);
    fm.setReg(0x19, 0x7f);
    fm.setReg(0x19, 0xff);
    fm.setReg(0x1b, 0x03); // W = noise (LFO テーブル構築に乱数を使用)
    fm.setReg(0x08, 0x78);

    const buffer = new Int32Array(2000);
    fm.mix(buffer, 1000);

    const reference = loadReference().noiseLfo;
    expect(buffer.reduce((sum, v) => sum + v, 0)).toBe(reference.sum);
    expect(Array.from(buffer.slice(0, 16))).toEqual(reference.head);
  });

  it('reads back written registers only', () => {
    const fm = new Ym2151(3579545);
    expect(fm.tryGetRegister(0x08)).toBeNull();

    fm.setReg(0x08, 0x78);
    expect(fm.tryGetRegister(0x08)).toEqual({ present: true, value: 0x78 });

    // reset 後はクリアされる
    fm.reset();
    expect(fm.tryGetRegister(0x08)).toBeNull();
  });

  it('reports the busy bit for 8 microseconds after a data write', () => {
    const fm = new Ym2151(3579545);
    // busyTStates = ceil(3579545 * 8 / 1e6) = 29 T-states
    expect(fm.busyPeriodTStates).toBe(29);

    let tState = 0;
    fm.setClockProvider(() => tState);

    fm.writeAddress(0x08);
    fm.writeData(0x78);
    // 直後のステータス読み出しは busy ビットが立つ
    tState = 10;
    expect(fm.readStatus() & 0x80).not.toBe(0);
    // 29 T-state 経過後は busy ビットが下がる
    tState = 100;
    expect(fm.readStatus() & 0x80).toBe(0);
  });

  it('raises timer flags and IRQ via timer A/B', () => {
    const fm = new Ym2151(3579545);
    fm.initialize(48000);

    const irqEvents: boolean[] = [];
    fm.setIrqChanged((irq) => irqEvents.push(irq));

    fm.setReg(0x10, 0x18); // Timer A = 1024 - (0x18 << 2) = 928
    fm.setReg(0x12, 0x00); // Timer B = 256 << 4 = 4096
    fm.setReg(0x14, 0x0f); // Timer A/B 起動 + オーバーフローフラグ有効

    // prescaler 64 → Timer A は 928 * 64 = 59392 クロックでオーバーフロー
    fm.advanceChipClocks(59392);
    expect(fm.readStatus() & 1).toBe(1);
    expect(irqEvents).toEqual([true]); // IRQ 立ち上がり

    fm.advanceChipClocks(4096 * 64 - 59392 + 1);
    expect(fm.readStatus() & 2).toBe(2);

    // フラグをクリアすると IRQ も下がる
    fm.setReg(0x14, 0x30);
    expect(fm.readStatus() & 3).toBe(0);
    expect(irqEvents).toEqual([true, false]); // IRQ 立ち下がり
  });

  it('changes the chip clock like swapping the crystal', () => {
    const fm = new Ym2151(3579545);
    fm.initialize(48000);

    expect(fm.setChipClock(4000000)).toBe(true);
    expect(fm.chipClock).toBe(4000000);
    expect(fm.setChipClock(0)).toBe(false);
    expect(fm.chipClock).toBe(4000000);
  });

  it('reports the C# parity properties', () => {
    const fm = new Ym2151(4000000);
    expect(fm.name).toBe('YM2151 (OPM)');
    expect(fm.cpuClock).toBe(4000000);
    expect(fm.busyPeriodTStates).toBe(32); // ceil(4MHz * 8us)
    expect(fm.enabled).toBe(true);
  });
});
