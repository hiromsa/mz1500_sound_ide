# MZ-1500 Sound IDE 開発進捗記録 (`PROGRESS.md`)

本書は、MZ-1500 Sound IDE の現在進行中のタスク、残タスク（ToDo）、および直近の完了作業を記録・管理するドキュメントです。
※ 過去の膨大な完了作業ログ（モック期、Webコア移植期、初期UI設計等の詳細履歴）は [PROGRESS_HISTORY.md](./PROGRESS_HISTORY.md) にアーカイブされています。

---

## 1. 現在のステータス概要
- **バージョン**: `v0.0.1-beta.92`（コミット通番＋短縮ハッシュ ハイブリッド方式）
- **テスト通過状況**: 全 34 テストファイル / 450 件パス（`npm test` / Vitest）
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
- [ ] **MML エディタへの専用コード補完プロバイダー実装 (辞書ベース)** ※優先度: 低 (2026-09-07 ユーザー確定)
  - 不自然な候補の原因だった Monaco 既定ワードベースサジェストは無効化済み (`MmlEditor.tsx` の `options.wordBasedSuggestions: 'off'`)。ただし現状 Ctrl+Space でも何も候補が出ない状態。
  - **実装方針 (2026-09-07 調査・確定済み)**:
    1. `src/utils/mmlCompletion.ts` (新規・ロジック層): MML コマンド辞書 (静的データ: トラック指定子 / ディレクティブ / 音符・休符 / コマンド `o`,`l`,`v`,`t`,`q`,`K`,`D`,`^`,`[`,`]`,`@`系 等 + 説明文) とプレフィックス・文脈フィルタの純粋関数。規模感 約 200〜300 行。
    2. `src/utils/mmlLanguage.ts` へ `monaco.languages.registerCompletionItemProvider` の登録を追加 (約 50 行)。
    3. 文脈判定は既存 `src/utils/mmlCaretParser.ts` (`MmlCaretContext.engine`) を流用。FM トラック内では `@v` (0-127) を優先提示、DCSG トラックでは `v` (0-15) を提示、等の絞り込み。
    4. 候補出し分け: 行頭=トラック指定子 (`P1`-`P6` / `N1`-`N2` / `B1` / `F1`-`F8` / `W1`-`W99`)、`#` 入力=ディレクティブ (`#TITLE` / `#COMPOSER` / `#OCTAVE` / `#OPM` / `#FM`)、`@` 入力=マクロ (`@1` / `@VE1` / `@PE1` / `@v` / `@q` / `@t` / `@WN` / `@IN` / `@SW`)、英字入力=MML コマンド。
    5. 辞書の元ネタ: Monarch トークン定義 (`src/utils/mmlLanguage.ts`) と `docs/specification/mml_reference.md`。
    6. テスト: `src/utils/__tests__/mmlCompletion.test.ts` を `mmlCaretParser.test.ts` のパターンに準拠して新設 (ロジック層は Monaco 非依存でテスト可能に設計)。
- [ ] **GitHub Pages 自動デプロイの設定切替 (ユーザー操作)**
  - GitHub リポジトリの Settings → Pages の Source を `Deploy from a branch` から `GitHub Actions` へ切り替える。
  - 切替後は main ブランチへの push に連動して自動ビルド・デプロイが実行されます（仕様詳細は [`docs/specification/ci_deploy.md`](./specification/ci_deploy.md) 参照）。
- [ ] **MCP `chrome-devtools-mcp` の初回動作確認**
  - 設定済み・未検証（詳細は [`docs/specification/mcp-browser-debug.md`](./specification/mcp-browser-debug.md) 参照）。次回ブラウザデバッグ時に Chrome 接続〜ログ・スクリーンショット取得の流れを検証。

---

## 3. 直近の完了作業（最新）

- **ノイズトラック (N1) が PLAY で鳴らない問題を修正 — TrackId の並び順を演奏系と統一 (`src/core/mml/TrackId.ts`, `src/core/player/__tests__/NoiseTrackPlayback.test.ts` 新設)** (2026-09-08):
  - **背景・ユーザー指摘**: 「ノイズ PLAYボタンでなりません。普通に音がなってます。」(psg_noise_basic.mml サンプルで N1 のノイズだけ鳴らない)
  - **原因**:
    - MML コンパイラ側の `TrackId.buildAllTracks` だけが `P1..P6, N1(6), N2(7), B1(8), F1-F8` の並び (N1 = trackIndex 6) で、演奏側 (TS `TrackSequencer.resolveDcsg` / `isNoise` / `AudioFrameMixer.setTrackGain` / `driver/mzsd_driver.asm` の `init_ch_regs`) が期待する MZ-1500 音源構成順 `P1,P2,P3,N1(3),P4,P5,P6,N2(7),B1(8),F1-F8` と不一致していた。
    - このため N1 のトラックデータがトラックテーブル slot 6 (**P6 = psg2 ch2 矩形波**) へ書かれ、N1 (slot 3) は「データなし」扱いでノイズチャンネル (psg1 ch3) が一切発音しなかった。N2 (7) は偶然一致していたため N1 だけが破綻する形。
    - Z80DriverEquivalence テストで検出できなかった理由: TS シーケンサと asm ドライバがどちらも「slot 6 = P6」と同一解釈するため両エンジンは等価のまま (コンパイラ ↔ 演奏系の断絶はこのテストでは見えない)。
  - **対応内容**:
    1. `TrackId.buildAllTracks` を正しい並び順に修正 (`P1-P3 → N1 → P4-P6 → N2 → B1 → F1-F8`、N1=3 / N2=7)。仕様準拠 (`mml_reference.md` §1: DCSG1 = P1,P2,P3,N1 / DCSG2 = P4,P5,P6,N2)。
    2. 回帰テスト `NoiseTrackPlayback.test.ts` (新設 5 ケース): N1 データが slot 3 へ書かれ slot 6 (P6) が空であること / N2 は slot 7 / **実サンプル (psg_noise_basic.mml 相当) を両エンジン (SourceInterpreter / Z80Driver) で駆動し、ノイズチャンネル減衰レジスタ < 15 かつ波形出力 > 0.01 で発音を検証** (PSG1 = N1 / PSG2 = N2)。
  - **テスト**: `npx tsc -b` エラーゼロ / `npm test` 全 34 ファイル・450 件合格 (+5) / `npm run build` 成功 / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。
  - **補足 (仕様メモ)**: 非連動ノイズ (`@WN0`/`@WN1` のみ) では SN76489 ハードウェア仕様上、音符の音程はノイズ分周 3 段階 (低中高) の自動ヒントにのみ反映され、音程どおりの高さ変化はしない。音程に連動させたい場合は `@IN1` / `@IN2` (P3 / P6 との同期連動) を使用する (psg_noise_interlock.mml 参照)。

- **mml_reference へ音源別 (fm / psg / beep) コマンド学習サンプルを整備 (`samples/mml_reference/fm|psg|beep/` 新設 14 ファイル追加・既存 2 ファイル移動, `samples/mml_reference/README.md`)** (2026-09-08):
  - **背景・ユーザー要望**: 「mml_referenceフォルダに色々なサンプルの.mmlを置いていきたいです。コマンド毎の動作が確認でき、書き方がわかるようにする意図があります。考えられるものをいくつか作ってみてください。fm音源とPSG、BEEPは分けたいです。」
  - **対応内容**:
    - `samples/mml_reference/` 配下に `fm/` `psg/` `beep/` サブフォルダを新設し、コマンドの動作を聞き比べられる 1 テーマ 1 ファイル構成のサンプル 12 本を新規追加。既存 `quantize.mml` / `volume2.mml` は PSG サンプルとして `psg/` へ移動。
    - `fm/`: `@v` 音量 / `@N`・`@FMN` 音色定義切替 / `p` パン / `D`・`@SW`・`@PE` (`fm_volume_atv` / `fm_voice_macro` / `fm_panpot` / `fm_pitch_effect`)。
    - `psg/`: 音符・休符・付点・タイ・連符 / `o`・`<>`・`K` / `t`・`@t`・`l` / `@VE` (減衰・ループ・リリース) / `@PE`・`@SW`・`D` / `[]`・`L` / `@WN` / `@IN` (`psg_notes_basic` / `psg_octave_transpose` / `psg_tempo_length` / `psg_volume_envelope` / `psg_pitch_effect` / `psg_loop_flow` / `psg_noise_basic` / `psg_noise_interlock`)。
    - `beep/`: `B1` 音階 / `@SW`・`@PE`・`D` (`beep_basic_scale` / `beep_pitch_effect`)。
    - `README.md` にフォルダ構成と「ファイル × 確認できるコマンド」対応表を追記。
    - 既存 `psg/volume2.mml` の `v16` (0-15 範囲外で警告発生) を `v15` に修正し、mml_reference 配下全 16 ファイルがエラー・警告ゼロでコンパイルできることを一時検証テストで確認。
  - **検証**: `npm test` 全 33 ファイル・445 件合格 / samples/ 配下全 .mml のエラー・警告ゼロコンパイル確認。

- **TRACK_END 時のリリース巻き戻し防止 & 仮想キーボード押下音の @VE リリース対応 (`src/core/player/TrackSequencer.ts`, `driver/mzsd_driver.asm`, `src/utils/virtualSynth.ts`, `src/view/VirtualKeyboard.tsx`, `src/view/MmlEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md), [`docs/specification/web_core_port.md`](./specification/web_core_port.md))** (2026-09-08):
  - **背景・ユーザー指摘**:
    - 「TRACK_END 時の do_keyoff が既にリリース再生済み (無音) の場合もリリース先頭へ巻き戻すため、曲自然終了の瞬間に僅かに音量が復帰して停止する」対応依頼。
    - 「仮想キーボードの押下時の音は先ほどと同じ不具合 (リリースに遷移) が残っている」。
  - **対応内容**:
    1. **TRACK_END / 不明命令時の無音固定**: TS `TrackSequencer` に `silence()` を新設し `TrackEnd` / `default` で `keyOff()` の代わりに呼ぶよう変更。asm も `end_silence` ルーチンを新設し `ev_end` から呼ぶよう変更 (既存 `do_stop` = 全消音停止ルーチンとのラベル衝突に注意)。**asm 側は同一フレーム内で `ev_end` 後も `venv_frame` が走り無音固定を上書きするため、`run_events` 後に ended フラグを検査してエンベロープ進行をスキップするよう修正** (TS の tick は TrackEnd 後 `applyVolumeFrame` をスキップするため)。これにより曲自然終了時の音量復帰、および venv + BEEP トラックで曲終了後にゲートが ON のまま持ち越される問題も解消。**C# オリジナル (TrackEnd → KeyOff) からの意図的な差分**として `web_core_port.md` §3.1 に記録。
    2. **仮想キーボードの @VE リリース対応** (`virtualSynth.ts`): `SynthPlayOptions.volEnvRelease` を新設。`VolumeEnvelopePlayback` クラス (KEY ON 中は `[loop, release)` サステイン区間をループ / リリース未指定はリリース直前ホールド、KEY OFF でリリース区間を 1 回再生して自動停止) と純粋関数 `sustainEnvelopeIndex` を実装し PSG / NOISE 両エンジンに適用。`noteOff` はリリース定義ありの場合 KEY OFF でリリースフェーズへ遷移、リトリガー時は `stopVoice` で即時停止。
    3. **リリース位置の配線**: V-ENV エディタ `onChangeEnvData(data, loop, release)` 第3引数追加 → App `activeVolEnvRelease` state 新設 → `MmlEditor` / `VirtualKeyboard` へ props 追加 → `effectiveVolEnvData` が release を返却 → `options.volEnvRelease` へ設定。MML 定義からの取得は既存 `loadVolEnvDefinition().releasePoint` を使用。
  - **テスト**: `MzsdSequencer.test.ts` の @VE 回帰テストを TRACK_END (51 フレーム目) を含む 54 フレーム検証に拡張 (終端で無音固定)。`virtualSynth.test.ts` (新規) に `sustainEnvelopeIndex` のセマンティクス固定テスト 6 ケース追加。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 33 ファイル・445 件合格 (+6) / `npm run build` 成功 / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。

- **@VE (音量エンベロープ) の KEY ON 中にリリース区間が再生される問題を修正 (`src/core/player/TrackSequencer.ts`, `driver/mzsd_driver.asm`, `src/view/VolEnvelopeEditor.tsx`, [`docs/specification/mml_reference.md`](./specification/mml_reference.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「`@VE1 = { 15, 14, 13, |, 12, 11, >, 8, 5, 2, 0 }` を演奏すると KEYON 途中でも @VE のリリースに遷移してしまいます。8,5,2,0 が繰り返し鳴っている」
  - **原因**: 両演奏エンジン (TS `TrackSequencer` / Z80 ドライバ `venv_frame`) のノート中エンベロープ進行が「全要素の末尾 (リリース区間含む) に到達したら loopIndex へ戻る」実装になっており、KEY ON 中にリリース区間 (`>` 以降) を演奏してループしていた。仕様 (4.1「`>` 以降はノート OFF 後に再生される余韻」) と V-ENV エディタのプレビュー実装が正。
  - **対応内容**:
    1. **`TrackSequencer.ts` (`applyVolumeFrame`) / `mzsd_driver.asm` (`venv_frame`)**: ノート中 (KEY ON) のループ終端をリリース位置 (releaseIndex 有効時) に変更。KEY ON 中のループ区間 = `[loopIndex, releaseIndex)` となり `|`〜`>` 直前を循環する (例: 12,11 をループ)。リリース未指定時は従来どおり末尾ループ。**`|` なしで `>` のみ指定の場合はリリース直前でホールド (サステイン)** するよう変更。
    2. **`VolEnvelopeEditor.tsx` (試聴プレビュー)**: ループ未指定 + リリースありのケースでリリース直前でホールドするよう演奏エンジンと挙動を統一。
    3. **ドキュメント**: `mml_reference.md` 4.1 に「`>` 指定時はノート ON 中のループ区間が `|`〜`>` 直前までに限定」を明記。
  - **テスト (+2)**: `MzsdSequencer.test.ts` にユーザー報告と同一 @VE のセマンティクス固定テスト (KEY ON 中は att 3,4 ループ = 12,11 / キーオフ後に att 7,10,13,15 = 8,5,2,0 を 1 回再生して末尾ホールド)、`Z80DriverEquivalence.test.ts` に同エンベロープの両エンジン等価テストを追加。既存 venv 等価テストのコメントを新挙動 (サステインループ 2..4) に更新。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 32 ファイル・439 件合格 (+2) / `npm run build` 成功 / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。
  - **判明事項 (別課題)**: TRACK_END 時の `do_keyoff` は既にリリース再生済み (無音) の場合もリリース先頭へ巻き戻すため、曲終了直後に音量が僅かに復帰して停止する (C# 準拠の既存挙動・両エンジン一致)。要望があれば別途検討。

- **仮想キーボードの PITCH @PE OFF 選択時も MML キャレットの @PE が発音へ適用される問題を修正 (`src/view/VirtualKeyboard.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「@PEも同様の不具合ありました。」(VOL DIRECT 選択時の @VE 適用問題と同種)
  - **原因**: `effectivePitchEnvData` 内に「プルダウンが `@PE OFF` でも MML キャレットに `@PE` 指定があれば発音へ適用する」分岐が残っており、OFF を選んでもエンベロープが鳴っていた。
  - **対応内容**:
    - 当該分岐を削除し、**手動選択 (`@PE OFF` / `@PE (EDITOR)` / `@PE<ID>`) を最優先**。
    - `@PE OFF` 選択中は MML キャレットの `@PE` 指定があってもピッチエンベロープ無しで発音される。
    - MML キャレット移動時の自動連動 (`@PE` 検出時に該当 ID へ自動切替) は従来どおり有効。
  - **検証**: `npx tsc -b` エラーゼロ / `npm run lint` 警告増加なし・エラーゼロ / `npm test` 全 32 ファイル・437 件合格。

- **仮想キーボードの VOL DIRECT 選択時に MML キャレットの @VE が発音へ適用される問題を修正 (`src/view/VirtualKeyboard.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「MML Editorモードで、仮想キーボードの VOL を DIRECTにしても、仮想キーボードを押すと@VE が有効になって鳴っています。」
  - **原因**: `effectiveVolEnvData` の適用条件が `psgVolumeMode === 'env' || (activeTabContext === 'mml' && mmlContext?.volEnvId)` となっており、ユーザーが `DIRECT` を明示選択していても MML キャレット位置に `@VE` 指定があれば発音へエンベロープが適用されていた。
  - **対応内容**:
    - 適用条件を `psgVolumeMode === 'env'` のみに修正し、**手動選択 (DIRECT / @VE) を最優先**。
    - `DIRECT` 選択中は MML キャレットの `@VE` 指定があっても直接音量 (0〜15) で発音される。
    - MML キャレット移動時の自動連動 (`@VE` 検出時に `@VE` モードへ自動切替) は従来どおり有効。
  - **検証**: `npx tsc -b` エラーゼロ / `npm run lint` 警告増加なし・エラーゼロ / `npm test` 全 32 ファイル・437 件合格。

- **仮想キーボードの V-ENV / P-ENV プルダウンも MML 定義済みリストへ刷新 (`src/view/VirtualKeyboard.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー要望**: 「V-ENV / P-ENV も同様にお願いします。」(FM VOICE プルダウンの MML 定義ベース化と同様の対応)
  - **対応内容**:
    - `definedPitchEnvs` / `definedVolEnvs` useMemo を新設し、MML 上で定義済みの `@PEN` / `@VEN` を ID 昇順の動的リスト化 (`loadPitchEnvDefinition` / `loadVolEnvDefinition` 使用)。
    - PITCH プルダウン: モック (`@PE1: Vib Mild` 等) を廃止し、`@PEID: NAME` (NAME 未設定時は `UNNAMED`) を動的表示。
    - VOLUME (@VE モード) プルダウン: モック (`@VE1: Piano` 等) を廃止し、同様に動的表示。
    - 発音 (`effectivePitchEnvData` / `effectiveVolEnvData`) も MML 定義データを使用するよう修正 (ENV エディタ表示中は従来どおりエディタ編集中のカーブを優先)。
    - モック定数 `PRESET_PITCH_ENVS` / `PRESET_VOL_ENVS` を完全削除。
  - **検証**: `npx tsc -b` エラーゼロ / `npm run lint` 警告増加なし・エラーゼロ / `npm test` 全 32 ファイル・437 件合格。

- **仮想キーボードの FM VOICE プルダウンを MML 定義済み音色の実表示に刷新 (`src/view/VirtualKeyboard.tsx`, `src/view/MmlEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「仮想キーボードのFM 音色選択プルダウンで、正しいNAMEが表示されていません。モック？」
  - **原因**: プルダウン選択肢がハードコードのモック (`DEFAULT_PRESET_FM_TONES`: `E.PIANO 1` / `SLAP BASS` / `BRASS ENS` / `CRYSTAL BELL`) で、MML 上の定義と無関係。また選択値は発音にも使用されていなかった。
  - **対応内容**:
    - `VirtualKeyboard` に `mmlSource` props を新設 (`MmlEditor` からアクティブタブの MML 全文 `activeFile.content` を供給)。
    - `findDefinitionBlocks` + `loadFmToneDefinition` により、**MML 上で定義済みの FM 音色 (@N) を ID 昇順で動的リスト化** (`definedFmTones` useMemo)。プルダウンは `@ID: NAME` 形式で表示 (NAME 未設定時は `UNNAMED`)。
    - 選択中 ID が MML から消えた場合は先頭の定義へ自動フォールバック (`effectiveSelectedFmToneId` useMemo / render 派生値のため set-state-in-effect 警告なし)。
    - **発音連動**: FM 時のテスト発音は、TONE タブ表示中は従来どおりエディタ編集中の音色を優先し、それ以外はプルダウンで選択中の MML 定義音色 (`options.fmTone`) を使用するよう修正。
    - モック `DEFAULT_PRESET_FM_TONES` を完全削除。TONE タブの表示バッジも `name ?? 'TONE'` → `name || 'UNNAMED'` に統一。
  - **検証**: `npx tsc -b` エラーゼロ / `npm run lint` 警告増加なし・エラーゼロ / `npm test` 全 32 ファイル・437 件合格。

- **FM TONE の未定義 ID 入力時に NAME へプリセット名が入る問題を修正 (`src/view/FmToneEditor.tsx`)** (2026-09-08):
  - **背景・ユーザー指摘**: 「FM TONE で IDのところに 未使用の番号 を入力すると、NAME に E.PIANO 1 入ってしまいます。」
  - **原因**: 未定義 ID 用フォールバック `createDefaultToneData(id)` が既定プリセット (`PRESET_TONES[0]` / E.PIANO 1) を **name 含め** そのまま複製していた。
  - **対応内容**:
    - `createDefaultToneData` に `name: ''` を追加し、未定義 ID 入力時・右クリック「編集」ロード時 (`loadToneId` useEffect) ともに NAME は空文字で開始するよう統一。
    - これにより FM TONE の NAME 自動入力経路 (初期 state / 未定義 ID フォールバック / プリセット適用) がすべて「NAME は空を維持」に統一完了。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 32 ファイル・437 件合格。

- **FM TONE 初期 NAME の空化 & 未設定名の UNNAMED 統一 (`src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, `src/utils/mmlDefinitionLoader.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「FM TONEのNAME初期値が E.PIANO とか入ります。」「また、タブ間で未設定の名前が違います UNNAMED 、DEFAULT → UNNAMEDに統一してください。」
  - **対応内容**:
    - FM TONE: 初期 `toneData` を `PRESET_TONES[0]` そのままから `{ ...PRESET_TONES[0], name: '' }` へ変更し、パラメータは初期プリセットのまま NAME のみ空で開始。
    - V-ENV / P-ENV: `envName` 初期値 (`useState`)、ID 変更時 (`handleIdChange`)・ロードリクエスト時 (useEffect) のフォールバックを `'DEFAULT'` → `''` (空) へ変更。
    - MML スニペット出力: 未設定時フォールバックを V-ENV / P-ENV の `'DEFAULT'` → `'UNNAMED'` へ変更し FM TONE と統一 (全エディタで `/* NAME: UNNAMED */` に統一)。
    - `mmlDefinitionLoader.loadFmToneDefinition`: 定義コメントに名称が無い場合のロード結果を `'UNNAMED'` → `''` (空) へ変更 (入力欄へ勝手に名前を入れない方針に統一、MML 出力時のみ UNNAMED フォールバック)。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 32 ファイル・437 件合格。

- **プリセット選択時の NAME 自動反映を廃止 (`src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー要望**: 「FM TONEやV-ENV、P-ENV で プリセットを選択したときに、NAMEには何もはいらないようにしたいです。あくまでもプリセットで参考値として使いたいだけなので。」
  - **対応内容 (A案: NAME 変更なし・既存値保持)**:
    - 3 エディタの `handleApplyPreset` からプリセット名の NAME 設定を廃止。プリセット選択時はパラメータのみ適用し、NAME 入力欄は既存の値をそのまま保持する。
    - FM TONE: プリセット `FmToneData` のディープコピー時に `name: toneData.name` で現在値を維持。
    - V-ENV / P-ENV: `setEnvName(p.name)` 呼び出しを削除。
    - 名称の復元は従来どおり MML からのロード時（`/* NAME: ... */` コメント）のみ。
  - **ユーザー確定判断 (2026-09-08)**: 選択肢 (A: NAME 変更なし / B: 毎回クリア) のうち **案 A「NAMEには何も設定しない」** を選択。

- **FM TONE の「MMLに反映」出力書式を簡素化 (`src/view/FmToneEditor.tsx`, `src/utils/__tests__/mmlDefinitionLoader.test.ts`, `src/core/mml/__tests__/MmlCompilerAdvanced.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー要望**: 「FM TONE で INSERTするMML はこんな書式にしたいです。」(例示: `/* ALG, FB */` ラベル + OP 共通パラメータ順ラベルのみの 46 値列)「OP1 とか Carrier とか、 ALG FBの数値不要」
  - **対応内容**:
    - `FmToneEditor.generateMmlSnippet` の出力を `/* ALG, FB */` (数値なし) + `/* AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME */` (OP1〜OP4 共通の順序説明、1 回のみ) のシンプル書式へ変更。
    - 従来付与していた OP 個別ラベル (`/* OP1: ... */` 〜 `/* OP4 (Carrier) */`) と行末の `; Carrier` コメントを廃止。
    - コンパイラ (`splitMacroTokens`) とローダー (`splitDefinitionTokens`) はコメント除去後に数値列をパースするため、既存 MML (旧書式) のコンパイル・ロードは後方互換で変化なし。名称フォールバック抽出 (`extractDefinitionName`) も `ALG` / `AR` 始まりのラベルコメントは予約キーワードとして自動除外されるため影響なし。
  - **テスト**: `mmlDefinitionLoader.test.ts` に新書式ロードケース追加、`MmlCompilerAdvanced.test.ts` に新書式コンパイルケース追加。

- **「エクスプローラーで表示」(Reveal in File Explorer) 機能の Web 制約調査 & 見送り判断の仕様書明記 ([`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー要望**: 「EXPLORER の部分、右クリックでファイルエクスプローラーで表示 が欲しいです。VSCodeみたいの。」
  - **調査結果 (技術的制約)**:
    - VS Code は Electron デスクトップアプリのため `shell.showItemInFolder()` で実現可能だが、本 IDE はブラウザサンドボックス内で動作する Web アプリであり、Web 標準 API (File System Access API 含む) には OS ネイティブのエクスプローラーウィンドウを開く手段が存在しない。
    - `window.open('file:///...')` 等による file スキーム起動もブラウザセキュリティポリシーによりブロックされる。
  - **ユーザー確定判断 (2026-09-08)**: 選択肢 (A: フォルダ選択ダイアログ代替 / B: 見送り・仕様書明記 / C: Electron 化) のうち **案 B「見送り (仕様書に制約を明記するのみ)」** を選択。
    - `showDirectoryPicker({ startIn })` によるダイアログ代替は「表示中のページ操作ブロック」「純粋な表示ではない」ため不採用。
    - Web ネイティブ完結方針を維持し、制約と技術的理由・代替案検討結果・将来再検討トリガーを `docs/specification/ui.md` §3.13-9 に明記。
  - **ソースコード変更**: なし (ドキュメントのみの対応)。

- **LOCAL FOLDER の新規作成ファイルのリネーム・実ディスク同期 & エディタ連動の修正、F2キーリネーム & 右クリックコンテキストメニュー新設 (`src/view/FileExplorer.tsx`, `src/view/MmlEditor.tsx`, `src/data/__tests__/sampleMmlSongs.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-08):
  - **背景・ユーザー指摘**:
    - 「LOCAL FOLDER で新規作成したファイルについて、ファイル名を変更したのに反映されていません。」
    - 「リネームは出来ましたが、EXPLORER(本アプリの左側)の名称は変わりません。実ファイル名は変わってます。」
    - 「また、リネームはf2 キーでも行いたいです。右クリックでも新規(ファイル、フォルダ)、名称変更、削除 指示したいです」
  - **対応内容**:
    - **エクスプローラー表示名の確実な更新 & 実ディスク再同期 (`rescanLocalFolder`)**:
      - `applyRename` でイミュータブル更新に加えアイテムオブジェクトの `name` プロパティを直接更新。
      - リネーム確定後、`dirHandleRef.current` が存在する場合は `rescanLocalFolder()` を実行して実ディスクの最新ディレクトリ内容とツリーおよび全ファイルハンドルを自動同期。
      - 日本語 IME 変換中の Enter (`e.nativeEvent.isComposing`) での誤確定を防止。
    - **`F2` キー / `Delete` キー操作**:
      - 選択中（クリックした）ファイルまたはフォルダに対して `F2` キー押下で即座にインライン編集を開始。
      - `Delete` キー押下で削除確認ダイアログを表示。
    - **右クリックコンテキストメニュー新設 (`contextMenu`)**:
      - ファイル上、フォルダ上、およびエクスプローラーの余白（背景）での右クリック時に、DAW/IDE標準の洗練されたダークテーマコンテキストメニューを表示。
      - ファイル上: 「名称変更 (`F2`)」「削除 (`Delete`)」「新規ファイル」「新規フォルダ」
      - フォルダ上: 「新規ファイル（フォルダ内）」「新規フォルダ（フォルダ内）」「名称変更 (`F2`)」「削除 (`Delete`)」
      - 背景余白: 「新規ファイル」「新規フォルダ」
      - 画面端の見切れ自動補正、外側クリックまたは `Escape` キーでの自動クローズに対応。
    - **確認ダイアログ・コンテキストメニューの全面最前面描画 (`createPortal`)**:
      - 削除確認等のモーダル（`ConfirmDialog`）が、親コンテナである Left Pane（`App.tsx` の `z-0`）のスタッキングコンテキスト内に閉じ込められていたため、右ペイン（TONE, V-ENV 等）の裏に隠れる不具合を解消。
      - `ConfirmDialog` および `FileExplorer` の `contextMenu` を `createPortal(..., document.body)` で `document.body` 直下にマウントし、`z-[9999]` で画面全体の中央・最前面に表示されるように修正。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 32 ファイル・435 件合格 / `npm run build` 成功。
    - ブラウザ実機検証にて、右クリックメニューおよび削除確認ダイアログが TONE / V-ENV / エディタ領域全面の最前面に美しく表示されることを確認。

- **プロジェクトルート `samples/` フォルダ連動の SAMPLE MML 動的読み込み化 & ユーザー用 `mml_reference/` フォルダ新設 (`samples/` 新設, `src/data/sampleMmlSongs.ts` 全面改修, `src/view/FileExplorer.tsx`, `src/data/__tests__/sampleMmlSongs.test.ts` / `src/core/transform/__tests__/mmlTransformEngine.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー要望**:
    - 「色々自分で作ったサンプル.mmlを組み込んで入れたい。mml_reference として。他にも今後フォルダ作って入れておきたい。プロジェクト内にルートフォルダを作っておいてほしい。既にあるサンプルもそのフォルダの中へ移動。」
    - 構成はユーザー確定: `samples/` 直下に `mml_reference/`（新規）と `classics/`（既存 5 曲）を並列配置し、中身の無い demos/・templates/ ダミーは削除。
  - **対応内容**:
    - **`samples/` フォルダ新設**: プロジェクトルートに `samples/mml_reference/`（ユーザー自作 MML 置き場・使い方 README 同梱）と `samples/classics/`（古典 5 曲を .mml 実ファイル化して移行）を配置。
    - **`src/data/sampleMmlSongs.ts` 全面改修（データ層）**: TS 文字列ハードコードから Vite `import.meta.glob('/samples/**/*.mml', { query: '?raw', import: 'default', eager: true })` による**フォルダ動的読み込み**へ刷新。`SampleMmlFile` 型（id / fileName / folderPath / relativePath / content）+ `SAMPLE_MML_FILES` + `findSampleFileById` / `findSampleFileByRelativePath` を提供。id は `samples/` からの相対パス（例: `classics/classic_fur_elise.mml`）で一意性を保証。UI とデータの疎結合を維持（本モジュールはファイル解決のみを担い、ツリー構築は UI 側）。
    - **`FileExplorer.tsx`**: `INITIAL_SAMPLE_FILES` ハードコード（demos/classics/templates ダミー含む）を廃止し、`buildSampleMmlTree()` で samples/ の実フォルダ構造からツリーを自動構築（フォルダ初期展開・フォルダ先行/名前順ソート・フォルダ id はパスベースでユニーク化）。サンプルクリック時は保持済み `content` を渡す簡素化（`findSampleSongById` 参照廃止）。
    - **テスト刷新**: `sampleMmlSongs.test.ts` は samples/ 配下の全 .mml を対象に（一意性 / ソート順 / 全曲エラー・警告ゼロコンパイル / 検索ヘルパー）+ classics/ 固有の作法規約（`L` 宣言 / BEEP 音量禁止 / `#OPM` 連動 / loopOffset==dataOffset）を分離検証。`mmlTransformEngine.test.ts` のサンプル曲統合テストも `SAMPLE_MML_FILES` ベースへ移行。ユーザーが追加した .mml も自動的に検証対象になる。
  - **検証**:
    - `npx tsc -b` エラーゼロ / `npm test` 全 435 件合格 (+1) / `npm run build` 成功（バンドルへ samples/ の MML 同梱を確認）。

- **`q` ゲートタイミングのオフバイワン修正 & 演奏自然終了が UI へ反映されない問題の修正 (`src/core/player/TrackSequencer.ts`, `src/core/player/AudioEngine.ts`, `driver/mzsd_driver.asm`, `src/core/player/__tests__/MzsdSequencer.test.ts` / `Z80DriverMachine.test.ts` / `AudioEngine.test.ts` (新規), [`docs/specification/mml_reference.md`](./specification/mml_reference.md))** (2026-09-07):
  - **背景・ユーザー指摘**:
    - 「`P1 t240 o4 l4 q8 cccc` — q8 なのに繋がって聞こえません。q1 だとまったく聞こえません。」
    - 「再生が終わって MML が最後まで到達しても 曲が終了状態 PLAY ボタン表示 になりません。」
  - **原因調査結果 (フレーム単位のレジスタダンプで実証)**:
    1. **ゲートのオフバイワン**: 両演奏エンジン (SourceInterpreter / Z80 ドライバ) ともノート開始フレームでゲートを減算しており、`gate == len` (q8) でも音符境界に毎回 1 フレーム (16.7ms) の無音が挿入されていた。また `q1` (gate=1) は開始フレーム内で即キーオフされ **0 フレームしか発音しない** (完全無音)。
    2. **演奏終了コールバック断線**: `AudioEngine` が `AudioFrameMixer.onSequencerFinished` を `AudioEngine.sequencerFinished` (→ `Player.onPlaybackFinished` → UI) へ中継しておらず、自然終了しても `isPlaying` が false にならなかった。
    3. **Z80 ドライバのループガード欠落**: `🔁 LOOP` ON (既定) + `L` コマンドなしの曲で、Z80 ドライバが `loop_rewind` を永久に繰り返して HALT せず、既定エンジン (Z80 DRIVER) では終了検知が発生しなかった。
  - **対応内容**:
    1. **ゲートタイミング仕様の確定**: 「ノート開始フレームを含む `gate` フレーム分発音」に統一。`TrackSequencer.tick()` はゲート処理をイベント実行より先に行い、`mzsd_driver.asm` も `gate_tick` を `run_events` / len 減算より前に移動。`gate == len` ではキーオフと次ノート開始が同フレームになり無音フレームが消失 (q8 = スラー / q1 = 1 フレーム発音)。
    2. **`pitch_frame` (asm) の発音中判定を `len > 0 && gate > 0` から `gate > 0` へ修正**: len はノート最終フレームで 0 になるため、新タイミングではスイープ / PENV / ディチューンのピッチ適用が最終フレームで欠落する (Z80DriverEquivalence テストで発覚 → 両エンジン全フレーム一致を回復)。
    3. **`AudioEngine` コンストラクタで `mixer.onSequencerFinished` を中継** (終了時に pump も停止)。`mzsd_driver.asm` の `loop_rewind` は復帰チャンネルが 1 つも無い場合 Z を返し、呼び出し側は演奏停止へ分岐 (MzsdSequencer の `hasWholeLoop` ガード相当・実機 QDF プレイヤーにも同じ恩恵)。
  - **テスト**: 既存 3 件 (ゲート終端 / REST キーオフ / FM キーオフ) を新仕様に更新 +「gate=1 で 1 フレーム発音」「gate == len 連続ノートで無音フレームなし」回帰テスト 2 件 +「L 未定義曲はループ要求でも停止」(Z80) 1 件 + `AudioEngine` 終了中継テスト (新規ファイル) 2 件を追加。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 32 ファイル 434 件合格 (+5) / `npm run lint` エラーゼロ (既存 UI 警告 11 のみ) / ユーザー報告 MML `P1 t240 o4 l4 q8 cccc` を Z80 ドライバで実行し **q8 = 無音フレーム 0 (完全スラー) / q1 = 各音符 1 フレーム発音** を確認。

- **MML エディタの不自然な補完候補 (Monaco 既定ワードベースサジェスト) を無効化 (`src/view/MmlEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-07):
  - **背景・ユーザー指摘**: 「MMLエディタとしては不自然なコードアシスト出てきます。」
  - **原因調査結果**:
    - MML 言語 (`mz1500-mml`) には補完プロバイダー (`registerCompletionItemProvider`) が未実装で、Monaco Editor 既定の「ワードベースサジェスト」(文書内の既存単語を機械的に候補表示) が唯一の補完ソースとして作動していた。
    - MML は `P1o4l8v15cde` のような無間記述 (スペースなしコマンド連結) 言語のため、Monaco の単語定義と噛み合わず、トークン断片 (`cdef` / `c#4` 等) や行の大半が意味不明な長い文字列として候補に出現、コメント内英単語も混入していた。
  - **対応内容**: `MmlEditor.tsx` のエディタ `options` に `wordBasedSuggestions: 'off'` を追加し不自然な候補を完全消滅 (最小対応・1 プロパティ追加)。MML 専用補完の実装はユーザー確定方針により別セッションへ分離し、実装方針を ToDo に記録済み (**優先度: 低 / 同日ユーザー確定**)。
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
