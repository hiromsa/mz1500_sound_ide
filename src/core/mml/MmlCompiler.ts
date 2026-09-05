/**
 * MML → バイナリ音楽データ コンパイラ。
 * (移植元: MzSound.MmlCompiler/MmlCompiler.cs)
 */
import type { MmlDiagnostic, TrackId } from './TrackId';
import { DiagnosticSeverity } from './TrackId';
import type { FmTone, PitchEnvelope, VolumeEnvelope } from './Envelopes';
import type { MmlMap } from './MmlMap';
import { MmlParser } from './parser/MmlParser';
import { assembleMusicData } from './MmlCompilerAssemble';
import { parseFmTone, parsePitchEnvelope, parseVolumeEnvelope } from './MmlCompilerMacros';

/** コンパイル結果。 */
export interface MmlCompileResult {
  readonly success: boolean;

  readonly diagnostics: readonly MmlDiagnostic[];

  /** バイナリ音楽データ (成功時のみ non-null)。 */
  readonly musicData: Uint8Array | null;

  /** 演奏位置ハイライト用デバッグ情報 (成功時のみ non-null)。 */
  readonly map: MmlMap | null;

  /** 四分音符あたりのフレーム数 (60Hz 基準)。 */
  readonly quarterFrames: number;

  /** 全トラック合計の演奏フレーム数 (概算)。 */
  readonly totalFrames: number;

  readonly tracks: readonly TrackId[];
}

/**
 * マクロ定義行 (@v / @VE, @EP / @PE, @FM / @<n>) を行頭から抽出する正規表現。
 * 書式は docs/specification/mml_reference.md 4 章準拠 (`@<種別><番号> = { ... }`、`=` 必須)。
 */
const macroRegex = /^[ \t]*@(?:(v|VE|EP|PE|FM)(\d+)|(\d+))[ \t]*=[ \t]*\{([^}]*)\}/gm;

/** マクロ定義の正規種別。 */
type MacroKind = 'v' | 'EP' | 'FM';

/** 正規化済みマクロ定義ヘッダ。 */
interface MacroHeader {
  readonly kind: MacroKind;
  readonly number: number;
}

/** 定義行の接頭辞を正規種別へ変換する (@VE→v、@PE→EP、@FM / @<n>→FM)。 */
function parseMacroHeader(
  prefix: string | undefined,
  numberStr: string | undefined,
  toneNumberStr: string | undefined,
): MacroHeader | null {
  if (prefix === undefined) {
    // @<n> 形式は FM 音色定義
    return toneNumberStr === undefined ? null : { kind: 'FM', number: parseInt(toneNumberStr, 10) };
  }

  const number = numberStr === undefined ? NaN : parseInt(numberStr, 10);
  switch (prefix.toUpperCase()) {
    case 'V':
    case 'VE':
      return { kind: 'v', number };
    case 'EP':
    case 'PE':
      return { kind: 'EP', number };
    case 'FM':
      return { kind: 'FM', number };
    default:
      return null;
  }
}

/**
 * ヘッダディレクティブ行 (#TITLE など、mml_reference.md 1章) を抽出する正規表現。
 * メタデータのため演奏データには影響しない (コンパイル前に除去する)。
 */
const headerRegex = /^[ \t]*#(?:TITLE|COMPOSER|OCTAVE|OPM|FM)\b[^\r\n]*/gim;

/** MML コンパイラ。 */
export class MmlCompiler {
  /** MML ソースをコンパイルする。 */
  compile(source: string): MmlCompileResult {
    const diagnostics: MmlDiagnostic[] = [];

    // 1) マクロ定義 (@v / @VE, @EP / @PE, @FM / @<n>) を抽出し、ソースからは行位置を崩さずに除去する
    const volumeEnvelopes: VolumeEnvelope[] = [];
    const pitchEnvelopes: PitchEnvelope[] = [];
    const fmTones: FmTone[] = [];

    const cleaned = source.replace(
      macroRegex,
      (match, prefix: string | undefined, numberStr: string | undefined, toneNumberStr: string | undefined, body: string, offset: number) => {
        const header = parseMacroHeader(prefix, numberStr, toneNumberStr);
        if (header === null) {
          return match;
        }

        const line = countLine(source, offset);

        switch (header.kind) {
          case 'v': {
            const venv = parseVolumeEnvelope(header.number, body, line, diagnostics);
            if (venv !== null) {
              volumeEnvelopes.push(venv);
            }

            break;
          }

          case 'EP': {
            const penv = parsePitchEnvelope(header.number, body, line, diagnostics);
            if (penv !== null) {
              pitchEnvelopes.push(penv);
            }

            break;
          }

          case 'FM': {
            const tone = parseFmTone(header.number, body, line, diagnostics);
            if (tone !== null) {
              fmTones.push(tone);
            }

            break;
          }
        }

        return blankOut(match);
      },
    );

    // 2) ヘッダディレクティブ (#TITLE など) を行位置を崩さずに除去する
    const withoutHeaders = cleaned.replace(headerRegex, (match) => blankOut(match));

    // 3) 本体パース + コード生成
    const parser = new MmlParser(withoutHeaders, volumeEnvelopes, pitchEnvelopes, fmTones, diagnostics);
    const parseResult = parser.parse();

    const hasError = diagnostics.some((d) => d.severity === DiagnosticSeverity.Error);
    if (parseResult === null || hasError) {
      return { success: false, diagnostics, musicData: null, map: null, quarterFrames: 0, totalFrames: 0, tracks: [] };
    }

    // 3) アセンブル
    const { data, map, totalFrames } = assembleMusicData(parseResult, volumeEnvelopes, pitchEnvelopes, fmTones);

    const tracks = [...parseResult.tracks.values()]
      .sort((a, b) => a.track.index - b.track.index)
      .map((t) => t.track);

    return {
      success: true,
      diagnostics,
      musicData: data,
      map,
      quarterFrames: parseResult.quarterFrames,
      totalFrames,
      tracks,
    };
  }
}

function blankOut(text: string): string {
  return [...text].map((c) => (c === '\r' || c === '\n' ? c : ' ')).join('');
}

function countLine(source: string, index: number): number {
  let line = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }

  return line;
}
