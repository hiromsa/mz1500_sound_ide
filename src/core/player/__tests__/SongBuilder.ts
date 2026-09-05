/**
 * テスト用の MZSD データビルダー。
 * (移植元: tests/MzSound.Player.Tests/MzsdSequencerTests.cs — SongBuilder)
 */
import { FmToneParameterCount, MzsdOp, MzsdSong } from '../MzsdSong';

export class SongBuilder {
  static readonly HeaderSize = 32;

  static readonly TrackCount = MzsdSong.TrackCount;

  private static get trackTableOffset(): number {
    return SongBuilder.HeaderSize;
  }

  private static get trackDataOffset(): number {
    return SongBuilder.HeaderSize + SongBuilder.TrackCount * 4;
  }

  private readonly trackData: number[] = [];

  private readonly fmTones: number[] = [];

  private readonly volumeEnvelopes: Uint8Array[] = [];

  private readonly pitchEnvelopes: Uint8Array[] = [];

  private readonly dataOffsets = new Array<number>(SongBuilder.TrackCount).fill(0);

  private readonly loopOffsets = new Array<number>(SongBuilder.TrackCount).fill(0);

  /** トラックコード (複数チャンク可) を登録し、データオフセットを返す。 */
  addTrack(trackIndex: number, ...codeChunks: Uint8Array[]): number {
    const offset = SongBuilder.trackDataOffset + this.trackData.length;
    this.dataOffsets[trackIndex] = offset;
    for (const chunk of codeChunks) {
      this.trackData.push(...chunk);
    }

    return offset;
  }

  /** FM 音色 (46 パラメータ) を登録し、音色番号を返す。足りないパラメータは 0 埋め。 */
  addFmTone(parameters: ArrayLike<number> = []): number {
    const index = this.fmTones.length / FmToneParameterCount;
    for (let i = 0; i < FmToneParameterCount; i++) {
      this.fmTones.push(parameters[i] ?? 0);
    }

    return index;
  }

  /** 音量エンベロープ (@v) を登録し、番号を返す。loop/release は 255 で無効。 */
  addVolumeEnvelope(values: ArrayLike<number>, loopIndex = 255, releaseIndex = 255): number {
    const entry: number[] = [values.length, loopIndex, releaseIndex];
    for (let i = 0; i < values.length; i++) {
      entry.push(values[i]);
    }

    this.volumeEnvelopes.push(Uint8Array.from(entry));
    return this.volumeEnvelopes.length - 1;
  }

  /** ピッチエンベロープ (@EP) を登録し、番号を返す。loopIndex は 255 で無効。 */
  addPitchEnvelope(values: ArrayLike<number>, loopIndex = 255): number {
    const entry: number[] = [values.length, loopIndex];
    for (let i = 0; i < values.length; i++) {
      entry.push(values[i] & 0xff, (values[i] >> 8) & 0xff);
    }

    this.pitchEnvelopes.push(Uint8Array.from(entry));
    return this.pitchEnvelopes.length - 1;
  }

  setLoop(trackIndex: number, loopOffset: number): void {
    this.loopOffsets[trackIndex] = loopOffset;
  }

  build(quarterFrames = 30): Uint8Array {
    const venvTableOffset = SongBuilder.trackDataOffset + this.trackData.length;
    const penvTableOffset =
      venvTableOffset + this.volumeEnvelopes.reduce((sum, envelope) => sum + envelope.length, 0);
    const fmTableOffset =
      penvTableOffset + this.pitchEnvelopes.reduce((sum, envelope) => sum + envelope.length, 0);
    const total = fmTableOffset + this.fmTones.length;
    const data = new Uint8Array(total);

    // ヘッダ
    data[0] = 0x4d; // 'M'
    data[1] = 0x5a; // 'Z'
    data[2] = 0x53; // 'S'
    data[3] = 0x44; // 'D'
    data[4] = 0x01;
    data[5] = SongBuilder.TrackCount;
    writeU16(data, 6, quarterFrames);
    writeU16(data, 10, SongBuilder.trackTableOffset);
    writeU16(data, 12, venvTableOffset);
    data[14] = this.volumeEnvelopes.length;
    writeU16(data, 15, penvTableOffset);
    data[17] = this.pitchEnvelopes.length;
    writeU16(data, 18, fmTableOffset);
    data[20] = this.fmTones.length / FmToneParameterCount;

    // トラックテーブル
    for (let i = 0; i < SongBuilder.TrackCount; i++) {
      writeU16(data, SongBuilder.trackTableOffset + i * 4, this.dataOffsets[i]);
      writeU16(data, SongBuilder.trackTableOffset + i * 4 + 2, this.loopOffsets[i]);
    }

    // トラックデータ
    data.set(this.trackData, SongBuilder.trackDataOffset);

    // エンベロープテーブル
    let offset = venvTableOffset;
    for (const envelope of this.volumeEnvelopes) {
      data.set(envelope, offset);
      offset += envelope.length;
    }

    for (const envelope of this.pitchEnvelopes) {
      data.set(envelope, offset);
      offset += envelope.length;
    }

    // FM 音色テーブル
    if (this.fmTones.length > 0) {
      data.set(this.fmTones, fmTableOffset);
    }

    return data;
  }

  // --- 命令コード生成ヘルパ (C# 版の静的メソッド相当) ---

  static tone(index: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Tone, index]);
  }

  static venv(id: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Venv, id]);
  }

  static penv(id: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Penv, id]);
  }

  static sweep(value: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Sweep, value]);
  }

  static detune(value: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Detune, value & 0xff, (value >> 8) & 0xff]);
  }

  static transpose(value: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Transpose, value]);
  }

  static noiseCtl(flags: number): Uint8Array {
    return Uint8Array.from([MzsdOp.NoiseCtl, flags]);
  }

  static loopStart(): Uint8Array {
    return Uint8Array.from([MzsdOp.LoopStart]);
  }

  static loopEnd(count: number): Uint8Array {
    return Uint8Array.from([MzsdOp.LoopEnd, count]);
  }

  static note(note: number, len: number, gate: number): Uint8Array {
    return Uint8Array.from([
      MzsdOp.Note,
      note,
      len & 0xff,
      (len >> 8) & 0xff,
      gate & 0xff,
      (gate >> 8) & 0xff,
    ]);
  }

  static rest(len: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Rest, len & 0xff, (len >> 8) & 0xff]);
  }

  static volume(value: number): Uint8Array {
    return Uint8Array.from([MzsdOp.Volume, value]);
  }

  static trackEnd(): Uint8Array {
    return Uint8Array.from([MzsdOp.TrackEnd]);
  }
}

function writeU16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}
