/**
 * バイナリ音楽データ (MZSD 形式) の解析結果。
 * 形式仕様: docs/specification/binary_music_format_spec.md (MmlCompiler 実装準拠)。
 * (移植元: MzSound.Player/Sequencer/MzsdSong.cs)
 */

/** 音量エンベロープ定義 (@v)。 */
export interface VolumeEnvelopeDef {
  /** 音量値列 (0-15)。 */
  readonly values: Uint8Array;

  /** ループ位置 (255 = ループなし)。 */
  readonly loopIndex: number;

  /** リリース位置 (255 = リリースなし)。 */
  readonly releaseIndex: number;
}

/** ピッチエンベロープ定義 (@EP)。 */
export interface PitchEnvelopeDef {
  /** ピッチ値列 (レジスタ差分、+ = 音程上昇)。 */
  readonly values: Int16Array;

  /** ループ位置 (255 = ループなし)。 */
  readonly loopIndex: number;
}

/** FM 音色の 1 音色あたりパラメータ数。 */
export const FmToneParameterCount = 46;

/** FM 音色定義 (@FM、46 パラメータ)。 */
export interface FmToneDef {
  readonly parameters: Uint8Array;
}

/** MZSD 命令コード。 */
export const MzsdOp = {
  Note: 0x00,
  Rest: 0x01,
  Tempo: 0x02,
  Volume: 0x03,
  Venv: 0x04,
  Penv: 0x05,
  Sweep: 0x06,
  Detune: 0x07,
  Transpose: 0x08,
  Tone: 0x09,
  NoiseCtl: 0x0a,
  LoopStart: 0x0b,
  LoopEnd: 0x0c,
  TrackEnd: 0x0e,
} as const;

const HeaderMinSize = 32;

const Magic = [0x4d, 0x5a, 0x53, 0x44] as const; // 'M', 'Z', 'S', 'D'

export class MzsdSong {
  /** トラック数 (PSG1 4ch + PSG2 4ch + BEEP + FM 8ch)。 */
  static readonly TrackCount = 17;

  /** 生データ (ヘッダ / トラック / エンベロープテーブルを含む)。 */
  readonly data: Uint8Array;

  /** 初期テンポ (四分音符あたりのフレーム数、60Hz 基準)。 */
  initialQuarterFrames = 0;

  /** 曲全体ループ (L コマンド) を持つか。 */
  hasWholeLoop = false;

  volumeEnvelopes: readonly VolumeEnvelopeDef[] = [];

  pitchEnvelopes: readonly PitchEnvelopeDef[] = [];

  fmTones: readonly FmToneDef[] = [];

  private readonly trackDataOffsets = new Array<number>(MzsdSong.TrackCount).fill(0);

  private readonly trackLoopOffsets = new Array<number>(MzsdSong.TrackCount).fill(0);

  private constructor(data: Uint8Array) {
    this.data = data;
  }

  /** トラックのデータ開始オフセット (0 = データなし)。 */
  trackDataOffset(trackIndex: number): number {
    return this.trackDataOffsets[trackIndex];
  }

  /** トラックの全体ループ復帰オフセット (0 = L なし)。 */
  trackLoopOffset(trackIndex: number): number {
    return this.trackLoopOffsets[trackIndex];
  }

  /** MZSD データを解析する。 */
  static parse(data: Uint8Array): MzsdSong {
    if (data.length < HeaderMinSize) {
      throw new Error('MZSD データが短すぎます (ヘッダ 32 バイト未満)。');
    }

    if (data[0] !== Magic[0] || data[1] !== Magic[1] || data[2] !== Magic[2] || data[3] !== Magic[3]) {
      throw new Error('MZSD マジックが一致しません。');
    }

    const song = new MzsdSong(data);
    song.initialQuarterFrames = readUInt16(data, 6);

    const trackTableOffset = readUInt16(data, 10);
    for (let i = 0; i < MzsdSong.TrackCount; i++) {
      song.trackDataOffsets[i] = readUInt16(data, trackTableOffset + i * 4);
      song.trackLoopOffsets[i] = readUInt16(data, trackTableOffset + i * 4 + 2);
      if (song.trackLoopOffsets[i] > 0) {
        song.hasWholeLoop = true;
      }
    }

    // 音量エンベロープテーブル: [len, loop, release, data...] × count
    const volumeEnvelopes: VolumeEnvelopeDef[] = [];
    let venvOffset = readUInt16(data, 12);
    const venvCount = data[14];
    for (let i = 0; i < venvCount; i++) {
      const length = data[venvOffset];
      const loop = data[venvOffset + 1];
      const release = data[venvOffset + 2];
      const values = new Uint8Array(length);
      values.set(data.subarray(venvOffset + 3, venvOffset + 3 + length));
      volumeEnvelopes.push({ values, loopIndex: loop, releaseIndex: release });
      venvOffset += 3 + length;
    }

    song.volumeEnvelopes = volumeEnvelopes;

    // ピッチエンベロープテーブル: [len, loop, data(2B each)] × count
    const pitchEnvelopes: PitchEnvelopeDef[] = [];
    let penvOffset = readUInt16(data, 15);
    const penvCount = data[17];
    for (let i = 0; i < penvCount; i++) {
      const length = data[penvOffset];
      const loop = data[penvOffset + 1];
      const values = new Int16Array(length);
      for (let j = 0; j < length; j++) {
        values[j] = readInt16(data, penvOffset + 2 + j * 2);
      }

      pitchEnvelopes.push({ values, loopIndex: loop });
      penvOffset += 2 + length * 2;
    }

    song.pitchEnvelopes = pitchEnvelopes;

    // FM 音色テーブル: 46 バイト × count
    const fmTones: FmToneDef[] = [];
    const fmTableOffset = readUInt16(data, 18);
    const fmCount = data[20];
    for (let i = 0; i < fmCount; i++) {
      const parameters = new Uint8Array(FmToneParameterCount);
      parameters.set(
        data.subarray(
          fmTableOffset + i * FmToneParameterCount,
          fmTableOffset + (i + 1) * FmToneParameterCount,
        ),
      );
      fmTones.push({ parameters });
    }

    song.fmTones = fmTones;

    return song;
  }
}

/** リトルエンディアン unsigned 16bit 読み出し。 */
export function readUInt16(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

/** リトルエンディアン signed 16bit 読み出し。 */
export function readInt16(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] | (buffer[offset + 1] << 8)) << 16 >> 16;
}
