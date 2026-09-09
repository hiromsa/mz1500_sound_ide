/**
 * 仮想キーボード CHIP セレクタのモード定義と実効判定ロジック (UI 非依存・純粋関数)。
 *
 * MML の @IN (ノイズ統合) はトーン 3 統合トラック (P3/P6) 専用コマンドであるため、
 * CHIP セレクタに「PSG P3/P6」モードを設け、明示選択時はキャレット位置に
 * 関係なく @IN セレクタを試聴可能にする。
 */
import type { SoundEngineType } from './virtualSynth';
import { isDcsgTone3TrackName } from './mmlCaretParser';

/** CHIP セレクタの選択値 ('psg_tone3' = 「PSG P3/P6 (@IN)」モードの明示選択) */
export type VirtualKeyboardChipMode = SoundEngineType | 'auto' | 'psg_tone3';

/**
 * 選択値を発音エンジン種別へ正規化する。
 * 「PSG P3/P6」モードは発音としては通常の PSG (DCSG 矩形波) と同一のため 'psg' へ置き換える。
 */
export function normalizeChipModeEngine(mode: VirtualKeyboardChipMode): SoundEngineType | 'auto' {
  return mode === 'psg_tone3' ? 'psg' : mode;
}

/** {@link isNoiseIntegrateChipActive} への引数 */
export interface NoiseIntegrateAvailability {
  /** 実効音源 (正規化済み) */
  effectiveEngine: SoundEngineType;
  /** CHIP セレクタの手動選択値 */
  manualEngine: VirtualKeyboardChipMode;
  /** MML エディタモードか (ENV エディタ等は false = トラック概念なし) */
  isMmlContext: boolean;
  /** MML キャレット位置のトラック名 (MML モード以外では空文字でよい) */
  caretTrackName: string;
}

/**
 * @IN (ノイズ統合) セレクタが有効 (試聴可能) かどうかを判定する。
 *
 * - 実効音源が PSG 以外 → 無効
 * - CHIP で「PSG P3/P6」を明示選択 → キャレット位置に依存せず有効 (自由試聴)
 * - MML モード → キャレットトラックが P3/P6 のときのみ有効 (P3/P6 以外では MML 演奏へ反映されないため)
 * - ENV エディタモード (トラック概念なし) → PSG 選択時に有効
 */
export function isNoiseIntegrateChipActive(args: NoiseIntegrateAvailability): boolean {
  if (args.effectiveEngine !== 'psg') return false;
  if (args.manualEngine === 'psg_tone3') return true;
  return !args.isMmlContext || isDcsgTone3TrackName(args.caretTrackName);
}
