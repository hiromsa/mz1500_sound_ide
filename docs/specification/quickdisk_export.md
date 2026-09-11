# QuickDisk (.qdf) エクスポート仕様 (`docs/specification/quickdisk_export.md`)

本書は、MZ-1500 Sound IDE の `EXPORT PLAYER (.qdf)` 機能が生成する QuickDisk イメージの形式仕様と
実装契約 (`src/core/export/QdfImageBuilder.ts`) を記録するドキュメントです。

- **実装の参照元 (実績実装)**: `mz1500_sound_driver` プロジェクトの
  `Mz1500SoundPlayer/Sound/QdcImageBuilder.cs` (拡張子 `.qdc` は誤記で正しくは `.qdf`)。
  同実装は MZ-1500 エミュレータが QuickDisk イメージとして起動できるところまで動作確認済み。
  **(2026/09/11 更新)** 実機 QDF ダンプ (MARIO / PAC-MAN / GALAGA) との 1 バイト単位比較により、
  ブロック配置 (SYNC 数 / GAP 長) を実物準拠に修正し、MZ-1500 エミュレータ (C# 実装) の
  実機 IPL 経由でのロード・演奏を確認済み。
- **QD メディア仕様の一次情報**: `mz1500_emulator_csharp/docs/mz1500_specification/MZ1500_Storage_QuickDisk.md`
  (Common Source Project の QUICKDISCK クラス精査 + sample.qdf 実測)。CRC やブロック構造は同書 §3〜§5 に一致する。

---

## 1. 出力の概要

| 項目 | 値 |
|---|---|
| 拡張子 | `.qdf` |
| サイズ | **81,936 バイト (0x14010) 固定** (未使用領域は 0 埋め) |
| 収納内容 | MzSD サウンドドライバ + MZSD 楽曲データ (コンパイル結果) を 1 ファイルとして格納 |
| ロード / 実行アドレス | **0x1200 / 0x1200** (ドライバの IPL 互換エントリ。Z80DriverImage.LoadAddress と同一) |
| FileType (QD ヘッダ属性) | 0x01 (Object = 機械語) |

---

## 2. イメージ構造 (物理レイアウト)

```text
オフセット   サイズ        内容
0x0000       16            "-QD format-" (11B) + 0xFF x5
0x0010       0x12DA        GAP (0 埋め)
0x12EA       9             SYNC (0x16 x9)
0x12F3       2 + 2         Information Block (ディレクトリ): A5h + ブロック総数(2) + CRC16(L,H)
0x12F7       6             SYNC (0x16 x6)
0x12FD       2795          GAP (0 埋め)
0x1DE8       9             SYNC (0x16 x9)
0x1DF1       0x44 + 2      Header Block (68B) + CRC16
0x1E37       6             SYNC (0x16 x6)
0x1E3D       255           GAP (0 埋め)
0x1F3C       10            SYNC (0x16 x10)
0x1F46       0xBE04 + 2    Data Block (A5h + タイプ + サイズ + データ + 0 パディング) + CRC16
(末尾)       5             SYNC (0x16 x5) → 以降 0 埋めで 0x14010 まで
```

※ SYNC 数 / GAP 長 / ブロック位置 (ディレクトリ 0x12F3 / ヘッダ 0x1DF1 / データ 0x1F46) は
実機 QDF ダンプ (MARIO / PAC-MAN / GALAGA) と 1 バイト単位で一致させる。
汎用的な「全ブロック SYNC x10」構成では実機 IPL の自動ロードが開始しないことを確認済み。
※ QD リード側は 2,700 バイト目から SYNC を走査してブロックを探索する。

### 2.1 Header Block (68 バイト = 0x44 固定)

| オフセット | サイズ | 内容 |
|---|---|---|
| +0 | 1 | 0xA5 (データ開始マーカ) |
| +1 | 1 | ブロック属性 (0x00 = ヘッダブロック) |
| +2 | 2 | データサイズ (LE、0x0040 = 64 バイト) |
| +4 | 1 | FileType = **0x01 (Object)** |
| +5 | 16 | ファイル名 (ASCII。未使用部は **0x20 空白** — 0x0D 埋めだと IPL のロード表示が文字化けする) |
| +21 | 1 | 0x0D (ファイル名終端) |
| +22 | 2 | LOCK (0x00) / SECRET (0x00) |
| +24 | 2 | データサイズ (LE、**0xBE00 固定** — C# 版契約) |
| +26 | 2 | ロードアドレス (LE、**0x1200**) |
| +28 | 2 | 実行アドレス (LE、**0x1200**) |
| +30 | 38 | 0 埋め (0x44 までパディング) |

### 2.2 Data Block

| オフセット | サイズ | 内容 |
|---|---|---|
| +0 | 1 | 0xA5 (データ開始マーカ) |
| +1 | 1 | ブロック属性 (0x05 = データブロック) |
| +2 | 2 | データサイズ (LE、**0xBE00 固定** — C# 版契約) |
| +4 | 0xBE00 | **ドライバ + MZSD 楽曲データ**。不足分は 0 パディング (全体で 0xBE04 バイト) |

---

## 3. CRC

- **CRC-16/ARC**: 多項式 0xA001 (反射 / LSB first)、初期値 0、出力 XOR なし。
- 適用範囲: 各ブロックの **A5h マーカからデータ末尾まで** (末尾の SYNC は含まない)。
- 格納順序: 下位バイト → 上位バイト (LE)。
- 検証ベクトル: `crc16Arc("123456789") = 0xBB3D` (QdfImageBuilder.test.ts で担保)。

---

## 4. 実装契約 (`buildQuickDiskImage`)

```ts
buildQuickDiskImage(fileName: string, executableData: Uint8Array): Uint8Array
```

- `executableData` には **実機起動イメージ** (`Z80DriverImage.buildExecutableImage` が生成する
  「0x1200 に MzSD ドライバ、`music_data` 位置に MZSD 楽曲データ」を配置したバイナリ) を渡す。
  これは再生時の `Z80DriverMachine.load` と同一の配置であり、QD からロードして実行アドレス 0x1200
  へ飛べば実機で演奏が開始される。
- `executableData.length > 0xBE00` の場合は `Error` を投げる (QD データブロック上限)。
- `fileName` は ASCII 16 文字に正規化される (非 ASCII 文字は `?` に置換、以降は 0x0D パディング)。
  C# 版の Shift-JIS (Encoding 932) エンコードはブラウザ標準 API が存在しないため ASCII 限定とした。

### §4.1 UI 側の連携 (`App.handleExport`)

1. アクティブタブの MML を `MmlCompiler` でコンパイル (エラー時はダウンロードせず PROBLEMS へ)。
2. `Z80DriverImage.buildExecutableImage(defaultDriver, musicData)` でドライバ込み起動イメージを生成。
3. `buildQuickDiskImage(baseName, executableImage)` で .qdf を生成し Blob ダウンロード。
   - `baseName` は `#TITLE` (ASCII 正規化・16 文字) を優先し、未設定時はファイル名から `.mml` を除いたもの。
4. 成功後はコンソールへ `[EXPORT] SUCCESS: Exported "<baseName>.qdf" (81,936 bytes).` を出力し、
   演奏位置ハイライト用の `playbackMap` も更新する。

---

## 5. ドライバの実機互換動作 (`driver/mzsd_driver.asm` v1.3)

実機 MZ-1500 (および C# 実装のエミュレータ) で演奏するため、ドライバは以下の実機互換構成を採る。

| 項目 | 内容 |
|---|---|
| フレーム同期 | **60Hz タイマー割り込み駆動**。8253 ch1 = mode2 count 1 (BLANK 15.7kHz をカウント)、ch2 = mode0 count 0x107 = 263 (OUT1 の falling edge 263 回後に terminal → OUT2 high)、OUT2 AND 8255 PC2 (INTMSK) → Z80 /INT。VB リファレンス実装 (hotatemusic.qdf) 準拠。 |
| 割り込みモード | **IM1 (RST 38h)**。ROM 0038h ハンドラが RAM フック **1039h/103Ah** の ISR アドレスへジャンプするため、ドライバは init_isr_hook で 1038h=0xC3、1039h/103Ah=isr アドレスを設定する。 |
| ワーク領域 | **0xB000-0xB797** (CB + 17ch ブロック + ループスタック)。MonitorHigh (D000h-FFFFh = VRAM & I/O) 状態でも **0x1000-0xCFFF は RAM** として読み書きできるため、バンク切替は不要。ロードデータで一時的に上書きされるが、exec 後の init_work で初期化される。 |
| スタック | SP = 0xBFFF (ワーク領域の上部)。 |
| BEEP | E008h bit0 (GATE) は MonitorHigh のまま MMIO として書き込めるため、バンク切替は不要。 |

※ 旧実装 (v1.2) は E008h bit7 (H-BLANK) ポーリング + ワーク 0xF800 台 (D000h-FFFFh = VRAM & I/O 空間) を
使用しており、実機では (1) ワーク / スタックへの書き込みが VRAM & I/O 空間で無効化される、
(2) H-BLANK はスキャンライン単位 (15.7kHz) で変化するため 60Hz 同期にならない、の 2 点で動作しなかった。
IDE 内蔵環境 (`Z80DriverMachine`) はバンクなし常時 RAM で動作するため、この問題は QDF (実機相当) でのみ顕在化していた。

---

## 6. 履歴

| 日付 | 内容 |
|---|---|
| 2026/09/05 | 初版作成。Phase 5 で `QdfImageBuilder` (C# QdcImageBuilder 移植) と `EXPORT (.qdf)` を実装。 |
| 2026/09/11 | ブロック配置 (SYNC 数 / GAP 長) を実機 QDF ダンプ準拠に修正。ドライバ v1.3 (60Hz タイマー割り込み駆動 / RAM フック 1039h / ワーク 0xB000 系) へ改修し、MZ-1500 エミュレータ (C# 実装) での実機 IPL 経由ロード・演奏を確認。 |
