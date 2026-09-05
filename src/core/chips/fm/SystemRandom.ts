/**
 * C# の System.Random (シード指定コンストラクタ / Knuth 減算法) と
 * 完全に同一の擬似乱数列を生成するクラス。
 * fmgen 由来の OPM LFO ノイズは乱数で波形を初期化するため、C# 版ポートとの
 * ビット一致検証 (web_core_port.md §4) を成立させるには乱数列の一致が必須。
 * そこで .NET の互換実装を忠実に移植している。
 */
const Mbig = 2147483647; // Int32.MaxValue
const Mseed = 161803398;

export class SystemRandom {
  private readonly seedArray: number[] = new Array<number>(56);

  private inext = 0;

  private inextp = 21;

  constructor(seed: number) {
    const subtraction = seed === -2147483648 ? Mbig : Math.abs(seed);
    let mj = Mseed - subtraction;
    this.seedArray[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      this.seedArray[ii] = mk;
      mk = mj - mk;
      if (mk < 0) {
        mk += Mbig;
      }
      mj = this.seedArray[ii];
    }

    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        this.seedArray[i] -= this.seedArray[1 + ((i + 30) % 55)];
        if (this.seedArray[i] < 0) {
          this.seedArray[i] += Mbig;
        }
      }
    }

    this.inext = 0;
    this.inextp = 21;
  }

  /** C# の Sample() 相当: [0, 1) の倍精度値。 */
  private sample(): number {
    return this.internalSample() * (1.0 / Mbig);
  }

  private internalSample(): number {
    let locInext = this.inext;
    let locInextp = this.inextp;

    if (++locInext >= 56) {
      locInext = 1;
    }

    if (++locInextp >= 56) {
      locInextp = 1;
    }

    let retVal = this.seedArray[locInext] - this.seedArray[locInextp];
    if (retVal === Mbig) {
      retVal--;
    }

    if (retVal < 0) {
      retVal += Mbig;
    }

    this.seedArray[locInext] = retVal;
    this.inext = locInext;
    this.inextp = locInextp;
    return retVal;
  }

  /** C# の Next(maxValue) 相当: [0, maxValue) の整数。 */
  next(maxValue: number): number {
    // (int)(Sample() * maxValue): Sample() は非負なので床切り捨てと等価
    return Math.floor(this.sample() * maxValue);
  }
}