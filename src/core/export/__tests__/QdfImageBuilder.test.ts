/**
 * QdfImageBuilder (.qdf イメージ生成) のテスト。
 * C# 版 (mz1500_sound_driver / QdcImageBuilder.BuildStandardExecutable) との
 * 契約 (サイズ・構造・CRC) を検証する。
 */
import { describe, expect, it } from 'vitest';
import { buildQuickDiskImage, crc16Arc, QdfDataBlockSize, QdfImageSize } from '../QdfImageBuilder';

// ブロック配置オフセット (実装の GAP / SYNC サイズから算出される固定位置)
const InfoBlockOffset = 16 + 0x12da + 10; // 4852
const HeaderMarkerOffset = InfoBlockOffset + 2 + 2 + 10 + 0xaeb; // 7661
const HeaderBlockOffset = HeaderMarkerOffset + 1 + 10; // 7672
const DataBlockOffset = HeaderMarkerOffset + 1 + 10 + 0x44 + 2 + 10 + 0xff + 10; // 8017

describe('crc16Arc', () => {
  it('computes the CRC-16/ARC check value for the standard test vector', () => {
    // CRC-16/ARC ("123456789") = 0xBB3D
    const input = [...'123456789'].map((ch) => ch.charCodeAt(0));
    expect(crc16Arc(input)).toBe(0xbb3d);
  });
});

describe('buildQuickDiskImage', () => {
  const payload = Uint8Array.from([0x31, 0xc9, 0x21, 0x00, 0x12]); // ダミーの Z80 機械語
  const image = buildQuickDiskImage('THEME  OF MZ', payload);

  it('produces the fixed 81,936 byte image', () => {
    expect(image.length).toBe(QdfImageSize);
  });

  it('starts with the "-QD format-" signature followed by 0xFF x5', () => {
    const signature = [...'-QD format-'].map((ch) => ch.charCodeAt(0));
    expect([...image.subarray(0, signature.length)]).toEqual(signature);
    expect([...image.subarray(11, 16)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff]);
  });

  it('writes the directory (Information Block) with block count 2 and a valid CRC', () => {
    expect(image[InfoBlockOffset]).toBe(0xa5);
    expect(image[InfoBlockOffset + 1]).toBe(2);

    const expected = crc16Arc(image.subarray(InfoBlockOffset, InfoBlockOffset + 2));
    const actual = image[InfoBlockOffset + 2] | (image[InfoBlockOffset + 3] << 8);
    expect(actual).toBe(expected);
  });

  it('writes the header block (FileType=01, size=0xBE00, load/exec addr=0x1200)', () => {
    const header = image.subarray(HeaderBlockOffset, HeaderBlockOffset + 0x44);
    expect(header[0]).toBe(0xa5); // データ開始マーカ
    expect(header[1]).toBe(0x00); // ヘッダ属性
    expect(header[2]).toBe(0x40); // サイズ下位 (64)
    expect(header[3]).toBe(0x00); // サイズ上位
    expect(header[4]).toBe(0x01); // FileType: Object
    expect(header[5 + 16]).toBe(0x0d); // ファイル名 16 バイトの直後に 0x0D 終端

    const fileName = [...header.subarray(5, 5 + 16)]
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(fileName).toBe('THEME  OF MZ' + String.fromCharCode(0x0d).repeat(4));

    const dataSize = header[24] | (header[25] << 8);
    expect(dataSize).toBe(QdfDataBlockSize);
    const loadAddress = header[26] | (header[27] << 8);
    const execAddress = header[28] | (header[29] << 8);
    expect(loadAddress).toBe(0x1200);
    expect(execAddress).toBe(0x1200);

    // ヘッダブロックの CRC 検証 (ブロック直後の 2 バイト)
    const expectedCrc = crc16Arc(header);
    const actualCrc = image[HeaderBlockOffset + 0x44] | (image[HeaderBlockOffset + 0x45] << 8);
    expect(actualCrc).toBe(expectedCrc);
  });

  it('writes the data block (type=05) containing the payload and a valid CRC', () => {
    expect(image[DataBlockOffset]).toBe(0xa5);
    expect(image[DataBlockOffset + 1]).toBe(0x05);

    const declaredSize = image[DataBlockOffset + 2] | (image[DataBlockOffset + 3] << 8);
    expect(declaredSize).toBe(QdfDataBlockSize);

    const payloadStart = DataBlockOffset + 4;
    expect([...image.subarray(payloadStart, payloadStart + payload.length)]).toEqual([...payload]);

    const blockEnd = DataBlockOffset + 4 + QdfDataBlockSize;
    const expectedCrc = crc16Arc(image.subarray(DataBlockOffset, blockEnd));
    const actualCrc = image[blockEnd] | (image[blockEnd + 1] << 8);
    expect(actualCrc).toBe(expectedCrc);
  });

  it('fills the area after the data block with zeroes', () => {
    const trailing = image.subarray(DataBlockOffset + 4 + QdfDataBlockSize + 2 + 10);
    expect(trailing.every((b) => b === 0)).toBe(true);
  });

  it('replaces non-ascii characters in the file name with question marks', () => {
    const image2 = buildQuickDiskImage('テーマ', payload);
    const header = image2.subarray(HeaderBlockOffset, HeaderBlockOffset + 0x44);
    const fileName = [...header.subarray(5, 5 + 16)].map((b) => String.fromCharCode(b)).join('');
    expect(fileName).toBe('???'.padEnd(16, String.fromCharCode(0x0d)));
  });

  it('rejects a payload larger than the data block size', () => {
    const oversized = new Uint8Array(QdfDataBlockSize + 1);
    expect(() => buildQuickDiskImage('TOO LARGE', oversized)).toThrow(/上限/);
  });
});
