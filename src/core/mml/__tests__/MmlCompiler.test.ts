/**
 * MML コンパイラの基本動作テスト。
 * (移植元: tests/MzSound.MmlCompiler.Tests/MmlCompilerTests.cs)
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler, type MmlCompileResult } from '../MmlCompiler';

function compile(mml: string): MmlCompileResult {
  return new MmlCompiler().compile(mml);
}

/** トラックデータ (コード先頭から) を取り出す。 */
export function getTrackData(result: MmlCompileResult, trackId: string): Uint8Array {
  if (result.musicData === null || result.map === null) {
    throw new Error('コンパイルに成功していない結果からトラックデータは取得できません');
  }

  const data = result.musicData;
  const mapTrack = result.map.tracks.find((t) => t.id === trackId);
  if (mapTrack === undefined) {
    throw new Error(`トラック ${trackId} はマップに存在しません`);
  }

  const nextOffsets = result.map.tracks
    .filter((t) => t.index > mapTrack.index)
    .map((t) => t.offset);
  const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : data.length;

  return data.slice(mapTrack.offset, nextOffset);
}

describe('MmlCompiler', () => {
  it('single note produces NOTE and TRACK_END', () => {
    const result = compile('P1 o4 c');
    expect(result.success).toBe(true);
    expect(result.musicData).not.toBeNull();

    const data = result.musicData as Uint8Array;
    expect(data[0]).toBe(0x4d); // 'M'
    expect(data[1]).toBe(0x5a); // 'Z'
    expect(data[2]).toBe(0x53); // 'S'
    expect(data[3]).toBe(0x44); // 'D'

    expect(result.quarterFrames).toBe(30); // t120 既定 → 四分音符 30 フレーム

    const tableOffset = data[10] | (data[11] << 8);
    const p1 = data[tableOffset] | (data[tableOffset + 1] << 8);
    expect(data[p1]).toBe(0x00); // NOTE
    expect(data[p1 + 1]).toBe(60); // o4 c = C4 = 60
    const len = data[p1 + 2] | (data[p1 + 3] << 8);
    expect(len).toBe(30); // 四分音符 = 30 フレーム
    const gate = data[p1 + 4] | (data[p1 + 5] << 8);
    expect(gate).toBe(26); // floor(30 × 7 / 8) = 26
    expect(data[p1 + 6]).toBe(0x0e); // TRACK_END
  });

  it('multiple tracks duplicate phrase', () => {
    const result = compile('P1,P2,P3 c d e');
    expect(result.success).toBe(true);
    expect(result.tracks.length).toBe(3);
  });

  it('tie extends length', () => {
    const result = compile('P1 c4^4');
    expect(result.success).toBe(true);

    const p1 = getTrackData(result, 'P1');
    const len = p1[2] | (p1[3] << 8);
    expect(len).toBe(60); // 四分 + 四分 = 60 フレーム
    const gate = p1[4] | (p1[5] << 8);
    expect(gate).toBe(52); // floor(60 × 7 / 8) = 52
  });

  it('loop produces loop opcodes', () => {
    const result = compile('P1 [cde]3');
    expect(result.success).toBe(true);

    const p1 = getTrackData(result, 'P1');
    expect(p1[0]).toBe(0x0b); // LOOP_START
    expect(p1[1]).toBe(0x00); // NOTE
    expect(p1[p1.length - 3]).toBe(0x0c); // LOOP_END
    expect(p1[p1.length - 2]).toBe(3); // 3 回
    expect(p1[p1.length - 1]).toBe(0x0e); // TRACK_END
  });

  it('tuplet splits evenly', () => {
    const result = compile('P1 {cde}2');
    expect(result.success).toBe(true);

    const p1 = getTrackData(result, 'P1');
    // 二分音符 = 60 フレーム (t120) → 3 等分で各 20 フレーム
    // NOTE 命令は 6 バイト (op, note, len2, gate2)
    expect(p1[2] | (p1[3] << 8)).toBe(20);
    expect(p1[8] | (p1[9] << 8)).toBe(20);
    expect(p1[14] | (p1[15] << 8)).toBe(20);
  });

  it('tempo command updates quarter frames', () => {
    const result = compile('P1 t150 c');
    expect(result.success).toBe(true);
    expect(result.quarterFrames).toBe(24); // 3600 / 150 = 24
  });

  it('frame tempo is precise', () => {
    // @t1,86 = 全音符が 86 フレーム → 四分音符 = 344 フレーム
    const result = compile('P1 @t1,86 c');
    expect(result.success).toBe(true);
    expect(result.quarterFrames).toBe(344);
  });
});
