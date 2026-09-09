/**
 * 部分再生 (キャレット位置から / 選択範囲のみ) の演奏範囲。
 * フレーム数は曲先頭基準の 0-based・60Hz 単位で、MmlMapEvent.startFrame と同一基準。
 * プレイヤー側は startFrame までを発音なしで高速シミュレート (プリシーク) し、
 * 開始位置直前までの v / o / @ 等の内部状態を引き継いだ上で同期再生を開始する。
 */
export interface PlaybackRange {
  /** 再生を開始するフレーム (このフレームから始まる音符 / 休符が最初の発音対象)。 */
  readonly startFrame: number;

  /**
   * 再生を終了するフレーム (このフレームに到達した時点で全パート消音・演奏終了)。
   * null = 曲末尾まで (キャレット位置から再生)。
   */
  readonly endFrame: number | null;
}