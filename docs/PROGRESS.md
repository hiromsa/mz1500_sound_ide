# MZ-1500 Sound IDE 開発進捗記録 (`PROGRESS.md`)

本書は、MZ-1500 Sound IDE の現在進行中のタスク、残タスク（ToDo）、および直近の完了作業を記録・管理するドキュメントです。
※ 過去の膨大な完了作業ログ（モック期、Webコア移植期、初期UI設計等の詳細履歴）は [PROGRESS_HISTORY.md](./PROGRESS_HISTORY.md) にアーカイブされています。

---

## 1. 現在のステータス概要
- **バージョン**: `v0.0.1-beta.71`（コミット通番＋短縮ハッシュ ハイブリッド方式）
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
