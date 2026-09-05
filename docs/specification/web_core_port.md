# Web コア層への移植アーキテクチャ (`docs/specification/web_core_port.md`)

本書は、C# 版プロジェクト (`C:\tools\mz1500_sound_devenv`) で実装済みの「内部機能 (UI 以外)」を
本プロジェクト (Web / TypeScript 版 MZ-1500 Sound IDE) へ移植する際のアーキテクチャ・方針・
対応関係を記録するドキュメントです。UI は本プロジェクトの既存実装を最優先します。

---

## 1. 移植の基本方針 (確定 2026/09/05)

| 項目 | 決定 |
|---|---|
| 移植対象 | C# 版の **MmlCompiler / DriverAssembler / Player (chips・sequencer・driver) / driver (Z80 アセンブリ)** |
| 非対象 | C# 版の UI (MzSound.DevEnv = Avalonia) — 本プロジェクトの UI (React + Monaco + Tailwind) を維持 |
| UI/ロジック分離 | UI は `src/view`・`src/app`、ロジック (コア) は `src/core` に完全分離。コアは UI (React/DOM) に依存しない |
| Z80 CPU コア | npm に実用レベルのライブラリが存在しないため、**Z80dotNet (C# 版で使用) と同一挙動のコアを TypeScript で内製移植する** (16bit ポート対応・T-state カウント・HALT 検出を含む) |
| オーディオ出力 | NAudio → **Web Audio API** (AudioWorklet 推奨、フォールバックで ScriptProcessor)。48kHz / 2ch / float、PSG1→L / PSG2→R / BEEP・FM→中央 のミックス仕様は C# 版を踏襲 |
| 演奏方式 | C# 版と同じ 2 モード: **SourceInterpreter** (TrackSequencer が MZSD を直接解釈) と **Z80Driver** (内蔵 Z80 コア上でドライバを実行)。等価性テストで両者を検証 |
| テスト | **vitest** (`npm test`)。C# 版の xUnit テストを TypeScript に移植し、数値が 1:1 で一致することを検証 |
| 配信形態 | GitHub Pages の静的配信 (クライアント完結。サーバサイド処理なし) |

## 2. フォルダ構成 (確定)

```text
mz1500_sound_ide/
├─ driver/                  … MZ-1500 側 Z80 サウンドドライバ (C# 版から移植、実体の正)
│  └─ mzsd_driver.asm         (将来的に Vite ?raw import でバンドル / テストでは node:fs で読む)
├─ src/
│  ├─ main.tsx              … エントリポイント
│  ├─ app/                  … アプリシェル (App.tsx = レイアウト・状態管理)
│  ├─ view/                 … UI コンポーネント (旧 src/components、Monaco/Canvas/Tailwind)
│  ├─ core/                 … ロジック層 (UI 非依存。DOM / React を import しない)
│  │  ├─ fm/FmTone.ts       … YM2151 音色データ型・アルゴリズム純粋ロジック (UI 逆依存解消のため抽出)
│  │  ├─ assembler/         … Z80 2パスアセンブラ (← MzSound.DriverAssembler)
│  │  │  ├─ Z80Assembler.ts    (2パス・org/equ/db/dw/dctbl/beeptbl)
│  │  │  ├─ Z80Encoding.ts     (命令エンコーダ)
│  │  │  ├─ OperandParser.ts / Z80Operand.ts / ExpressionEvaluator.ts / AssembleResult.ts
│  │  │  └─ __tests__/         (エンコード 45 ケース + ラベル/テーブル/エラー 6 ケース + 実ドライバ検証 3 ケース)
│  │  ├─ mml/               … MML コンパイラ (← MzSound.MmlCompiler)
│  │  │  ├─ MmlCompiler.ts     (マクロ抽出 → パース → アセンブル)
│  │  │  ├─ MmlCompilerMacros.ts / MmlCompilerAssemble.ts
│  │  │  ├─ TrackId.ts / Envelopes.ts / MmlMap.ts
│  │  │  ├─ parser/MmlParser.ts / MmlParserTypes.ts
│  │  │  └─ __tests__/         (基本 7 + 高度 13 + マクロ複数行 4)
│  │  ├─ chips/             … 音源エミュレーション (← MzSound.Player/Chips) 【次フェーズ】
│  │  │  ├─ DcsgChip.ts / BeepChip.ts / ChipBank.ts
│  │  │  └─ fm/ (Ym2151.ts / Opm.ts / FmOperator.ts / FmChannel4.ts / FmTables.ts / FmTimer.ts)
│  │  ├─ player/            … 演奏エンジン (← MzSound.Player) 【次フェーズ】
│  │  │  ├─ MzsdSong.ts / TrackSequencer.ts / MzsdSequencer.ts
│  │  │  ├─ AudioEngine.ts (Web Audio 化) / Player.ts
│  │  │  └─ Z80DriverImage.ts / Z80DriverMachine.ts
│  │  └─ z80/               … Z80 CPU コア (Z80dotNet 相当を内製移植) 【次フェーズ】
│  └─ utils/                … UI 補助ユーティリティ (MML キャレット解析 / 仮想シンセ)
└─ docs/specification/      … 本書を含む仕様ドキュメント一式
```

## 3. C# 版との対応表

| C# (mz1500_sound_devenv) | TypeScript (本プロジェクト) | 状態 |
|---|---|---|
| `src/MzSound.DriverAssembler/*` | `src/core/assembler/*` | ✅ 移植済 (85 テスト全合格) |
| `src/MzSound.MmlCompiler/*` | `src/core/mml/*` | ✅ 移植済 |
| `driver/mzsd_driver.asm` | `driver/mzsd_driver.asm` | ✅ 取り込み済 (アセンブル検証済み) |
| `src/MzSound.Player/Chips/*` | `src/core/chips/*` | ⏳ 次フェーズ |
| `src/MzSound.Player/Sequencer/*` | `src/core/player/*` | ⏳ 次フェーズ |
| `src/MzSound.Player/Audio/AudioEngine.cs` (NAudio) | `src/core/player/AudioEngine.ts` (Web Audio) | ⏳ 次フェーズ |
| `src/MzSound.Player/Driver/Z80DriverMachine.cs` (Z80dotNet) | `src/core/player/Z80DriverMachine.ts` + `src/core/z80/*` | ⏳ 次フェーズ |
| `tests/MzSound.*.Tests/*` (xUnit, 136 テスト) | `src/core/**/__tests__/*` (vitest) | 🔶 アセンブラ 51 + MML 24 相当は移植済、Player/等価テストは次フェーズ |

## 4. 検証方針

1. **数値一致テスト**: C# 版のテスト期待値 (オペコード列 / フレーム数 / 周波数テーブル等) を
   TypeScript テストにそのまま流用し、ビット単位で一致させる。
2. **実ドライバ検証**: C# 版 `Z80DriverImage.Build` と同じ契約 (origin = 0x1200、
   `music_data` ラベル存在、org パディング除去) を vitest で常時検証する。
   実ドライバ 1945 行が TypeScript アセンブラでアセンブルできることが回帰防止になる。
3. **等価性テスト (次フェーズ)**: C# 版 `Z80DriverEquivalenceTests` と同様に、
   SourceInterpreter と Z80Driver の全フレーム音源レジスタ (PSG×2 / BEEP / FM 全レジスタ) を比較する。

## 5. 履歴

| 日付 | 内容 |
|---|---|
| 2026/09/05 | 初版作成。アセンブラ・MML コンパイラ移植完了 (85 テスト全合格)。フォルダ再編 (view/app/core) 実施。 |
