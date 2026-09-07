/**
 * SAMPLE MML (パブリックドメイン古典楽曲) のデータ整合性テスト。
 * 全サンプル曲がコンパイラでエラー / 警告なしにコンパイルできること、
 * 音源特性 (BEEP 音量不可・#OPM 連動) や永久ループ (L) の規約を
 * 守っていることを保証する。
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../../core/mml/MmlCompiler';
import {
  CLASSIC_SAMPLE_MML_SONGS,
  findSampleSongByFileName,
  findSampleSongById,
} from '../sampleMmlSongs';

describe('sampleMmlSongs', () => {
  it('id と fileName はユニークである', () => {
    const ids = CLASSIC_SAMPLE_MML_SONGS.map((song) => song.id);
    const fileNames = CLASSIC_SAMPLE_MML_SONGS.map((song) => song.fileName);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  it('メタデータ (title / composer / chips / .mml 形式の fileName) を持つ', () => {
    for (const song of CLASSIC_SAMPLE_MML_SONGS) {
      expect(song.fileName.endsWith('.mml'), song.fileName).toBe(true);
      expect(song.title.length, song.fileName).toBeGreaterThan(0);
      expect(song.composer.length, song.fileName).toBeGreaterThan(0);
      expect(song.chips.length, song.fileName).toBeGreaterThan(0);
    }
  });

  it('全サンプル曲がエラー・警告なしでコンパイルできる', () => {
    for (const song of CLASSIC_SAMPLE_MML_SONGS) {
      const result = new MmlCompiler().compile(song.content);

      expect(
        result.diagnostics,
        `${song.fileName}: ${JSON.stringify(result.diagnostics)}`,
      ).toHaveLength(0);
      expect(result.success, song.fileName).toBe(true);
      expect(result.musicData, song.fileName).not.toBeNull();
      expect(result.totalFrames, song.fileName).toBeGreaterThan(0);
    }
  });

  it('FM トラック (F1〜F8) の使用と #OPM ON の宣言が一致する', () => {
    for (const song of CLASSIC_SAMPLE_MML_SONGS) {
      const usesFm = /(^|\s)F[1-8]\b/.test(song.content);
      const declaresOpmOn = /#OPM\s+ON\b/i.test(song.content);

      expect(usesFm, song.fileName).toBe(declaresOpmOn);
    }
  });

  it('BEEP トラック (B1) の行に音量コマンド (v / @VE) を書いていない', () => {
    for (const song of CLASSIC_SAMPLE_MML_SONGS) {
      const beepLines = song.content.split('\n').filter((line) => line.trimStart().startsWith('B1'));

      // B1 を使用しない曲はチェック対象外 (BEEP はハードウェア的に音量制御不可)
      for (const line of beepLines) {
        expect(line, song.fileName).not.toMatch(/(^|\s)v\d+/);
        expect(line, song.fileName).not.toMatch(/@VE/i);
      }
    }
  });

  it('使用中の全トラックが先頭行で L を宣言している (曲頭永久ループの規約)', () => {
    for (const song of CLASSIC_SAMPLE_MML_SONGS) {
      const usedTracks = new Set<string>();
      const loopTracks = new Set<string>();

      for (const rawLine of song.content.split('\n')) {
        const line = rawLine.trim();
        const match = line.match(/^(P[1-6]|N[12]|B1|F[1-8])\b/);
        if (match === null) {
          continue;
        }

        usedTracks.add(match[1]);
        if (/^(P[1-6]|N[12]|B1|F[1-8])\s+L\b/.test(line)) {
          loopTracks.add(match[1]);
        }
      }

      const missing = [...usedTracks].filter((track) => !loopTracks.has(track));
      expect(missing, song.fileName).toHaveLength(0);
    }
  });

  it('全トラックのループ復帰位置がトラックデータ先頭と一致する (曲頭ループ)', () => {
    for (const song of CLASSIC_SAMPLE_MML_SONGS) {
      const result = new MmlCompiler().compile(song.content);
      const data = result.musicData as Uint8Array;
      // ヘッダ 10-11 バイト目にトラックテーブルのオフセットが格納される
      // (トラックテーブル: dataOffset 2 バイト + loopOffset 2 バイト / トラック)
      const tableOffset = data[10] | (data[11] << 8);

      for (const track of result.tracks) {
        const slot = tableOffset + track.index * 4;
        const dataOffset = data[slot] | (data[slot + 1] << 8);
        const loopOffset = data[slot + 2] | (data[slot + 3] << 8);

        expect(loopOffset, `${song.fileName}: ${track.id}`).toBe(dataOffset);
      }
    }
  });

  it('検索ヘルパー (id / fileName) が正しく動作する', () => {
    const first = CLASSIC_SAMPLE_MML_SONGS[0];

    expect(findSampleSongById(first.id)).toBe(first);
    expect(findSampleSongByFileName(first.fileName)).toBe(first);
    expect(findSampleSongById('not-exist')).toBeUndefined();
    expect(findSampleSongByFileName('not_exist.mml')).toBeUndefined();
  });
});
