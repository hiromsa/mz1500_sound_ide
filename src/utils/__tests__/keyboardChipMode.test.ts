import { describe, expect, it } from 'vitest';
import { isNoiseIntegrateChipActive, normalizeChipModeEngine } from '../keyboardChipMode';

describe('keyboardChipMode', () => {
  describe('normalizeChipModeEngine', () => {
    it("'psg_tone3' (CHIP: PSG P3/P6) は発音エンジンとしては 'psg' に正規化される", () => {
      expect(normalizeChipModeEngine('psg_tone3')).toBe('psg');
    });

    it('その他の選択値はそのまま返る', () => {
      expect(normalizeChipModeEngine('auto')).toBe('auto');
      expect(normalizeChipModeEngine('psg')).toBe('psg');
      expect(normalizeChipModeEngine('fm')).toBe('fm');
      expect(normalizeChipModeEngine('beep')).toBe('beep');
      expect(normalizeChipModeEngine('noise')).toBe('noise');
    });
  });

  describe('isNoiseIntegrateChipActive', () => {
    it('実効音源が PSG 以外 (FM / BEEP / NOISE) では常に無効', () => {
      for (const effectiveEngine of ['fm', 'beep', 'noise'] as const) {
        expect(
          isNoiseIntegrateChipActive({
            effectiveEngine,
            manualEngine: 'psg_tone3',
            isMmlContext: true,
            caretTrackName: 'P3',
          }),
        ).toBe(false);
      }
    });

    it('MML モード: キャレットトラックが P3/P6 なら AUTO / PSG 選択時も有効', () => {
      for (const caretTrackName of ['P3', 'P6']) {
        for (const manualEngine of ['auto', 'psg'] as const) {
          expect(
            isNoiseIntegrateChipActive({
              effectiveEngine: 'psg',
              manualEngine,
              isMmlContext: true,
              caretTrackName,
            }),
          ).toBe(true);
        }
      }
    });

    it('MML モード: キャレットトラックが P1/P2/P4/P5/N1/N2 なら AUTO / PSG 選択時は無効', () => {
      for (const caretTrackName of ['P1', 'P2', 'P4', 'P5', 'N1', 'N2']) {
        for (const manualEngine of ['auto', 'psg'] as const) {
          expect(
            isNoiseIntegrateChipActive({
              effectiveEngine: 'psg',
              manualEngine,
              isMmlContext: true,
              caretTrackName,
            }),
          ).toBe(false);
        }
      }
    });

    it('MML モード: CHIP で PSG P3/P6 を明示選択するとキャレット位置に依存せず有効', () => {
      for (const caretTrackName of ['P1', 'P2', 'P4', 'P5', 'N1', 'F1', '']) {
        expect(
          isNoiseIntegrateChipActive({
            effectiveEngine: 'psg',
            manualEngine: 'psg_tone3',
            isMmlContext: true,
            caretTrackName,
          }),
        ).toBe(true);
      }
    });

    it('ENV エディタモード (isMmlContext: false) は PSG 選択時に常に有効', () => {
      expect(
        isNoiseIntegrateChipActive({
          effectiveEngine: 'psg',
          manualEngine: 'auto',
          isMmlContext: false,
          caretTrackName: '',
        }),
      ).toBe(true);
    });
  });
});
