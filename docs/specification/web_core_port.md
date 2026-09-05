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

### 1.1 Z80 CPU コアの選定経緯 (2026/09/05 再確認)

外部ライブラリ `lkesteloot/z80-emulator` (TypeScript 製・MIT・z80-test 1356 テスト合格) の採用を検討したが、
以下の理由により **依存ライブラリとしては採用せず、本表の「Z80dotNet 相当の内製移植」方針を維持** する。

| 評価ポイント | 結果 |
|---|---|
| 命令セットの正確性 | ◎ z80-test 1356 テスト合格 (オペコード表は生成コード方式 `GenerateOpcodes.ts`) |
| ライセンス | ◎ MIT |
| メンテ状況 | ✗ GitHub リポジトリは 2024/1/5 にアーカイブ (read-only、本体は `lkesteloot/trs80` モノレポへ移行)。npm パッケージ `z80-emulator` も deprecated (最終版 2.3.0 / 2021-11 公開、TS 3.9 世代のビルド) |
| ポート I/O | ✗ `Hal` が 8bit ポート前提 (コメントで「上位バイトはテスト用データ扱い」と明記)。C# 版が使用する Z80dotNet の 16bit ポート空間 (`UseExtendedPortsSpace`) と非互換 |
| 割り込み | ✗ IM0 は常に RST 38h 扱い (データバス非対応)、IM2 ベクタ下位バイトが 0xFF 固定 (`Z80.ts` 確認済み)。EI 後の iff 遅延の実装も未確認 |
| C# 版との等価検証 | ✗ 挙動が Z80dotNet と一致する保証がなく、等価性テスト (§4) の土台を崩す恐れ |

**活用方法 (検証基盤)** — MIT であり、内製コアの品質向上のために限定的に利用する:

1. **命令セット検証**: `lkesteloot/trs80` モノレポ内の `z80-test` (任意のエミュレータを接続可能な設計) を、内製コア完成後の全命令検証に使用する (1356 テスト)。
2. **オペコード表実装の参考**: `GenerateOpcodes.ts` + `opcodes` データによる生成方式を参考に、手書きミスを防止する。
3. **突き合わせデバッグ**: 挙動が疑わしい命令のリファレンス実装として使用する。

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
│  │  ├─ chips/             … 音源エミュレーション (← MzSound.Player/Chips) ✅
│  │  │  ├─ DcsgChip.ts / BeepChip.ts / ChipBank.ts
│  │  │  ├─ fm/ (Ym2151.ts / Opm.ts / FmOperator.ts / FmChannel4.ts / FmTables.ts / FmTimer.ts /
│  │  │  │        FmChip.ts / ISoundChip.ts / SystemRandom.ts)
│  │  │  └─ __tests__/        (DCSG 7 + BEEP 4 + Ym2151 8 + ChipBank 4 + SystemRandom 2)
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
| `src/MzSound.DriverAssembler/*` | `src/core/assembler/*` | ✅ 移植済 |
| `src/MzSound.MmlCompiler/*` | `src/core/mml/*` | ✅ 移植済 |
| `driver/mzsd_driver.asm` | `driver/mzsd_driver.asm` | ✅ 取り込み済 (アセンブル検証済み) |
| `src/MzSound.Player/Chips/DcsgChip.cs` | `src/core/chips/DcsgChip.ts` | ✅ 移植済 (標本レベルで C# 一致) |
| `src/MzSound.Player/Chips/BeepChip.cs` | `src/core/chips/BeepChip.ts` | ✅ 移植済 (標本レベルで C# 一致) |
| `src/MzSound.Player/Chips/ChipBank.cs` | `src/core/chips/ChipBank.ts` | ✅ 移植済 |
| `src/MzSound.Player/Chips/Fm/*` (fmgen 由来) | `src/core/chips/fm/*` | ✅ 移植済 (FM 出力をビット単位で C# 一致検証済み) |
| `src/MzSound.Player/Sequencer/*` | `src/core/player/*` | ⏳ 次フェーズ |
| `src/MzSound.Player/Audio/AudioEngine.cs` (NAudio) | `src/core/player/AudioEngine.ts` (Web Audio) | ⏳ 次フェーズ |
| `src/MzSound.Player/Driver/Z80DriverMachine.cs` (Z80dotNet) | `src/core/player/Z80DriverMachine.ts` + `src/core/z80/*` | ⏳ 次フェーズ |
| `tests/MzSound.*.Tests/*` (xUnit) | `src/core/**/__tests__/*` (vitest) | 🔶 アセンブラ 51 + MML 24 + チップ 25 相当を移植済、Player/等価テストは次フェーズ |

### 3.1 C# partial class の統合対応

C# の partial class (1 クラス複数ファイル) は、TS では 1 ファイル 1 クラスへ統合した。

| C# ファイル群 | TS 1 ファイル |
|---|---|
| `FmTables.cs` + `FmTables.Build.cs` + `FmTables.Envelopes.cs` | `chips/fm/FmTables.ts` |
| `FmOperator.cs` + `.Calc.cs` + `.Eg.cs` + `.Params.cs` | `chips/fm/FmOperator.ts` |
| `FmChannel4.cs` + `.Calc.cs` | `chips/fm/FmChannel4.ts` |
| `Opm.cs` + `.Registers.cs` + `.Lfo.cs` + `.Mix.cs` | `chips/fm/Opm.ts` |
| `Ym2151.cs` + `Ym2151.Ports.cs` | `chips/fm/Ym2151.ts` |

その他の移植上の対応:

- C# `enum` は `erasableSyntaxOnly` 対応のため const オブジェクト + union 型で実装
  (`FmOpType` / `EgPhase`)。
- C# `uint` の 32bit ラップが必要な箇所 (`lfoCount` / `pgCount` / `noise` 等) は
  `>>> 0` / `Math.imul(...) >>> 0` で再現。
- `Span<int>` は `Int32Array` + offset 引数で代替。
- `Random(1234)` (Knuth 減算法) は `chips/fm/SystemRandom.ts` として完全再現
  (OPM の LFO ノイズ波形が乱数に依存するため、C# とのビット一致には乱数列の一致が必須)。
- `Ym2151.IrqChanged` イベントは `setIrqChanged(handler)` コールバックで代替。

## 4. 検証方針

1. **数値一致テスト**: C# 版のテスト期待値 (オペコード列 / フレーム数 / 周波数テーブル等) を
   TypeScript テストにそのまま流用し、ビット単位で一致させる。
2. **実ドライバ検証**: C# 版 `Z80DriverImage.Build` と同じ契約 (origin = 0x1200、
   `music_data` ラベル存在、org パディング除去) を vitest で常時検証する。
   実ドライバ 1945 行が TypeScript アセンブラでアセンブルできることが回帰防止になる。
3. **等価性テスト (次フェーズ)**: C# 版 `Z80DriverEquivalenceTests` と同様に、
   SourceInterpreter と Z80Driver の全フレーム音源レジスタ (PSG×2 / BEEP / FM 全レジスタ) を比較する。
4. **C# リファレンス値ダンプ (`tools/cs-probe/`)**: chips 移植の検証のため、C# 版
   `MzSound.Player` を参照する .NET コンソールツールを用意した。
   `dotnet run --project tools/cs-probe -c Release` で以下を `out/reference.json` へ出力し、
   vitest (`chips/__tests__/referenceLoader.ts` 経由) でビット単位照合する。
   - `System.Random(1234).Next(32768)` の先頭 16 値 (乱数列の一致)
   - DcsgChip トーン / ノイズの連続 RenderSample 値 (double 完全一致)
   - BeepChip の連続 RenderSample 値 (double 完全一致)
   - Ym2151 キーオン後の出力 (部分最大値・総和・先頭 48 int 値 → 完全一致)
   - Ym2151 + saw LFO / noise LFO 出力 (総和・先頭 int 値 → 完全一致)
   bin / obj / out は .gitignore 済み (ソース `Program.cs` / `.csproj` のみ管理)。

## 5. 履歴

| 日付 | 内容 |
|---|---|
| 2026/09/05 | 初版作成。アセンブラ・MML コンパイラ移植完了 (85 テスト全合格)。フォルダ再編 (view/app/core) 実施。 |
| 2026/09/05 | §1.1 追加: Z80 コア外部ライブラリ (`lkesteloot/z80-emulator`) を評価。依存採用は見送り、Z80dotNet 内製移植方針を再確定 (`z80-test` は検証基盤として活用)。 |
| 2026/09/05 | Phase 2 完了: 音源エミュレーション (DCSG ×2 / BEEP 8253 / YM2151 fmgen 由来) を移植。`tools/cs-probe` による C# リファレンス値とのビット一致検証を導入 (§3.1、§4.4 追加)。テスト合計 110 (アセンブラ 51 + MML 24 + チップ 25 + 実ドライバ 3 + …)。 |
