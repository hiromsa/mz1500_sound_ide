/**
 * MZSD データ全体の演奏シーケンサ。17 トラックの状態機械を 60Hz で駆動し、
 * 全トラック終了時に L ループ (loopOffset) 復帰 / 演奏終了を判定する。
 * (移植元: MzSound.Player/Sequencer/MzsdSequencer.cs)
 */
import { ChipBank } from '../chips/ChipBank';
import { MzsdSong } from './MzsdSong';
import { TrackSequencer } from './TrackSequencer';

export class MzsdSequencer {
  private readonly songValue: MzsdSong;

  private readonly chipsValue: ChipBank;

  private readonly tracksValue: readonly TrackSequencer[];

  /** ループ有効フラグ (プリシーク中は一時的に false にして復帰を抑制する)。 */
  private loopEnabled: boolean;

  private finished = false;

  /**
   * 残り演奏フレーム数 (部分再生の範囲制限)。0 = 制限なし。
   * 0 に到達した時点で全パートを消音し、演奏終了扱いにする。
   */
  private remainingFrames = 0;

  constructor(
    song: MzsdSong,
    chips: ChipBank,
    loopEnabled: boolean,
    seekFrames: number = 0,
    stopAfterFrames: number = 0,
  ) {
    this.songValue = song;
    this.chipsValue = chips;
    this.loopEnabled = false;

    const tracks: TrackSequencer[] = [];
    for (let i = 0; i < MzsdSong.TrackCount; i++) {
      const track = new TrackSequencer(song, i, chips);
      track.reset(song.trackDataOffset(i));
      tracks.push(track);
    }

    this.tracksValue = tracks;
    this.remainingFrames = Math.max(0, stopAfterFrames);

    // プリシーク (部分再生): 開始フレーム直前まで全トラックの命令をサイレント実行し、
    // v / o / @ 等の内部状態をチップレジスタへ反映させる。
    // この間は mixer に接続されていないため発音せず、L ループ復帰も抑制される。
    for (let i = 0; i < seekFrames; i++) {
      this.tick();
    }

    this.loopEnabled = loopEnabled && song.hasWholeLoop;
  }

  get song(): MzsdSong {
    return this.songValue;
  }

  get chips(): ChipBank {
    return this.chipsValue;
  }

  get tracks(): readonly TrackSequencer[] {
    return this.tracksValue;
  }

  /** 演奏位置ハイライト用: トラックの現在データオフセット。 */
  getTrackOffset(trackIndex: number): number {
    return this.tracksValue[trackIndex].currentOffset;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get initialQuarterFrames(): number {
    return this.songValue.initialQuarterFrames;
  }

  /** 1 フレーム (1/60 秒) 分進める。 */
  tick(): void {
    if (this.finished) {
      return;
    }

    let anyActive = false;
    for (const track of this.tracksValue) {
      track.tick();
      if (!track.isEnded) {
        anyActive = true;
      }
    }

    // 範囲制限 (部分再生): 指定フレーム数を消化したら anyActive に関係なく消音して終了する
    if (this.remainingFrames > 0 && --this.remainingFrames === 0) {
      this.finishAtRangeEnd();
      return;
    }

    if (anyActive) {
      return;
    }

    if (this.loopEnabled) {
      for (const track of this.tracksValue) {
        const loop = this.songValue.trackLoopOffset(track.trackIndex);
        if (loop > 0) {
          track.reset(loop);
        }
      }
    } else {
      this.finished = true;
    }
  }

  /** 部分再生の範囲終端に到達した。全パートを消音して演奏を終了する。 */
  private finishAtRangeEnd(): void {
    this.finished = true;
    for (const track of this.tracksValue) {
      track.silence();
    }
  }
}
