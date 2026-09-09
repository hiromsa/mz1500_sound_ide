/**
 * Z80 サウンドドライバのリアルタイム演奏駆動 (FrameDriver 実装)。
 * 内蔵 Z80 コア上で MzSD ドライバを実行し、60Hz のフレーム同期で音源チップへ書き込む。
 * load 直後のブート (ワーク / FM 初期化) 中は STAT_PLAY (CB_STATUS bit0) が立つまで
 * フレーム実行を先行させ、以降は MzsdSequencer.tick() と 1:1 のフレーム駆動へ移行する
 * (Z80DriverEquivalence テストと同一の手順)。
 */
import { ChipBank } from '../chips/ChipBank';
import type { FrameDriver } from './FrameDriver';
import { Z80DriverImage } from './Z80DriverImage';
import { Z80DriverMachine } from './Z80DriverMachine';

/** ドライバブート待ちの最大フレーム数 (等価性テストと同一のガード値)。 */
const MaxBootFrames = 4;

export class Z80DriverPlayback implements FrameDriver {
  private readonly machine: Z80DriverMachine;

  private readonly chips: ChipBank;

  /** 残り演奏フレーム数 (部分再生の範囲制限)。0 = 制限なし。 */
  private remainingFrames = 0;

  /** 部分再生の範囲終端に到達した (消音済み・演奏終了扱い)。 */
  private rangeStopped = false;

  constructor(chips: ChipBank) {
    this.chips = chips;
    this.machine = new Z80DriverMachine(chips);
  }

  get isFinished(): boolean {
    return this.rangeStopped || this.machine.isFinished;
  }

  /**
   * MZSD データをロードしてドライバのブートを完了させる。
   * seekFrames > 0 の場合は部分再生のプリシークとして、ドライバを開始フレーム直前まで
   * サイレント実行する (mixer に未接続のため発音せず、v / o / @ 等の状態だけがチップへ残る)。
   * stopAfterFrames > 0 の場合は指定フレーム数の演奏後に消音して終了する。
   */
  play(musicData: Uint8Array, loop: boolean, seekFrames: number = 0, stopAfterFrames: number = 0): void {
    this.machine.load(Z80DriverImage.defaultDriver, musicData, loop);

    let bootGuard = 0;
    while ((this.machine.status & 0x01) === 0 && bootGuard++ < MaxBootFrames) {
      this.machine.runFrame();
    }

    for (let i = 0; i < seekFrames; i++) {
      this.machine.runFrame();
    }

    this.remainingFrames = Math.max(0, stopAfterFrames);
    this.rangeStopped = false;
  }

  tick(): void {
    if (this.rangeStopped) {
      return;
    }

    this.machine.runFrame();

    if (this.remainingFrames > 0 && --this.remainingFrames === 0) {
      this.rangeStopped = true;
      this.chips.silenceAll();
    }
  }

  getTrackOffset(trackIndex: number): number {
    return this.machine.getTrackOffset(trackIndex);
  }
}
