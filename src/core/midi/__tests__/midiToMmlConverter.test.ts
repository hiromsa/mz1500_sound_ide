/**
 * MIDI → MML 変換エンジンの単体テスト。
 * 内蔵デモ MIDI (demoMidi.ts で生成する SMF Format 1) をフィクスチャとして使用する。
 */
import { describe, expect, it } from 'vitest';
import {
  autoAssignRouting,
  convertNotesToMmlBody,
  extractVoice,
  generateMml,
  midiNoteToMmlName,
  parseMidiFile,
  quantizeNoteLength,
  type AssignedPart,
  type MidiNoteEvent,
} from '../midiToMmlConverter';
import { createDemoMidiBytes } from '../demoMidi';
import { DiagnosticSeverity } from '../../mml/TrackId';
import { MmlCompiler } from '../../mml/MmlCompiler';

const demoSummary = parseMidiFile('demo.mid', createDemoMidiBytes());

const note = (midi: number, startBeat: number, durationBeats = 1): MidiNoteEvent => ({
  midi,
  startBeat,
  durationBeats,
  velocity: 0.8,
});

describe('parseMidiFile', () => {
  it('parses tempo and tracks from the demo midi', () => {
    expect(demoSummary.bpm).toBe(120);
    expect(demoSummary.tracks).toHaveLength(3);
    expect(demoSummary.durationBeats).toBeGreaterThanOrEqual(4);
  });

  it('detects a mono melody track', () => {
    const melody = demoSummary.tracks[0];
    expect(melody.name).toBe('Melody');
    expect(melody.channel).toBe(0);
    expect(melody.type).toBe('mono');
    expect(melody.noteCount).toBe(4);
    expect(melody.lowestNote).toBe(60);
    expect(melody.highestNote).toBe(67);
  });

  it('detects a poly chord track', () => {
    const chords = demoSummary.tracks[1];
    expect(chords.channel).toBe(1);
    expect(chords.type).toBe('poly');
    expect(chords.maxPolyphony).toBe(3);
    expect(chords.lowestNote).toBe(48);
    expect(chords.highestNote).toBe(60);
  });

  it('detects a percussion track on channel 10', () => {
    const drums = demoSummary.tracks[2];
    expect(drums.isPercussion).toBe(true);
    expect(drums.channel).toBe(9);
  });
});

describe('extractVoice', () => {
  const chordNotes = [
    note(48, 0, 2),
    note(52, 0, 2),
    note(55, 0, 2),
    note(53, 2, 2),
    note(57, 2, 2),
    note(60, 2, 2),
  ];

  it('extracts the top voice', () => {
    expect(extractVoice(chordNotes, 'top').map((n) => n.midi)).toEqual([55, 60]);
  });

  it('extracts the bottom voice', () => {
    expect(extractVoice(chordNotes, 'bottom').map((n) => n.midi)).toEqual([48, 53]);
  });

  it('extracts the middle voice', () => {
    expect(extractVoice(chordNotes, 'middle').map((n) => n.midi)).toEqual([52, 57]);
  });
});

describe('quantizeNoteLength', () => {
  it('maps beat durations to mml length texts', () => {
    expect(quantizeNoteLength(4).text).toBe('1');
    expect(quantizeNoteLength(2).text).toBe('2');
    expect(quantizeNoteLength(1).text).toBe('4');
    expect(quantizeNoteLength(0.5).text).toBe('8');
    expect(quantizeNoteLength(0.25).text).toBe('16');
  });

  it('prefers dotted lengths', () => {
    expect(quantizeNoteLength(1.5).text).toBe('4.');
    expect(quantizeNoteLength(0.75).text).toBe('8.');
    expect(quantizeNoteLength(3).text).toBe('2.');
  });

  it('clamps tiny durations to the shortest length', () => {
    expect(quantizeNoteLength(0.01).text).toBe('32');
  });
});

describe('convertNotesToMmlBody', () => {
  it('renders notes with an octave command only when it changes', () => {
    expect(convertNotesToMmlBody([note(60, 0), note(62, 1), note(64, 2)])).toBe('o4 c4 d4 e4');
  });

  it('inserts octave commands and rests between gaps', () => {
    // C3 (2拍) → 2拍の休符 → C4
    const result = convertNotesToMmlBody([note(48, 0, 2), note(60, 4, 1)]);
    expect(result).toBe('o3 c2 r2 o4 c4');
  });

  it('quantizes off-grid start beats to the nearest grid', () => {
    // 開始拍 1.4 は 1.375 にスナップ → 16 分付点の休符を挿入
    const result = convertNotesToMmlBody([note(60, 0), note(64, 1.4, 0.5)]);
    expect(result).toBe('o4 c4 r16. e8');
  });
});

describe('generateMml', () => {
  it('groups hardware tracks first and work tracks last', () => {
    const parts: AssignedPart[] = [
      { targetTrack: 'W1', sourceLabel: 'Pad', notes: [note(48, 0, 4)], velocity: 0.6 },
      { targetTrack: 'P1', sourceLabel: 'Melody', notes: [note(60, 0), note(62, 1), note(64, 2), note(67, 3)], velocity: 0.8 },
    ];

    const mml = generateMml({ fileName: 'demo.mid', bpm: 120 }, parts);
    const p1Index = mml.indexOf('\nP1 ');
    const w1Index = mml.indexOf('\nW1 ');

    expect(p1Index).toBeGreaterThan(-1);
    expect(w1Index).toBeGreaterThan(p1Index);
    expect(mml).toContain('P1  t120 v12 q7 l16 o4 c4 d4 e4 g4  ; from Melody');
    expect(mml).toContain('; from Pad');
  });

  it('outputs the tempo command only once', () => {
    const parts: AssignedPart[] = [
      { targetTrack: 'P1', sourceLabel: 'Melody', notes: [note(60, 0)], velocity: 0.8 },
      { targetTrack: 'P5', sourceLabel: 'Bass', notes: [note(36, 0)], velocity: 0.8 },
    ];

    const mml = generateMml({ fileName: 'demo.mid', bpm: 120 }, parts);
    expect(mml.match(/t120/g)).toHaveLength(1);
  });
});

describe('autoAssignRouting', () => {
  it('assigns hardware slots and falls back to work tracks', () => {
    const input = [
      { isPercussion: false, type: 'mono' as const },
      { isPercussion: false, type: 'poly' as const },
      { isPercussion: true, type: 'poly' as const },
      { isPercussion: false, type: 'mono' as const },
      { isPercussion: false, type: 'mono' as const },
      { isPercussion: false, type: 'mono' as const },
    ];

    expect(autoAssignRouting(input, false)).toEqual(['P1', 'SPLIT(3)', 'N1', 'P5', 'P6', 'W1']);
  });

  it('uses fm slots for overflow when fm is enabled', () => {
    const input = [
      { isPercussion: false, type: 'mono' as const },
      { isPercussion: false, type: 'mono' as const },
      { isPercussion: false, type: 'mono' as const },
      { isPercussion: false, type: 'mono' as const },
    ];

    expect(autoAssignRouting(input, true)).toEqual(['P1', 'P5', 'P6', 'F1']);
  });
});

describe('midiNoteToMmlName', () => {
  it('converts midi notes to sharp notation', () => {
    expect(midiNoteToMmlName(60)).toBe('c');
    expect(midiNoteToMmlName(61)).toBe('c#');
    expect(midiNoteToMmlName(70)).toBe('a#');
  });
});

describe('integration with MmlCompiler', () => {
  it('compiles the generated mml with zero errors', () => {
    const melody = demoSummary.tracks[0];
    const chords = demoSummary.tracks[1];
    const drums = demoSummary.tracks[2];

    const parts: AssignedPart[] = [
      { targetTrack: 'P1', sourceLabel: melody.name, notes: melody.notes, velocity: 0.8 },
      { targetTrack: 'P2', sourceLabel: `${chords.name} (Top)`, notes: extractVoice(chords.notes, 'top'), velocity: 0.7 },
      { targetTrack: 'P3', sourceLabel: `${chords.name} (Middle)`, notes: extractVoice(chords.notes, 'middle'), velocity: 0.6 },
      { targetTrack: 'P4', sourceLabel: `${chords.name} (Bottom)`, notes: extractVoice(chords.notes, 'bottom'), velocity: 0.6 },
      { targetTrack: 'N1', sourceLabel: drums.name, notes: drums.notes, velocity: 1 },
    ];

    const mml = generateMml({ fileName: demoSummary.fileName, bpm: demoSummary.bpm }, parts);
    const result = new MmlCompiler().compile(mml);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error);

    expect(errors).toEqual([]);
    expect(result.success).toBe(true);
  });
});