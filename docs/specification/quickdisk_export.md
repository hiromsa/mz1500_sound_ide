# QuickDisk (.qdf) エクスポート仕様 (`docs/specification/quickdisk_export.md`)

本書は、MZ-1500 Sound IDE の `EXPORT (.qdf)` 機能が生成する QuickDisk イメージの形式仕様と
実装契約 (`src/core/export/QdfImageBuilder.ts`) を記録するドキュメントです。

- **実装の参照元 (実績実装)**: `mz1500_sound_driver` プロジェクトの
  `Mz1500SoundPlayer/Sound/QdcImageBuilder.cs` (拡張子 `.qdc` は誤記で正しくは `.qdf`)。
  同実装は MZ-1500 エミュレータが QuickDisk イメージとして起動できるところまで動作確認済み。
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

```
オフセット   サイズ        内容
0x0000       16            "-QD format-" (11B) + 0xFF x5
0x0010       0x12DA        GAP (0 埋め)
0x12EA       10            SYNC (0x16 x10)
0x12F4       2 + 2         Information Block (ディレクトリ): A5h + ブロック総数(2) + CRC16(L,H)
0x12FA       10            SYNC (0x16 x10)
0x1304       0xAEB         GAP (0 埋め)
0x1DEF       1 + 10        0x00 マーカ + SYNC x10
0x1DFA       0x44 + 2      Header Block (68B) + CRC16
0x1E40       10            SYNC x10
0x1E4A       0xFF          GAP (0 埋め)
0x1F49       10            SYNC x10
0x1F53       0xBE04 + 2    Data Block (A5h + タイプ + サイズ + データ + 0 パディング) + CRC16
(末尾)       10            SYNC x10 → 以降 0 埋めで 0x14010 まで
```

※ 実機の QD リード側は 2,700 バイト目から SYNC を走査してブロックを探索するため、
GAP の厳密な長さは識別に影響しない。本実装は実績のある C# 版と同一の値を採用した。

### 2.1 Header Block (68 バイト = 0x44 固定)

| オフセット | サイズ | 内容 |
|---|---|---|
| +0 | 1 | 0xA5 (データ開始マーカ) |
| +1 | 1 | ブロック属性 (0x00 = ヘッダブロック) |
| +2 | 2 | データサイズ (LE、0x0040 = 64 バイト) |
| +4 | 1 | FileType = **0x01 (Object)** |
| +5 | 16 | ファイル名 (ASCII、0x0D パディング) |
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

## 5. 履歴

| 日付 | 内容 |
|---|---|
| 2026/09/05 | 初版作成。Phase 5 で `QdfImageBuilder` (C# QdcImageBuilder 移植) と `EXPORT (.qdf)` を実装。 |
