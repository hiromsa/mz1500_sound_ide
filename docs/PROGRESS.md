# MZ-1500 Sound IDE 開発進捗記録 (`PROGRESS.md`)

本書は、MZ-1500 Sound IDE の現在進行中のタスク、残タスク（ToDo）、および直近の完了作業を記録・管理するドキュメントです。
※ 過去の膨大な完了作業ログ（モック期、Webコア移植期、初期UI設計等の詳細履歴）は [PROGRESS_HISTORY.md](./PROGRESS_HISTORY.md) にアーカイブされています。

---

## 1. 現在のステータス概要
- **バージョン**: `v0.0.1-beta.72`（コミット通番＋短縮ハッシュ ハイブリッド方式）
- **テスト通過状況**: 全 31 テストファイル / 429 件パス（`npm test` / Vitest）
- **型検査状況**: エラー 0 件（`npx tsc -b`）
- **主要機能の稼働状況**:
  - Web ネイティブ MML コンパイラ（9ch / 17ch / ワークトラック W1〜W99 対応）
  - 内製 TypeScript Z80 CPU エミュレーションコア & Z80 サウンドドライバ実行環境
  - DCSG (SN76489) / OPM (YM2151) / 8253 BEEP 音源エミュレーション & Web Audio 再生
  - QuickDisk イメージ (`.qdf`) 実機演奏プレイヤー内包エクスポート
  - MIDI ROUTING STUDIO (SMF プレビュー & MML 変換 & 和音自動ボイス分離)
  - MML TRANSFORM (半音・オクターブ移調 & 音量スケーリング & チャンネル置換)
  - ローカルフォルダオープン (`OPEN LOCAL FOLDER...`) & IndexedDB / localStorage 自動永続化・次回アクセス時完全復元

---

## 2. 残タスク・今後の ToDo 一覧 (Pending Tasks)

### 優先度: 高 (High Priority)
- [ ] **実機 / エミュレータでの試聴・起動確認**
  - 生成された QuickDisk イメージ (`.qdf`) の実機および各種エミュレータでの動作・演奏確認。
  - 実機環境での AudioWorklet / Web Audio 再生挙動のクロスチェック。

### 優先度: 中 (Medium Priority)
- [ ] **和音（Poly）トラックの複数独立スプリット管理 (別AIへの引継ぎタスク)**
  - 現状の `MidiRouterModal` は単一の `splitTargets: { [voice: number]: string }` を共有しているため、複数和音トラック存在時にスプリット先が同一になる。
  - `WorkTrack` 内部にトラック固有の `splitTargets`（または個別ボイスアサインマップ）を内包化し、トラックごとに独立したスプリット先へ振り分けられるよう内部データ構造を拡張する。
- [ ] **MML エディタへの専用コード補完プロバイダー実装 (辞書ベース)**
  - 不自然な候補の原因だった Monaco 既定ワードベースサジェストは無効化済み (`MmlEditor.tsx` の `options.wordBasedSuggestions: 'off'`)。ただし現状 Ctrl+Space でも何も候補が出ない状態。
  - **実装方針 (2026-09-07 調査・確定済み)**:
    1. `src/utils/mmlCompletion.ts` (新規・ロジック層): MML コマンド辞書 (静的データ: トラック指定子 / ディレクティブ / 音符・休符 / コマンド `o`,`l`,`v`,`t`,`q`,`K`,`D`,`^`,`[`,`]`,`@`系 等 + 説明文) とプレフィックス・文脈フィルタの純粋関数。規模感 約 200〜300 行。
    2. `src/utils/mmlLanguage.ts` へ `monaco.languages.registerCompletionItemProvider` の登録を追加 (約 50 行)。
    3. 文脈判定は既存 `src/utils/mmlCaretParser.ts` (`MmlCaretContext.engine`) を流用。FM トラック内では `@v` (0-127) を優先提示、DCSG トラックでは `v` (0-15) を提示、等の絞り込み。
    4. 候補出し分け: 行頭=トラック指定子 (`P1`-`P6` / `N1`-`N2` / `B1` / `F1`-`F8` / `W1`-`W99`)、`#` 入力=ディレクティブ (`#TITLE` / `#COMPOSER` / `#OCTAVE` / `#OPM` / `#FM`)、`@` 入力=マクロ (`@1` / `@VE1` / `@PE1` / `@v` / `@q` / `@t` / `@WN` / `@IN` / `@SW`)、英字入力=MML コマンド。
    5. 辞書の元ネタ: Monarch トークン定義 (`src/utils/mmlLanguage.ts`) と `docs/specification/mml_reference.md`。
    6. テスト: `src/utils/__tests__/mmlCompletion.test.ts` を `mmlCaretParser.test.ts` のパターンに準拠して新設 (ロジック層は Monaco 非依存でテスト可能に設計)。
- [ ] **`lkesteloot/trs80` の `z80-test` (1356 テスト) による命令セット全数検証**
  - 実現可能性調査完了済み。テストデータ取り込み + Delegate 実装に加え、**MEMPTR 実装 (コア大規模変更)** が前提要件（詳細は [`docs/specification/web_core_port.md`](./specification/web_core_port.md) §4.5 参照）。

### 優先度: 低 / 環境・運用 (Low Priority / Operations)
- [ ] **GitHub Pages 自動デプロイの設定切替 (ユーザー操作)**
  - GitHub リポジトリの Settings → Pages の Source を `Deploy from a branch` から `GitHub Actions` へ切り替える。
  - 切替後は main ブランチへの push に連動して自動ビルド・デプロイが実行されます（仕様詳細は [`docs/specification/ci_deploy.md`](./specification/ci_deploy.md) 参照）。
- [ ] **MCP `chrome-devtools-mcp` の初回動作確認**
  - 設定済み・未検証（詳細は [`docs/specification/mcp-browser-debug.md`](./specification/mcp-browser-debug.md) 参照）。次回ブラウザデバッグ時に Chrome 接続〜ログ・スクリーンショット取得の流れを検証。

---

## 3. 直近の完了作業（最新）

- **MML エディタの不自然な補完候補 (Monaco 既定ワードベースサジェスト) を無効化 (`src/view/MmlEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー指摘**: 「MMLエディタとしては不自然なコードアシスト出てきます。」
  - **原因調査結果**:
    - MML 言語 (`mz1500-mml`) には補完プロバイダー (`registerCompletionItemProvider`) が未実装で、Monaco Editor 既定の「ワードベースサジェスト」(文書内の既存単語を機械的に候補表示) が唯一の補完ソースとして作動していた。
    - MML は `P1o4l8v15cde` のような無間記述 (スペースなしコマンド連結) 言語のため、Monaco の単語定義と噛み合わず、トークン断片 (`cdef` / `c#4` 等) や行の大半が意味不明な長い文字列として候補に出現、コメント内英単語も混入していた。
  - **対応内容**: `MmlEditor.tsx` のエディタ `options` に `wordBasedSuggestions: 'off'` を追加し不自然な候補を完全消滅 (最小対応・1 プロパティ追加)。MML 専用補完の実装はユーザー確定方針により別セッションへ分離し、実装方針を ToDo に記録済み。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 31 ファイル・429 件合格。

- **MML Live Dock: FM / V-ENV / P-ENV 各エディタへのドラッグリサイズ機能追加 (`src/view/MmlLiveDock.tsx`, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`)** (2026-09-07):
  - **背景・ユーザー要望**:
    - 「FMの部分は全体見せるとき、もちょっと高さあった方がいいですね。各タブとも一応ドラッグして高さ調節できるようにもしておけますか。それにより、入力エリアも広がる感じで。」
  - **対応内容**:
    - **ドラッグリサイズハンドル実装 (`MmlLiveDock.tsx`)**:
      - ドック上端に半透明のピルバー形状のリサイズハンドルを配置。ホバー時にシアン色に発光、ドラッグ中はグロー強調。
      - ポインターキャプチャ（`setPointerCapture`）を利用し、ドラッグ中に意図せずカーソルが外れないよう堅牢なリサイズ処理を実装。
      - 上方向にドラッグで拡大・下方向で縮小。最小高さ 120px ～ 最大高さ 560px の範囲内で自由調節。
      - チラ見え状態（閉じている）でもハンドルをドラッグすると自動展開してリサイズ開始。
    - **展開中の現在高さ表示**: ヘッダーに「Drag top bar to resize: 340px」のようなインジケータを常時表示。
    - **FM TONE エディタのデフォルト展開高さ増加**: 4オペレータ分のMMLがすべて見えるよう、FM専用のデフォルト展開高さを 220px → 340px (最大 650px) に設定。
    - **高さトランジション制御**: ドラッグ中は `transition-none`、展開/折りたたみ時は `transition-[height] duration-200` でスムーズなアニメーション。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 31 ファイル・429 件合格。
    - ブラウザ実機にて FM (340px デフォルト展開 / 最大 650px)、V-ENV・P-ENV (220px デフォルト展開) のリサイズ動作を確認完了。

- **MML Live Dock: FM / V-ENV / P-ENV 各エディタへのチラ見えボトムドック実装 (`src/view/MmlLiveDock.tsx`, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`)** (2026-09-07):
  - **背景・ユーザー要望**:
    - 「TONE、P-ENV、V-ENV下のMML部分はちらっと常に見えていて、フォーカスしたりすると全体が見えるように固定され、GUIを見ながらMML部分を編集するとGUIへ反映されるとかできますか」
    - 「まずはちらみの部分の雰囲気だけモックできますか」
  - **対応内容**:
    - **`MmlLiveDock.tsx` 新規コンポーネント作成**: 各エディタ最下部に sticky 配置されるチラ見えドック UI。
    - **チラ見え状態（高さ 38px）**: MML 定義コードを1行サマリーでプレビュー表示。COPY / EXPAND ボタン付き。
    - **展開状態**: textarea でコード閲覧・編集可能。MINIMIZE ボタン・MMLに反映ボタン付き。
    - **全 3 エディタへ配置**: `FmToneEditor.tsx`・`VolEnvelopeEditor.tsx`・`PitchEnvelopeEditor.tsx` の旧 MML 出力カードを `MmlLiveDock` に置換。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 31 ファイル・429 件合格。
    - ブラウザ実機にて全3タブのチラ見えバー・展開・COPY 動作を確認完了。

- **FM TONE / V-ENV / P-ENV の音色・エンベロープ名称（NAMEコメント）仕様策定 & 各タブへの名称入力欄新設 (`src/utils/mmlDefinitionLoader.ts`, `src/utils/__tests__/mmlDefinitionLoader.test.ts`, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー要望**:
    - 「FM TONE、V-ENV、P-ENVで名前をつけておける仕様を考えたいです。名前はコメントで記憶しておきます。/*  */ の中に何か名前だとわかるような特殊文字メタ文字？みたいなのを入れておくと、名前として解釈されるようにしたいです。」
    - 「パターン1 いいですね。 NAME: name: どっちでも という感じで。FM TONE エディタには既に音色名入力欄がありますか？？ 名称欄、それぞれのタブに追加したいです。」
  - **対応内容**:
    - **コメント構文ルール (`/* NAME: 音色名 */` パターン1採用)**:
      - `/* NAME: xxx */` および `/* name: xxx */` を最優先で名前として抽出する `extractDefinitionName` パーサーを新設。
      - 後方互換性として、`NAME:` タグがない場合でも予約パラメータ（`ALG=`, `OP1` 等）を含まない最初のコメントを自動的に名前としてフォールバック復元。
    - **各エディタヘッダーへの名称入力欄（テキストボックス）新設**:
      - **FM TONE**: `@ID` の右隣に `NAME:` 入力欄を新設（自由編集可能）。
      - **V-ENV**: `@VE` の右隣に `NAME:` 入力欄を新設。
      - **P-ENV**: `@PE` の右隣に `NAME:` 入力欄を新設。
      - プリセット選択時に各プリセット名が自動セットされ、ユーザーが任意の名称へ編集可能。
    - **MMLへの出力 & MMLからのロード自動連動**:
      - 各エディタの「▶ MMLに反映」ボタン押下時、`/* NAME: ${name} */` を先頭に付与した MML スニペットを生成。
      - MML 上の定義を選択・ロードした際も、コメントから名称を自動復元して入力欄に反映。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 31 ファイル・429 件合格（新規テスト +4）。
    - ブラウザ実機にて FM, V-ENV, P-ENV の全タブヘッダーに `NAME:` 入力欄が整然と配置されていることを確認完了。

- **ローカルフォルダの初期空化 & 永続化（次回アクセス時自動復元）・フォルダクローズ機能の実装 (`src/view/FileExplorer.tsx`, `src/utils/workspaceStorage.ts`, `src/utils/__tests__/workspaceStorage.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー指示**:
    - 「OPEN FOLDER ボタンを OPEN LOCAL FOLDER にして 内部実装できますか。」
    - 「デフォルトのローカルフォルダ表示は無し/空でOKです。一度読み込んだローカルフォルダは次回表示時にも表示するようにしたいです。」
  - **対応内容**:
    - **デフォルト表示のモック撤廃 & 初期空状態 (Empty State)**:
      - 従来のモックデータ（`my_game_bgm`）を完全撤廃。
      - 未ロード時は `Local Files` 見出し横に `EMPTY` バッジを掲示し、中央に点線カードで「No Folder Opened / Click OPEN LOCAL FOLDER... above to load your project.」を案内。
    - **IndexedDB / localStorage による永続化 & 次回アクセス時の自動復元 (`workspaceStorage.ts`)**:
      - 読み込んだローカルフォルダのツリー構造および各MMLファイルの内容（`content`）をブラウザの IndexedDB（フォールバック時は localStorage）へ自動保存。
      - 次回起動時・リロード時に `useEffect` で自動ロードし、前回のフォルダ状態を即座に完全復元。
      - ツリー内の新規ファイル・フォルダ追加、リネーム、削除、ファイル読み取り時も自動的にストレージと同期。
    - **フォルダを閉じる（Close / Unload Folder）機能**:
      - フォルダが開いている際、`WORKSPACE` バッジ横にフォルダを閉じるアイコンボタン（`<FolderX />`）を配置。クリックでストレージをクリアし初期空状態へ復帰可能。
    - **ブラウザネイティブのフォルダ読み込み**:
      - `window.showDirectoryPicker()`（Chromium系）および `<input type="file" webkitdirectory />`（フォールバック）を完備。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 31 ファイル・425 件合格。
    - ブラウザ実機にて初期空状態（`No Folder Opened`）の綺麗な表示を確認。

- **`MIDI ROUTING STUDIO` モーダルのモック要素・試作表記撤廃 (`src/view/MidiRouterModal.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー指示**: 「IMPORT MIDI の画面で、PROTOTYPEとか記載が残ってたり、Load Demo Fileボタンが残ってたり、モック要素が残ってます。モック要素は削除してください。」
  - **対応内容**:
    - **`PROTOTYPE` バッジ削除**: モーダルヘッダー右上の `PROTOTYPE` バッジを撤廃。
    - **`Load Demo File` ボタン・関連ロジック削除**: 初期ドロップゾーンの `Load Demo File` ボタン、`loadDemoFile` 関数、および `createDemoMidiBytes` インポートを完全削除。
    - **ドロップゾーンのクリーン化**: 中央に「`Browse .mid File`」ボタンのみを配置し、実用ツールとしてのクリーンで洗練されたファイル選択UIへ移行。
    - **アイコン整理**: 未使用となった `Sparkles` インポートを削除し、和音一括割り当てプリセットボタンのアイコンを `Split` に適正化。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 422 件合格。
    - ブラウザ実機にて `PROTOTYPE` バッジおよび `Load Demo File` ボタンが消去され、`Browse .mid File` のみが美しく表示されることを確認完了。

- **バージョン番号運用ルールの策定 & ハイブリッド方式（コミット通番＋短縮ハッシュ）の導入 (`.clinerules`, `src/config/version.ts`, `package.json`, `src/view/AboutModal.tsx`, `src/app/App.tsx`, `src/view/SettingsPanel.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー要望**: 「バージョン番号のルールを記載しておき、必要に応じてアップしたいです。末尾の 番号は、コミットするたびに変更したいです。数字じゃなくてもいいですけど、良いルールあれば提案してください。」「パターン1と2のハイブリッドがいいです」
  - **対応内容 (パターン1+2 ハイブリッド方式の導入)**:
    - **体系**: `v<Major>.<Minor>.<Patch>-beta.<CommitCount>+<ShortHash>`
      - 例: `v0.0.1-beta.69+18a7f84`
      - 通常表示（ヘッダー、ステータスバー、設定パネル）: `v0.0.1-beta.69`
      - 詳細表示（About モーダル）: `v0.0.1-beta.69 (18a7f84)`
      - `package.json`: `"version": "0.0.1-beta.69"`
    - **ルール化 (`.clinerules`)**:
      - コミット直前に `git rev-list --count HEAD`（+1）と `git rev-parse --short HEAD` を取得し、`package.json` と `src/config/version.ts` を同期更新してからコミットするルールを規定。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 422 件合格。
    - ブラウザ実機にてヘッダー、ステータスバー、About モーダルの各バージョン表示（`v0.0.1-beta.69 (18a7f84)`）を確認完了。

- **右ペインタブバーのコンパクト化 & 1行収容改修 (横スクロール完全防止) (`src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー要望**: 「TRACK MONITOR などの タブが増えてきました。現在は横スクロールで表示できますが、他にスクロールしなくても見せるようなアイディアありますか。」
  - **対応内容 (アイディア1の採用・実装)**:
    - 各タブのラベルを短縮化しつつ直感性を維持：
      - `TRACK MONITOR` ➔ `MONITOR`
      - `FM TONE` ➔ `FM`
      - `VOL ENV` ➔ `V-ENV`
      - `PITCH ENV` ➔ `P-ENV`
      - `SONG SETUP` ➔ `SETUP`
      - `MML TRANSFORM` ➔ `TRANSFORM`
      - `SETTINGS` ➔ 右端固定アイコンボタン（ギアマーク `Settings`）
    - パディングを `px-3.5` から `px-2.5` へ引き締め、アイコンとテキストの間隔を最適化。
    - 各タブに詳細ツールチップ（`title`）を付与し、ホバー時に正式機能名を即座に提示。
    - 左右 50:50 の標準分割幅でも全 7 タブが横スクロールなしで1行にすっきりと収まるレイアウトを実現。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 422 件合格。
    - ブラウザ実機にて全7タブが1行に収まっていること、および `FM`, `TRANSFORM`, `SETTINGS`, `MONITOR` の各タブ切り替えがスムーズに動作することを確認完了。

- **ヘッダーの EXPORT ボタン表記を `EXPORT PLAYER (.qdf)` へ変更 (`src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー要望**: 「EXPORT ボタンは EXPORT PLAYER にしたいです。」「あ、(.qdf)は必要です。」
  - **対応内容**:
    - メインヘッダーのボタンラベルを `EXPORT (.qdf)` から `EXPORT PLAYER (.qdf)` へ変更。
    - ツールチップ（title）を「実機演奏プレイヤー入り QuickDiskイメージ (.qdf) としてエクスポート」に更新し、単なるデータ出力ではなく独立して実機起動可能なプレイヤー込み QD イメージが生成される機能であることを明確化。

- **バージョン表記 (`v0.0.1-beta`)・Copyright (`© 2026 ほたて`)・リスペクト先 (`AboutModal`) の実装完了 (`src/config/version.ts`, `src/view/AboutModal.tsx`, `src/app/App.tsx`, `src/view/SettingsPanel.tsx`, `package.json`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー要望**:
    - 「どこかに、バージョン表記もいれたいです。今はbeta です。0.0.1 くらい。 メジャー.マイナー.リリース番号 くらいかな。」
    - 「また、copyright 表示もどこかに入れたいです。詳細クリックしたら、リスペクト先を記載したいです。」
    - 具体的なURL等の提供（Konamiman氏GitHub, ぽよこまだんな氏X, AKD氏サイト, 紅茶羊羹氏サイト）。
  - **対応内容**:
    - `src/config/version.ts` でバージョン・コピーライト・リスペクト先データ（Konamiman様、ぽよこまだんな様、AKD様、紅茶羊羹様）を一元管理。
    - `AboutModal.tsx` 新設、ヘッダーおよび最下部ステータスバー、環境設定パネルから起動可能に。

---

## 4. 過去の開発履歴アーカイブ
モック期から初期開発、Web コア移植（MML コンパイラ・Z80 CPU エミュレータ・音源ドライバ・等価テスト等）の詳細な全履歴は以下に保管されています：
👉 **[`docs/PROGRESS_HISTORY.md`](./PROGRESS_HISTORY.md)**
