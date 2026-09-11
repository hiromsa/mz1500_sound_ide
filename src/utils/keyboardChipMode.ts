/**
 * 仮想キーボード CHIP セレクタのモード定義と実効判定ロジック (UI 非依存・純粋関数)。
 *
 * MML の @IN (ノイズ統合) はトーン 3 統合トラック (P3/P6) 専用コマンドであるため、
 * CHIP セレクタに「PSG P3/P6」モードを設け、明示選択時はキャレット位置に
 * 関係なく @IN セレクタを試聴可能にする。
 */
import type { SoundEngineType } from './virtualSynth';
import { isDcsgTone3TrackName, resolveDcsgChipIndexFromTrackName } from './mmlCaretParser';

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

/** PSG / ノイズ発音のステレオ定位 ('left' = DCSG1 側 / 'right' = DCSG2 側 / 'center' = 中央)。 */
export type VirtualKeyboardPsgPlacement = 'left' | 'right' | 'center';

/** {@link resolvePsgOutputPlacement} への引数 */
export interface PsgPlacementResolution {
  /** 実効音源 (正規化済み) */
  effectiveEngine: SoundEngineType;
  /** MML エディタモードか (ENV エディタ等は false = トラック概念なし) */
  isMmlContext: boolean;
  /** MML キャレット位置のトラック名 (MML モード以外では空文字でよい) */
  caretTrackName: string;
}

/**
 * 仮想キーボード発音のステレオ定位を実機チップ構成から解決する。
 *
 * - FM / BEEP → 'center' (OPM 既定 RL = L+R / 8253 内蔵スピーカ = 中央出力)
 * - ENV エディタモード (トラック概念なし) → 'center' (両チップから出力し中央定位にする)
 * - MML モード → キャレットトラックの DCSG チップ配線に従う
 *   (P1-P3 / N1 = DCSG1 = 左、P4-P6 / N2 = DCSG2 = 右、W1-W99 など実機未割当トラック = 中央)
 */
export function resolvePsgOutputPlacement(args: PsgPlacementResolution): VirtualKeyboardPsgPlacement {
  if (args.effectiveEngine !== 'psg' && args.effectiveEngine !== 'noise') return 'center';
  if (!args.isMmlContext) return 'center';
  const chip = resolveDcsgChipIndexFromTrackName(args.caretTrackName);
  if (chip === null) return 'center';
  return chip === 0 ? 'left' : 'right';
}
