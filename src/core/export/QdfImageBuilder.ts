/**
 * MZ-1500 QuickDisk (.qdf) イメージを生成するビルダ。
 * 実機エミュレータでの起動実績がある C# 版 (mz1500_sound_driver / QdcImageBuilder.
 * BuildStandardExecutable) の契約を 1:1 で移植したものである。
 *
 * イメージ構造 (全 81,936 バイト固定、未使用領域は 0 埋め):
 *   "-QD format-" + 0xFF x5 → GAP (0x12DA) → SYNC x10 → Information Block
 *   → SYNC x10 → GAP (0xAEB) → Header Block → GAP (0xFF) → Data Block → 0 埋め
 * - Information Block (ディレクトリ): A5h + ブロック総数 (2 = ヘッダ + データ)
 * - Header Block: FileType = 01h (Object)、Data Size = 0xBE00、
 *   Load Addr = Exec Addr = 0x1200 (MzSD ドライバのロードアドレス)
 * - Data Block: タイプ 05h、ドライバ + MZSD データを 0xBE04 バイトまで 0 パディング
 * - 各ブロックには CRC-16/ARC (多項式 0xA001 反射、初期値 0) を付与する
 */

/** .qdf イメージの固定サイズ (バイト)。 */
export const QdfImageSize = 0x14010;

/** データブロックの宣言サイズ (C# 版互換の固定値)。 */
export const QdfDataBlockSize = 0xbe00;

/** ドライバ (MZSD) のロード / 実行アドレス。 */
const LoadAddress = 0x1200;

/** ファイル名フィールドの文字数 (0x0D 終端を除く)。 */
const FileNameLength = 16;

/**
 * CRC-16/ARC を計算する (多項式 0xA001 反射、初期値 0、出力 XOR なし)。
 * 適用範囲は各ブロックの A5h マーカからデータ末尾まで。
 */
export function crc16Arc(bytes: readonly number[] | Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }

  return crc;
}

/** QD ブロック / イメージを組み立てるバッファ。 */
class QdfBlockBuilder {
  private readonly data: number[] = [];

  get length(): number {
    return this.data.length;
  }

  appendByte(value: number): void {
    this.data.push(value & 0xff);
  }

  appendBytes(values: Uint8Array): void {
    for (const value of values) {
      this.data.push(value);
    }
  }

  appendUShortLE(value: number): void {
    this.appendByte(value);
    this.appendByte(value >> 8);
  }

  /** targetLength に達するまで fillByte を追加する (既に超えている場合は何もしない)。 */
  appendFillByteToLength(fillByte: number, targetLength: number): void {
    while (this.data.length < targetLength) {
      this.data.push(fillByte);
    }
  }

  /** 指定バイト数の fillByte を追加する (C# 版の for ループ相当)。 */
  appendFillByte(fillByte: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.data.push(fillByte);
    }
  }

  /** ブロック内容 (A5h マーカからデータ末尾まで) の CRC-16/ARC。 */
  crc16(): number {
    return crc16Arc(this.data);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.data);
  }
}

function appendAscii(target: QdfBlockBuilder, text: string): void {
  for (const ch of text) {
    target.appendByte(ch.charCodeAt(0));
  }
}

/** SYNC (16h) x10 を追加する (C# 版 AppendStandardSync と同一)。 */
function appendStandardSync(target: QdfBlockBuilder): void {
  for (let i = 0; i < 10; i++) {
    target.appendByte(0x16);
  }
}

/** ブロック本体 + CRC (LE 2 バイト) を書き込む。 */
function appendBlockWithCrc(target: QdfBlockBuilder, block: QdfBlockBuilder): void {
  target.appendBytes(block.toUint8Array());
  const crc = block.crc16();
  target.appendByte(crc);
  target.appendByte(crc >> 8);
}

/** QD のファイル名 (ASCII 16 文字 + 0x0D x1-17) に正規化して追加する。 */
function appendFileName(target: QdfBlockBuilder, fileName: string): void {
  const normalized = [...fileName]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e ? ch : '?';
    })
    .join('')
    .slice(0, FileNameLength);

  appendAscii(target, normalized);
  for (let i = normalized.length; i < FileNameLength; i++) {
    target.appendByte(0x0d);
  }
  target.appendByte(0x0d);
}

/**
 * 機械語イメージ (ドライバ + MZSD データ) から .qdf イメージを生成する。
 * fileName は QD のファイル名として使われ、ASCII 以外の文字は '?' に置換される。
 */
export function buildQuickDiskImage(fileName: string, executableData: Uint8Array): Uint8Array {
  if (executableData.length > QdfDataBlockSize) {
    throw new Error(
      `ドライバ + MZSD データ (${executableData.length} バイト) が ` +
        `QD データブロックの上限 (${QdfDataBlockSize} バイト) を超えています。`,
    );
  }

  const image = new QdfBlockBuilder();

  // 先頭 16 バイト: "-QD format-" + 0xFF x5
  appendAscii(image, '-QD format-');
  image.appendFillByte(0xff, 5);

  // メディア先頭の GAP
  image.appendFillByte(0, 0x12da);

  // Information Block (ディレクトリ): A5h + ブロック総数 (2)
  appendStandardSync(image);
  {
    const infoBlock = new QdfBlockBuilder();
    infoBlock.appendByte(0xa5);
    infoBlock.appendByte(2);
    appendBlockWithCrc(image, infoBlock);
  }

  // BLOCK-FILE 直後の GAP
  appendStandardSync(image);
  image.appendFillByte(0, 0xaeb);

  // Header Block (インフォメーションブロック)
  {
    image.appendByte(0); // ブロック先頭マーカ (C# 版契約)
    appendStandardSync(image);

    const headerBlock = new QdfBlockBuilder();
    headerBlock.appendByte(0xa5); // データ開始マーカ
    headerBlock.appendByte(0x00); // ブロック属性 (ヘッダ)
    headerBlock.appendByte(0x40); // サイズ下位 (64 バイト)
    headerBlock.appendByte(0x00); // サイズ上位
    headerBlock.appendByte(0x01); // FileType: Object (機械語)
    appendFileName(headerBlock, fileName);
    headerBlock.appendByte(0x00); // LOCK
    headerBlock.appendByte(0x00); // SECRET
    headerBlock.appendUShortLE(QdfDataBlockSize); // Data Size
    headerBlock.appendUShortLE(LoadAddress); // Load Addr
    headerBlock.appendUShortLE(LoadAddress); // Exec Addr
    headerBlock.appendFillByteToLength(0, 0x44); // ヘッダブロックは 0x44 バイト固定
    appendBlockWithCrc(image, headerBlock);
    appendStandardSync(image);
  }

  // ヘッダブロック後の GAP
  image.appendFillByte(0, 0xff);

  // Data Block (ドライバ + MZSD データ)
  {
    appendStandardSync(image);

    const dataBlock = new QdfBlockBuilder();
    dataBlock.appendByte(0xa5); // データ開始マーカ
    dataBlock.appendByte(0x05); // データタイプ
    dataBlock.appendUShortLE(QdfDataBlockSize); // Data Size
    dataBlock.appendBytes(executableData);
    dataBlock.appendFillByteToLength(0, QdfDataBlockSize + 4); // 0xBE04 まで 0 パディング
    appendBlockWithCrc(image, dataBlock);
    appendStandardSync(image);
  }

  // 残りを 0 埋めして固定サイズにする
  image.appendFillByteToLength(0, QdfImageSize);

  return image.toUint8Array();
}
