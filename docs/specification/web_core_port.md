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
│  │  ├─ player/            … 演奏エンジン (← MzSound.Player) ✅
│  │  │  ├─ MzsdSong.ts / TrackSequencer.ts / MzsdSequencer.ts
│  │  │  ├─ FrameDriver.ts (駆動方式共通契約) / AudioFrameMixer.ts / AudioEngine.ts (Web Audio 化) / Player.ts
│  │  │  ├─ FramePlaybackWorklet.ts (AudioWorkletProcessor ソース / Blob URL ロード)
│  │  │  ├─ Z80DriverImage.ts (?raw import + アセンブル + buildExecutableImage) /
│  │  │  │  Z80DriverMachine.ts (内蔵 Z80 でドライバ実行) / Z80DriverPlayback.ts (リアルタイム駆動) ✅
│  │  │  └─ __tests__/           (MZSD 解析 3 + シーケンサ/FM 12 + ミキサー 5 + Player 2 +
│  │  │                            Z80DriverMachine 12 + Z80DriverPlayback 3 + Z80Driver 等価性 11)
│  │  ├─ export/              … 実機転送用バイナリ生成 (Phase 5 新設)
│  │  │  └─ QdfImageBuilder.ts (+ __tests__/ 9: QuickDisk .qdf イメージ生成)
│  │  └─ z80/               … Z80 CPU コア (Z80dotNet 相当を内製移植) ✅
│  │     └─ MainRegisters.ts / Z80Registers.ts / Z80Bus.ts / Z80Processor.ts / __tests__/ (57)
│  └─ utils/                … UI 補助ユーティリティ (MML キャレット解析 / 仮想シンセ)
└─ docs/specification/      … 本書を含む仕様ドキュメント一式
```

## 3. C# 版との対応表

| C# (mz1500_sound_devenv) | TypeScript (本プロジェクト) | 状態 |
|---|---|---|
| `src/MzSound.DriverAssembler/*` | `src/core/assembler/*` | ✅ 移植済 |
| `src/MzSound.MmlCompiler/*` | `src/core/mml/*` | ✅ 移植済 |
| `driver/mzsd_driver.asm` | `driver/mzsd_driver.asm` | ✅ 取り込み済 (アセンブル検証済み) |
| `src/MzSound.Player/Chips/DcsgChip.cs` | `src/core/chips/DcsgChip.ts` | ✅ 移植済 (トーンは標本レベルで C# 一致。ノイズ LFSR は C# バグ修正のため意図的差分 → §3.1) |
| `src/MzSound.Player/Chips/BeepChip.cs` | `src/core/chips/BeepChip.ts` | ✅ 移植済 (標本レベルで C# 一致) |
| `src/MzSound.Player/Chips/ChipBank.cs` | `src/core/chips/ChipBank.ts` | ✅ 移植済 |
| `src/MzSound.Player/Chips/Fm/*` (fmgen 由来) | `src/core/chips/fm/*` | ✅ 移植済 (FM 出力をビット単位で C# 一致検証済み) |
| `src/MzSound.Player/Sequencer/MzsdSong.cs` | `src/core/player/MzsdSong.ts` | ✅ 移植済 (C# xUnit テスト期待値と一致) |
| `src/MzSound.Player/Sequencer/TrackSequencer.cs` | `src/core/player/TrackSequencer.ts` | ✅ 移植済 (同上) |
| `src/MzSound.Player/Sequencer/MzsdSequencer.cs` | `src/core/player/MzsdSequencer.ts` | ✅ 移植済 (同上) |
| `src/MzSound.Player/Audio/AudioEngine.cs` (NAudio) | `src/core/player/AudioFrameMixer.ts` (合成) + `AudioEngine.ts` (Web Audio) | ✅ 移植済。合成 / 60Hz フレーム駆動 / ミックス / VU を Web Audio 非依存の FrameMixer に分離し vitest で検証。出力は AudioWorklet (Blob URL) + ScriptProcessor フォールバック |
| `src/MzSound.Player/Player.cs` | `src/core/player/Player.ts` | ✅ 移植済 (`play` / `rewindToStart` のみ AudioWorklet ロードのため async) |
| `src/MzSound.Player/Driver/Z80DriverMachine.cs` (Z80dotNet) | `src/core/z80/*` (CPU コア) + `src/core/player/Z80DriverImage.ts` / `Z80DriverMachine.ts` | ✅ 移植済。実ドライバ 1945 行が内製コア上で動作し、SourceInterpreter との全フレーム等価性を検証済み (§4.3) |
| — (C# 版は未接続だったリアルタイム Z80Driver 再生) | `src/core/player/Z80DriverPlayback.ts` + `FrameDriver.ts` + `AudioEngine.ts` (Z80Driver モード) | ✅ Phase 5 で接続。STAT_PLAY 待ちブート + 60Hz フレーム駆動を等価テストと同一手順で実装 |
| `mz1500_sound_driver` QdcImageBuilder.cs (実績実装・別プロジェクト) | `src/core/export/QdfImageBuilder.ts` | ✅ Phase 5 で移植 (.qdf / 81,936B 固定 / CRC-16/ARC)。仕様は quickdisk_export.md |
| `tests/MzSound.*.Tests/*` (xUnit) | `src/core/**/__tests__/*` (vitest) | ✅ アセンブラ 51 + MML 24 + チップ 25 + Player (シーケンサ等) 22 + Z80 コア 57 + Z80DriverMachine 12 + Z80DriverPlayback 3 + QDF 9 + 等価性 11 = **222 合格 + 2 skip (C# 版と同一理由)** |

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
  (`FmOpType` / `EgPhase` / `AudioEngineMode`)。
- C# `uint` の 32bit ラップが必要な箇所 (`lfoCount` / `pgCount` / `noise` 等) は
  `>>> 0` / `Math.imul(...) >>> 0` で再現。
- `Span<int>` は `Int32Array` + offset 引数で代替。
- `Random(1234)` (Knuth 減算法) は `chips/fm/SystemRandom.ts` として完全再現
  (OPM の LFO ノイズ波形が乱数に依存するため、C# とのビット一致には乱数列の一致が必須)。
- `Ym2151.IrqChanged` イベントは `setIrqChanged(handler)` コールバックで代替。
- C# の `(sbyte)` キャスト (`OpSweep` / `OpTranspose`) は `(v << 24) >> 24` で再現。
- NAudio `MixerProvider` の合成部 (60Hz フレーム駆動 / ミックス / VU) は
  `player/AudioFrameMixer.ts` (Web Audio 非依存) として切り出し。`AudioEngine.ts` は
  AudioWorklet への標本供給 (20ms pump + リングバッファ) と ScriptProcessor フォールバックのみを担う。
- **意図的な C# からの差分 (2026-09-08)**: `@VE` のノート ON 中ループ区間は
  `[loopIndex, releaseIndex)` に限定 (C# は全要素末尾でループしリリース区間を演奏してしまう)。
  また TRACK_END / 不明命令時はリリース再始動 (`do_keyoff`) ではなく無音固定
  (TS `TrackSequencer.silence()` / asm `end_silence`) とする。終了後に演奏フレームが
  進まないため、リリース再始動すると音量が復帰したまま持ち越されるため。
- **意図的な C# からの差分 (2026-09-08): DCSG ノイズ LFSR のフィードバックを XOR に修正**。
  C# 版は white ノイズのフィードバックを `bit0 AND bit3` で実装しており、15bit LFSR が
  白噪開始から数ステップで `0x0000` (吸引点) に落ちて bit0 固定の DC 出力
  (reference.json の `dcsgNoiseSamples` が全標本 -0.25 定常であることが証拠) となり、
  実際の音は約 0.3ms で無音化する。実機 SN76489AN の正仕様は `bit0 XOR bit3`
  (TMS 系 15bit LFSR、periodic = bit0 パススルー) であるため、TS 版は XOR へ修正した
- **意図的な C# からの差分 (2026-09-08): DCSG ノイズ LFSR のフィードバックを XOR かつ 16bit 化**。
  C# 版は white ノイズのフィードバックを `bit0 AND bit3` で実装しており、15bit LFSR が
  白噪開始から数ステップで `0x0000` (吸引点) に落ちて bit0 固定の DC 出力
  (reference.json の `dcsgNoiseSamples` が全標本 -0.25 定常であることが証拠) となり、
  実際の音は約 0.3ms で無音化する。実機 SN76489AN の正仕様は
  **16bit シフトレジスタ (bit15 挿入) で white = `bit0 XOR bit3` / periodic = `bit0`**
  であるため、TS 版は XOR かつ 16bit へ修正した (`DcsgChip.shiftLfsr`、初期値 0x8000)。
  なお 15bit (bit14 挿入) のまま XOR にした場合もタップ (0,3) が最大長から外れ
  **63 ステップの短循環 (約 890Hz のブザー音)** となるため、16bit 化は必須
  (周期検証テスト: white > 30000 ステップ / periodic = 16 ステップ)。
  C# 標本との一致検証テスト (`renders the same noise samples
  as the C# reference`) は意図的差分として `it.skip` (理由コメント付き)。C# 本体側も
  同バグのため将来修正する際は reference.json 再生成 + 本テストの skip 解除で再照合可能。
- **意図的な C# からの差分 (2026-09-08): DCSG ノイズ出力への帯域制限フィルタ追加**。
  ノイズシフトクロック (55.9〜223.7kHz) は音声ナイキスト (24kHz) を大きく超えるため、
  ビット列をそのまま標本化すると折り返し雑音 (エイリアス) が金属的な高音として聞こえる。
  実機はアナログ出力段で高域が減衰するため、TS 版は `DcsgChip.renderSample` のノイズ出力に
  **2 段 1-pole LPF + RMS 補正ゲイン + DC ブロック (30Hz / 出力コンデンサ相当)** を追加した
  (カットオフはホワイトノイズのみ分周モード連動: rate 0/3 = 8kHz / 1 = 4kHz / 2 = 2kHz。
  周期ノイズは基本波が音の高さのため固定 8kHz。仮想キーボード
  `virtualSynth.ts` も `DcsgChip.lpfCutoffForRate` で同一基準)。
  効果は隣接標本差平均で検証 (無フィルタ ≈ 1.0 → 0.12、テスト `attenuates the alias high band`)。
- **意図的な C# からの差分 (2026-09-09): 専用ノイズトラックの分周ヒントを音名ベースへ変更**。
  C# 版は `TrackSequencer.cs` の周波数しきい値 (`freq < 40000 ? 2 : freq < 80000 ? 1 : 0`) のため
  実用音域で常に rate 2 に丸まり、c/e/g の 3 段階が聞こえなかった。本 IDE は C# 版リファレンス
  (`mz1500_sound_driver/mml_reference.md` §5.1) の記述どおり、音名で 3 段階
  (c〜d# = 2 低 / e〜f# = 1 中 / g〜b = 0 高、オクターブ不問) を選択する
  (`DcsgChip.noiseRateForNote` / `mzsd_driver.asm` `play_noise` の `pn_rate_tbl`)。

- **意図的な C# からの差分 (2026-09-09): REST 命令はノート発音中のみキーオフ**。
  C# 版は REST を無条件で KeyOff 扱いにするため、ゲート終端済み / 連続休符 / 曲先頭の
  休符でも `@VE` のリリース区間が再始動し、休符中にリリース音が鳴ってしまう。
  TS (`TrackSequencer` の `noteOn && gateRemaining > 0`) と asm (`ev_rest` の
  `CH_GATE != 0` 判定) は発音中のときだけキーオフする。`cr` のリリースはゲート終端
  キーオフで発生するため従来どおり演奏される。
  あわせて `@VE` 適用中の音量エンベロープ進行 / 減衰書き込みを「ノート発音中 /
  リリース中」に限定した (C# はノート外でもエンベロープ値を減衰レジスタへ書き続ける)。
  TS `TrackSequencer.applyVolumeFrame` と asm `venv_frame` の両方に同一ガードを追加し、
  休符中にエンベロープ値の音量が書き出されることがないようにしている。

## 4. 検証方針

1. **数値一致テスト**: C# 版のテスト期待値 (オペコード列 / フレーム数 / 周波数テーブル等) を
   TypeScript テストにそのまま流用し、ビット単位で一致させる。
2. **実ドライバ検証**: C# 版 `Z80DriverImage.Build` と同じ契約 (origin = 0x1200、
   `music_data` ラベル存在、org パディング除去) を vitest で常時検証する。
   実ドライバ 1945 行が TypeScript アセンブラでアセンブルできることが回帰防止になる。
3. **等価性テスト**: C# 版 `Z80DriverEquivalenceTests` を vitest に移植し、
   SourceInterpreter (`MzsdSequencer`) と Z80Driver (`Z80DriverMachine`) の全フレーム音源レジスタ
   (PSG×2 全パラメータ / BEEP counter・gate / YM2151 全 256 レジスタの書き込み有無と値) を比較する。
   **11 シナリオ全てが合格 (2026-09-06)**。かつて C# 版がスキップしていた 2 シナリオ (FM 音色
   レジスタマッピング) は、Z80 ドライバ `apply_fm_tone` 周辺の下記 3 バグ修正により解消した
   (`driver/mzsd_driver.asm`):
   - `ev_tone`: 音色番号範囲チェックが `音色数 - 1` と比較しており、最後の音色番号 (音色数 1 時は
     音色 0) が常に範囲外扱いでスキップされ、`apply_fm_tone` が一度も呼ばれていなかった →
     音色数との直接比較へ修正。
   - `aft_reg`: オペレータアドレス計算が `op*4` (`add a,a` ×2) で、OPM 正の `op*8` でなかった
     (op1 以降の書き込みが ch4-7 のレジスタ領域へ衝突) → `add a,a` を 1 回追加。
   - 0xC0 系 (DT2/D2R): DT2 読み出しが `hl` が既に p2 を指した状態で `+9` しており p11
     (次オペレータの AR) を読んでいた → `+7` (p9) に修正。
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
5. **Z80 コアの検証**: 内製コア (`src/core/z80/`) は 57 単体テスト (ALU / フラグ未文書ビット /
   T-state / ブロック命令 / 未文書 IXH・IXL / DDCB レジスタロード / 未定義オペコードの PC 進行 /
   16bit ポート) に加え、上記 §4.3 の実ドライバ等価性テストで実機相当の命令列を通した検証を行う。
   `lkesteloot/trs80` の `z80-test` (1356 テスト) による命令セット全数検証は、テストバイナリの
   取り込みと RST 38h 出力ハンドラ実装が必要なため **今後の検証拡充タスク** とする (§1.1)。
   **実現可能性調査完了 (2026-09-06)**:
   - `packages/z80-test` (MIT, Copyright (c) 2019 Lawrence Kesteloot) はテキスト形式の
     `tests.in` / `tests.expected` (計約 484 KB) を持ち、`Delegate` インターフェース
     (`getRegister` / `setRegister` / `readMemory` / `writeMemory` / `run(tStateCount)` /
     `getTStateCount` / `startNewTest`) を実装した任意のエミュレータを接続できる。
     `Runner` は `checkTStates` / `checkEvents` を無効化可能なため、レジスタ最終値 + メモリ変化
     の検証を主軸にできる。1 命令実行 API (`executeNextInstruction`) は内製コアに既存。
   - **前提要件 (未解決)**: 全テストが **MEMPTR** レジスタを検証対象とするが、内製コアは
     MEMPTR 未実装 (Z80dotNet 由来の移植時に省略)。完全合格には全命令ディスパッチへの
     MEMPTR 設定追加が必要で、コアへの大規模変更となる。MEMPTR は割り込み系挙動にのみ影響し、
     演奏ドライバ (割り込み未使用) には影響しないため、**MEMPTR 実装の要否を含め別タスクとして
     判断する**。

## 4.1 Z80dotNet 由来コードのライセンス表記

`src/core/z80/` は Z80dotNet (https://github.com/Konamiman/Z80dotNet, Copyright (C) 2014
Konamiman) を TypeScript へ移植・改変したものである。Z80dotNet の LICENSE.txt 条項
(著作権表示と許諾表示を全てのコピーに添付すること、改変部分を明示すること) に従い、
**2026-09-06 に以下を整備した**:

- `src/core/z80/` の各 `.ts` ファイル (Z80Processor / Z80Registers / MainRegisters / Z80Bus)
  の冒頭に、移植元の明示 (`This file is a TypeScript port of Z80.Net ...`)・改変者と日付
  (`Modified by hiromsa on 2026-09-06`)・著作権表示・**Permission 条文の全文併記**を記載。
- ルート [`LICENSE`](../../LICENSE) に Z80dotNet のライセンス全文 (改変版 MIT) を追記。
- [`README.md`](../../README.md) に Credits セクション (移植・改変の明記) を追加。

`Z80DriverImage.ts` / `Z80DriverMachine.ts` は C# 版プロジェクト (`mz1500_sound_devenv`) の
実装移植であり Z80dotNet コードを含まないが、CPU コアの挙動参照元として本節に記録する。

## 5. 履歴

| 日付 | 内容 |
|---|---|
| 2026/09/05 | 初版作成。アセンブラ・MML コンパイラ移植完了 (85 テスト全合格)。フォルダ再編 (view/app/core) 実施。 |
| 2026/09/05 | §1.1 追加: Z80 コア外部ライブラリ (`lkesteloot/z80-emulator`) を評価。依存採用は見送り、Z80dotNet 内製移植方針を再確定 (`z80-test` は検証基盤として活用)。 |
| 2026/09/05 | Phase 2 完了: 音源エミュレーション (DCSG ×2 / BEEP 8253 / YM2151 fmgen 由来) を移植。`tools/cs-probe` による C# リファレンス値とのビット一致検証を導入 (§3.1、§4.4 追加)。テスト合計 110 (アセンブラ 51 + MML 24 + チップ 25 + 実ドライバ 3 + …)。 |
| 2026/09/05 | Phase 3 完了: 演奏エンジン (`Sequencer` + `Audio` + `Player`) を移植。NAudio の合成部は Web Audio 非依存の `AudioFrameMixer` に分離、出力は AudioWorklet (Blob URL) + ScriptProcessor フォールバック。テスト合計 132 (Player 系 +22)。 |
| 2026/09/05 | Phase 4 完了: Z80 CPU コア (`src/core/z80/`、Z80dotNet 相当・全命令 / T-state / HALT / 16bit ポート) とドライバ実行環境 (`Z80DriverImage.ts` / `Z80DriverMachine.ts`) を移植。実ドライバが内蔵コア上で動作し、SourceInterpreter との全フレーム等価性テスト (9 シナリオ) 合格。テスト合計 209 合格 + 2 skip。§4.1 (ライセンス表記) / §4.5 (検証方針) 追加。 |
| 2026/09/05 | Phase 5 完了: UI 接続。`FrameDriver` 抽象 (`MzsdSequencer` / `Z80DriverPlayback` を同一視) を導入し `AudioEngine` に Z80Driver モードを接続。`src/core/export/QdfImageBuilder.ts` (C# QdcImageBuilder 移植・実機起動実績あり) による `EXPORT (.qdf)` (ドライバ込み実機起動イメージ格納) を実装。UI は MML BUILD → `MmlCompiler` (エラー → PROBLEMS / CONSOLE)、PLAY → `Player`、TrackMonitor を VU / 演奏位置 (`MmlMap`) 実データ連携化、SETTINGS に演奏エンジン切替を追加。テスト合計 222 合格 + 2 skip。 |
| 2026/09/06 | 等価性テスト 11/11 合格: Z80 ドライバ `apply_fm_tone` の 3 バグ (音色番号範囲チェック / `aft_reg` の op×4 → op×8 / 0xC0 系 DT2 オフセット p11 → p9) を修正し、C# 版持ち越しの skip 2 シナリオを解消 (§4.3)。§4.1 ライセンス表記 (LICENSE / README / 各 .ts ヘッダー) を整備。§4.5 に z80-test 実現可能性調査結果を追記 (MEMPTR 未実装が完全合格の前提要件と判明)。 |
