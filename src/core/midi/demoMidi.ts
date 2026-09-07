/**
 * 内蔵デモ MIDI ファイル (SMF Format 1) のバイト列を生成する。
 * - MIDI ROUTING STUDIO の `Load Demo File` ボタン用デモデータ
 * - `midiToMmlConverter` の単体テストフィクスチャ (SMF 構築ヘルパの動作検証を兼ねる)
 *
 * 構成 (120 BPM / 4 拍):
 * - Track 0: テンポ / 曲名メタのみ
 * - Track 1: Melody (ch0, mono)   : C4 → D4 → E4 → G4 (四分音符 × 4)
 * - Track 2: Chords (ch1, poly)   : C メジャー → F メジャー (2 拍 × 2, 3 和音)
 * - Track 3: Drums (ch9, percussion): Kick / Snare / Closed Hi-Hat
 */

interface RawEvent {
  readonly tick: number;
  readonly bytes: readonly number[];
}

const strBytes = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const u32 = (value: number): number[] => [
  (value >> 24) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];

/** MIDI 可変長数量 (Variable Length Quantity) をエンコードする。 */
function writeVarLen(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }

  return bytes;
}

const noteOn = (channel: number, note: number, velocity = 96): RawEvent => ({
  tick: 0,
  bytes: [0x90 | channel, note, velocity],
});
const noteOff = (channel: number, note: number): RawEvent => ({
  tick: 0,
  bytes: [0x80 | channel, note, 0],
});

/** イベント列 (絶対 tick) を 1 つの MTrk チャンクへ直列化する。 */
function serializeTrackChunk(name: string, events: readonly RawEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  // 先頭イベントの前にも delta time (0) が必須
  let data: number[] = [0x00, 0xff, 0x03, name.length, ...strBytes(name)];
  let lastTick = 0;
  for (const event of sorted) {
    data = data.concat(writeVarLen(event.tick - lastTick), event.bytes);
    lastTick = event.tick;
  }

  data = data.concat([0x00, 0xff, 0x2f, 0x00]); // delta 0 + End of Track
  return [...strBytes('MTrk'), ...u32(data.length), ...data];
}

/** デモ MIDI ファイルのバイト列を生成する。 */
export function createDemoMidiBytes(): Uint8Array {
  const ppq = 480;

  // Track 0: テンポ (120 BPM) メタのみ
  const tempoHeader: RawEvent[] = [
    { tick: 0, bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] }, // 500000 µs / quarter
  ];

  // Track 1: Melody (mono) — 四分音符 × 4
  const melody: RawEvent[] = [];
  const melodyNotes = [60, 62, 64, 67];
  melodyNotes.forEach((note, index) => {
    const start = index * ppq;
    melody.push({ tick: start, bytes: noteOn(0, note).bytes });
    melody.push({ tick: start + ppq, bytes: noteOff(0, note).bytes });
  });

  // Track 2: Chords (poly, 3 和音) — 2 拍 × 2
  const chords: RawEvent[] = [];
  const chordGroups = [
    [48, 52, 55], // C major
    [53, 57, 60], // F major
  ];
  chordGroups.forEach((group, index) => {
    const start = index * 2 * ppq;
    const end = start + 2 * ppq;
    group.forEach((note) => {
      chords.push({ tick: start, bytes: noteOn(1, note).bytes });
      chords.push({ tick: end, bytes: noteOff(1, note).bytes });
    });
  });

  // Track 3: Drums (ch9)
  const drums: RawEvent[] = [];
  const kick = 36;
  const snare = 38;
  const hiHat = 42;
  const drumHits: ReadonlyArray<{ tick: number; note: number }> = [
    { tick: 0, note: kick },
    { tick: 0, note: hiHat },
    { tick: ppq, note: snare },
    { tick: ppq, note: hiHat },
    { tick: 2 * ppq, note: kick },
    { tick: 2 * ppq, note: hiHat },
    { tick: 3 * ppq, note: snare },
    { tick: 3 * ppq, note: hiHat },
  ];
  drumHits.forEach(({ tick, note }) => {
    drums.push({ tick, bytes: noteOn(9, note, 100).bytes });
    drums.push({ tick: tick + 120, bytes: noteOff(9, note).bytes });
  });

  const header = [
    ...strBytes('MThd'),
    ...u32(6),
    ...u16(1), // format 1
    ...u16(4), // track count
    ...u16(ppq),
  ];

  const chunks = [
    ...header,
    ...serializeTrackChunk('MZ1500 Demo', tempoHeader),
    ...serializeTrackChunk('Melody', melody),
    ...serializeTrackChunk('Chords', chords),
    ...serializeTrackChunk('Drums', drums),
  ];

  return new Uint8Array(chunks);
}