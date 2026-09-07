/**
 * SAMPLE MML (プリセット楽曲) データ定義。
 *
 * 著作権フリー (パブリックドメイン) の古典楽曲を MZ-1500 向け MML に
 * アレンジしたサンプル集。PSG / BEEP / FM 音源 / ノイズの各系統を網羅する
 * デモ楽曲として、エクスプローラーの Sample MML > classics フォルダに表示される。
 * UI (FileExplorer) とデータを疎結合に保つため、MML ソース本体は本モジュールに集約する。
 *
 * 楽曲構成の共通ルール:
 * - 全トラックの先頭行に `L` を配置し、曲頭から永久ループする (ループ復帰時に
 *   音量・音色などの初期化コマンドも再生されるよう、状態指定は L より後に書く)。
 * - BEEP トラック (B1) はハードウェア的に音量制御不可のため v / @VE を使わない。
 * - FM トラック (F1〜F8) を使う曲は `#OPM ON` を宣言する。
 */

/** サンプル楽曲 1 曲分の定義。 */
export interface SampleMmlSong {
  /** エクスプローラー / エディタタブの識別子 (ユニーク)。 */
  readonly id: string;
  /** エクスプローラーに表示するファイル名 (ユニーク・.mml 形式)。 */
  readonly fileName: string;
  /** 楽曲タイトル。 */
  readonly title: string;
  /** 原曲の作曲者 (いずれもパブリックドメイン)。 */
  readonly composer: string;
  /** 使用音源の概要。 */
  readonly chips: string;
  /** MML ソース全文。 */
  readonly content: string;
}

/** classics フォルダに格納する著作権フリー古典楽曲一覧。 */
export const CLASSIC_SAMPLE_MML_SONGS: readonly SampleMmlSong[] = [
  {
    id: 'classic-fur-elise',
    fileName: 'classic_fur_elise.mml',
    title: 'エリーゼのために',
    composer: 'L. v. Beethoven (1810)',
    chips: 'PSG ×3',
    content: `; ============================================================
; エリーゼのために (WoO 59 / 1810)
; 原曲: L. v. Beethoven 〔著作権フリー: パブリックドメイン〕
; 構成: PSG ×3  P1=メロディ / P2=アルペジオ / P3=低音保持
; 各トラック先頭の L から曲頭へ永久ループします
; ============================================================
#TITLE "Fur Elise"
#COMPOSER "L. v. Beethoven"
#OPM OFF
#OCTAVE NORMAL

; テンポ (曲全体)
t120

; --- P1: メロディ (有名な主題) ---
P1 L l16 o5 v13 q7
P1 r4.
P1 o5 e d+ e d+ e o4 b
P1 o5 d c o4 a4
P1 o4 c e a b8.
P1 o4 e g+ b o5 c8.
P1 o4 e o5 e d+ e d+ e
P1 o4 b o5 d c o4 a8.
P1 o4 c e a b8.
P1 o4 e g+ b o5 c8.
P1 o5 c b o4 a4
P1 o5 e d+ e d+ e o4 b
P1 o5 d c o4 a4
P1 r4.

; --- P2: アルペジオ伴奏 (根音-5度-3度の16分流れ) ---
P2 L l16 o2 v9 q7
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a
P2 o2 e > e g+ < e > e g+
P2 o2 e > e g+ < e > e g+
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a
P2 o2 e > e g+ < e > e g+
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a
P2 o2 a > e a < a > e a

; --- P3: 低音保持 (控えめな和音の土台) ---
P3 L l4 o3 v5
P3 a4. a4. a4. a4.
P3 e4. e4.
P3 a4. a4.
P3 e4.
P3 a4.
P3 a4. a4. a4.
`,
  },
  {
    id: 'classic-ode-to-joy',
    fileName: 'classic_ode_to_joy.mml',
    title: '歓喜の歌 (交響曲第9番)',
    composer: 'L. v. Beethoven (1824)',
    chips: 'BEEP + PSG ×2 + Noise',
    content: `; ============================================================
; 歓喜の歌 (交響曲第9番 第4楽章 主題 / 1824)
; 原曲: L. v. Beethoven 〔著作権フリー: パブリックドメイン〕
; 構成: BEEP=メロディ / PSG ×2 (ベース・パッド) / N1=ノイズドラム
; BEEP は音量制御不可のため、音量コマンドは書いていません
; ============================================================
#TITLE "Ode to Joy"
#COMPOSER "L. v. Beethoven"
#OPM OFF
#OCTAVE NORMAL

t120

; --- B1: メロディ (BEEP は音量指定不可) ---
B1 L l4 o4
B1 f+4 f+4 g4 a4
B1 a4 g4 f+4 e4
B1 d4 d4 e4 f+4
B1 f+4. e8 e2
B1 f+4 f+4 g4 a4
B1 a4 g4 f+4 e4
B1 d4 d4 e4 f+4
B1 e4. d8 d2

; --- P1: ベース (根音と5度の8分刻み) ---
P1 L l8 o2 v11 q7
P1 d8 a8 d8 a8 d8 a8 d8 a8
P1 o2 a8 > e8 < a8 > e8 < a8 > e8 < a8
P1 d8 a8 d8 a8 d8 a8 d8 a8
P1 o2 a8 > e8 < a8 > e8 < a8 > e8 < a8
P1 d8 a8 d8 a8 d8 a8 d8 a8
P1 o2 a8 > e8 < a8 > e8 < a8 > e8 < a8
P1 d8 a8 d8 a8 d8 a8 d8 a8
P1 o2 a8 > e8 < a8 > e8 < a8 > e8 < a8

; --- P2: 和音パッド ---
P2 L l4 o3 v8
P2 d4 f+4 a2
P2 c+4 e4 a2
P2 d4 f+4 a2
P2 c+4 e4 a2
P2 d4 f+4 a2
P2 c+4 e4 a2
P2 d4 f+4 a2
P2 c+4 e4 a2

; --- N1: ノイズドラム (ホワイトノイズで拍子取り) ---
N1 L @WN1 v9 l4
N1 [c4 c8 c8 c4 c4]8
`,
  },
  {
    id: 'classic-menuett-g',
    fileName: 'classic_menuett_g.mml',
    title: 'メヌエット ト長調',
    composer: 'C. Petzold (1725頃)',
    chips: 'PSG ×2',
    content: `; ============================================================
; メヌエット ト長調 (BWV Anh. 114 / 1725頃)
; 原曲: C. Petzold (バッハの名で親しまれる) 〔著作権フリー: パブリックドメイン〕
; 構成: PSG ×2  P1=メロディ / P2=分散和音ベース
; ============================================================
#TITLE "Menuet in G"
#COMPOSER "C. Petzold"
#OPM OFF
#OCTAVE NORMAL

t132

; --- P1: メロディ ---
P1 L l8 o5 v13 q7
P1 d4 < g a b c
P1 d4 < g4 g4
P1 o5 e4 c8 d8 e8 f+8
P1 o5 g4 < g4 g4
P1 o5 c4 d8 c8 < b8 a8
P1 o4 b4 o5 c8 o4 b8 a8 g8
P1 o4 f+4 g8 a8 b8 g8
P1 o4 b4 a2

; --- P2: 分散和音ベース (8分6音で小節を埋める) ---
P2 L l8 o2 v9 q7
P2 o2 g > d < b > d < g > d
P2 o2 g > d < b > d < g > d
P2 o2 c > g < e > g < c > g
P2 o2 g > d < b > d < g > d
P2 o2 c > g < e > g < c > g
P2 o2 g > d < b > d < g > d
P2 o2 d > a < f+ > a < d > a
P2 o2 g > d < b > d < g > d
`,
  },
  {
    id: 'classic-pachelbel-canon',
    fileName: 'classic_pachelbel_canon.mml',
    title: 'カノン ニ長調',
    composer: 'J. Pachelbel (1690頃)',
    chips: 'FM ×3',
    content: `; ============================================================
; カノン ニ長調 (Canon in D / 1690頃)
; 原曲: J. Pachelbel 〔著作権フリー: パブリックドメイン〕
; 構成: FM音源 ×3  F1=メロディ / F2=対旋律 / F3=ベース
; メロディは 2分 → 4分 → 8分 と装飾が増えていく 3 段階の変奏
; ============================================================
#TITLE "Canon in D"
#COMPOSER "J. Pachelbel"
#OPM ON
#OCTAVE NORMAL

t100

; --- FM 音色定義 ---
; @1 = リード音色 (ALG4 ストリングス風) / @2 = ベース音色 (ALG5)
; 順序: ALG, FB / OP1〜4 それぞれ AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME
@1 = {
  4, 1,
  31, 8, 0, 10, 0, 22, 0, 1, 0, 0, 0,
  24, 10, 0, 10, 0, 35, 0, 1, 0, 0, 0,
  28, 6, 0, 10, 0, 28, 0, 1, 0, 0, 0,
  31, 8, 0, 10, 0, 14, 0, 1, 0, 0, 0
}
@2 = {
  5, 0,
  31, 2, 0, 10, 0, 8, 1, 1, 0, 0, 0,
  31, 4, 0, 10, 0, 16, 1, 1, 0, 0, 0,
  31, 4, 0, 10, 0, 20, 1, 1, 0, 0, 0,
  31, 6, 0, 12, 0, 10, 1, 1, 0, 0, 0
}

; --- F1: メロディ (2分 → 4分 → 8分 変奏) ---
F1 L @1 @v100 l4 o5 q7
F1 f+2 e2 d2 c+2 b2 a2 b2 c+2
F1 f+4 f+4 e4 e4 d4 d4 c+4 c+4 b4 b4 a4 a4 b4 b4 c+4 c+4
F1 [f+8 f+8 e8 e8 d8 d8 c+8 c+8 b8 b8 a8 a8 b8 b8 c+8 c+8]2

; --- F2: 対旋律 (1巡目は休符、2巡目から加わる) ---
F2 L @1 @v70 l4 o4 q7
F2 r2 r2 r2 r2 r2 r2 r2 r2
F2 a4 a4 g4 g4 f+4 f+4 e4 e4 d4 d4 c+4 c+4 d4 d4 e4 e4
F2 [a8 a8 g8 g8 f+8 f+8 e8 e8 d8 d8 c+8 c+8 d8 d8 e8 e8]2

; --- F3: ベース (有名な低音進行を繰り返す) ---
F3 L @2 @v90 l4 o2 q7
F3 [d2 a2 b2 f+2 g2 d2 g2 a2]3
`,
  },
  {
    id: 'classic-twinkle-star',
    fileName: 'classic_twinkle_star.mml',
    title: 'きらきら星',
    composer: 'フランス民謡 (W. A. Mozart K.265)',
    chips: 'FM + PSG + BEEP + Noise',
    content: `; ============================================================
; きらきら星 (フランス民謡 «Ah! vous dirai-je, maman» / 1761)
; モーツァルト ピアノ変奏曲 K.265 の主題 〔著作権フリー: パブリックドメイン〕
; 構成: FM=メロディ / PSG=アルペジオ / BEEP=3度下カウンター / N1=ドラム
; 全音源 (FM + PSG + BEEP + Noise) を組み合わせたデモ曲
; ============================================================
#TITLE "Twinkle Twinkle"
#COMPOSER "Trad. (Mozart K.265)"
#OPM ON
#OCTAVE NORMAL

t120

; --- FM 音色定義 (@1 = ベル風 ALG7) ---
@1 = {
  7, 0,
  31, 20, 0, 8, 0, 18, 0, 1, 0, 0, 0,
  31, 24, 0, 8, 0, 24, 0, 2, 0, 0, 0,
  31, 16, 0, 6, 0, 30, 0, 4, 0, 0, 0,
  31, 12, 0, 6, 0, 16, 0, 8, 0, 0, 0
}

; --- F1: メロディ (FM) ---
F1 L @1 @v110 l4 o5 q7
F1 c4 c4 g4 g4 a4 a4 g2
F1 f4 f4 e4 e4 d4 d4 c2
F1 g4 g4 f4 f4 e4 e4 d2
F1 g4 g4 f4 f4 e4 e4 d2
F1 c4 c4 g4 g4 a4 a4 g2
F1 f4 f4 e4 e4 d4 d4 c2

; --- B1: カウンター旋律 (BEEP・3度下平行) ---
B1 L l4 o4
B1 a4 a4 e4 e4 f4 f4 e2
B1 d4 d4 c4 c4 o3 b4 b4 a2
B1 o4 e4 e4 d4 d4 c4 c4 o3 b2
B1 o4 e4 e4 d4 d4 c4 c4 o3 b2
B1 a4 a4 e4 e4 f4 f4 e2
B1 d4 d4 c4 c4 o3 b4 b4 a2

; --- P1: アルペジオ伴奏 (PSG) ---
P1 L l8 o3 v10 q7
P1 [c e g e]2
P1 f a c a c e g e g b d b c e g e
P1 g b d b c e g e g b d b c e g e
P1 g b d b c e g e g b d b c e g e
P1 [c e g e]2
P1 f a c a c e g e g b d b c e g e

; --- N1: ノイズドラム ---
N1 L @WN1 v8 l4
N1 [c4 c8 c8 c4 c4]12
`,
  },
];

/** id からサンプル楽曲を検索する (見つからない場合は undefined)。 */
export function findSampleSongById(id: string): SampleMmlSong | undefined {
  return CLASSIC_SAMPLE_MML_SONGS.find((song) => song.id === id);
}

/** ファイル名からサンプル楽曲を検索する (見つからない場合は undefined)。 */
export function findSampleSongByFileName(fileName: string): SampleMmlSong | undefined {
  return CLASSIC_SAMPLE_MML_SONGS.find((song) => song.fileName === fileName);
}
