/**
 * MML TRANSFORM 変換エンジンの単体テスト。
 *
 * - トラック帰属の解決が正式パーサ (MmlParser.detectTrackSpec) 準拠であること
 * - リマップ (スワップ含む)・オクターブシフト・移調・音量スケーリングの各変換
 * - 変換後の MML が正式パーサ (MmlCompiler) でエラーなくコンパイルできること
 */
import { describe, expect, it } from 'vitest';
import { applyMmlTransform } from '../mmlTransformEngine';
import { resolveLineScopes } from '../mmlTrackScope';
import { MmlCompiler, type MmlCompileResult } from '../../mml/MmlCompiler';
import { DiagnosticSeverity } from '../../mml/TrackId';
import { SAMPLE_MML_FILES } from '../../../data/sampleMmlSongs';

function compile(mml: string): MmlCompileResult {
  return new MmlCompiler().compile(mml);
}

/** コンパイル結果から指定トラック分のバイナリデータを取り出す。 */
function trackBytes(result: MmlCompileResult, trackId: string): Uint8Array {
  if (result.musicData === null || result.map === null) {
    throw new Error('コンパイルに成功していない結果からトラックデータは取得できません');
  }

  const mapTrack = result.map.tracks.find((track) => track.id === trackId);
  if (mapTrack === undefined) {
    throw new Error(`トラック ${trackId} はマップに存在しません`);
  }

  const nextOffsets = result.map.tracks
    .filter((track) => track.index > mapTrack.index)
    .map((track) => track.offset);
  const nextOffset = nextOffsets.length > 0 ? Math.min(...nextOffsets) : result.musicData.length;
  return result.musicData.slice(mapTrack.offset, nextOffset);
}

/** 指定トラックの先頭 NOTE 命令のノート番号を取得する (音符が無い場合は null)。 */
function firstNoteNumber(mml: string, trackId: string): number | null {
  const result = compile(mml);
  if (result.musicData === null || result.map === null) {
    return null;
  }

  const data = trackBytes(result, trackId);
  return data[0] === 0x00 ? data[1] : null;
}

describe('remapTracks', () => {
  it('remaps a single track declaration', () => {
    const result = applyMmlTransform('P1 o4 c\nP2 o5 e', { kind: 'remapTracks', mappings: { P1: 'P4' } });
    expect(result.source).toBe('P4 o4 c\nP2 o5 e');
    expect(result.changedCount).toBe(1);
  });

  it('swaps two tracks without collision', () => {
    const result = applyMmlTransform('P1 c\nP2 e', {
      kind: 'remapTracks',
      mappings: { P1: 'P2', P2: 'P1' },
    });
    expect(result.source).toBe('P2 c\nP1 e');
    expect(result.changedCount).toBe(2);
  });

  it('moves a work track to a hardware track', () => {
    const result = applyMmlTransform('W1 o4 c d e', { kind: 'remapTracks', mappings: { W1: 'P1' } });
    expect(result.source).toBe('P1 o4 c d e');
    expect(result.changedCount).toBe(1);
  });

  it('remaps all declared tracks in a multi declaration line', () => {
    const result = applyMmlTransform('P1,P2 c d e', {
      kind: 'remapTracks',
      mappings: { P1: 'F1', P2: 'F2' },
    });
    expect(result.source).toBe('F1,F2 c d e');
    expect(result.changedCount).toBe(2);
  });

  it('does not touch identifiers in directives, macro definitions or comments', () => {
    const source = '#TITLE "P1 test"\n@VE1 = { 15 10 }\nP1 c ; P1 in comment';
    const result = applyMmlTransform(source, { kind: 'remapTracks', mappings: { P1: 'P4' } });
    expect(result.source).toBe('#TITLE "P1 test"\n@VE1 = { 15 10 }\nP4 c ; P1 in comment');
    expect(result.changedCount).toBe(1);
  });

  it('changes nothing when no mapping matches', () => {
    const source = 'P1 c\n e f g';
    const result = applyMmlTransform(source, { kind: 'remapTracks', mappings: { P2: 'P3' } });
    expect(result.source).toBe(source);
    expect(result.changedCount).toBe(0);
  });
});

describe('shiftOctave', () => {
  it('shifts o commands of the target tracks only', () => {
    const result = applyMmlTransform('P1 o4 c o5 e\nP2 o4 g', {
      kind: 'shiftOctave',
      targetTracks: ['P1'],
      shift: 1,
    });
    expect(result.source).toBe('P1 o5 c o6 e\nP2 o4 g');
    expect(result.changedCount).toBe(2);
  });

  it('applies to continuation lines of the target track', () => {
    const result = applyMmlTransform('P1 o4 c\n e f\nP2 o4 g', {
      kind: 'shiftOctave',
      targetTracks: ['P1'],
      shift: -2,
    });
    expect(result.source).toBe('P1 o2 c\n e f\nP2 o4 g');
  });

  it('clamps to the octave range and reports no change when clamped', () => {
    const result = applyMmlTransform('P1 o10 c', { kind: 'shiftOctave', targetTracks: ['P1'], shift: 2 });
    expect(result.source).toBe('P1 o10 c');
    expect(result.changedCount).toBe(0);
  });

  it('keeps relative octave shifts (< >) untouched', () => {
    const result = applyMmlTransform('P1 o4 c > c < c', {
      kind: 'shiftOctave',
      targetTracks: ['P1'],
      shift: 1,
    });
    expect(result.source).toBe('P1 o5 c > c < c');
  });
});

describe('transpose', () => {
  it('shifts note names within the same octave (sharp notation)', () => {
    const result = applyMmlTransform('P1 o4 c d e f g a b', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 1,
    });
    expect(result.source).toBe('P1 o4 c# d# f f# g# a# o5c');
    expect(result.changedCount).toBe(7);
  });

  it('transposes accidentals and normalizes to sharp notation', () => {
    const result = applyMmlTransform('P1 o4 c# b- d+', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 1,
    });
    // c#(61)+1=d / b-(70)+1=b / d+(63)+1=e
    expect(result.source).toBe('P1 o4 d b e');
  });

  it('inserts an octave command when crossing the octave boundary', () => {
    const result = applyMmlTransform('P1 o4 b c', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 1,
    });
    // b(71)+1 = o5c へ跨ぎ挿入。2 音目の c は元テキスト上 o4 のままであるため
    // 正式パーサ準拠の解釈 (c4) に従い c#4 へ移調し、出力上は o4 へ戻す o を再挿入する
    expect(result.source).toBe('P1 o4 o5c o4c#');
    expect(result.changedCount).toBe(2);
  });

  it('moves down across the octave boundary', () => {
    const result = applyMmlTransform('P1 o4 c', { kind: 'transpose', targetTracks: ['P1'], semitones: -1 });
    // 元の o4 は保持し、音符直前に必要な o コマンドのみを挿入する
    expect(result.source).toBe('P1 o4 o3b');
  });

  it('keeps note lengths, dots, ties and rests untouched', () => {
    const result = applyMmlTransform('P1 o4 c4.d8 r4 e^2', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 2,
    });
    expect(result.source).toBe('P1 o4 d4.e8 r4 f#^2');
  });

  it('transposes tuplet notes within the same octave (no octave insertion)', () => {
    const result = applyMmlTransform('P1 o4 {ceg}4', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 2,
    });
    expect(result.source).toBe('P1 o4 {df#a}4');
  });

  it('ignores digits of other commands (t120 / l8 / v15 / @1)', () => {
    const result = applyMmlTransform('P1 l8 v15 t120 @1 c', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 2,
    });
    expect(result.source).toBe('P1 l8 v15 t120 @1 d');
  });

  it('does not touch other tracks or comments', () => {
    const source = 'P1 o4 c\nP2 o4 c\nP1 d ; memo c';
    const result = applyMmlTransform(source, { kind: 'transpose', targetTracks: ['P1'], semitones: 2 });
    expect(result.source).toBe('P1 o4 d\nP2 o4 c\nP1 e ; memo c');
  });

  it('continues the octave state across continuation lines (parser compatible)', () => {
    // 継続行は元テキスト上のオクターブ状態 (o5) を引き継ぐ (正式パーサと同一の挙動)。
    // 挿入した o6 は出力テキスト上の都合であり、後続音符の解釈には影響しない
    const result = applyMmlTransform('P1 o5 b\n b b', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 1,
    });
    // b5+1 = c6 (隣接音名)。継続行の b も元テキスト上 o5 のまま (正式パーサ準拠) であるため同様に c6 へ
    expect(result.source).toBe('P1 o5 o6c\n c c');
  });
});

describe('scaleVolume', () => {
  it('adds to psg volumes with clamping', () => {
    const result = applyMmlTransform('P1 v10 c v14 e', {
      kind: 'scaleVolume',
      targetTracks: ['P1'],
      add: 2,
      percent: 100,
    });
    expect(result.source).toBe('P1 v12 c v15 e');
    expect(result.changedCount).toBe(2);
  });

  it('scales volumes by percentage', () => {
    const result = applyMmlTransform('P1 v10 c', {
      kind: 'scaleVolume',
      targetTracks: ['P1'],
      add: 0,
      percent: 50,
    });
    expect(result.source).toBe('P1 v5 c');
  });

  it('reports no change when values are already at the limit', () => {
    const result = applyMmlTransform('P1 v15 c', {
      kind: 'scaleVolume',
      targetTracks: ['P1'],
      add: 2,
      percent: 100,
    });
    expect(result.source).toBe('P1 v15 c');
    expect(result.changedCount).toBe(0);
  });

  it('scales fm volumes only on fm tracks', () => {
    const result = applyMmlTransform('F1 @v100 c\nP1 @v100 c', {
      kind: 'scaleVolume',
      targetTracks: ['F1', 'P1'],
      add: 0,
      percent: 50,
    });
    expect(result.source).toBe('F1 @v50 c\nP1 @v100 c');
  });

  it('scales fm volumes across the 0-127 range', () => {
    const result = applyMmlTransform('F1 @v120 c', {
      kind: 'scaleVolume',
      targetTracks: ['F1'],
      add: 10,
      percent: 100,
    });
    expect(result.source).toBe('F1 @v127 c');
  });
});

describe('line scope resolution', () => {
  it('assigns continuation lines to the previous track', () => {
    const scopes = resolveLineScopes('P1 c\n e f\nP2 g');
    expect(scopes.map((scope) => scope.trackNames.join(','))).toEqual(['P1', 'P1', 'P2']);
  });

  it('marks macro definition and directive lines as skipped but keeps the track scope', () => {
    const scopes = resolveLineScopes('P1 c\n@VE1 = { 15 }\n#TITLE "x"\n e');
    expect(scopes[1].isSkipped).toBe(true);
    expect(scopes[2].isSkipped).toBe(true);
    expect(scopes[3].trackNames).toEqual(['P1']);
  });

  it('detects work track declarations', () => {
    const scopes = resolveLineScopes('W1 c\n e');
    expect(scopes[0].trackNames).toEqual(['W1']);
    expect(scopes[1].trackNames).toEqual(['W1']);
  });

  it('detects other dialect track declarations (A-Z single letters)', () => {
    const scopes = resolveLineScopes('ABC @t1,86\nA c\n e\nB d');
    expect(scopes[0].trackNames).toEqual(['A', 'B', 'C']);
    expect(scopes[0].contentStart).toBe(4);
    expect(scopes[1].trackNames).toEqual(['A']);
    expect(scopes[2].trackNames).toEqual(['A']);
    expect(scopes[3].trackNames).toEqual(['B']);
  });

  it('treats digit-suffixed letters as invalid declarations (parser compatible)', () => {
    // A1 / Q5 は正式パーサの無効宣言 (P7 等) と同様に宣言扱いしない (継続行帰属)
    const scopes = resolveLineScopes('P1 c\nA1 e\nQ5 f');
    expect(scopes[0].trackNames).toEqual(['P1']);
    expect(scopes[1].trackNames).toEqual(['P1']);
    expect(scopes[2].trackNames).toEqual(['P1']);
  });
});

describe('other tracks (A-Z single letter dialects)', () => {
  /** ユーザー提供の他方言 MML 例 (PMD 系: A-Z 1 文字トラック)。 */
  const DIALECT_MML = [
    'ABC @t1,86',
    '',
    'A @1 @v0 o5 l8 q8',
    'B @1 v12 o3 l16 @q0',
    'C         o4 l8 @q2',
    '',
    'A o4v15',
    'A La+12r12a+12a+12a+12a+12a+12>c12d12c12r12<a+12>',
    'A f2r4d+12f12g12',
    'C c d e',
  ].join('\n');

  it('remaps a dialect track and keeps other tracks untouched', () => {
    const result = applyMmlTransform('A c\nB e', { kind: 'remapTracks', mappings: { A: 'C' } });
    expect(result.source).toBe('C c\nB e');
    expect(result.changedCount).toBe(1);
  });

  it('remaps part of consecutive declarations (ABC -> XBC)', () => {
    const result = applyMmlTransform('ABC @t1,86', { kind: 'remapTracks', mappings: { A: 'X' } });
    expect(result.source).toBe('XBC @t1,86');
    expect(result.changedCount).toBe(1);
  });

  it('swaps dialect tracks without collision', () => {
    const result = applyMmlTransform('A c\nB e', {
      kind: 'remapTracks',
      mappings: { A: 'B', B: 'A' },
    });
    expect(result.source).toBe('B c\nA e');
    expect(result.changedCount).toBe(2);
  });

  it('moves a dialect track to a hardware track', () => {
    const result = applyMmlTransform('A o5 c d e', { kind: 'remapTracks', mappings: { A: 'P1' } });
    expect(result.source).toBe('P1 o5 c d e');
    expect(result.changedCount).toBe(1);
  });

  it('transposes notes in dialect tracks including continuation lines', () => {
    const result = applyMmlTransform(DIALECT_MML, { kind: 'transpose', targetTracks: ['A'], semitones: 2 });
    const lines = result.source.split('\n');
    // 対象外トラックとコマンド行は無変換
    expect(lines[2]).toBe('A @1 @v0 o5 l8 q8');
    expect(lines[3]).toBe('B @1 v12 o3 l16 @q0');
    expect(lines[4]).toBe('C         o4 l8 @q2');
    expect(lines[6]).toBe('A o4v15');
    // 同音連打 (a+12 x7, o4) は全て c5 へ: 1 音目のみ o5 を挿入し以降は音名のみ
    expect(lines[7]).toBe('A Lo5c12r12c12c12c12c12c12>o5d12e12d12r12<o5c12>');
    // 行 7 末尾の `>` (元テキスト o5 相当) を引き継ぐため f5 起点で o5 を再挿入する
    expect(lines[8]).toBe('A o5g2r4f12g12a12');
    expect(lines[9]).toBe('C c d e');
    expect(result.changedCount).toBe(14);
  });

  it('shifts octaves only in the targeted dialect tracks', () => {
    const result = applyMmlTransform('A o5 c\nB o3 e', { kind: 'shiftOctave', targetTracks: ['A'], shift: -1 });
    expect(result.source).toBe('A o4 c\nB o3 e');
  });

  it('scales PSG volumes in dialect tracks within the 0-15 range', () => {
    const result = applyMmlTransform('B v12 c', { kind: 'scaleVolume', targetTracks: ['B'], add: 0, percent: 50 });
    expect(result.source).toBe('B v6 c');
  });

  it('does not scale @v of dialect tracks as fm volume', () => {
    // OTHER トラック行の @v は FM 音量 (0-127) 扱いにしない (PSG トラック同様 @v は保持)
    const result = applyMmlTransform('A @v100 c', { kind: 'scaleVolume', targetTracks: ['A'], add: 0, percent: 50 });
    expect(result.source).toBe('A @v100 c');
    expect(result.changedCount).toBe(0);
  });

  it('applies remap and transpose sequentially to the user dialect example', () => {
    let source = applyMmlTransform(DIALECT_MML, { kind: 'remapTracks', mappings: { A: 'D' } }).source;
    expect(source.split('\n')[6]).toBe('D o4v15');
    expect(source.split('\n')[7].startsWith('D L')).toBe(true);

    source = applyMmlTransform(source, { kind: 'transpose', targetTracks: ['D'], semitones: -3 }).source;
    // f2r4d+12f12g12 (o4) → d2r4c12d12e12
    expect(source.split('\n')[8]).toBe('D d2r4c12d12e12');
    expect(source.split('\n')[3]).toBe('B @1 v12 o3 l16 @q0');
    expect(source.split('\n')[4]).toBe('C         o4 l8 @q2');
  });
});

describe('integration with MmlCompiler', () => {
  it('produces shifted note numbers after transposing', () => {
    const original = 'P1 o4 c d e';
    const transformed = applyMmlTransform(original, { kind: 'transpose', targetTracks: ['P1'], semitones: 2 });

    expect(compile(original).success).toBe(true);
    expect(compile(transformed.source).success).toBe(true);
    expect(firstNoteNumber(original, 'P1')).toBe(60);
    expect(firstNoteNumber(transformed.source, 'P1')).toBe(62);
  });

  it('keeps note numbers across an octave boundary transposition', () => {
    const transformed = applyMmlTransform('P1 o4 b c', {
      kind: 'transpose',
      targetTracks: ['P1'],
      semitones: 1,
    });
    const result = compile(transformed.source);
    expect(result.success).toBe(true);

    // P1 トラック内の NOTE 命令列のみを確認 (b+1 = 72 / 元テキスト o4 の c+1 = 61)
    const data = trackBytes(result, 'P1');
    const notes: number[] = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0x00) {
        notes.push(data[i + 1]);
        i += 5;
      }
    }

    expect(notes).toEqual([72, 61]);
  });

  it('compiles all sample songs with zero errors after transforms', () => {
    for (const file of SAMPLE_MML_FILES) {
      let source = applyMmlTransform(file.content, {
        kind: 'shiftOctave',
        targetTracks: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'F1', 'F2', 'F3', 'W1', 'W2', 'W3', 'W4'],
        shift: -1,
      }).source;
      source = applyMmlTransform(source, {
        kind: 'scaleVolume',
        targetTracks: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
        add: -1,
        percent: 100,
      }).source;
      source = applyMmlTransform(source, {
        kind: 'transpose',
        targetTracks: ['P1', 'F1', 'F2'],
        semitones: 2,
      }).source;

      const result = compile(source);
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error);
      expect(errors).toEqual([]);
      expect(result.success).toBe(true);
    }
  });
});