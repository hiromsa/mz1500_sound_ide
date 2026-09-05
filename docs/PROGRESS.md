# MZ-1500 Sound IDE 開発進捗記録 (`PROGRESS.md`)

本書は、MZ-1500 Sound IDE の実装進捗状況、完了した機能、および次期 ToDo を記録・管理するドキュメントです。エージェント開発ルール（[GEMINI.md](./GEMINI.md) / [AGENTS.md](./AGENTS.md)）に基づき、作業完了時に随時更新します。

---

## 1. 直近の完了作業（最新）
- **MMLエディタ 右クリックコンテキストメニュー & 各エディタ⇔MML連携の実装 ([`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/utils/mmlContextParser.ts`](./src/utils/mmlContextParser.ts), [`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx), [`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **Monaco右クリックコンテキストメニュー (計6アクション)**:
    - `📊 FM TONE (@) を編集...` / `📊 VOL ENV (@VE) を編集...` / `📈 PITCH ENV (@PE) を編集...`: 右クリックした行を解析し、記述済みの `@N` / `@FMN`、`@vN` / `@VEN`、`@PEN` を対応エディタで開く (右ペインタブ自動切替・非表示時は自動オープン)。
    - `✨ 新規 FM TONE / VOL ENV / PITCH ENV を作成...`: MML全文から既存IDを収集し、**最大ID+1の未使用ID**で各エディタを新規作成状態で開く。
    - 「編集...」系は対象IDが行に存在しない場合、安全ガードにより何もしない。
  - **MMLパーサーユーティリティの新設 (`src/utils/mmlContextParser.ts`)**:
    - `analyzeMmlLine` (1行解析) / `collectUsedIds` (全文ID収集) / `nextAvailableId` (未使用ID採番) をUIと切り離した純粋関数として分離 (高凝集・疎結合)。
    - コメント (`;` / `//`) 以降の除外、`@WN` / `@SW` / `@q` 等の他コマンドの音色ID誤検出防止を実装。
    - ロジック検証スクリプト [`scripts/verify-mml-parser.mjs`](./scripts/verify-mml-parser.mjs) (**全17ケース自動アサート、全パス**)。`node scripts/verify-mml-parser.mjs` で実行可能。
  - **各エディタに「▶ MMLに反映」ボタンを新設 (エディタ⇔MML双方向連携)**:
    - FM TONE: `@N /* 音色名 */ { ALG, FB, OP1〜OP4パラメータ }` 複数行ブロック / VOL ENV: `@vN = { |L, |R マーカー付き音量列 }` / PITCH ENV: `@PEN = { ... }` を、Monaco Editor のカーソル位置に挿入 (選択範囲があれば置換)。
    - 3エディタのMML生成ロジックを `generateMmlSnippet` に統一。FM TONE の「GENERATED FM TONE MML」プレビューも擬似表記から実コマンド形式 (`mml_reference.md` 準拠) に刷新。
    - エディタ側は `loadToneId` / `loadEnvId` props を監視し、右クリックメニュー指定IDをIDセレクタへ即時反映。
  - **App.tsx 連携ハンドラ**:
    - `handleRequestEdit*` / `handleRequestNew*` (6種) + `handleApplyToMml` を実装。`onEditorMount` による Monaco インスタンスの共有で右ペインからMMLへの挿入を実現。
  - **ビルド & ロジックテスト通過**:
    - `npm run build` エラーゼロ通過。`npm run lint` (oxlint) エラーゼロ。パーサーロジック全17テストパス。
    - 実機ブラウザでの右クリック操作・スニペット挿入のE2E確認は次セッションで実施推奨 (自動化MCP未接続環境のため)。

- **PLAYボタンのトグル停止化、`Ctrl + Enter` 再生ショートカット、無限ループ（`LOOP`）ON/OFFスイッチ、および下部エリア（PROBLEMS / CONSOLE）のタブ化 ([`src/App.tsx`](./src/App.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/CompileErrorPanel.tsx`](./src/components/CompileErrorPanel.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **PLAYボタンのトグル停止動作**:
    - 再生中（`PLAYING...` / `STOP / PLAYING`）にもう一度 PLAY ボタンを押すと停止するトグル動作を実装（`STOP` ボタンも引き続き配置）。
  - **`Ctrl + Enter` ショートカットキー**:
    - ウィンドウ全体および Monaco Editor 内の両方で `Ctrl + Enter`（Mac: `Cmd + Enter`）を押すことで、即座に再生/停止をトグル可能に実装。
  - **無限ループ（`LOOP`）ON/OFF トグルボタン**:
    - PLAY ボタンのすぐ左側に、Repeat アイコンと自照式 LED ランプ付きの `LOOP` トグルボタンを新設（デフォルト: **ON**）。
    - ビルドおよび再生ログに `Loop mode: ENABLED (L infinite loop)` / `DISABLED (Play once)` が明瞭に出力されるよう連動。
  - **下部エリア（PROBLEMS / CONSOLE）のタブ化統合**:
    - 従来上下2段に分割されていたコンパイルエラー（PROBLEMS）とシステムコンソール（CONSOLE）を、下部の共通タブバー（`[PROBLEMS (件数)]` / `[CONSOLE (行数)]`）によるタブ切り替え方式に統合。
    - 将来的に追加される別の作業エリア（逆アセンブラ、メモリマップ、波形プレビューなど）をスムーズに拡張できるスロット構造を確保。
    - 上部境界のスプリッターにより、下部エリア全体の高さをマウスドラッグで自在に上下伸縮可能（ダブルクリックで初期高さ 160px にリセット）。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて、PLAYトグル、LOOPボタン切替、`Ctrl+Enter` キーバインド、タブ切り替え（PROBLEMS ⇔ CONSOLE）、上下ドラッグリサイズがすべて正常動作することを確認。

- **トランスポート統合（PLAY/STOP/EXPORT .qdf）、右ペイン開閉ボタン移設、コンパイルエラーパネル新設 & 上下ドラッグリサイズの実装 ([`src/components/CompileErrorPanel.tsx`](./src/components/CompileErrorPanel.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **EXPORT ボタン表記の `.qdf` 化**:
    - 実機MZ-1500のQuickDisk形式に合わせて `EXPORT (.qdf)` に更新。クリック時にコンソールへ生成成功ログを出力。
  - **`F1: BUILD` 廃止 & `PLAY` ボタン統合**:
    - ヘッダーの単独 `F1: BUILD` を削除し、`PLAY` ボタンで「MMLコンパイル ➜ 再生開始」をワンクリックで実行可能に統合。
  - **`PLAY` / `STOP` ボタンのモック連動**:
    - 再生中（`PLAYING...` 自照式シアン発光）と停止（`STOPPED`）のステートを管理。
    - クリック時に SYSTEM CONSOLE へビルドログ・再生開始ログ・停止ログをリアルタイム出力。
  - **右ペイン開閉トグルボタンの移設**:
    - ヘッダー右端のボタンを撤去し、**MMLエディタタブバーの最右端（`ml-auto`）**に左右対称の開閉ボタン（`HIDE` / `PANE`）を配置。ワンクリックで右ペインの開閉が可能。
  - **コンパイルエラー（文法エラー・問題）パネルの新設 (`CompileErrorPanel.tsx`)**:
    - ご指定の「MMLエディタの下部(CONSOLE)の上かつEXPLORERの右側」に `PROBLEMS / COMPILE ERRORS` パネルを新設。
    - エラー数バッジ（`X Errors`, `Y Warnings`）、トラック名、行・列番号、エラーメッセージ、CLEARボタンを完備。
  - **エクスプローラー右側領域の3段上下ドラッグリサイズ**:
    - [Monaco MMLエディタ] ⇔ [コンパイルエラーパネル] ⇔ [システムコンソール] の間に水平スプリッターを導入。
    - マウスドラッグにより、エラーパネルおよびコンソールの高さを自在に上下伸縮可能（ダブルクリックで初期高さにリセット）。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて、PLAY/STOPによるログ出力とボタン発光、EXPORT (.qdf) 動作、エディタタブバー右端ボタンでの右ペイン開閉、スプリッターのマウスドラッグによる上下リサイズをすべて確認。

- **TRACK MONITOR の実機標準音源の `MZ-1500 BASICS` タイトル化 & 3サブカテゴリ（DCSG1 / DCSG2 / BEEP）整流化 ([`src/components/TrackMonitor.tsx`](./src/components/TrackMonitor.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **1パネル内でのサブカテゴリ構造化**:
    - 実機標準音源の左カラムタイトルを `MZ-1500 BASICS`（バッジ: `STANDARD 9ch`）へアップデート。
    - パネル全体の `ALL ON` / `MUTE` 一括操作ボタン（標準9ch全体を一括ON/MUTE）の操作性はそのまま維持。
    - パネル内部に、各音源チップ系統ごとの洗練されたサブカテゴリヘッダーを導入：
      - **`DCSG 1 (SN76489)`**: `P1`, `P2`, `P3` (PSG 1-3) ＋ `N1` (Noise 1)
      - **`DCSG 2 (SN76489)`**: `P4`, `P5`, `P6` (PSG 4-6) ＋ `N2` (Noise 2)
      - **`BEEP`**: `B1` (1-bit Pulse 8253 Timer)
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて `MZ-1500 BASICS` カラム内に `DCSG 1`、`DCSG 2`、`BEEP` が整然とカテゴリ分け表示され、ヘッダーの `ALL ON` / `MUTE` で全9chが一括操作できることを確認。

- **`SETTINGS` タブの将来バージョン実装予定（COMING SOON）への表示刷新 & `SONG SETUP` への誘導設置 ([`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **設定混同・誤解防止のUI改善**:
    - `SETTINGS` タブにダミー値が並ぶことによるユーザーの混乱（「ここで変更できるのか？曲設定とどう違うのか？」）を防止するため、タブ全体を「将来バージョンで実装予定（FUTURE FEATURE）」の案内パネルへ刷新。
  - **アンダーコンストラクション案内カード**:
    - 「アプリ環境設定は将来バージョンで実装予定です」のメッセージを表示。
    - 「楽曲に関する設定（#TITLE, #OPM, #OCTAVE 等）をお探しですか？」という誘導バナーおよび、ワンクリックで第5タブへ遷移する「`SONG SETUP を開く ➔`」ボタンを設置。
  - **ロードマップ表示 (PLANNED PREFERENCE MODULES)**:
    - 将来的に実装を計画しているIDE共通設定（`KEYBINDINGS & SHORTCUTS`, `THEMES & SYNTAX COLORS`, `AUDIO & MIDI HARDWARE ROUTING`）を控えめな `COMING SOON` スタイルで提示。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザにて `SETTINGS` タブを表示し、将来実装予定の案内および「`SONG SETUP を開く ➔`」クリックで `SONG SETUP` タブに即座に遷移することを確認。

- **楽曲専用設定パネル `SONG SETUP` の新設 & MMLディレクティブ双方向同期 & `SETTINGS` の環境設定分離 ([`src/components/SongSetupPanel.tsx`](./src/components/SongSetupPanel.tsx), [`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **`SONG SETUP` タブの新設 (RightTab 第5タブ)**:
    - 楽曲（MML）に紐づくヘッダー情報・コンパイルディレクティブを設定する専用パネル [`SongSetupPanel.tsx`](./src/components/SongSetupPanel.tsx) を新規作成。
    - **Bento Card 1: 楽曲メタデータ (`#TITLE` / `#COMPOSER`)**: タイトルや作曲者名を入力・編集し、MMLヘッダーと即座に同期。
    - **Bento Card 2: 楽曲別音源構成 (`#OPM ON / OFF`)**: この楽曲で拡張FM音源ボード（ACZ-8BS1MZ 8ch）を使用するかを自照式トグルスイッチで設定。ONにすると MML に `#OPM ON`、OFFで `#OPM OFF` が自動反映。トラックモニターや TONE タブの有効/無効とも完全連動。
    - **Bento Card 3: MML記法・方言ディレクティブ (`#OCTAVE`)**: オクターブ記号（`<` `>`）の動作規則を「NORMAL（デフォルト: `<` 下げる, `>` 上げる）」または「REVERSE（逆向き: `<` 上げる, `>` 下げる）」から選択し、MMLヘッダーの `#OCTAVE NORMAL / REVERSE` と双方向連動。
    - **Bento Card 4: リアルタイム同期プレビュー**: 現在設定されている全ディレクティブをコードカードでライブ表示。
  - **MMLエディタとGUIパネルのリアルタイム双方向完全同期 (Single Source of Truth)**:
    - パネル側でタイトル変更、トグル切替、オクターブ選択を行った際は即座にアクティブMMLファイル内の `#` ディレクティブ行へ反映（未記述の場合はヘッダー部に自動挿入）。
    - 逆にユーザーが MML エディタ上で直接 `#TITLE`、`#COMPOSER`、`#OPM`、`#OCTAVE` をタイピング編集した場合も、SONG SETUP パネル側の各フィールド・スイッチ状態が自動追従。
  - **`SETTINGS` タブの役割整理・リファクタリング**:
    - 楽曲依存の設定を `SONG SETUP` へ移管したことで、`SETTINGS` タブ（第6タブ）は純粋な「アプリケーション自体の環境設定（エディタフォントサイズ、オーディオプレビューエンジン、ターゲットマシン仕様）」として役割を明確化。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザにて `SONG SETUP` タブを開き、タイトル変更・#OPMトグル・#OCTAVE切り替えを行い、左側 MML エディタのテキストがリアルタイムに更新されることを確認。また `SETTINGS` パネルへの切り替えも正常動作を確認。

- **FM音源 `#OPM ON/OFF` ディレクティブの連動 & TONEエディタのホイール誤動作防止 ([`src/App.tsx`](./src/App.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx), [`docs/specification/mml_reference.md`](./docs/specification/mml_reference.md), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **TONEエディタのスピン入力ホイール誤操作防止**:
    - エディタ全体をマウスホイールでスクロールする際、カーソルが数値ボックス（`AR` や `D1R` 等）の上を通るとスクロールが阻害されて値が勝手に増減してしまう不具合を解消。`SpinInput` から `onWheel` リスナーを削除し、スムーズな画面スクロールと上下ボタン/直接入力による確実な編集操作を両立。
  - **FM音源オプションのデフォルトOFF化**:
    - MZ-1500 実機標準構成（DCSG & BEEP 9ch）に合わせて、拡張ボード ACZ-8BS1MZ（YM2151）の初期ステートを `OFF`（無効）に設定。
  - **SETTINGS スイッチと MML `#OPM ON / OFF` ディレクティブの完全双方向連動**:
    - SETTINGS パネルでスイッチを `ON` にすると、MMLエディタ内のアクティブファイルに `#OPM ON` が自動追記（既存ディレクティブ行があれば置換）。
    - スイッチを `OFF` にすると、MML内のディレクティブが `#OPM OFF` に自動更新。
    - 逆にユーザーが MML エディタ上で直接 `#OPM ON` / `#OPM OFF`（または `#FM ON` / `#FM OFF`）を記述・編集した場合も、SETTINGS のスイッチ状態がリアルタイムに自動追従。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて、SETTINGS パネルでのスイッチ切り替えに応じて `main.mml` 内の `#OPM ON` ➜ `#OPM OFF` が自動反映されること、および TONE エディタの AR 入力欄上でホイールしても値が勝手に変化しないことを完全確認。

- **MML言語仕様書 (`docs/specification/mml_reference.md`) の策定 & ピッチエンベロープ `@PE` 記法統一 ([`docs/specification/mml_reference.md`](./docs/specification/mml_reference.md), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx))**:
  - **MML言語仕様の体系化 & ジャンル別リファレンス**:
    - 全コマンドを「基本・音符・休符」「オクターブ・移調」「テンポ・演奏速度」「音量・ボリュームエンベロープ」「ピッチ・効果音」「音色・ノイズ・FM制御」「フロー制御・ループ」の7ジャンルに整理。
    - 全コマンドに**英語名（由来・覚え方）**を併記（例: `q`: Quantize, `@q`: Quick Cut, `@WN`: Waveform Noise, `@IN`: Interlock Noise, `@PE`: Pitch Envelope, `K`: Key Transpose 等）。
  - **音源チップ別対応機能マトリクス (Chip Capability Matrix)**:
    - YM2151 (FM 8ch), DCSG 矩形波 (P1〜P6), DCSG ノイズ (N1, N2), BEEP (B1) ごとの対応コマンド・制約を網羅。
    - BEEP の音量指定不可（1bitパルスのみ）、DCSGノイズの周期/ホワイト切替（`@WN`）、矩形波連動（`@IN`）等を明確化。
  - **方言切り替えディレクティブ (`#OCTAVE NORMAL / REVERSE`)**:
    - オクターブ記号（`<` `>`）の増減方向切り替えディレクティブを定義。
  - **エンベロープ・音色マクロ記法の統一**:
    - ピッチエンベロープ: **`@PE`**（定義: `@PE1 = { ... }`, 適用: `@PE1`, 解除: `@PE` または `@PE0`）。`PitchEnvelopeEditor.tsx` のMML出力・IDセレクタも `@PE` に完全連動。
    - 音量エンベロープ: **`@v` / `@VE`**（両対応）。
    - FM音色マクロ: **`@` / `@FM`**（両対応）。
  - **ビルド通過**: `npm run build` エラーゼロ通過。

- **VOL ENV ホバー＆マウスホイール時のバー上部数値バッジ表示不具合の修正 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**:
  - **バー頭上バッジの表示対象の修正**:
    - バー上部に表示されるピルバッジがマウスカーソルのY軸位置（`hoveredPos.vol`）を参照していたため、バー本体の音量値と乖離していた不具合を修正。該当ステップの現在の音量値（`vol`）をダイレクトに表示するよう変更。
    - マウスホイールによる値の増減時、ドラッグ描画時、ホバー時のいずれにおいても、バーの高さ（現在の音量値）とバー上部バッジの数値が完全に同期。
  - **ゴーストプレビューバーの整理**:
    - ホイール操作中やホバー中にカーソル位置に重なって表示されていた半透明のゴーストプレビュー矩形を削除し、実際の音量バーと数値バッジのみがすっきりと美しく連動するプロDAW表示へ最適化。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にてバー上でマウスホイールを上下操作し、頭上の数値バッジが 15 ➜ 14 ➜ 13 と正確に同期して変化することを確認。

- **VOL ENV & PITCH ENV のバー上マウスホイールによる1ステップ単位の数値変更操作の実装 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx))**:
  - **バー上でのマウスホイール上下連動**:
    - VOL ENV および PITCH ENV のバーグラフ領域にマウスカーソルを合わせた状態でマウスホイールをスクロールした際、**カーソル位置のステップの値が 1 ずつ上下にダイレクトに変化**する直感操作を実装。
    - ホイール上（`deltaY < 0`）: +1 増加（VOL: 最大15、PITCH: 最大+RANGE でクランプ）。
    - ホイール下（`deltaY > 0`）: -1 減少（VOL: 最小0、PITCH: 最小-RANGE でクランプ）。
    - ホバー情報（`hoveredPos`）およびツールチップ、下部MMLテキスト出力もリアルタイムに完全同期。
  - **Ctrl+ホイール（タイムラインズーム）との安全な共存**:
    - `Ctrl` キー押下中はタイムライン拡縮ズーム（60%〜350%）、通常ホイール時はバーの数値増減として明確に分離・共存。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にて VOL ENV の音量バーおよび PITCH ENV のビブラート波形バー上でマウスホイールを上下し、対象ステップの数値が +1 / -1 ずつ正確に増減することを確認。

- **VOL ENV & PITCH ENV の値シフト機能（上下左右 SHIFT: [←][→][↑][↓]）の実装 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx))**:
  - **タイムライン左右シフト (Frame Shift)**:
    - `右シフト [→]`: タイムラインを1フレーム右へシフト。一番左（Step 0）の値が複製されて先頭に挿入され、末尾の値は押し出される（長尺維持）。
    - `左シフト [←]`: タイムラインを1フレーム左へシフト。一番右の末尾の値が複製されて末尾に挿入され、先頭の値は押し出される（長尺維持）。
  - **値レベル上下シフト (Value Level Shift)**:
    - `上シフト [↑]`: 全ステップの値を +1 加算（VOL: 最大15クランプ、PITCH: 最大+RANGEクランプ）。
    - `下シフト [↓]`: 全ステップの値を -1 減算（VOL: 最小0クランプ、PITCH: 最小-RANGEクランプ）。
  - **洗練されたDAWツールUI**:
    - 各エディタのツールバーに `SHIFT:` ボタングループ（`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`）を配置。ワンクリックで直感的に波形位置や音量・ピッチの全体オフセットを調整可能。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にて VOL ENV および PITCH ENV の左右・上下シフトが正確に動作し、生成MMLとグラフがリアルタイムに更新されることを確認。

- **TONEエディタの複数選択時・直接数値入力（絶対値一括指定）と相対同期編集のハイブリッド実装 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **直接数値入力時の絶対値一括反映 (Absolute Mode)**:
    - 複数OPを選択中に、いずれかのOPの数値テキストボックスへ直接数値をタイピング入力した場合（またはセレクトボックスで選択した場合）、**入力した値そのものが選択中の全OPへ一括適用**されるよう実装。一括で同じ値（AR: 31等）に揃えたい操作にダイレクトに対応。
  - **上下ボタン・ホイール・グラフドラッグ時の相対差分反映 (Relative Mode)**:
    - スピンボタン（`▲` / `▼`）やマウスホイール、Canvasグラフのドラッグ、TLスライダー操作時は、**操作元OPの変化差分（delta）を各選択OPへ相対的に加算・反映**（min〜maxの許容範囲でクランプ）。
  - **UIガイドテキストの更新**:
    - コントロールバーの案内を「`※数値直接入力: その値に一括変化 / 上下ボタン・グラフドラッグ: 相対変化`」へ更新。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にて直接数値入力時の絶対値反映および上下ボタン時の相対変化を完全確認。

- **TONEエディタのOP選択解除の操作性改善 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **Shift/Ctrlキーなしでの選択解除に対応**:
    - 通常クリック時、すでに選択されているOPカード（`[SELECTED]` ボタンまたは余白）をクリックした場合に選択が解除（トグルオフ）されるよう修正。
    - 未選択OPをクリックした際は従来通りそのOPのみを選択。
    - ガイドテキストおよびツールチップを「クリック: 選択/解除 / Shift・Ctrl + クリック: 複数選択」へ更新。

- **PITCH ENV（ピッチエンベロープエディタ）の新規実装 ([`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx), [`src/App.tsx`](./src/App.tsx))**:
  - **Bento Grid & Linear Style DAW UIの適用**:
    - `VolEnvelopeEditor` の洗練された操作体系・設計を踏襲しつつ、ピッチ変調に特化したUIを完全新規構築。
  - **センターゼロ基準の双極性バーグラフ (Bipolar Bar Graph)**:
    - 中央「0」に破線基準ラインを配置。プラス方向のピッチ変化（音高上昇）はQDシアン（`cyan-400`）、マイナス方向のピッチ変化（音高下降）はアンバー（`amber-400`）で上下に伸びる双極バーを描画。
  - **用途に応じたダイナミックレンジ切替 (RANGE)**:
    - `±7` (微小デチューン・浅いビブラート)
    - `±15` (標準ビブラート・効果音)
    - `±24` (2オクターブ・ポルタメント)
    - `±48` (ワイドピッチベンド・急降下/急上昇)
    - レンジ切替時も既存データを自動クランプしてシームレスに編集可能。
  - **ビブラート特化プリセット & 編集ツール (TOOLS)**:
    - プリセット: `VIBRATO (MILD)`, `VIBRATO (DEEP)`, `DELAYED VIB`, `PITCH DROP`, `PITCH UP`, `FAST TRILL` を搭載。
    - ツール: `GEN VIB ~` (正弦波ビブラート自動生成)、`INVERT ⇅` (正負反転)、`FLIP ⇄` (左右反転)、`SMOOTH` (スムージング)、`CENTER 0` (0リセット)。
  - **プロDAW操作性**:
    - スペースキードラッグスクロール（パン）、Ctrl+ホイールズーム、線形補間（Interpolation）ドラッグ描画。
    - ループ（`|L`）/ リリース（`|R`）直接指定マーカーレーンおよび上部リージョンブラケット。
  - **Web Audio リアルタイム試聴 (TEST TONE)**:
    - 1フレーム（1/60秒）単位で発音ピッチをリアルタイム変調（デチューンセント）し、ビブラートやピッチベンドの効果を直接耳で確認可能。
  - **MMLテキストリアルタイム出力 & コピー**:
    - `@p1 = { |L, 0, 3, 6, 8, ... }` 形式でリアルタイム生成・クリップボードコピー。
  - **ビルド・実機表示・Web Audio・スクリーンショット検証完了**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にてOP選択解除、PITCH ENVの全ツール・レンジ切替・ビブラート波形描画・試聴トランスポートの完全動作を確認。

- **全画面アイコンの幾何学的フラットデザイン（Lucide Icons）への完全統一**:
  - **インラインSVGおよび文字・絵文字アイコンの全廃**:
    - 全画面（ヘッダー、エクスプローラー、MMLエディタ、システムコンソール、トラックモニター、FMトーンエディタ、ボリュームエンベロープエディタ、設定パネル）のアイコンを `lucide-react` のソリッドカラー・幾何学的フラットアイコンへ統一。
  - **各領域での統一アイコン**:
    - **Header**: `Zap` (F1:BUILD), `Play` (PLAY), `Square` (STOP), `Download` (EXPORT), `PanelRightClose`/`PanelRightOpen` (HIDE/SHOW PANE)
    - **File Explorer**: `Folder`, `FolderOpen`, `FileCode`, `ChevronRight`/`ChevronDown`, `FilePlus` (+MML), `FolderPlus` (+Folder), `Pencil` (Rename), `Trash2` (Delete), `FolderOpen` (Open Folder)
    - **MML Editor & Console**: `PanelLeftClose`/`PanelLeftOpen` (Explorer Toggle), `FileCode` (Tab), `X` (Close), `Plus` (New Tab), `Terminal` (System Console)
    - **Right Pane Tabs**: `Sliders` (Track Monitor), `AudioWaveform` (YM2151 Tone), `TrendingUp` (Vol Env), `LineChart` (Pitch Env), `Settings` (Settings)
    - **Track Monitor**: `Volume2` / `VolumeX` (Preview Toggle)
    - **FM Tone Editor**: `AudioWaveform` (Header), `ChevronUp`/`ChevronDown` (SpinInput), `Play` (Test Note), `Square` (Stop), `Copy` (Copy OP / MML), `ClipboardPaste` (Paste OP)
    - **Vol Envelope Editor**: `Play` (Key On), `Square` (Key Off / Stop), `X` (Clear L/R), `TrendingUp` (Ramp Up), `TrendingDown` (Ramp Down), `FlipHorizontal` (Flip), `ArrowUpDown` (Invert), `Trash2` (Clear), `Copy` (Copy MML)
    - **Settings**: `Settings` (Header), `Cpu` (Hardware Options), `HardDrive` (Target Spec)
  - **ビルド & 実機動作検証完了**:
    - `npm run build` エラーゼロ通過。全画面（TRACK MONITOR, TONE, VOL ENV, SETTINGS）のスクリーンショットを撮影し、ソリッドかつ統一されたモダンDAWルックを確認。

- **SETTINGS（システム設定パネル）のプロDAWライク・デザイン刷新 ([`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx))**:
  - **シアン装飾の完全排除 & 静的テキストの落ち着いたグレー/白化**:
    - 見出しの歯車アイコン（`text-zinc-400`）および四角いドット装飾（`text-zinc-500`）からシアンを排除し、シルバー/グレーへ変更。
    - チャンネル一覧（`F1, F2...`）やターゲットフォーマット（`MZT`）のシアンテキストをライトグレー/白（`text-zinc-200` / `text-zinc-100`）へ統一。
  - **Bento Card 枠線の統一**:
    - YM2151カードのシアン枠線を廃止し、標準音源やビルド設定カードと同じ 1px のダークグレーボーダー（`border-[#3C3C3C]`、背景 `#2D2D2D`）へ完全統一。
  - **ミニマルなピルバッジ化**:
    - `INSTALLED`, `NOT INSTALLED`, `STANDARD`, `HARDWARE` バッジを、色付き枠線から落ち着いたグレー背景＋白文字のミニマルなピルバッジ（`rounded-full bg-[#3A3A3A] text-zinc-200` 等）へ変更。
  - **アクティブ要素（ONトグルスイッチ）のみクリアブルーで際立たせ**:
    - 「ON」状態のトグルスイッチのみ、鮮やかなクリアブルー（`#00A8FF`）とグローを採用し、操作可能・アクティブな要素としての視覚的ヒエラルキーを明確化。
  - **ビルド・実機表示・トグル動作の自動検証完了**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザで ON / OFF の各状態のスクリーンショットを撮影・表示確認済み。

- **VOL ENV（ボリュームエンベロープエディタ）のプロDAWライク・デザイン刷新 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**:
  - **Bento Grid & Linear Style の完全適用**:
    - 古いslate系カラーや粗いスリットパターン、過度なネオン装飾を全廃し、マットダークサーフェス（`#090a0f` / `#12131a`）と極細境界線（`border-white/[0.08]`）で整理された4つのBento Card構成へ再設計。
  - **DAW風ループ＆リリース・リージョン可視化 (Loop & Release Region Brackets)**:
    - `|L` から `|R` までのループ区間を薄いシアンの透過帯（`bg-cyan-500/[0.03]`）と上部 `LOOP` ブラケットで表示し、再生時にどこが循環するかが一目瞭然。
    - `|R` 以降のリリース区間を薄いレッドの透過帯（`bg-red-500/[0.03]`）と上部 `RELEASE` ブラケットで表示。
  - **プロDAW波形クイック編集ツール (TOOLS) の搭載**:
    - `RAMP ↗`（0→15 リニア上昇スロープ自動生成）
    - `RAMP ↘`（15→0 リニア下降スロープ自動生成）
    - `FLIP ⇄`（タイムライン左右反転）
    - `INVERT ⇅`（音量上下反転: `15 - vol`）
    - `CLEAR`（全ステップ消音クリア）
    - ボタン操作と同時に波形および生成MMLテキストが即座に同期更新。
  - **洗練されたプロDAWバーグラフ**:
    - スリット線を排し、エッジが上品に発色するモダン角丸バー（通常スレート、ループ区間シアン、リリース区間レッド、再生中シアン発光）。
  - **ビルド・実機表示・ツール動作の自動検証完了**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザで初期画面、`RAMP ↗` 実行後、`FLIP ⇄` 実行後のスクリーンショットを撮影・検証済み。


- **ボリュームエンベロープエディタの当たり判定・ドラッグ描画の改善・バグ修正 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**:
  - **列ピッチ計算の厳密化によるステップずれ解消**:
    - 旧実装では各列の幅と間隔ギャップ（`stepWidth + 4px`）を考慮せずコンテナ幅の単純等分でステップを計算していたため、カーソル位置と実際の更新対象バーが 1〜数ステップずれていた不具合を根本解消。
  - **Y軸の均等16等分スロット化**:
    - 上下パディングを除いた高さを 0〜15（16段階）で完全等分割し、VOL 0 と VOL 15 も中央の値と同じ快適な高さで狙えるように改善。
  - **素早いドラッグ時の線形補間（Interpolation）**:
    - マウスを素早く滑らせて描画した際の中間ステップ抜け（虫食い）を防止し、前回の位置から今回の位置まで自動で線形補間して一筆書きで綺麗なカーブを描画可能に。
  - **Pointer Events & 遅延ゼロ化**:
    - `setPointerCapture` による枠外追従と、描画バーの不要なCSS遅延アニメーション（`transition-all duration-75`）を撤廃し、マウス操作に完全に同期したダイレクトなレスポンスを実現。
- **YM2151 トーンエディタのエンベロープグラフ・ドラッグ操作の改善・バグ修正 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **ドラッグ操作追従の根本修正（Pointer Events & 累積変位方式）**:
    - 旧実装では毎イベントごとに微小差分（`dx`）を計算していたため、古いクロージャ変数との比較で値が `+1 / -1` を往復してブルブル震えて実際の値が変化しない現象が発生していた問題を解消。
    - ドラッグ開始時の基準位置とパラメータ初期値を Ref で保持し、開始地点からの累積移動量から滑らかに絶対値を再計算する方式へ刷新。
    - `setPointerCapture` による Pointer Events（`onPointerDown` / `onPointerMove` / `onPointerUp`）を採用し、マウスがキャンバス枠外へ移動しても途切れることなくドラッグを継続可能。
    - キャンバス上の当たり判定を半径18pxへ微拡大し、ドラッグ中もノードの選択グロー・カーソル形状を安定維持。
- **システムコンソールの移設 ([`src/App.tsx`](./src/App.tsx))**:
  - 右ペイン下部から「MMLエディタ下部（中央ペイン）」へ移設。右ペインの作業スペースを最大化。
- **右ペイン開閉トグルボタン ([`src/App.tsx`](./src/App.tsx))**:
  - ヘッダー右上に `[HIDE PANE] / [SHOW PANE]` ボタンを設置。ワンクリックで右ペインを非表示にしてMMLエディタ＋コンソールを画面全体の100%全幅に展開可能。直前の比率でスムーズに復帰。
- **右ペインタブの直感的SVGアイコン追加 ([`src/App.tsx`](./src/App.tsx))**:
  - 各タブタイトルの左側に専用のSVGアイコンを配置（`📊 TRACK MONITOR`, `∿ YM2151 TONE`, `📈 VOL ENV`, `↗ PITCH ENV`, `⚙ SETTINGS`）。
- **YM2151 トーンエディタの操作性・UI改善 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **数値入力エリアのサイズ拡大 & カスタム上下スピンボタン (`▲` `▼`) の実装**:
    - `MUL`, `DT1`, `DT2`: 高さを 28px（`h-7`）、フォントを `text-xs font-bold`（太字）に拡大し、ドロップダウンがクリックしやすく現在の値が一目でわかるように改善。
    - `AR`, `D1R`, `D1L`, `D2R`, `RR`: ブラウザ標準の極小矢印を廃止し、幅20pxの押しやすい独立上下ボタン（`SpinInput` コンポーネント）を搭載。マウスでのクリック連打が快適に行え、さらに**マウスホイール上下スクロールでの増減**にも対応。
    - `TL` (Total Level): スライダーの高さを 1.5 に微拡大し、操作しやすく調整。
  - **接続ルート表示 (`SIGNAL ROUTE`) の静的インフォメーション化**:
    - ボタンのように見えて誤操作を誘発しないよう、独立した囲み枠やボタン風バッジを撤去し、落ち着いたフラットなテキストインフォメーション表示に変更。
  - **OPセクション間の重なり矢印オーバーレイの削除**:
    - 画面の煩雑さを解消するため、2×2パネル間の重なり配線矢印オーバーレイを撤去し、クリーンなUIに刷新。
  - **エンベロープグラフのグラデーション廃止 & QDブルー統一**:
    - 余計な塗りを排し、スライダー等と統一感のあるソリッドなQDブルー（`#06b6d4`）の折れ線のみを描画。
  - **ドラッグノード（〇）のサイズ拡大 & QDブルー＋白枠**:
    - 直径11px〜13px（`r=5.5〜6.5`）に拡大し、QDブルー塗りつぶし＋純白の輪郭線でダーク背景でも視認性を大幅向上。
  - **ピクセルベースの当たり判定改善**:
    - アスペクト比に依存しないピクセル距離（半径16px）を導入し、「掴みにくい・反応が悪い」問題を根本解決。
  - **操作方向に応じた動的マウスカーソル表現**:
    - `AR`（アタックレート）: 左右時間のみ変更可能 ➜ `ew-resize`（`↔`）
    - `D1`（ディケイ1変曲点）: 左右時間＋上下サステインレベル変更可能 ➜ `move`（全方位十字）
    - `D2`（ディケイ2終了点）: 上下減衰深度のみ変更可能 ➜ `ns-resize`（`↕`）
    - `RR`（リリースレート）: 左右時間のみ変更可能 ➜ `ew-resize`（`↔`）

---

## 2. これまでに完了した機能一覧
1. **プロジェクト初期化 & 技術スタック選定**
   - Vite + React (TypeScript) + Tailwind CSS + Monaco Editor
   - Webネイティブ技術完結（C#/.NET WASM不使用）
   - MZ-1500実機リスペクト（チャコールブラック、QDブルー、MZレッド、QD方眼グリッド）
2. **基本レイアウト & ペインスプリッター**
   - ヘッダー（QD方眼グリッド、MZ自照式ロゴ、F1:BUILD、PLAY、STOP、EXPORT、右ペイン開閉トグル）
   - 左ペイン（中央ペイン）: MMLエディタ ＋ システムコンソール
   - スプリッターバー（可変幅 20%〜80%、ダブルクリックで50:50リセット、ドラッグ全画面オーバーレイ）
   - 右ペイン（タブ切り替え式）
3. **MMLエディタ & ファイルエクスプローラー ([`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/FileExplorer.tsx`](./src/components/FileExplorer.tsx))**
   - Monaco Editor 組み込み（カスタムダークテーマ、行ハイライト、ズーム対応）
   - 複数タブ管理（開く、閉じる、新規作成、切り替え）
   - エクスプローラー開閉トグル（`📁◀` / `📁▶`）
   - サンプルMML（デモ・テンプレート）、ローカルフォルダファイル操作（新規作成、リネーム、削除）
   - エクスプローラースプリッター（140px〜460pxリサイズ、ダブルクリックで240px復帰）
4. **トラックモニター ([`src/components/TrackMonitor.tsx`](./src/components/TrackMonitor.tsx))**
   - 全17ch構成（DCSG×2 8ch + BEEP 1ch [左カラム] / 拡張FM ACZ-8BS1MZ 8ch [右カラム]）
   - 自照式スピーカーボタン（各ch発音/消音プレビュートグル）
   - 音源系統別 `ALL ON` / `MUTE` 一括ボタン
   - シックなスレートグレーバッジによる統一デザイン
5. **システム設定パネル ([`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx))**
   - 拡張FM音源ボード「ACZ-8BS1MZ (YM2151 / OPM)」（開発: ぽよこまだんな 氏 / [@poyokoma_danna](https://x.com/poyokoma_danna)）オプション切替トグル
   - ボード搭載（ON）/非搭載（OFF）の画面連動（OFF時は実機標準の9ch表示・FMタブ無効化案内）
6. **ボリュームエンベロープエディタ ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**
   - DCSG向けの1フレーム（1/60秒）単位の音量シーケンスエディタGUI（音量0〜15）
   - 可変長ステップ（デフォルト32F / 2〜128F可変、長尺時自動スクロール）
   - マーカーレーンによるループポイント (`|L`) / リリースポイント (`|R`) の直接ワンクリック指定
   - タイムライン縦横同時ズーム（Ctrl+ホイール / ツールバー操作で60%〜350%拡大縮小）
   - スペースキードラッグスクロール（ハンドツール / パン）
   - Web Audio プレビュー試聴（`▶ KEY ON` ループ再生 / `■ KEY OFF` リリース減衰）
   - MMLテキストリアルタイム生成＆ワンクリックコピー
7. **YM2151 (OPM) FM 音色エディタ ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**
   - ヤマハ公式・OPM仕様準拠のALG 0〜7接続ブロック図（白塗りキャリア、OP1自己フィードバック線）
   - 全8アルゴリズムの横1列レスポンシブ収まり
   - 4-OP 2×2固定グリッド配置
   - シグナルルート表示（`SIGNAL ROUTE`）
   - 各OPのI/Oストリップ（`IN:` / `OUT:`）
   - 自照式 Mute (`M`) / Solo (`S`) トグル、パラメータ一括 Copy / Paste
   - 出力＆ピッチパラメータ（TLスライダー、MUL/DT1/DT2セレクトボックス拡大）
   - インタラクティブCanvasエンベロープ（ソリッドQDブルー線、拡大ノード、ピクセル当たり判定、操作方向別カーソル）
   - 押しやすいカスタム上下ボタン付きスピン入力（`SpinInput`、ホイール対応）
   - Web Audio 4-Op FM 合成プレビュー試聴（`▶ TEST NOTE`）
   - 音色プリセット（`E.PIANO 1`, `SLAP BASS`, `BRASS ENSEMBLE`, `CRYSTAL BELL`）
   - MML音色定義リアルタイム出力＆コピー
8. **ボリュームエンベロープエディタ リリース区間配色の最適化 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**
   - 眩しく刺激が強かった蛍光レッド（`red-500` 系）を撤廃。
   - プロDAW（Serum, Vital等）のモダン配色セオリーに基づき、目に優しく温かみのある**アンバー（琥珀色・ウォームオレンジ/ゴールド系: `amber-500` / `amber-600` / `amber-700`）**に全面トーンダウン。
   - 上部ブラケット、Rマーカーボタン、タイムライン背景透過帯、ステップバー、音量フレーム数値ラベルまで統一調整し、QDシアン（ループ区間）との美しいコントラストと長時間の作業視認性を両立。
9. **ボリュームエンベロープエディタ 水平スクロールパン（ドラッグ操作）の刷新 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**
   - 画面外への沈み込みや迷子を完全防止するため、DAW標準の**水平スクロール（`scrollLeft`）方式**に全面刷新。
   - 上下方向（Y軸）のブレや沈み込みを完全に排除し、常にコンテナ上端に整然と配置（`overflow-y-hidden`）。
   - スペースキー＋ドラッグでスムーズに左右にスクロール可能とし、スクロールバーによる可視化と境界制御により画面外へ消える問題を根本解決。
   - ズームパーセンテージボタン（`350%` 等）や `SPACE: PAN` ボタンのクリック、またはダブルクリックで瞬時に `100%` & スクロール先頭（`0`）へ完全復帰。
10. **YM2151 FM 音色エディタ マルチOP複数選択＆一括連動編集 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**
    - 各OPカードの空き領域（背景・余白）や `[SELECT]` ボタンをクリックして複数オペレータを直感的に選択可能。
    - 選択中カードをシアン枠＋ネオングロー（`border-cyan-400 ring-1 ring-cyan-400/50`）と `[SELECTED]` バッジで強調。
    - 2×2グリッド上部に `MULTI-OP EDIT` バーを配置し、連動状況インジケータ（`x OPs SELECTED (LINKED)`）および `SELECT ALL` / `CLEAR` 一括ボタンを搭載。
    - 複数選択中にいずれかのOPの数値（スピンボタン、スライダー、セレクトボックス）やエンベロープCanvasノードを変更すると、**変更された該当パラメータのみが選択中の全OPへスマートに同期反映**され、各OP固有のTL等は安全に保持。
11. **UIレイアウト改善 & システムコンソール移設 ([`src/App.tsx`](./src/App.tsx))**
    - システムコンソールの中央ペイン下部移設
    - 右ペイン開閉ボタン（`[HIDE PANE] / [SHOW PANE]`）
    - 右ペインタブアイコン追加
12. **ドキュメント整備**
    - UI仕様書 [`docs/specification/ui.md`](./docs/specification/ui.md) 作成・継続更新
    - ルール定義 [`GEMINI.md`](./GEMINI.md), [`AGENTS.md`](./AGENTS.md) 作成
    - 進捗管理 [`PROGRESS.md`](./PROGRESS.md) 作成・継続更新

---

## 3. 次回・未着手の作業候補 (ToDo)
- [x] **システムコンソールのMMLエディタ下部移設 & 右ペイン開閉ボタン** (完了)
- [x] **右ペインタブの直感的アイコン追加** (完了)
- [x] **YM2151 音色エディタのエンベロープグラフ改善** (完了: グラデーション廃止、QDブルー統一、ノード拡大、判定改善、カーソル対応、OP間配線矢印削除)
- [x] **接続ルート表示 (`SIGNAL ROUTE`) の静的インフォメーション化** (完了: 誤操作防止のフラットテキスト表示)
- [x] **数値入力エリアのサイズ拡大 & カスタム上下スピンボタン (`▲` `▼`) の実装** (完了: MUL/DT1/DT2拡大、AR〜RRの独立上下ボタン・ホイール対応)
- [x] **ピッチエンベロープエディタ (`PITCH ENV`) のUI実装** (完了: 双極性バーグラフ、ダイナミックレンジ±7〜±48切替、ビブラートプリセット＆生成ツール、Web Audio試聴、MML出力)
- [ ] **システムコンソールの機能拡張**
  - ログ出力、MMLビルドエラーの詳細表示、折りたたみ・リサイズ
