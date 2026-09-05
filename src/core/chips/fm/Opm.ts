/**
 * Yamaha YM2151 (OPM) FM 音源。
 * (fmgen の Opm クラスより移植 — opm.cpp, Copyright (C) cisc 1998, 2003。
 * 移植元: MzSound.Player/Chips/Fm/Opm.cs + Opm.Registers.cs + Opm.Lfo.cs +
 * Opm.Mix.cs を 1 モジュールへ統合)
 */
import { FmChannel4 } from './FmChannel4';
import { FmChip } from './FmChip';
import { buildFmTables, RatioBits } from './FmTables';
import { FmTimer } from './FmTimer';
import { SystemRandom } from './SystemRandom';

/** OPM_LFOENTS。 */
const OpmLfoEnts = 512;

// LFO 波形テーブル ([波形][インデックス]、2 ステップで読む)、初回のみ構築。
const lfoAmTable: number[][] = [
  new Array<number>(OpmLfoEnts).fill(0),
  new Array<number>(OpmLfoEnts).fill(0),
  new Array<number>(OpmLfoEnts).fill(0),
  new Array<number>(OpmLfoEnts).fill(0),
];
const lfoPmTable: number[][] = [
  new Array<number>(OpmLfoEnts).fill(0),
  new Array<number>(OpmLfoEnts).fill(0),
  new Array<number>(OpmLfoEnts).fill(0),
  new Array<number>(OpmLfoEnts).fill(0),
];
let lfoTablesBuilt = false;

export class Opm extends FmTimer {
  private readonly chip = new FmChip();

  private readonly channels: FmChannel4[] = [];

  private readonly kc: number[] = new Array<number>(8).fill(0);

  private readonly kf: number[] = new Array<number>(8).fill(0);

  private readonly pan: number[] = new Array<number>(8).fill(0);

  private readonly ibuf: number[] = new Array<number>(8).fill(0);

  private readonly idest: number[] = new Array<number>(8).fill(0);

  /** ノイズ LFO 用乱数 (C++ rand() 相当の任意値。C# 互換乱数で決定的に保つ)。 */
  private readonly random = new SystemRandom(1234);

  private fmVolumeL = 0;

  private fmVolumeR = 0;

  private clock = 0;

  /** 現在の出力サンプルレート (Hz) (リファレンス互換の保持値)。 */
  get pcmRate(): number {
    return this.pcmRateValue;
  }

  private rate = 0;

  private pcmRateValue = 0;

  private pmd = 0;

  private amd = 0;

  private lfoCount = 0; // C# uint 相当

  private lfoCountDiff = 0; // C# uint 相当

  private lfoStep = 0;

  private lfoCountPrev = 4294967295; // C# uint.MaxValue 相当

  private lfoWaveform = 0;

  private rateRatio = 0; // C# uint 相当

  private noise = 0; // C# uint 相当

  private noiseCount = 0;

  private noiseDelta = 0; // C# uint 相当

  private lfoFreq = 0;

  private interrupt = false;

  private reg01 = 0;

  constructor() {
    super();
    buildFmTables();
    buildLfoTables();
    for (let i = 0; i < 8; i++) {
      const channel = new FmChannel4();
      channel.setChip(this.chip);
      channel.setType(1); // FmOpType.Mod
      this.channels.push(channel);
    }
  }

  /** チップを初期化 (クロックとサンプルレート) し、リセットする。 */
  init(clock: number, rate: number, interpolation = false): boolean {
    if (!this.setRate(clock, rate, interpolation)) {
      return false;
    }

    this.reset();
    this.setVolume(0, 0);
    this.setChannelMask(0);
    return true;
  }

  /** チップクロック / サンプルレートのペアを変更する (タイミング表を再構築)。 */
  setRate(clock: number, rate: number, interpolation = false): boolean {
    this.clock = clock;
    this.pcmRateValue = rate;
    this.rate = rate;
    void interpolation; // リファレンス互換のシグネチャ (リサンプリングは将来拡張)
    this.rebuildTimeTable();

    // 位相ステップは比率表に依存する: 全チャンネルを再計算対象へ。
    for (const channel of this.channels) {
      channel.refresh();
    }

    return true;
  }

  setChannelMask(mask: number): void {
    for (let i = 0; i < 8; i++) {
      this.channels[i].mute((mask & (1 << i)) !== 0);
    }
  }

  setVolume(dbL: number, dbR: number): void {
    dbL = Math.min(dbL, 20);
    dbR = Math.min(dbR, 20);
    this.fmVolumeL = dbL > -192 ? (16384.0 * Math.pow(10.0, dbL / 40.0)) | 0 : 0;
    this.fmVolumeR = dbR > -192 ? (16384.0 * Math.pow(10.0, dbR / 40.0)) | 0 : 0;
  }

  /** 全レジスタと内部状態をリセットする。 */
  reset(): void {
    for (let addr = 0; addr < 0x100; addr++) {
      this.setReg(addr, 0);
    }

    this.setReg(0x19, 0x80);
    super.reset();
    this.status = 0;
    this.interrupt = false;
    this.noise = 12345;
    this.noiseCount = 0;
    for (const channel of this.channels) {
      channel.reset();
    }
  }

  /** 現在の IRQ 出力状態 (IRQ 有効時のタイマオーバーフロー)。 */
  readIRQ(): boolean {
    return this.interrupt;
  }

  /** ステータスレジスタ (タイマ A/B オーバーフローフラグ。busy ビットはラッパーが追加)。 */
  readStatus(): number {
    return this.status & 0x03;
  }

  /** タイマを進める。タイマイベントが起きたら true を返す。 */
  count(clocks: number): boolean {
    return super.count(clocks);
  }

  protected override setStatus(bits: number): void {
    if ((this.status & bits) === 0) {
      this.status |= bits;
      this.intr(true);
    }
  }

  protected override resetStatus(bits: number): void {
    if ((this.status & bits) !== 0) {
      this.status &= ~bits;
      if (this.status === 0) {
        this.intr(false);
      }
    }
  }

  private intr(value: boolean): void {
    this.interrupt = value;
  }

  private rebuildTimeTable(): void {
    const fmClock = (this.clock / 64) | 0; // C# の uint 整数除算相当
    this.rateRatio = ((((fmClock << RatioBits) + (this.rate / 2)) / this.rate) | 0) >>> 0;
    this.setTimerPrescaler(64);
    this.chip.setRatio(this.rateRatio);
  }

  // ------------------------------------------------- レジスタ (Registers)

  private static readonly slTable = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 124];

  private static readonly slotTable = [0, 2, 1, 3];

  /** チップの 1 レジスタへ書き込む。 */
  setReg(addr: number, data: number): void {
    if (addr >= 0x100) {
      return;
    }

    const c = addr & 7;
    switch (addr & 0xff) {
      case 0x01: // TEST (LFO リスタート)
        if ((data & 2) !== 0) {
          this.lfoCount = 0;
          this.lfoCountPrev = 4294967295;
        }

        this.reg01 = data;
        break;
      case 0x08: // KEYON
        if ((this.regtc & 0x80) === 0) {
          this.channels[data & 7].keyControl(data >> 3);
        } else {
          // CSM モード: レジスタは演算子のキーオフのみ行う。
          const channel = this.channels[data & 7];
          if ((data & 0x08) === 0) channel.getOp(0).keyOff();
          if ((data & 0x10) === 0) channel.getOp(1).keyOff();
          if ((data & 0x20) === 0) channel.getOp(2).keyOff();
          if ((data & 0x40) === 0) channel.getOp(3).keyOff();
        }

        break;
      case 0x10:
      case 0x11: // CLKA1, CLKA2
        this.setTimerA(addr, data);
        break;
      case 0x12: // CLKB
        this.setTimerB(data);
        break;
      case 0x14: // CSM, TIMER 制御
        this.setTimerControl(data);
        break;
      case 0x18: // LFRQ (LFO 周波数)
        this.lfoFreq = data;
        // C#: (uint)(rateRatio * (uint)((16 + (lfoFreq & 15)) << (16 - 4 - RatioBits))
        //          / (uint)(1 << (15 - (lfoFreq >> 4))))
        {
          const num = ((16 + (this.lfoFreq & 15)) << (16 - 4 - RatioBits)) >>> 0;
          const den = (1 << (15 - (this.lfoFreq >> 4))) >>> 0;
          this.lfoCountDiff = (this.rateRatio * num) / den >>> 0;
        }
        break;
      case 0x19: // PMD / AMD
        if ((data & 0x80) !== 0) {
          this.pmd = data & 0x7f;
        } else {
          this.amd = data & 0x7f;
        }

        break;
      case 0x1b: // CT, W (LFO 波形)
        this.lfoWaveform = data & 3;
        break;
      case 0x20:
      case 0x21:
      case 0x22:
      case 0x23:
      case 0x24:
      case 0x25:
      case 0x26:
      case 0x27: // RL, FB, Connect
        this.channels[c].setFb((data >> 3) & 7);
        this.channels[c].setAlgorithm(data & 7);
        this.pan[c] = (data >> 6) & 3;
        break;
      case 0x28:
      case 0x29:
      case 0x2a:
      case 0x2b:
      case 0x2c:
      case 0x2d:
      case 0x2e:
      case 0x2f: // KC
        this.kc[c] = data;
        this.channels[c].setKcKf(this.kc[c], this.kf[c]);
        break;
      case 0x30:
      case 0x31:
      case 0x32:
      case 0x33:
      case 0x34:
      case 0x35:
      case 0x36:
      case 0x37: // KF
        this.kf[c] = data >> 2;
        this.channels[c].setKcKf(this.kc[c], this.kf[c]);
        break;
      case 0x38:
      case 0x39:
      case 0x3a:
      case 0x3b:
      case 0x3c:
      case 0x3d:
      case 0x3e:
      case 0x3f: // PMS, AMS
        this.channels[c].setMs((data << 4) | (data >> 4));
        break;
      case 0x0f: // NE / NFRQ (ノイズ)
        this.noiseDelta = data;
        this.noiseCount = 0;
        break;
      default:
        if (addr >= 0x40) {
          this.setParameter(addr, data);
        }

        break;
    }
  }

  /** 演算子ごとのパラメータレジスタ (40h-FFh) をデコードする。 */
  private setParameter(addr: number, data: number): void {
    const slot = Opm.slotTable[(addr >> 3) & 3];
    const op = this.channels[addr & 7].getOp(slot);

    switch ((addr >> 5) & 7) {
      case 2: // 40-5F DT1 / MULTI
        op.setDt((data >> 4) & 0x07);
        op.setMultiple(data & 0x0f);
        break;
      case 3: // 60-7F TL
        op.setTl(data & 0x7f, (this.regtc & 0x80) !== 0);
        break;
      case 4: // 80-9F KS / AR
        op.setKs((data >> 6) & 3);
        op.setAr((data & 0x1f) * 2);
        break;
      case 5: // A0-BF DR (D1R) / AMON (AMS-EN)
        op.setDr((data & 0x1f) * 2);
        op.setAmon((data & 0x80) !== 0);
        break;
      case 6: // C0-DF SR (D2R) / DT2
        op.setSr((data & 0x1f) * 2);
        op.setDt2((data >> 6) & 3);
        break;
      case 7: // E0-FF SL (D1L) / RR
        op.setSl(Opm.slTable[(data >> 4) & 15]);
        op.setRr((data & 0x0f) * 4 + 2);
        break;
    }
  }

  /** Timer A オーバーフロー: 有効時は全チャンネルを CSM キーオン/オフする。 */
  protected override timerA(): void {
    if ((this.regtc & 0x80) !== 0) {
      for (let i = 0; i < 8; i++) {
        this.channels[i].keyControl(0);
        this.channels[i].keyControl(0xf);
      }
    }
  }

  // ----------------------------------------------------------- LFO / ノイズ

  /** 出力標本 1 つごとに LFO を進める。 */
  private lfo(): void {
    if (this.lfoWaveform !== 3) {
      const index = (this.lfoCount >>> 15) & 0x1fe;
      this.chip.setPml(
        (Math.trunc((lfoPmTable[this.lfoWaveform][index] * this.pmd) / 128) + 0x80) >>> 0,
      );
      this.chip.setAml(Math.trunc((lfoAmTable[this.lfoWaveform][index] * this.amd) / 128) >>> 0);
    } else {
      // ノイズ LFO: カウンタ上位ビットの変化時に深度を更新する。
      if (((this.lfoCount ^ this.lfoCountPrev) & 0xfffe0000) !== 0) {
        const c = Math.floor(this.random.next(32768) / 17) & 0xff;
        this.chip.setPml((Math.trunc(((c - 0x80) * this.pmd) / 128) + 0x80) >>> 0);
        this.chip.setAml(Math.trunc((c * this.amd) / 128) >>> 0);
      }
    }

    this.lfoCountPrev = this.lfoCount;
    this.lfoStep = (this.lfoStep + 1) >>> 0;
    if ((this.lfoStep & 7) === 0) {
      this.lfoCount = (this.lfoCount + this.lfoCountDiff) >>> 0;
    }
  }

  /** ノイズ発生器 (LFSR、多項式 8408h) を進める。 */
  private noiseGen(): number {
    this.noiseCount += (2 * this.rateRatio) | 0;
    if (this.noiseCount >= (32 << RatioBits)) {
      let n = 32 - (this.noiseDelta & 0x1f);
      if (n === 1) {
        n = 2;
      }

      this.noiseCount -= n << RatioBits;
      if ((this.noiseDelta & 0x1f) === 0x1f) {
        this.noiseCount -= RatioBits;
      }

      this.noise = ((this.noise >>> 1) ^ ((this.noise & 1) !== 0 ? 0x8408 : 0)) >>> 0;
    }

    return this.noise;
  }

  // ---------------------------------------------------------------- 合成 (Mix)

  /**
   * nsamples 分のステレオ標本 (L, R インターリーブ) をバッファの offset 以降へ加算する。
   */
  mix(buffer: Int32Array, offset: number, nsamples: number): void {
    // 奇数ビット = 発音中、偶数ビット = LFO 使用中。
    let activeChannels = 0;
    for (let i = 0; i < 8; i++) {
      activeChannels = ((activeChannels << 2) | this.channels[i].prepare()) >>> 0;
    }

    if ((activeChannels & 0x5555) === 0) {
      return;
    }

    // LFO 波形が無効: 通常のミキシングパスへ強制する。
    if ((this.reg01 & 0x02) !== 0) {
      activeChannels &= 0x5555;
    }

    for (let i = 0; i < 8; i++) {
      this.idest[i] = this.pan[i];
    }

    for (let sample = 0; sample < nsamples; sample++) {
      this.ibuf[1] = this.ibuf[2] = this.ibuf[3] = 0;
      this.lfo();
      if ((activeChannels & 0xaaaa) !== 0) {
        this.mixSubL(activeChannels);
      } else {
        this.mixSub(activeChannels);
      }

      buffer[offset + sample * 2] += (limit(this.ibuf[1] + this.ibuf[3], 0xffff, -0x10000) * this.fmVolumeL) >> 14;
      buffer[offset + sample * 2 + 1] += (limit(this.ibuf[2] + this.ibuf[3], 0xffff, -0x10000) * this.fmVolumeR) >> 14;
    }
  }

  private mixSub(activeChannels: number): void {
    if ((activeChannels & 0x4000) !== 0) this.ibuf[this.idest[0]] = this.channels[0].calc();
    if ((activeChannels & 0x1000) !== 0) this.ibuf[this.idest[1]] += this.channels[1].calc();
    if ((activeChannels & 0x0400) !== 0) this.ibuf[this.idest[2]] += this.channels[2].calc();
    if ((activeChannels & 0x0100) !== 0) this.ibuf[this.idest[3]] += this.channels[3].calc();
    if ((activeChannels & 0x0040) !== 0) this.ibuf[this.idest[4]] += this.channels[4].calc();
    if ((activeChannels & 0x0010) !== 0) this.ibuf[this.idest[5]] += this.channels[5].calc();
    if ((activeChannels & 0x0004) !== 0) this.ibuf[this.idest[6]] += this.channels[6].calc();
    if ((activeChannels & 0x0001) !== 0) {
      if ((this.noiseDelta & 0x80) !== 0) {
        this.ibuf[this.idest[7]] += this.channels[7].calcN(this.noiseGen());
      } else {
        this.ibuf[this.idest[7]] += this.channels[7].calc();
      }
    }
  }

  private mixSubL(activeChannels: number): void {
    if ((activeChannels & 0x4000) !== 0) this.ibuf[this.idest[0]] = this.channels[0].calcL();
    if ((activeChannels & 0x1000) !== 0) this.ibuf[this.idest[1]] += this.channels[1].calcL();
    if ((activeChannels & 0x0400) !== 0) this.ibuf[this.idest[2]] += this.channels[2].calcL();
    if ((activeChannels & 0x0100) !== 0) this.ibuf[this.idest[3]] += this.channels[3].calcL();
    if ((activeChannels & 0x0040) !== 0) this.ibuf[this.idest[4]] += this.channels[4].calcL();
    if ((activeChannels & 0x0010) !== 0) this.ibuf[this.idest[5]] += this.channels[5].calcL();
    if ((activeChannels & 0x0004) !== 0) this.ibuf[this.idest[6]] += this.channels[6].calcL();
    if ((activeChannels & 0x0001) !== 0) {
      if ((this.noiseDelta & 0x80) !== 0) {
        this.ibuf[this.idest[7]] += this.channels[7].calcLn(this.noiseGen());
      } else {
        this.ibuf[this.idest[7]] += this.channels[7].calcL();
      }
    }
  }
}

/** 値を [min, max] へクランプする。 */
function limit(value: number, max: number, min: number): number {
  return value > max ? max : value < min ? min : value;
}

/** LFO 波形テーブルを一度だけ構築する (Opm.Lfo.cs 由来)。 */
function buildLfoTables(): void {
  if (lfoTablesBuilt) {
    return;
  }

  lfoTablesBuilt = true;
  // C++ ビルドは rand() を使用する: 値は任意。C# 互換乱数で決定的に保つ。
  const random = new SystemRandom(1234);
  for (let type = 0; type < 4; type++) {
    let r = 0;
    for (let c = 0; c < OpmLfoEnts; c++) {
      let a: number;
      let p: number;
      switch (type) {
        case 0: // saw
          p = (((c + 0x100) & 0x1ff) / 2 | 0) - 0x80;
          a = 0xff - (c / 2 | 0);
          break;
        case 1: // square
          a = c < 0x100 ? 0xff : 0;
          p = c < 0x100 ? 0x7f : -0x80;
          break;
        case 2: // triangle
          p = (c + 0x80) & 0x1ff;
          p = p < 0x100 ? p - 0x80 : 0x17f - p;
          a = c < 0x100 ? 0xff - c : c - 0x100;
          break;
        default: // noise
          if ((c & 3) === 0) {
            r = Math.floor(random.next(32768) / 17) & 0xff;
          }

          a = r;
          p = r - 0x80;
          break;
      }

      lfoAmTable[type][c] = a;
      lfoPmTable[type][c] = -p - 1;
    }
  }
}
