/**
 * 統合環境向けの演奏ファサード。MZSD バイナリデータを受けて再生 / 停止 / ミキサー連携を提供する。
 * UI からはこのクラスのみを操作する。
 * C# 版との差分: AudioWorklet のロードが必要なため play / rewindToStart は Promise を返す。
 * (移植元: MzSound.Player/Player.cs)
 */
import { AudioEngine } from './AudioEngine';
import { AudioEngineMode } from './AudioEngine';
import { MzsdSong } from './MzsdSong';

export class Player {
  private readonly engine = new AudioEngine();

  private playbackMode: AudioEngineMode = AudioEngineMode.SourceInterpreter;

  private disposed = false;

  isPlaying = false;

  /** 最後に開始した演奏が L ループ有効か。 */
  isLoopEnabled = false;

  /** 演奏中の曲 (停止中は null)。 */
  currentSong: MzsdSong | null = null;

  /** 演奏が自然終了した。 */
  onPlaybackFinished: (() => void) | null = null;

  /** MZSD データを解析して演奏を開始する。 */
  async play(
    musicData: Uint8Array,
    loop: boolean,
    mode: AudioEngineMode = AudioEngineMode.SourceInterpreter,
  ): Promise<void> {
    this.throwIfDisposed();
    this.stop();

    const song = MzsdSong.parse(musicData);
    this.currentSong = song;
    this.isLoopEnabled = loop;
    this.playbackMode = mode;
    this.engine.sequencerFinished = this.handleSequencerFinished;
    await this.engine.play(song, loop, mode);
    this.isPlaying = true;
  }

  stop(): void {
    this.throwIfDisposed();
    this.engine.sequencerFinished = null;
    this.engine.stop();
    this.isPlaying = false;
  }

  /** 演奏位置を先頭へ戻す (再生中は先頭から再スタート)。 */
  async rewindToStart(): Promise<void> {
    this.throwIfDisposed();
    const song = this.currentSong;
    if (song === null) {
      return;
    }

    await this.engine.play(song, this.isLoopEnabled, this.playbackMode);
    this.isPlaying = true;
  }

  /** UI ミキサーのチャンネル音量 / ミュートを反映する。 */
  setTrackVolume(trackIndex: number, volume: number, muted: boolean): void {
    this.throwIfDisposed();
    // 知覚補正として 2 乗曲線を適用
    const gain = muted ? 0 : volume * volume;
    this.engine.setTrackGain(trackIndex, gain);
  }

  setMasterVolume(volume: number): void {
    this.throwIfDisposed();
    this.engine.setMasterVolume(volume * volume);
  }

  /** トラックの VU レベル (0-1)。 */
  getTrackLevel(trackIndex: number): number {
    return this.disposed ? 0 : this.engine.getTrackLevel(trackIndex);
  }

  /** マスターの VU レベル (0-1)。 */
  getMasterLevel(): number {
    return this.disposed ? 0 : this.engine.getMasterLevel();
  }

  /** トラックの現在データオフセット (演奏位置ハイライト用、停止中は -1)。 */
  getTrackOffset(trackIndex: number): number {
    return this.disposed ? -1 : this.engine.getTrackOffset(trackIndex);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    await this.engine.dispose();
  }

  private readonly handleSequencerFinished = (): void => {
    this.isPlaying = false;
    this.onPlaybackFinished?.();
  };

  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error('Player は破棄されています。');
    }
  }
}
