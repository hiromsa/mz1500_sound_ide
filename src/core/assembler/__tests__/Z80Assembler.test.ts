/**
 * Z80 アセンブラのエンコード検証。
 * (移植元: tests/MzSound.DriverAssembler.Tests/Z80AssemblerTests.cs)
 */
import { describe, expect, it } from 'vitest';
import { AssemblerException } from '../AssembleResult';
import { assembleZ80, beepCounterFor, dcsgPeriodFor } from '../Z80Assembler';

function assembleLines(lines: string[]): Uint8Array {
  return assembleZ80(lines.join('\n')).data;
}

describe('Z80Assembler.EncodesInstructions', () => {
  it.each<[string, number[]]>([
    ['ld a,0x05', [0x3e, 0x05]],
    ['ld b,c', [0x41]],
    ['ld (hl),a', [0x77]],
    ['ld a,(hl)', [0x7e]],
    ['ld a,(ix+0)', [0xdd, 0x7e, 0x00]],
    ['ld b,(ix+2)', [0xdd, 0x46, 0x02]],
    ['ld (ix+0),a', [0xdd, 0x77, 0x00]],
    ['ld hl,0x1234', [0x21, 0x34, 0x12]],
    ['ld ix,0x1234', [0xdd, 0x21, 0x34, 0x12]],
    ['ld sp,0xf7ff', [0x31, 0xff, 0xf7]],
    ['out (0xf2),a', [0xd3, 0xf2]],
    ['in a,(0xf2)', [0xdb, 0xf2]],
    ['out (c),e', [0xed, 0x59]],
    ['ld a,(0xe008)', [0x3a, 0x08, 0xe0]],
    ['ld (0xe008),a', [0x32, 0x08, 0xe0]],
    ['ld hl,(0xf801)', [0x2a, 0x01, 0xf8]],
    ['ld (0xf801),hl', [0x22, 0x01, 0xf8]],
    ['bit 7,a', [0xcb, 0x7f]],
    ['set 0,a', [0xcb, 0xc7]],
    ['res 0,(hl)', [0xcb, 0x86]],
    ['jp nz,0x1234', [0xc2, 0x34, 0x12]],
    ['jp z,0x1234', [0xca, 0x34, 0x12]],
    ['jp c,0x1200', [0xda, 0x00, 0x12]],
    ['jp nc,0x1200', [0xd2, 0x00, 0x12]],
    ['call 0x1234', [0xcd, 0x34, 0x12]],
    ['ret z', [0xc8]],
    ['push de', [0xd5]],
    ['pop bc', [0xc1]],
    ['ex de,hl', [0xeb]],
    ['exx', [0xd9]],
    ['ldir', [0xed, 0xb0]],
    ['add hl,de', [0x19]],
    ['sbc hl,de', [0xed, 0x52]],
    ['add a,(ix+7)', [0xdd, 0x86, 0x07]],
    ['ld (ix+11),0xf2', [0xdd, 0x36, 0x0b, 0xf2]],
    ['or (ix+7)', [0xdd, 0xb6, 0x07]],
    ['neg', [0xed, 0x44]],
    ['halt', [0x76]],
    ['djnz 0x0000', [0x10, 0xfe]],
    ['jr nz,0x0000', [0x20, 0xfe]],
    ['jr z,0x0000', [0x28, 0xfe]],
    ['jr nc,0x0000', [0x30, 0xfe]],
    ['jr c,0x0000', [0x38, 0xfe]],
    ['sla b', [0xcb, 0x20]],
    ['rrca', [0x0f]],
  ])('encodes %s', (source, expected) => {
    expect(assembleLines([source])).toEqual(new Uint8Array(expected));
  });
});

describe('Z80Assembler', () => {
  it('resolves forward labels in jr', () => {
    const data = assembleLines([
      'loop:',
      '  jr nz,loop',
      '  jr loop',
    ]);
    // jr nz,loop: loop = 0、命令末尾 PC = 2 -> offset = -2
    // jr loop:    命令開始 2、末尾 4 -> offset = -4
    expect(data).toEqual(new Uint8Array([0x20, 0xfe, 0x18, 0xfc]));
  });

  it('resolves labels in absolute jump', () => {
    const data = assembleLines([
      '  jp target',
      'target:',
      '  halt',
    ]);
    expect(data).toEqual(new Uint8Array([0xc3, 0x03, 0x00, 0x76]));
  });

  it('assembles db/dw and labels', () => {
    const result = assembleZ80(
      'org 0x1000\n'
      + 'value equ 0x42\n'
      + '  db value, 1, "AB"\n'
      + '  dw 0x1234, msg\n'
      + 'msg: db "HI", 0',
    );
    expect(result.data.slice(result.origin)).toEqual(new Uint8Array([
      0x42, 0x01, 0x41, 0x42, // db
      0x34, 0x12, 0x08, 0x10, // dw (msg = 0x1008)
      0x48, 0x49, 0x00, // "HI", 0
    ]));
    expect(result.labels.get('*')).toBe(0x1000);
    expect(result.labels.get('msg')).toBe(0x1008);
  });

  it('generates note tables matching reference formulas', () => {
    const result = assembleZ80(
      'org 0x1200\n'
      + '  dctbl note_dctbl, 0, 127\n'
      + '  beeptbl note_beep_tbl, 0, 127',
    );
    expect(result.origin).toBe(0x1200);
    expect(result.data.length).toBe(5120);
    expect(result.labels.get('note_dctbl')).toBe(0x1200);
    expect(result.labels.get('note_beep_tbl')).toBe(0x1300);

    const readWord = (data: Uint8Array, offset: number): number => data[offset] | (data[offset + 1] << 8);

    // Data 配列のインデックス = 絶対アドレス (先頭 0x1200 バイトは org パディング)
    const dcOffset = result.labels.get('note_dctbl') as number;
    const beepOffset = result.labels.get('note_beep_tbl') as number;
    for (let note = 0; note <= 127; note++) {
      expect(readWord(result.data, dcOffset + note * 2)).toBe(dcsgPeriodFor(note));
      expect(readWord(result.data, beepOffset + note * 2)).toBe(beepCounterFor(note));
    }

    // A4 (69) の代表値: DCSG period = 253 / 8253 counter = 2034
    expect(dcsgPeriodFor(69)).toBe(253);
    expect(beepCounterFor(69)).toBe(2034);
  });

  it('rejects out of range relative jump', () => {
    expect(() => assembleLines([
      'org 0x1200',
      '  jr start',
      ...Array.from({ length: 200 }, () => '  nop'),
      'start: halt',
    ])).toThrow();
  });

  it('reports line number on error', () => {
    try {
      assembleLines([
        'org 0x1200',
        '  nop',
        '  badmnemonic',
      ]);
      expect.unreachable('アセンブルエラーになるべき');
    } catch (ex) {
      expect(ex).toBeInstanceOf(AssemblerException);
      expect((ex as AssemblerException).lineNumber).toBe(3);
    }
  });
});
