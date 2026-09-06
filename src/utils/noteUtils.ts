// MIDIノート番号と音名の変換ユーティリティ

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * MIDIノート番号 (0〜127) を音名文字列 (例: 'C4', 'A#3') に変換する。
 */
export function midiNoteToName(midiNote: number): string {
  const semitone = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[semitone]}${octave}`;
}

/**
 * 音名文字列 (例: 'C4', 'A#3') を MIDIノート番号に変換する。
 */
export function nameToMidiNote(name: string): number | null {
  const match = name.match(/^([A-G][#b]?)(-?\d+)$/i);
  if (!match) return null;

  let noteName = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);

  // フラット表記の正規化 (例: Bb -> A#)
  const flatMap: Record<string, string> = {
    'DB': 'C#',
    'EB': 'D#',
    'GB': 'F#',
    'AB': 'G#',
    'BB': 'A#',
  };
  if (flatMap[noteName]) {
    noteName = flatMap[noteName];
  }

  const semitone = NOTE_NAMES.indexOf(noteName as typeof NOTE_NAMES[number]);
  if (semitone === -1) return null;

  const midiNote = (octave + 1) * 12 + semitone;
  return Math.max(0, Math.min(127, midiNote));
}

/**
 * テスト発音で素早く選べる代表的な音高プリセット一覧
 */
export const QUICK_TEST_NOTES: ReadonlyArray<{ note: number; label: string; desc: string }> = [
  { note: 36, label: 'C2', desc: 'Bass Low (C2)' },
  { note: 48, label: 'C3', desc: 'Bass (C3)' },
  { note: 57, label: 'A3', desc: 'Mid Low (A3)' },
  { note: 60, label: 'C4', desc: 'Middle C (C4)' },
  { note: 64, label: 'E4', desc: 'Mid Harm (E4)' },
  { note: 67, label: 'G4', desc: 'Mid Fifth (G4)' },
  { note: 69, label: 'A4', desc: 'Concert Pitch 440Hz (A4)' },
  { note: 72, label: 'C5', desc: 'Treble (C5)' },
  { note: 76, label: 'E5', desc: 'High Harm (E5)' },
  { note: 84, label: 'C6', desc: 'High Lead (C6)' },
];
