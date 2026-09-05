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

/** マクロ定義 (@v / @EP / @FM) を行頭から抽出する正規表現。 */
const macroRegex = /^[ \t]*@(v|EP|FM)(\d+)[ \t]*=[ \t]*\{([^}]*)\}/gm;

/** MML コンパイラ。 */
export class MmlCompiler {
  /** MML ソースをコンパイルする。 */
  compile(source: string): MmlCompileResult {
    const diagnostics: MmlDiagnostic[] = [];

    // 1) マクロ定義 (@v / @EP / @FM) を抽出し、ソースからは行位置を崩さずに除去する
    const volumeEnvelopes: VolumeEnvelope[] = [];
    const pitchEnvelopes: PitchEnvelope[] = [];
    const fmTones: FmTone[] = [];

    const cleaned = source.replace(macroRegex, (match, kind: string, numStr: string, body: string, offset: number) => {
      const number = parseInt(numStr, 10);
      const line = countLine(source, offset);

      switch (kind) {
        case 'v': {
          const venv = parseVolumeEnvelope(number, body, line, diagnostics);
          if (venv !== null) {
            volumeEnvelopes.push(venv);
          }

          break;
        }

        case 'EP': {
          const penv = parsePitchEnvelope(number, body, line, diagnostics);
          if (penv !== null) {
            pitchEnvelopes.push(penv);
          }

          break;
        }

        case 'FM': {
          const tone = parseFmTone(number, body, line, diagnostics);
          if (tone !== null) {
            fmTones.push(tone);
          }

          break;
        }

        default:
          break;
      }

      return blankOut(match);
    });

    // 2) 本体パース + コード生成
    const parser = new MmlParser(cleaned, volumeEnvelopes, pitchEnvelopes, fmTones, diagnostics);
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
