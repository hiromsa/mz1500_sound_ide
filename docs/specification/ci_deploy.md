# CI / デプロイ (GitHub Actions による GitHub Pages 自動デプロイ)

## 概要
- `main` ブランチへの push、および手動実行 (`workflow_dispatch`) をトリガーに、GitHub Actions で lint → build → GitHub Pages 公開まで自動実行する。
- ワークフロー定義: [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)

## ワークフローの処理内容
| 手順 | 処理 |
|---|---|
| 1 | `actions/checkout@v4` でチェックアウト |
| 2 | `actions/setup-node@v4` で Node.js 22 + npm キャッシュをセットアップ |
| 3 | `npm ci` で依存をインストール |
| 4 | `npm run lint` (oxlint) |
| 5 | `npm run build` (`tsc -b && vite build`、型チェック込み) |
| 6 | `actions/configure-pages@v5` + `actions/upload-pages-artifact@v3` で `dist/` をアップロード |
| 7 | `actions/deploy-pages@v4` で Pages へ公開 |

- 同時実行制御 (`concurrency.group: pages`) により、連続 push 時は実行中の古いデプロイを打ち切って最新のみをデプロイする。

## 重要な注意事項

### 単体テスト (`npm test`) は CI で実行していない
- チップ照合テスト (`src/core/chips/__tests__/` 等) は C# リファレンス値 `tools/cs-probe/out/reference.json` を必要とする。
- この JSON は `tools/cs-probe` (ターゲット `net9.0-windows` / **リポジトリ外**の `mz1500_sound_devenv/src/MzSound.Player` を ProjectReference) がローカルで生成するものであり、CI 環境では生成できない (`out/` は `.gitignore` 済み)。
- そのため CI では **lint + build のみ**を実行し、単体テストは push 前にローカルで `npm test` を実行して確認する運用とする。
- 将来的に C# リファレンス値を CI で扱う場合 (例: `reference.json` をリポジトリへコミット、または .NET セットアップの導入) は、本ワークフローへ `npm test` ステップを追加すること。

### 初回適用時に必要な GitHub 側の設定 (リポジトリ管理者)
1. リポジトリ **Settings → Pages → Build and deployment** の **Source** を `GitHub Actions` に変更する。
   - 従来の `gh-pages` ブランチ方式から切り替わる。Source 変更後、初回の main push で自動公開される。
2. 切替後は従来の手動デプロイ (`npm run deploy` / `gh-pages -d dist`) は不要。併用はしないこと。

## 公開 URL
- `https://hiromsa.github.io/mz1500_sound_ide/`
  - [`vite.config.ts`](../../vite.config.ts) の `base: '/mz1500_sound_ide/'` と対応。

## 履歴
| 日付 | 内容 | 状態 |
|---|---|---|
| 2026-09-06 | ワークフロー新規作成 (lint + build + deploy-pages) | ✅ 完了 (GitHub 側の Pages Source 切替は要確認) |
