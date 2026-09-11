// FONT.ROM の字形を ASCII アートでダンプし、ディスプレイコード→文字の対応表を確定する
// (一時デバッグツール・コミット対象外)
//
// 使い方: node dump-font.mjs <FONT.ROMのパス> [開始コード(16進)] [終了コード(16進)]
import { readFileSync } from 'node:fs';

const [romPath, startArg, endArg] = process.argv.slice(2);
const rom = readFileSync(romPath);
console.log(`FONT.ROM size: ${rom.length}`);

const start = startArg !== undefined ? parseInt(startArg, 16) : 0x00;
const end = endArg !== undefined ? parseInt(endArg, 16) : 0xff;

for (let code = start; code <= end; code++) {
  const glyph = rom.subarray(code * 8, code * 8 + 8);
  const lines = [];
  for (let row = 0; row < 8; row++) {
    let bits = '';
    for (let bit = 7; bit >= 0; bit--) {
      bits += ((glyph[row] >> bit) & 1) === 1 ? '##' : '..';
    }

    lines.push(bits);
  }

  console.log(`--- code 0x${code.toString(16).padStart(2, '0')} ---`);
  for (const line of lines) {
    console.log(line);
  }
}
