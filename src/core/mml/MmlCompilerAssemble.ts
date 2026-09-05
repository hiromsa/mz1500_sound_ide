/**
 * パース結果のトラックコードを結合してバイナリデータを組み立てる。
 * (移植元: MzSound.MmlCompiler/MmlCompiler.Assemble.cs)
 */
import type { MmlMap, MmlMapTrack } from './MmlMap';
import type { FmTone, PitchEnvelope, VolumeEnvelope } from './Envelopes';
import type { ParseResult } from './parser/MmlParserTypes';

const headerSize = 32;
const trackCount = 17;

export interface AssembleOutput {
  data: Uint8Array;
  map: MmlMap;
  totalFrames: number;
}

export function assembleMusicData(
  parseResult: ParseResult,
  volumeEnvelopes: readonly VolumeEnvelope[],
  pitchEnvelopes: readonly PitchEnvelope[],
  fmTones: readonly FmTone[],
): AssembleOutput {
  const usedTracks = [...parseResult.tracks.values()]
    .sort((a, b) => a.track.index - b.track.index);

  // トラックテーブル = dataOffset(2) + loopOffset(2) / トラック
  const trackTableOffset = headerSize;
  const trackDataOffset = trackTableOffset + trackCount * 4;

  const trackTable = new Uint8Array(trackCount * 4);
  const trackData: number[] = [];

  for (const track of usedTracks) {
    const slot = track.track.index * 4;
    const offset = trackDataOffset + trackData.length;
    writeUInt16(trackTable, slot, offset);
    writeUInt16(
      trackTable,
      slot + 2,
      track.wholeLoopOffset >= 0 ? offset + track.wholeLoopOffset : 0,
    );
    trackData.push(...track.code);
  }

  // 音量エンベロープテーブル: [len, loop, release, data...] / 1 エンベロープ
  const venvTableOffset = trackDataOffset + trackData.length;
  const venvTable: number[] = [];
  for (const env of volumeEnvelopes) {
    venvTable.push(env.values.length);
    venvTable.push(env.loopIndex >= 0 ? env.loopIndex : 255);
    venvTable.push(env.releaseIndex >= 0 ? env.releaseIndex : 255);
    for (const v of env.values) {
      venvTable.push(v);
    }
  }

  // ピッチエンベロープテーブル: [len, loop, data(2B each)]
  const penvTableOffset = venvTableOffset + venvTable.length;
  const penvTable: number[] = [];
  for (const env of pitchEnvelopes) {
    penvTable.push(env.values.length);
    penvTable.push(env.loopIndex >= 0 ? env.loopIndex : 255);
    for (const v of env.values) {
      penvTable.push(v & 0xff);
      penvTable.push((v >> 8) & 0xff);
    }
  }

  // FM 音色テーブル: 46 バイト / 1 音色
  const fmTableOffset = penvTableOffset + penvTable.length;
  const fmTable: number[] = [];
  for (const tone of fmTones) {
    for (const p of tone.parameters) {
      fmTable.push(p);
    }
  }

  const totalSize = fmTableOffset + fmTable.length;
  const data = new Uint8Array(Math.max(totalSize, headerSize));

  // ヘッダ
  data[0] = 0x4d; // 'M'
  data[1] = 0x5a; // 'Z'
  data[2] = 0x53; // 'S'
  data[3] = 0x44; // 'D'
  data[4] = 0x01; // version
  data[5] = trackCount;
  writeUInt16(data, 6, parseResult.quarterFrames);
  data[8] = 0; // flags (bit0: FM データあり) ※将来用
  writeUInt16(data, 10, trackTableOffset);
  writeUInt16(data, 12, venvTableOffset);
  data[14] = volumeEnvelopes.length;
  writeUInt16(data, 15, penvTableOffset);
  data[17] = pitchEnvelopes.length;
  writeUInt16(data, 18, fmTableOffset);
  data[20] = fmTones.length;

  data.set(trackTable, trackTableOffset);
  data.set(Uint8Array.from(trackData), trackDataOffset);
  data.set(Uint8Array.from(venvTable), venvTableOffset);
  data.set(Uint8Array.from(penvTable), penvTableOffset);
  data.set(Uint8Array.from(fmTable), fmTableOffset);

  // デバッグマップ (使用トラックのみ)
  const mapTracks: MmlMapTrack[] = [];
  let dataCursor = trackDataOffset;
  for (const track of usedTracks) {
    mapTracks.push({
      id: track.track.id,
      index: track.track.index,
      offset: dataCursor,
      events: track.events,
    });
    dataCursor += track.code.length;
  }

  const map: MmlMap = { version: 1, tracks: mapTracks };
  const totalFrames = usedTracks.length === 0
    ? 0
    : Math.ceil(Math.max(...usedTracks.map((t) => t.tickSeconds)) * 60.0);

  return { data, map, totalFrames };
}

function writeUInt16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = value >> 8;
}
