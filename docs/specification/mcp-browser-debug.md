# MCP 自動ブラウザ操作 & デバッグ環境 (chrome-devtools-mcp)

Cline から **MCP (Model Context Protocol)** 経由で Chrome ブラウザを自動操作・デバッグできるようにするための環境設定と運用手順を記録する。

---

## ⚠ 適用範囲に関する重要な注意 (Cline 専用)

- 本 MCP 設定は **VSCode + Cline 用**に整備したものである。
- 本プロジェクトの役割分担: **VSCode + Cline = 内部実装 / Antigravity = デザイン・UI**。
- **Antigravity には独自の組み込み Browser 機能があるため、本設定は Antigravity では原則不要**。
  Antigravity 側へ同じ MCP 設定を流し込む必要はない (必要になった時点で改めて検討すること)。
- `.clinerules` は [`GEMINI.md`](../../GEMINI.md) 経由で **Antigravity からも間接的に参照される**。
  **その参照を拒否・除外 (.gitignore 追加等) やブロックする設定を行ってはいけない。**

---

## 1. 採用ツールと採用理由

| 項目 | 内容 |
|---|---|
| 採用ツール | **chrome-devtools-mcp** (Google ChromeDevTools 公式) |
| 提供形態 | MCP サーバー (`npx chrome-devtools-mcp@latest`) |
| 方式 | Chrome DevTools Protocol (Puppeteer ベース) で実際の Chrome を制御 |
| 採用理由 | ① Google Antigravity の MCP Store「Frontend & Design」でも **Chrome DevTools** が採用されており方向性が一致 ② コンソールログ収集・ネットワーク検査・パフォーマンストレースなど **デバッグ系機能が豊富** ③ 公式メンテで安定 ④ Playwright MCP と比較して DevTools レベルのデバッグ (性能計測等) に強い |

### 前提条件 (当環境での確認済み)

- Node.js: **v24.12.0** (LTS 以上) ✅
- Chrome: 安定版がインストールされていること (サーバー初回起動時に自動でバージョン確認あり)
- npm / npx が使えること ✅

---

## 2. 設定内容

### 設定ファイルの場所 (Cline / VS Code)

```
%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

### 現在の設定 (2026-09-05 設定済み)

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "autoApprove": [],
      "disabled": false,
      "timeout": 100,
      "command": "cmd",
      "args": ["/c", "npx", "-y", "chrome-devtools-mcp@latest"],
      "env": {}
    }
  }
}
```

### 設定のポイント

- **`command: "cmd"` + `args: ["/c", "npx", ...]`**: Windows 環境では Cline が `npx` (`.cmd` バッチ) を直接 spawn できないケースがあるため、`cmd /c` 経由で起動するのが公式推奨パターン。
- **`chrome-devtools-mcp@latest`**: 常に最新版を使用する (公式推奨)。
- **`timeout: 100`**: 初回起動時は npx によるパッケージダウンロードが発生するため、デフォルトより長めに設定。
- **`autoApprove: []`**: 空配列 = **すべての MCP ツール呼び出しでユーザー承認を求める** (安全優先)。運用に慣れたら `list_console_messages` 等の読み取り系ツールのみ追加を検討する。

---

## 3. 使い方 (標準デバッグワークフロー)

MZ-1500 Sound IDE での典型的な確認手順:

1. **dev サーバー起動**: `npm run dev` (Vite)
   - `vite.config.ts` に `base: '/mz1500_sound_ide/'` があるため、dev URL は
     **`http://localhost:5173/mz1500_sound_ide/`** になる点に注意 (ルート直下ではない)。
2. **ページを開く**: `new_page` または `navigate_page` で上記 URL を開く
3. **視覚確認**: `take_screenshot` でスクリーンショット取得
4. **エラー確認**: `list_console_messages` で React の警告・例外・404 を確認
5. **通信確認**: `list_network_requests` / `get_network_request` でフェッチ状況を確認
6. **必要に応じて**: `click` / `fill` で UI を実際に操作し、操作後のコンソールを再取得

### プロンプト例

```
http://localhost:5173/mz1500_sound_ide/ を Chrome で開いて、
コンソールエラーとネットワークエラーを確認してスクリーンショットを見せて
```

---

## 4. 主なツール一覧 (代表例)

| カテゴリ | ツール | 用途 |
|---|---|---|
| ページ | `new_page` / `navigate_page` / `list_pages` | ページを開く・遷移する・開いているページ一覧 |
| | `resize_page` | ウィンドウサイズ変更 (レスポンシブ確認) |
| 操作 | `click` / `hover` / `fill` / `fill_form` | 要素のクリック・ホバー・入力 (スナップショットの uid 指定) |
| | `handle_dialog` | alert / confirm / prompt への応答 |
| 検査 | `take_screenshot` | スクリーンショット取得 |
| | `take_snapshot` | アクセシビリティスナップショット取得 (要素 uid の取得元) |
| | `evaluate_script` | 任意の JS をページ内で実行 (DOM 状態の調査) |
| デバッグ | `list_console_messages` | コンソールログ / エラー・警告の収集 |
| ネットワーク | `list_network_requests` | リクエスト一覧・ステータス・失敗検知 |
| | `get_network_request` | 個別リクエストの詳細 (ヘッダ・ボディ) |
| 性能 | `performance_start_trace` / `performance_stop_trace` | パフォーマンストレース記録と解析 |
| エミュレート | `emulate_cpu` / `emulate_network` | 低速 CPU / 低速回線の再現 |

> 完全な一覧は公式ドキュメント (developer.chrome.com/docs/devtools/agents) を参照。
> バージョンアップでツールが追加・変更される場合がある。

---

## 5. 起動オプション (必要に応じて `args` に追記)

| オプション | 効果 | 使いどころ |
|---|---|---|
| `--headless` | ヘッドレス起動 | 画面を出さずに自動化する場合 |
| `--isolated` | 一時プロファイルで起動 (終了時に破棄) | 通常プロファイルに影響を与えたくない場合 |
| `--channel=canary` 等 | 起動する Chrome チャンネルを指定 | 新機能検証時 |
| `--browserUrl=<url>` | 起動済み Chrome (remote-debugging-port) に接続 | 既存セッションの引き継ぎ |
| `--executablePath=<path>` | Chrome のパス明示 | 複数バージョンInstalled時 |
| `--no-usage-statistics` | Google への利用統計送信を無効化 | プライバシー重視時 |
| `--slim` | 基本操作のみの軽量モードで起動 | ツール数を絞りたい場合 |

---

## 6. トラブルシューティング

| 症状 | 対処 |
|---|---|
| サーバーが起動しない / タイムアウト | 初回は npx ダウンロードで時間がかかる。`timeout` を延長するか、一度手動で `npx -y chrome-devtools-mcp@latest --version` を実行してキャッシュさせる |
| Chrome が見つからない | Chrome 安定版をインストールするか `--channel` / `--executablePath` で明示 |
| `npx` が見つからないエラー | `command` が `npx` 直指定になっていないか確認 (Windows は `cmd` + `/c npx` 必須) |
| ページが真っ白 / 404 | `base: '/mz1500_sound_ide/'` の影響。`http://localhost:5173/mz1500_sound_ide/` で開いているか確認 |
| MCP ツール実行のたびに止まる | `autoApprove` が空のため承認待ち。慣れたら読み取り系ツールを追加 |

---

## 7. 検証ステータス

| 日付 | 内容 | 結果 |
|---|---|---|
| 2026-09-05 | 設定追加・JSON 構文検証 | ✅ 完了 |
| (未実施) | ブラウザ起動〜コンソールログ取得の実動作確認 | ⏳ 次回 UI 修正時等に要確認 (PROGRESS.md の ToDo 参照) |
