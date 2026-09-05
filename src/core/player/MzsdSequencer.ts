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

  private readonly loopEnabled: boolean;

  private finished = false;

  constructor(song: MzsdSong, chips: ChipBank, loopEnabled: boolean) {
    this.songValue = song;
    this.chipsValue = chips;
    this.loopEnabled = loopEnabled && song.hasWholeLoop;

    const tracks: TrackSequencer[] = [];
    for (let i = 0; i < MzsdSong.TrackCount; i++) {
      const track = new TrackSequencer(song, i, chips);
      track.reset(song.trackDataOffset(i));
      tracks.push(track);
    }

    this.tracksValue = tracks;
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
}
