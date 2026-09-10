/**
 * 音量エンベロープ (@VE) 1 発音分の進行状態。
 * KEY ON 中はサステイン区間 (`[loop, release)` / リリースなしは末尾) を進み、
 * beginRelease() 以降はリリース区間を末尾まで 1 回だけ再生する。
 * MZSD 演奏エンジン (TrackSequencer) の挙動を手動再現したもので、
 * KeyboardSoundEngine (仮想キーボード / エディタ試聴) から 60Hz で駆動される。
 * (virtualSynth.ts から core 層へ移動 — Phase B。旧 import は utils/virtualSynth が再エクスポート)
 */

/**
 * KEY ON 中の音量エンベロープインデックスを算出する。
 * リリース位置がある場合はその直前まで (サステイン区間) でループ / ホールドし、
 * リリース区間には決して入らない (MZSD 演奏エンジンと同一挙動)。
 */
export function sustainEnvelopeIndex(
  frame: number,
  length: number,
  loop: number | undefined,
  release: number | undefined,
): number {
  const sustainEnd = release !== undefined && release >= 0 && release < length ? release : length;
  if (frame < sustainEnd) return frame;
  if (loop !== undefined && loop >= 0 && loop < sustainEnd) {
    return loop + ((frame - sustainEnd) % (sustainEnd - loop));
  }
  return sustainEnd - 1;
}

export class VolumeEnvelopePlayback {
  private readonly values: readonly number[];

  private readonly loop: number | undefined;

  private readonly release: number | undefined;

  private frame = 0;

  private releaseFrame = 0;

  private releasing = false;

  constructor(values: readonly number[], loop: number | undefined, release: number | undefined) {
    this.values = values;
    this.loop = loop;
    this.release = release;
  }

  /** リリース定義 (`>` マーカー) を持つかどうか。 */
  get hasRelease(): boolean {
    return this.validRelease() !== null;
  }

  /** リリース区間のフレーム数 (hasRelease 時のみ意味を持つ)。 */
  get releaseLengthFrames(): number {
    const start = this.validRelease();
    return start === null ? 0 : this.values.length - start;
  }

  /** 現在フレームの音量インデックス (進行はしない)。 */
  currentIndex(): number {
    const len = this.values.length;
    if (this.releasing) {
      const start = this.validRelease();
      if (start !== null) {
        return Math.min(start + this.releaseFrame, len - 1); // リリース末尾でホールド
      }
    }

    return sustainEnvelopeIndex(this.frame, len, this.loop, this.release);
  }

  /** 1 フレーム進める。 */
  advance(): void {
    this.frame++;
    if (this.releasing) {
      this.releaseFrame++;
    }
  }

  /**
   * KEY OFF: リリースフェーズへ遷移する (リリース未定義は false)。
   * 既にリリース中の場合は進行を壊さないよう true を返すだけの冪等設計
   * (マウスドラッグ終了時の全キーオフで 2 回呼ばれてもリリースが巻き戻らない)。
   */
  beginRelease(): boolean {
    if (!this.hasRelease) return false;
    if (this.releasing) return true;
    this.releasing = true;
    this.releaseFrame = 0;
    return true;
  }

  private validRelease(): number | null {
    return this.release !== undefined && this.release >= 0 && this.release < this.values.length
      ? this.release
      : null;
  }
}
