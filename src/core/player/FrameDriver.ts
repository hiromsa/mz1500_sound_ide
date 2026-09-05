/**
 * 60Hz フレーム駆動で音源チップへ演奏データを供給する駆動方式の共通契約。
 * SourceInterpreter (MzsdSequencer) と Z80Driver (Z80DriverPlayback) を
 * AudioFrameMixer / AudioEngine から同一視するために用いる。
 * (C# 版 AudioEngine.cs が演奏方式を切り替えていた部分に対応)
 */
export interface FrameDriver {
  /** 1 フレーム (1/60 秒) 分進める。 */
  tick(): void;

  /** 演奏が終了した (ループ無効曲で全トラック終了 / ドライバ HALT)。 */
  readonly isFinished: boolean;

  /** 演奏位置ハイライト用: トラックの現在データオフセット。 */
  getTrackOffset(trackIndex: number): number;
}
