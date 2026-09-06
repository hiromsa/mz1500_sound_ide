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

      // マクロ定義行: @1 = { ... }, @VE1 = { ... }, @PE1 = { ... }
      [/([@](?:FM)?\d+)(\s*=\s*)(\{)/i, [
        'macro.fm',
        'delimiter',
        { token: 'delimiter.bracket', next: '@macroBody' }
      ]],
      [/([@](?:VE)\d+)(\s*=\s*)(\{)/i, [
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
      [/[@](?:VE)\d*\b/i, 'macro.vol'],
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
      [/[@]v\d+\b/i, 'volume'],               // @v: FM 専用音量 (0-127)
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
    // コメント: スモーキーなオリーブグレー
    { token: 'comment', foreground: '667761', fontStyle: 'italic' },

    // ディレクティブ: ダスティモーヴ / スモーキーパープル
    { token: 'keyword.directive', foreground: 'A782A9', fontStyle: 'bold' },
    { token: 'directive.value', foreground: '5FA89B' },
    { token: 'string', foreground: 'B88572' },

    // トラック指定子: 彩度を抑えたシックな系統色
    { token: 'track.psg', foreground: '5B9BD5', fontStyle: 'bold' },   // DCSG矩形波: スレートブルー
    { token: 'track.noise', foreground: 'CD8D5A', fontStyle: 'bold' }, // DCSGノイズ: ダスティオレンジ
    { token: 'track.beep', foreground: '78B084', fontStyle: 'bold' },  // BEEP: セージグリーン
    { token: 'track.fm', foreground: '9E86C8', fontStyle: 'bold' },    // FM音源: スモーキーラベンダー

    // 音色・エンベロープマクロ: 淡いトーン
    { token: 'macro.fm', foreground: 'C97A9E' },    // FM音色: ダスティピンク
    { token: 'macro.vol', foreground: 'D6C585' },   // 音量エンベロープ: ペールサンドゴールド
    { token: 'macro.pitch', foreground: '6EB589' }, // ピッチエンベロープ/スイープ: スモーキーミント
    { token: 'macro.noise', foreground: 'C77373' }, // ノイズ波形/連動: ダスティコーラル

    // 音符 & 休符: 目に優しい柔らかいトーン
    { token: 'note', foreground: 'C8D1D9' },                           // 音符: ソフトライトグレー
    { token: 'rest', foreground: '7E9F95' },                           // 休符: スモーキーブルーグリーン
    { token: 'note.tie', foreground: 'B87B95' },                       // タイ: ソフトローズ
    { token: 'note.tuplet', foreground: 'BA9268' },                    // 連符括弧: ダスティアンバー

    // オクターブ & 移調
    { token: 'octave', foreground: '58A497' },                         // o4: ソフトシアン
    { token: 'octave.step', foreground: '5EA6B5', fontStyle: 'bold' }, // < >: スモーキーアクア
    { token: 'transpose', foreground: '6C94B8' },                      // K, D: スモーキーアイスブルー

    // テンポ・音長・音量・クオンタイズ
    { token: 'tempo', foreground: 'C47285' },                          // t, @t: ダスティローズ
    { token: 'length', foreground: '52949C' },                         // l: スレートターコイズ
    { token: 'volume', foreground: 'C4A76C' },                         // v: ソフトオーカー
    { token: 'quantize', foreground: 'A57AB5' },                       // q, @q: ミュートラベンダー

    // フロー制御・ループ
    { token: 'loop.global', foreground: 'D4B859', fontStyle: 'bold' }, // L: ウォームマスタード
    { token: 'loop.bracket', foreground: 'C8A858' },                   // [ ]: ソフトゴールド
    { token: 'macro.loop', foreground: '5EA6B5', fontStyle: 'bold' },  // |: スモーキーシアン
    { token: 'macro.release', foreground: 'C9864E', fontStyle: 'bold' },// >: ダスティアンバー
    { token: 'macro.repeat', foreground: 'B87B95' },                   // 15x4: ソフトローズ

    // その他
    { token: 'number', foreground: '9AB38F' },                         // 数値: 落ち着いたセージ
    { token: 'delimiter', foreground: '8E9297' },                      // 区切り: 落ち着いたグレー
    { token: 'delimiter.bracket', foreground: 'C8A858' },
  ],
  colors: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#C8D1D9',
    'editorCursor.foreground': '#5B9BD5',
    'editor.lineHighlightBackground': '#25282E',
    'editorLineNumber.foreground': '#4F545C',
    'editorLineNumber.activeForeground': '#8A9DB4',
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
