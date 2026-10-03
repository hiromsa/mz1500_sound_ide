# MZ-1500 Sound IDE

**SHARP MZ-1500** のサウンドドライバ & MML コンパイラ / DAW Studio を Web 技術だけで再現したプロジェクトです。
C# や .NET WebAssembly を一切使わず、TypeScript / Web ネイティブ技術 (Vite + React + Web Audio API) で完結しています。

> 開発進捗の詳細は [`docs/PROGRESS.md`](./docs/PROGRESS.md)、機能別の仕様は [`docs/specification/README.md`](./docs/specification/README.md) を参照してください。

## 主な機能

- **MML STUDIO**: Monaco Editor ベースの MML エディタ (シンタックスハイライト / キャレットコンテキスト連動 / 定義ブロックの右クリック編集)
- **MML コンパイラ**: 9ch / 17ch / ワークトラック (W1〜W99) 対応の内製コンパイラ
- **演奏プレビュー**: 内製 TypeScript Z80 CPU エミュレーションコア + Z80 サウンドドライバによる演奏 (Z80 DRIVER) とソースインタプリタ方式 (SOURCE INTERPRETER) の切替
- **音源エミュレーション**: DCSG (SN76489) / OPM (YM2151) / 8253 BEEP の Web Audio API 再生
- **QuickDisk エクスポート**: 実機演奏プレイヤーを内包した `.qdf` イメージの生成 (MZ-1500 エミュレータでのロード・演奏確認済み)
- **MIDI ROUTING STUDIO**: SMF プレビュー & MML 変換 & 和音自動ボイス分離
- **MML TRANSFORM**: 半音・オクターブ移調 / 音量スケーリング / チャンネル置換
- **仮想キーボード**: PSG / FM / ノイズ / BEEP 試聴 (実機 DCSG 配線に連動した定位)
- **音色・エンベロープエディタ**: FM TONE / VOL ENV / PITCH ENV / P-SW (ピッチスイープ & 波形ジェネレーター)
- **ローカルフォルダオープン**: IndexedDB / localStorage による自動永続化・次回アクセス時完全復元

## 開発環境

- Node.js 22 以上
- .NET 9 + C# は**チップ照合テストのリファレンス値を再生成する場合のみ**必要 (通常の開発・テストには不要)

## セットアップ

```bash
npm install
```

## コマンド一覧

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 (Vite) |
| `npm test` | 単体テスト実行 (Vitest・`src/` 配下) |
| `npm run test:probe` | 実測プローブ実行 (`tools/qdf-probe`・C# 生成物が必要なためローカル実行のみ) |
| `npm run verify` | MML パーサーの検証スクリプト実行 |
| `npm run lint` | 静的解析 (oxlint) |
| `npm run build` | 型検査 (`tsc -b`) + 本番ビルド (GitHub Pages 向け `dist/`) |
| `npm run update-chip-reference` | チップ照合テストのリファレンス値を再生成してフィクスチャへ反映 (要 dotnet) |

## CI / デプロイ

`main` ブランチへの push で GitHub Actions が lint → test → build を実行し、GitHub Pages へ自動デプロイします (詳細は [`docs/specification/ci_deploy.md`](./docs/specification/ci_deploy.md))。

公開 URL: <https://hiromsa.github.io/mz1500_sound_ide/>

## ライセンス

[MIT License](./LICENSE)

## Credits (Z80 CPU コア)

`src/core/z80/` は Konamiman 氏の **[Z80dotNet (Z80.Net)](https://github.com/Konamiman/Z80dotNet)** を
C# から TypeScript へ移植・改変したものです。

- Based on Z80dotNet, Copyright (C) 2014 Konamiman, www.konamiman.com.
- Z80dotNet のライセンス (改変版 MIT) の条項に従い、著作権表示・許諾表示の保持と改変の明示を行っています。
  ライセンス全文は [LICENSE](./LICENSE) を、移植ファイルのヘッダーは各 `.ts` ファイルの冒頭を参照してください。
