/**
 * C# System.Random (シード指定) 互換乱数のテスト。
 * 期待値は C# (.NET 9) の実出力 (tools/cs-probe でダンプ)。
 */
import { describe, expect, it } from 'vitest';
import { loadReference } from './referenceLoader';
import { SystemRandom } from '../fm/SystemRandom';

describe('SystemRandom', () => {
  it('reproduces the C# System.Random(1234) sequence', () => {
    const random = new SystemRandom(1234);
    const values = Array.from({ length: 16 }, () => random.next(32768));
    expect(values).toEqual(loadReference().randomValues);
  });

  it('returns values within [0, maxValue)', () => {
    const random = new SystemRandom(42);
    for (let i = 0; i < 1000; i++) {
      const value = random.next(1024);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1024);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
