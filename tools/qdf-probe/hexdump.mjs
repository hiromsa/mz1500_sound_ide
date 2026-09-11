// QDF 生バイトの hexdump (デバッグ用・コミット対象外)
// 使い方: node hexdump.mjs <file> <offsetHex> <countHex>
import { readFileSync } from 'node:fs';

const [file, offsetArg, countArg] = process.argv.slice(2);
const offset = parseInt(offsetArg, 16);
const count = parseInt(countArg, 16);
const b = readFileSync(file);

for (let i = 0; i < count; i += 16) {
  const line = b.subarray(offset + i, offset + i + 16);
  const hex = [...line].map((c) => c.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...line].map((c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '.')).join('');
  console.log(`${(offset + i).toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
}
