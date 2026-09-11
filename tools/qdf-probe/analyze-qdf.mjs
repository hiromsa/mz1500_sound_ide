// QDF 生イメージのブロック構造解析 (デバッグ用・コミット対象外)
// 使い方: node analyze-qdf.mjs <qdf1> <qdf2> ...
import { readFileSync } from 'node:fs';

function crc16Arc(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

function analyze(path) {
  const b = readFileSync(path);
  console.log(`=== ${path} (${b.length} bytes) ===`);
  console.log('head16: ' + b.subarray(0, 16).toString('hex'));
  let pos = 2700;
  let index = 0;
  let blockFilePending = true;
  let gapStart = 2700;
  while (pos < b.length) {
    while (pos < b.length && b[pos] === 0x00) pos++; // GAP / unrecorded
    if (pos >= b.length) break;
    if (pos > gapStart) {
      console.log(`gap: 0x${gapStart.toString(16)} - 0x${(pos - 1).toString(16)} (${pos - gapStart} bytes)`);
    }
    const syncStart = pos;
    while (pos < b.length && b[pos] === 0x16) pos++;
    const syncLen = pos - syncStart;
    if (pos >= b.length) break;
    if (b[pos] !== 0xa5) {
      console.log(`!! non-A5 byte 0x${b[pos].toString(16)} at 0x${pos.toString(16)} (syncLen=${syncLen}), resyncing`);
      gapStart = pos;
      pos++;
      continue;
    }
    if (blockFilePending) {
      const body = b.subarray(pos, pos + 4);
      const crcStored = b[pos + 4] | (b[pos + 5] << 8);
      console.log(
        `block#${index} start=0x${pos.toString(16)} syncLen=${syncLen} BLOCKFILE count=${body[1]} crcStored=0x${crcStored.toString(16)} crcCalc=0x${crc16Arc(body).toString(16)}`,
      );
      blockFilePending = false;
      pos += 6;
    } else {
      const flag = b[pos + 1];
      const size = b[pos + 2] | (b[pos + 3] << 8);
      const crcPos = pos + 4 + size;
      if (crcPos + 2 > b.length) {
        console.log(`block#${index} start=0x${pos.toString(16)} truncated (flag=0x${flag.toString(16)} size=0x${size.toString(16)})`);
        break;
      }
      const crcStored = b[crcPos] | (b[crcPos + 1] << 8);
      const crcCalc = crc16Arc(b.subarray(pos, crcPos));
      let extra = '';
      if (flag === 0x00) {
        const h = b.subarray(pos + 4, crcPos);
        const name = [...h.subarray(1, 18)]
          .map((c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '.'))
          .join('');
        extra = ` attr=${h[0]} name="${name}" fileSize=0x${(h[18] | (h[19] << 8)).toString(16)} load=0x${(
          h[20] |
          (h[21] << 8)
        ).toString(16)} exec=0x${(h[22] | (h[23] << 8)).toString(16)}`;
      }
      console.log(
        `block#${index} start=0x${pos.toString(16)} syncLen=${syncLen} flag=0x${flag.toString(16)} size=0x${size.toString(16)} crcStored=0x${crcStored.toString(16)} crcCalc=0x${crcCalc.toString(16)} crcOK=${crcCalc === crcStored}${extra}`,
      );
      pos = crcPos + 2;
    }
    gapStart = pos;
    index++;
  }
  console.log(`total blocks: ${index}`);
  console.log('');
}

for (const path of process.argv.slice(2)) {
  analyze(path);
}

