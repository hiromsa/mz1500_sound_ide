/**
 * mmlPlaybackTracker の単体テスト。
 * 実際の MmlCompiler のコンパイル結果 (MmlMap) と組み合わせて検証する。
 */
import { describe, expect, it } from 'vitest';
import { MmlCompiler } from '../../core/mml/MmlCompiler';
import type { MmlMap } from '../../core/mml/MmlMap';
import {
  findActiveEvent,
  findEventAtOffset,
  resolvePlaybackPositions,
} from '../mmlPlaybackTracker';

/** MML をコンパイルして MmlMap を取り出す。 */
function compileMap(mml: string): MmlMap {
  const result = new MmlCompiler().compile(mml);
  expect(result.success, result.diagnostics.map((d) => d.message).join('\n')).toBe(true);
  expect(result.map).not.toBeNull();
  return result.map as MmlMap;
}

/** トラックインデックス → 絶対オフセット のモック取得関数を作る (未指定は -1 = 停止中)。 */
function offsetProvider(values: Record<number, number>): (trackIndex: number) => number {
  return (trackIndex: number) => values[trackIndex] ?? -1;
}

describe('MmlMap ソース位置記録', () => {
  it('音符イベントに列位置とトークン長が記録される', () => {
    const map = compileMap('P1 c d e');
    const track = map.tracks[0];

    expect(track.id).toBe('P1');
    expect(track.events).toHaveLength(3);

    // 列位置: P1=1-2, 空白=3 → c=4, d=6, e=8 / トークン長は各 1 文字
    expect(track.events[0]).toMatchObject({ line: 1, column: 4, length: 1, kind: 'note' });
    expect(track.events[1]).toMatchObject({ line: 1, column: 6, length: 1, kind: 'note' });
    expect(track.events[2]).toMatchObject({ line: 1, column: 8, length: 1, kind: 'note' });

    // NOTE 命令 (op + note + len2 + gate2 = 6 バイト) の連続
    expect(track.events.map((e) => e.offset)).toEqual([0, 6, 12]);
  });

  it('音長付き音符のトークン長には数字が含まれる', () => {
    const map = compileMap('P1 c4 d2');
    const events = map.tracks[0].events;

    expect(events[0]).toMatchObject({ column: 4, length: 2, kind: 'note' });
    expect(events[1]).toMatchObject({ column: 7, length: 2, kind: 'note' });
  });

  it('休符イベントは kind が rest になる', () => {
    const map = compileMap('P1 c r2');
    const events = map.tracks[0].events;

    expect(events[0]).toMatchObject({ column: 4, length: 1, kind: 'note' });
    expect(events[1]).toMatchObject({ column: 6, length: 2, kind: 'rest' });

    // REST 命令 (op + len2 = 3 バイト) は c の NOTE (6 バイト) の直後
    expect(events[1].offset).toBe(6);
  });

  it('連符内のイベントは列位置不定 (column 0) として記録される', () => {
    const map = compileMap('P1 {cd}4');
    const events = map.tracks[0].events;

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ column: 0, length: 0, kind: 'note' });
    expect(events[1]).toMatchObject({ column: 0, length: 0, kind: 'note' });
  });

  it('複数行の MML では行番号が記録される', () => {
    const map = compileMap('P1 c\nd');
    const events = map.tracks[0].events;

    expect(events[0].line).toBe(1);
    expect(events[1].line).toBe(2);
  });
});

describe('findEventAtOffset', () => {
  it('到達済みの最新イベントを二分探索する', () => {
    const map = compileMap('P1 c d e');
    const track = map.tracks[0];

    expect(findEventAtOffset(track, 0)?.column).toBe(4);
    expect(findEventAtOffset(track, 5)?.column).toBe(4);
    expect(findEventAtOffset(track, 6)?.column).toBe(6);
    expect(findEventAtOffset(track, 999)?.column).toBe(8);
  });

  it('トラック先頭未満は null を返す', () => {
    const map = compileMap('P1 t120 c');
    const track = map.tracks[0];

    // t120 が先頭に emit されるため最初の音符イベントは offset > 0
    expect(track.events[0].offset).toBeGreaterThan(0);
    expect(findEventAtOffset(track, 0)).toBeNull();
  });
});

describe('findActiveEvent', () => {
  it('NOTE 命令を読み終えた位置から発音区間として判定する', () => {
    const map = compileMap('P1 c d e');
    const track = map.tracks[0];

    // c: offset 0 / サイズ 6 → 発音区間は [6, 12)
    expect(findActiveEvent(track, 5)).toBeNull();
    expect(findActiveEvent(track, 6)?.column).toBe(4);
    expect(findActiveEvent(track, 11)?.column).toBe(4);

    // d: offset 6 / 発音区間 [12, 18)
    expect(findActiveEvent(track, 12)?.column).toBe(6);

    // e: offset 12 / 発音区間 [18, 24) (TRACK_END 到達後も最後のイベントを保持)
    expect(findActiveEvent(track, 18)?.column).toBe(8);
    expect(findActiveEvent(track, 999)?.column).toBe(8);
  });

  it('REST 命令のサイズ (3 バイト) で発音区間を判定する', () => {
    const map = compileMap('P1 c r2');
    const track = map.tracks[0];
    // c: offset 0 サイズ 6 → 発音区間 [6, 9) / r2: offset 6 サイズ 3 → 発音区間 [9, ...)

    expect(findActiveEvent(track, 8)?.column).toBe(4);
    expect(findActiveEvent(track, 9)?.kind).toBe('rest');
  });
});

describe('resolvePlaybackPositions', () => {
  it('絶対オフセット (MZSD データ先頭基準) を MML 位置へ解決する', () => {
    const map = compileMap('P1 c d e');
    const track = map.tracks[0];

    // トラックデータ開始 = ヘッダ(32) + トラックテーブル(17*4) = 100
    // c の発音区間は相対 [6, 12) → 絶対 [106, 112)
    const getOffset = offsetProvider({ 0: track.offset + 6 });
    const positions = resolvePlaybackPositions(map, getOffset);

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      trackId: 'P1',
      trackIndex: 0,
      line: 1,
      column: 4,
      length: 1,
      kind: 'note',
    });
  });

  it('複数トラックの演奏位置を同時に解決する', () => {
    const map = compileMap('P1,P2 c d');
    expect(map.tracks).toHaveLength(2);

    const [p1, p2] = map.tracks;
    const getOffset = offsetProvider({
      0: p1.offset + 6, // P1 = c 発音中
      1: p2.offset + 6, // P2 = c 発音中
    });

    const positions = resolvePlaybackPositions(map, getOffset);

    // c は "P1,P2 c d" の 7 列目
    expect(positions).toHaveLength(2);
    expect(positions.map((p) => ({ id: p.trackId, line: p.line, column: p.column, kind: p.kind }))).toEqual([
      { id: 'P1', line: 1, column: 7, kind: 'note' },
      { id: 'P2', line: 1, column: 7, kind: 'note' },
    ]);
  });

  it('停止中 (-1) のトラックは除外する', () => {
    const map = compileMap('P1 c');
    const track = map.tracks[0];

    const positions = resolvePlaybackPositions(map, offsetProvider({ 0: -1 }));
    expect(positions).toHaveLength(0);

    const playing = resolvePlaybackPositions(map, offsetProvider({ 0: track.offset + 6 }));
    expect(playing).toHaveLength(1);
  });

  it('最初の音符に到達していない間は解決しない', () => {
    const map = compileMap('P1 c d');
    const track = map.tracks[0];

    // トラック開始直後 (音符読み取り前)
    const positions = resolvePlaybackPositions(map, offsetProvider({ 0: track.offset }));
    expect(positions).toHaveLength(0);
  });
});
