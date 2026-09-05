/**
 * MzSD サウンドドライバ (driver/mzsd_driver.asm) のビルド結果。
 * ソースは Vite の ?raw import でバンドルされ、music_data ラベル位置へ
 * MZSD 音楽データを配置して 0x1200 番地にロードする。
 * (移植元: MzSound.Player/Driver/Z80DriverImage.cs)
 */
import driverSource from '../../../driver/mzsd_driver.asm?raw';
import type { AssembleResult } from '../assembler/AssembleResult';
import { assembleZ80 } from '../assembler/Z80Assembler';

/**
 * This file is a TypeScript port of Z80dotNet originally written by Konamiman.
 * (ドライバイメージのビルド契約は MzSound.Player (C# 版) と同一。)
 */
export class Z80DriverImage {
  /** ドライバのロードアドレス (= エントリポイント、IPL 互換)。 */
  static readonly LoadAddress = 0x1200;

  private static defaultInstance: Z80DriverImage | null = null;

  /** ドライババイナリ (LoadAddress からのイメージ)。 */
  readonly binary: Uint8Array;

  /** music_data ラベルの絶対アドレス (MZSD データ配置位置)。 */
  readonly musicDataAddress: number;

  /** ラベル / シンボル辞書 (デバッグ用)。 */
  readonly labels: ReadonlyMap<string, number>;

  private constructor(
    binary: Uint8Array,
    musicDataAddress: number,
    labels: ReadonlyMap<string, number>,
  ) {
    this.binary = binary;
    this.musicDataAddress = musicDataAddress;
    this.labels = labels;
  }

  /** 既定ドライバ (埋め込みソースからビルド、キャッシュ)。 */
  static get defaultDriver(): Z80DriverImage {
    if (Z80DriverImage.defaultInstance === null) {
      Z80DriverImage.defaultInstance = Z80DriverImage.build(driverSource);
    }

    return Z80DriverImage.defaultInstance;
  }

  /** ドライバソースをアセンブルしてイメージを生成する。 */
  static build(source: string): Z80DriverImage {
    const result = assembleZ80(source);
    return Z80DriverImage.fromAssembleResult(result);
  }

  private static fromAssembleResult(result: AssembleResult): Z80DriverImage {
    const musicDataAddress = result.labels.get('music_data');
    if (musicDataAddress === undefined) {
      throw new Error('ドライバに music_data ラベルがありません。');
    }

    if (result.origin !== Z80DriverImage.LoadAddress) {
      throw new Error(
        `ドライバの開始アドレスが不正です (期待: ${Z80DriverImage.LoadAddress.toString(16).toUpperCase()}h、` +
          `実際: ${result.origin.toString(16).toUpperCase()}h)。`,
      );
    }

    // org パディングを除去してコード先頭 (LoadAddress) からのバイナリにする
    return new Z80DriverImage(result.data.slice(result.origin), musicDataAddress, result.labels);
  }
}
