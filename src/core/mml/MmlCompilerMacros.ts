/**
 * マクロ定義 (@v / @EP / @FM) のパース。
 * (移植元: MzSound.MmlCompiler/MmlCompiler.Macros.cs)
 */
import {
  type MmlDiagnostic,
} from './TrackId';
import { FmToneParameterCount, type FmTone, type PitchEnvelope, type VolumeEnvelope } from './Envelopes';
import { mmlError, mmlWarn } from './parser/MmlParser';

const envelopeElementRegex = /^(-?\d+)(?:[x×](\d+))?$/i;

/** マクロ本体をトークン配列へ分割する (コメント除去、改行も区切りとして扱う)。 */
export function splitMacroTokens(body: string): string[] {
  const cleaned = body
    .replace(/(;|\/)[^\r\n]*/g, '')
    .replace(/\r?\n/g, ',');
  return cleaned
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .flatMap((token) => {
      // `| 12` / `> 8` のような「マーカー+数値」(エディタ generateMmlSnippet 出力書式) を分離する
      const match = /^([|>])\s*(.+)$/.exec(token);
      return match ? [match[1], match[2]] : [token];
    });
}

export function parseVolumeEnvelope(
  number: number,
  body: string,
  line: number,
  column: number,
  diagnostics: MmlDiagnostic[],
): VolumeEnvelope | null {
  const values: number[] = [];
  let loopIndex = -1;
  let releaseIndex = -1;

  for (const rawToken of splitMacroTokens(body)) {
    const token = rawToken.trim();
    if (token.length === 0) {
      continue;
    }

    if (token === '|') {
      if (loopIndex >= 0) {
        diagnostics.push(mmlError(line, column, 'エンベロープのループ位置 | は 1 回のみ指定できます'));
      } else {
        loopIndex = values.length;
      }

      continue;
    }

    if (token === '>') {
      if (releaseIndex >= 0) {
        diagnostics.push(mmlError(line, column, 'リリース位置 > は 1 回のみ指定できます'));
      } else {
        releaseIndex = values.length;
      }

      continue;
    }

    const match = envelopeElementRegex.exec(token);
    if (match === null) {
      diagnostics.push(mmlError(line, column, `無効なエンベロープ要素: '${token}'`));
      continue;
    }

    let value = parseInt(match[1], 10);
    if (value < 0 || value > 15) {
      diagnostics.push(mmlWarn(line, column, `音量値 ${value} は 0-15 の範囲外です (15 に制限しました)`));
      value = Math.min(15, Math.max(0, value));
    }

    const repeat = match[2] !== undefined ? parseInt(match[2], 10) : 1;
    for (let i = 0; i < repeat; i++) {
      values.push(value);
    }
  }

  if (values.length === 0) {
    diagnostics.push(mmlError(line, column, `@v${number} の要素がありません`));
    return null;
  }

  return { number, values, loopIndex, releaseIndex };
}

export function parsePitchEnvelope(
  number: number,
  body: string,
  line: number,
  column: number,
  diagnostics: MmlDiagnostic[],
): PitchEnvelope | null {
  const values: number[] = [];
  let loopIndex = -1;

  for (const rawToken of splitMacroTokens(body)) {
    const token = rawToken.trim();
    if (token.length === 0) {
      continue;
    }

    if (token === '|') {
      if (loopIndex >= 0) {
        diagnostics.push(mmlError(line, column, 'エンベロープのループ位置 | は 1 回のみ指定できます'));
      } else {
        loopIndex = values.length;
      }

      continue;
    }

    if (token === '>') {
      diagnostics.push(mmlWarn(line, column, 'ピッチエンベロープにリリース > は指定できません (無視しました)'));
      continue;
    }

    const match = envelopeElementRegex.exec(token);
    if (match === null) {
      diagnostics.push(mmlError(line, column, `無効なエンベロープ要素: '${token}'`));
      continue;
    }

    const value = Math.min(32767, Math.max(-32768, parseInt(match[1], 10)));
    const repeat = match[2] !== undefined ? parseInt(match[2], 10) : 1;
    for (let i = 0; i < repeat; i++) {
      values.push(value);
    }
  }

  if (values.length === 0) {
    diagnostics.push(mmlError(line, column, `@EP${number} の要素がありません`));
    return null;
  }

  return { number, values, loopIndex };
}

export function parseFmTone(
  number: number,
  body: string,
  line: number,
  column: number,
  diagnostics: MmlDiagnostic[],
): FmTone | null {
  const tokens = splitMacroTokens(body);
  const values: number[] = [];

  for (const token of tokens) {
    if (!/^[+-]?\d+$/.test(token)) {
      diagnostics.push(mmlError(line, column, `無効な FM 音色パラメータ: '${token}'`));
      return null;
    }

    const value = parseInt(token, 10);
    values.push(Math.min(127, Math.max(0, value)));
  }

  if (values.length !== FmToneParameterCount) {
    diagnostics.push(mmlError(
      line,
      column,
      `@FM${number} のパラメータ数は ${FmToneParameterCount} 個必要です (現在 ${values.length} 個)`,
    ));
    return null;
  }

  return { number, parameters: values };
}
