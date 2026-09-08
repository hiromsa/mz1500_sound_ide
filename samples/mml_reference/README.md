# mml_reference — MML サンプル置き場

このフォルダは、自分で作成した MML サンプル (`*.mml`) を MZ-1500 Sound IDE に
組み込むための作業フォルダです。自由に .mml を追加してください。

## フォルダ構成 (コマンド学習用サンプル)

音源ごとにフォルダを分けています。各ファイルはコマンドの動作が
聞き比べられるように、1 テーマずつ順番に鳴らす構成になっています。

| フォルダ | 内容 |
|---|---|
| `fm/` | FM音源 (YM2151 / `F1`-`F8`) 専用コマンドのサンプル (`@v` 音量 / `@` 音色 / `p` パン等) |
| `psg/` | DCSG (SN76489 / `P1`-`P6`, `N1`, `N2`) のサンプル。音符・テンポ等の**全音源共通の基本コマンド**もこちらで確認できます |
| `beep/` | BEEP (8253 PIT / `B1`) のサンプル。音量コマンド (`v` / `@VE`) が使えない点に注意 |

| ファイル | 確認できるコマンド |
|---|---|
| `fm/fm_volume_atv.mml` | `@v` (0-127 の FM 専用音量) |
| `fm/fm_voice_macro.mml` | `@N` / `@FMN` (音色定義・切替) |
| `fm/fm_panpot.mml` | `p` (ステレオ定位) |
| `fm/fm_pitch_effect.mml` | `D` / `@SW` / `@PE` (FM) |
| `psg/psg_notes_basic.mml` | 音符・休符・音長・付点・タイ・連符・半音 |
| `psg/psg_octave_transpose.mml` | `o` / `<` `>` / `K` (移調) |
| `psg/psg_tempo_length.mml` | `t` / `@t` / `l` |
| `psg/psg_volume_envelope.mml` | `@VE` (減衰 / ループ `|` / リリース `>`) |
| `psg/psg_pitch_effect.mml` | `@PE` / `@SW` / `D` (PSG) |
| `psg/psg_loop_flow.mml` | `[ ]` / `L` (永久ループ) |
| `psg/psg_noise_basic.mml` | `N1` / `@WN` / `v` (ノイズ) |
| `psg/psg_noise_interlock.mml` | `@IN` (ノイズ連動) |
| `psg/quantize.mml` | `q` / `@q` (ゲート時間) |
| `psg/volume2.mml` | `v` (0-15 の音量) |
| `beep/beep_basic_scale.mml` | `B1` 音階演奏 |
| `beep/beep_pitch_effect.mml` | `@SW` / `@PE` / `D` (BEEP) |

## 使い方

1. このフォルダに `*.mml` ファイルを置く (分類したい場合はサブフォルダを作成して OK)
2. 開発サーバー (`npm run dev`) を起動すると、エクスプローラーの **SAMPLE MML** ツリーに
   `samples/` 配下のフォルダ・ファイルが自動で反映される
3. ファイルをクリックするとエディタのタブに展開され、BUILD / PLAY でそのまま試聴できる

## ルール

- `samples/` 配下の `*.mml` はすべてビルド時にバンドルへ取り込まれます
- `npm test` で **samples/ 配下の全 .mml がエラー / 警告なしでコンパイルできること** を検証します
  (エラーを含む .mml を置いたままコミットするとテストが落ちるので注意してください)
- `classics/` フォルダの楽曲には追加の作法規約テストがあります
  (全トラック曲頭 `L` 宣言による永久ループ / BEEP トラックの音量コマンド禁止 / FM 使用時の `#OPM ON` 宣言)
- 詳細仕様: [`docs/specification/ui.md`](../../docs/specification/ui.md) の「Sample MML」セクション
