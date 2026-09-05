import type { Monaco } from '@monaco-editor/react';
import type { languages, editor } from 'monaco-editor';

export const MML_LANGUAGE_ID = 'mz1500-mml';
export const MML_THEME_NAME = 'mz1500-mml-theme';

/**
 * MML 言語設定 (コメント、括弧補完、ペア)
 */
export const mmlLanguageConfiguration: languages.LanguageConfiguration = {
  comments: {
    lineComment: ';',
    blockComment: ['/*', '*/'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: '/*', close: '*/' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};

/**
 * Monarch トークンプロバイダー定義
 */
export const mmlMonarchTokensProvider: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: false,

  tokenizer: {
    root: [
      // 空白
      { include: '@whitespace' },

      // ディレクティブ (行頭 or 空白直後の #TITLE, #COMPOSER, #OCTAVE, #OPM, #FM 等)
      [/^#(?:TITLE|COMPOSER)\b/i, { token: 'keyword.directive', next: '@directiveString' }],
      [/^#(?:OCTAVE|OPM|FM)\b/i, { token: 'keyword.directive', next: '@directiveValue' }],
      [/^#\w+\b/i, 'keyword.directive'],

      // マクロ定義行: @1 = { ... }, @v1 = { ... }, @PE1 = { ... }
      [/([@](?:FM)?\d+)(\s*=\s*)(\{)/i, [
        'macro.fm',
        'delimiter',
        { token: 'delimiter.bracket', next: '@macroBody' }
      ]],
      [/([@](?:VE|v)\d+)(\s*=\s*)(\{)/i, [
        'macro.vol',
        'delimiter',
        { token: 'delimiter.bracket', next: '@macroBody' }
      ]],
      [/([@](?:PE|EP)\d+)(\s*=\s*)(\{)/i, [
        'macro.pitch',
        'delimiter',
        { token: 'delimiter.bracket', next: '@macroBody' }
      ]],

      // トラック指定子 (全17トラック: P1〜P6, N1〜N2, B1, F1〜F8)
      [/\b(P[1-6])\b/i, 'track.psg'],
      [/\b(N[1-2])\b/i, 'track.noise'],
      [/\b(B1)\b/i, 'track.beep'],
      [/\b(F[1-8])\b/i, 'track.fm'],

      // 音色・エンベロープ・効果音マクロ適用 / 解除
      [/[@](?:FM)?\d+\b/i, 'macro.fm'],
      [/[@](?:VE|v)\d*\b/i, 'macro.vol'],
      [/[@](?:PE|EP)\d*\b/i, 'macro.pitch'],
      [/[@]SW-?\d+\b/i, 'macro.pitch'],
      [/[@](?:WN|IN)\d+\b/i, 'macro.noise'],

      // テンポ
      [/[@]t\d+,\d+\b/i, 'tempo'],
      [/t\d+\b/i, 'tempo'],

      // クオンタイズ
      [/[@]q\d+\b/i, 'quantize'],
      [/q[1-8]\b/i, 'quantize'],

      // 音量
      [/v(?:1[0-5]|[0-9])\b/i, 'volume'],

      // デフォルト音長
      [/l(?:64|32|16|8|4|2|1)\.?/i, 'length'],

      // オクターブ
      [/o[1-8]\b/i, 'octave'],
      [/[<>]/, 'octave.step'],

      // 移調 & ディチューン
      [/K[+-]?\d+\b/, 'transpose'],
      [/D[+-]?\d+\b/, 'transpose'],

      // ループ記号
      [/\bL\b/, 'loop.global'],
      [/\[/, 'loop.bracket'],
      [/\]\d*/, 'loop.bracket'],

      // タイ
      [/\^/, 'note.tie'],

      // 連符括弧
      [/[{}]/, 'note.tuplet'],

      // 休符 (r4, r8., r など)
      [/r(?:64|32|16|8|4|2|1)?\.?/i, 'rest'],

      // 音符 (c, d+, e-, f#4, g. 等)
      [/[cdefgab][+#-]?(?:64|32|16|8|4|2|1)?\.?/i, 'note'],

      // その他の数値や区切り記号
      [/[0-9]+/, 'number'],
      [/[,=]/, 'delimiter'],
    ],

    macroBody: [
      { include: '@whitespace' },
      [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
      [/\|/, 'macro.loop'],
      [/>/, 'macro.release'],
      [/-?\d+x\d+/i, 'macro.repeat'],
      [/-?\d+/, 'number'],
      [/,/, 'delimiter'],
    ],

    directiveString: [
      [/"([^"\\]|\\.)*"/, 'string', '@pop'],
      [/[^"\r\n]+/, 'string'],
      [/[\r\n]+/, '', '@pop'],
    ],

    directiveValue: [
      [/\b(NORMAL|REVERSE|ON|OFF)\b/i, 'directive.value', '@pop'],
      [/[ \t]+/, 'white'],
      [/;.*$/, 'comment', '@pop'],
      [/[\r\n]+/, '', '@pop'],
    ],

    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/\/\*/, 'comment', '@comment'],
      [/;.*$/, 'comment'],
      [/\/\/.*$/, 'comment'],
    ],

    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
};

/**
 * MML 専用ダークテーマ定義
 */
export const mmlThemeData: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // コメント: オリーブグリーン
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },

    // ディレクティブ: マゼンタ
    { token: 'keyword.directive', foreground: 'C586C0', fontStyle: 'bold' },
    { token: 'directive.value', foreground: '4EC9B0', fontStyle: 'bold' },
    { token: 'string', foreground: 'CE9178' },

    // トラック指定子: 音源系統ごとに色分け
    { token: 'track.psg', foreground: '00A8FF', fontStyle: 'bold' },   // DCSG矩形波: スカイブルー (IDEテーマと統一)
    { token: 'track.noise', foreground: 'FF9E3B', fontStyle: 'bold' }, // DCSGノイズ: オレンジ
    { token: 'track.beep', foreground: '50FA7B', fontStyle: 'bold' },  // BEEP: ライムグリーン
    { token: 'track.fm', foreground: 'BD93F9', fontStyle: 'bold' },    // FM音源: バイオレット

    // 音色・エンベロープマクロ
    { token: 'macro.fm', foreground: 'FF79C6', fontStyle: 'bold' },    // FM音色: ピンク
    { token: 'macro.vol', foreground: 'F1FA8C', fontStyle: 'bold' },   // 音量エンベロープ: ゴールド
    { token: 'macro.pitch', foreground: '50FA7B', fontStyle: 'bold' }, // ピッチエンベロープ/スイープ: ミント
    { token: 'macro.noise', foreground: 'FF6E6E', fontStyle: 'bold' }, // ノイズ波形/連動: コーラル

    // 音符 & 休符
    { token: 'note', foreground: 'E6EDF3', fontStyle: 'bold' },        // 音符: クリアホワイト
    { token: 'rest', foreground: '85E89D' },                           // 休符: ソフトグリーン/ミント
    { token: 'note.tie', foreground: 'FF79C6', fontStyle: 'bold' },    // タイ: ピンク
    { token: 'note.tuplet', foreground: 'FFB86C' },                    // 連符括弧: アンバー

    // オクターブ & 移調
    { token: 'octave', foreground: '4EC9B0', fontStyle: 'bold' },      // o4: シアン
    { token: 'octave.step', foreground: '00E5FF', fontStyle: 'bold' }, // < >: ネオンシアン
    { token: 'transpose', foreground: '79B8FF', fontStyle: 'bold' },   // K, D: スカイブルー

    // テンポ・音長・音量・クオンタイズ
    { token: 'tempo', foreground: 'FF6B8B', fontStyle: 'bold' },       // t, @t: ホットピンク
    { token: 'length', foreground: '56B6C2' },                         // l: ターコイズ
    { token: 'volume', foreground: 'E5C07B', fontStyle: 'bold' },      // v: アンバーゴールド
    { token: 'quantize', foreground: 'C678DD' },                       // q, @q: ラベンダー

    // フロー制御・ループ
    { token: 'loop.global', foreground: 'FFDF5D', fontStyle: 'bold' }, // L: ネオンイエロー
    { token: 'loop.bracket', foreground: 'FFD700', fontStyle: 'bold' },// [ ]: ゴールド
    { token: 'macro.loop', foreground: '00E5FF', fontStyle: 'bold' },  // | (マクロ内ループ): ネオンシアン
    { token: 'macro.release', foreground: 'FF9900', fontStyle: 'bold' },// > (マクロ内リリース): アンバー
    { token: 'macro.repeat', foreground: 'FF79C6' },                   // 15x4: ピンク

    // その他
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    { token: 'delimiter.bracket', foreground: 'FFD700' },
  ],
  colors: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#D4D4D4',
    'editorCursor.foreground': '#00A8FF',
    'editor.lineHighlightBackground': '#2A2D32',
    'editorLineNumber.foreground': '#5A5A5A',
    'editorLineNumber.activeForeground': '#00A8FF',
  },
};

/**
 * Monaco インスタンスに MML 言語と言語定義・テーマを一度だけセットアップする
 */
let isLanguageRegistered = false;

export function setupMmlLanguage(monaco: Monaco): void {
  if (!isLanguageRegistered) {
    monaco.languages.register({ id: MML_LANGUAGE_ID });
    monaco.languages.setLanguageConfiguration(MML_LANGUAGE_ID, mmlLanguageConfiguration);
    monaco.languages.setMonarchTokensProvider(MML_LANGUAGE_ID, mmlMonarchTokensProvider);
    monaco.editor.defineTheme(MML_THEME_NAME, mmlThemeData);
    isLanguageRegistered = true;
  }
}
