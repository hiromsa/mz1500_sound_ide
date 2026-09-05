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

  constructor(chips: ChipBank) {
    this.machine = new Z80DriverMachine(chips);
  }

  get isFinished(): boolean {
    return this.machine.isFinished;
  }

  /** MZSD データをロードしてドライバのブートを完了させる。 */
  play(musicData: Uint8Array, loop: boolean): void {
    this.machine.load(Z80DriverImage.defaultDriver, musicData, loop);

    let bootGuard = 0;
    while ((this.machine.status & 0x01) === 0 && bootGuard++ < MaxBootFrames) {
      this.machine.runFrame();
    }
  }

  tick(): void {
    this.machine.runFrame();
  }

  getTrackOffset(trackIndex: number): number {
    return this.machine.getTrackOffset(trackIndex);
  }
}
