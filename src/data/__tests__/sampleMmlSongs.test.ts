/**
 * SAMPLE MML (samples/ フォルダ) のデータ整合性テスト。
 *
 * - samples/ 配下の全 .mml がエラー / 警告なしでコンパイルできること
 * - id / パスの一意性と検索ヘルパーの動作
 * - classics/ 楽曲の作法規約 (曲頭永久ループ L / BEEP 音量不可 / #OPM 連動)
 * を保証する。ユーザーが samples/ に追加した .mml も自動的に検証対象になる。
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../../core/mml/MmlCompiler';
import {
  SAMPLE_MML_FILES,
  findSampleFileById,
  findSampleFileByRelativePath,
} from '../sampleMmlSongs';

/** classics/ フォルダ (著作権フリー古典楽曲集) のファイルのみ取得する。 */
const classics = SAMPLE_MML_FILES.filter((file) => file.folderPath === 'classics');

describe('sampleMmlSongs', () => {
  it('samples/ フォルダから .mml が読み込まれ、classics に 5 曲ある', () => {
    expect(classics.map((file) => file.fileName)).toEqual([
      'classic_fur_elise.mml',
      'classic_menuett_g.mml',
      'classic_ode_to_joy.mml',
      'classic_pachelbel_canon.mml',
      'classic_twinkle_star.mml',
    ]);
  });

  it('id と相対パスはユニークであり、各メタ情報が正しく生成されている', () => {
    const ids = SAMPLE_MML_FILES.map((file) => file.id);
    const relativePaths = SAMPLE_MML_FILES.map((file) => file.relativePath);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(relativePaths).size).toBe(relativePaths.length);

    for (const file of SAMPLE_MML_FILES) {
      expect(file.fileName.endsWith('.mml'), file.id).toBe(true);
      expect(file.content.length, file.id).toBeGreaterThan(0);
      expect(file.relativePath, file.id).toBe(`samples/${file.id}`);
      expect(file.id.startsWith(`${file.folderPath}/`), file.id).toBe(true);
    }
  });

  it('samples/ 配下はフォルダパス・ファイル名順にソートされている', () => {
    const sorted = [...SAMPLE_MML_FILES].sort(
      (a, b) =>
        a.folderPath.localeCompare(b.folderPath) || a.fileName.localeCompare(b.fileName),
    );

    expect(SAMPLE_MML_FILES).toEqual(sorted);
  });

  it('全サンプル MML がエラー・警告なしでコンパイルできる', () => {
    for (const file of SAMPLE_MML_FILES) {
      const result = new MmlCompiler().compile(file.content);

      expect(
        result.diagnostics,
        `${file.id}: ${JSON.stringify(result.diagnostics)}`,
      ).toHaveLength(0);
      expect(result.success, file.id).toBe(true);
      expect(result.musicData, file.id).not.toBeNull();
      expect(result.totalFrames, file.id).toBeGreaterThan(0);
    }
  });

  it('検索ヘルパー (id / relativePath) が正しく動作する', () => {
    const first = SAMPLE_MML_FILES[0];

    expect(findSampleFileById(first.id)).toBe(first);
    expect(findSampleFileByRelativePath(first.relativePath)).toBe(first);
    expect(findSampleFileById('not-exist.mml')).toBeUndefined();
    expect(findSampleFileByRelativePath('samples/not_exist.mml')).toBeUndefined();
  });

  // === 以下は classics/ 楽曲の作法規約テスト (ユーザー追加曲には適用しない) ===

  it('[classics] FM トラック (F1〜F8) の使用と #OPM ON の宣言が一致する', () => {
    for (const file of classics) {
      const usesFm = /(^|\s)F[1-8]\b/.test(file.content);
      const declaresOpmOn = /#OPM\s+ON\b/i.test(file.content);

      expect(usesFm, file.fileName).toBe(declaresOpmOn);
    }
  });

  it('[classics] BEEP トラック (B1) の行に音量コマンド (v / @VE) を書いていない', () => {
    for (const file of classics) {
      const beepLines = file.content.split('\n').filter((line) => line.trimStart().startsWith('B1'));

      // B1 を使用しない曲はチェック対象外 (BEEP はハードウェア的に音量制御不可)
      for (const line of beepLines) {
        expect(line, file.fileName).not.toMatch(/(^|\s)v\d+/);
        expect(line, file.fileName).not.toMatch(/@VE/i);
      }
    }
  });

  it('[classics] 使用中の全トラックが先頭行で L を宣言している (曲頭永久ループの規約)', () => {
    for (const file of classics) {
      const usedTracks = new Set<string>();
      const loopTracks = new Set<string>();

      for (const rawLine of file.content.split('\n')) {
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
      expect(missing, file.fileName).toHaveLength(0);
    }
  });

  it('[classics] 全トラックのループ復帰位置がトラックデータ先頭と一致する (曲頭ループ)', () => {
    for (const file of classics) {
      const result = new MmlCompiler().compile(file.content);
      const data = result.musicData as Uint8Array;
      // ヘッダ 10-11 バイト目にトラックテーブルのオフセットが格納される
      // (トラックテーブル: dataOffset 2 バイト + loopOffset 2 バイト / トラック)
      const tableOffset = data[10] | (data[11] << 8);

      for (const track of result.tracks) {
        const slot = tableOffset + track.index * 4;
        const dataOffset = data[slot] | (data[slot + 1] << 8);
        const loopOffset = data[slot + 2] | (data[slot + 3] << 8);

        expect(loopOffset, `${file.fileName}: ${track.id}`).toBe(dataOffset);
      }
    }
  });
});
