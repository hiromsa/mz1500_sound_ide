# MZ-1500 Sound IDE 開発進捗記録 (`PROGRESS.md`)

本書は、MZ-1500 Sound IDE の現在進行中のタスク、残タスク（ToDo）、および直近の完了作業を記録・管理するドキュメントです。
※ 過去の膨大な完了作業ログ（モック期、Webコア移植期、初期UI設計等の詳細履歴）は [PROGRESS_HISTORY.md](./PROGRESS_HISTORY.md) にアーカイブされています。

---

## 1. 現在のステータス概要
- **バージョン**: `v0.0.1-beta.110`（コミット通番＋短縮ハッシュ ハイブリッド方式）
- **テスト通過状況**: 全 36 テストファイル / 495 件パス + 1 skip（`npm test` / Vitest）
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

- **MMLエディタに「キャレット位置から再生」「選択範囲のみ再生」のUIモックを実装 (`src/view/MmlEditor.tsx`, `src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「MML エディタで 選択している範囲のみ再生したり、キャレットの位置から再生という機能を用意したいです。いずれもそのキャレットの直前、選択している文字の直前までは、vや@などのコマンドは実行されている前提での再生をしたいです。まずはUIのモックのみ実装をお願いします。」
  - **対応内容**:
    1. **エディタ内クイックトランスポートボタン群の新設**:
       - MMLエディタのタブバー右側（`HIDE PANE` ボタンの左隣）に `▶ FROM CARET` および `▶ SELECTION` ボタンを配置。
       - `FROM CARET`: キャレット位置から再生を実行。実行時は一時的にシアン発光＋パルスアニメーションに変化。
       - `SELECTION`: 選択範囲のみ再生を実行。**エディタのテキスト選択状態と動的連動**し、未選択時は暗いグレーアウト（`disabled`、ホバー不可）、選択時はエメラルド系アクティブ発色＋選択文字数バッジ（`N`文字）を表示。
    2. **右クリックコンテキストメニューへの追加**:
       - エディタ右クリックメニューの最上部に「部分再生グループ」を新設: `▶ キャレット位置から再生` (`Alt+Enter`)、`▶ 選択範囲のみ再生` (`Ctrl+Shift+Enter`、未選択時 disabled・選択時は文字数表示付き)。
    3. **Monaco Editor キーボードショートカット**:
       - `Alt + Enter`: キャレット位置から再生
       - `Ctrl + Shift + Enter`: 選択範囲のみ再生
    4. **モック動作フィードバック**:
       - 各アクション実行時、システムコンソール (CONSOLE) へ現在のキャレット位置（行、列、トラック名、オクターブ、音量等）または選択範囲（開始〜終了位置、文字数）と「直前コマンドを適用して再生」するシミュレーションログを出力。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 36 ファイル・495 件合格 + 1 skip / `npm run lint` エラーゼロ / `npm run build` 成功 / 組み込みブラウザサブエージェントによる画面・ボタン動作・ログ出力・選択状態連動検証完了。

- **仮想キーボードの CHIP セレクタに「PSG P3/P6 (@IN)」モードを追加 — @IN セレクタをキャレット位置に依存せず試聴可能に (`src/view/VirtualKeyboard.tsx`, `src/utils/keyboardChipMode.ts` (新規), `src/utils/__tests__/keyboardChipMode.test.ts` (新規), [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「仮想キーボードについて、CHIPに PSG P3/P6 のようなモードが欲しいです。@INとの有効・無効の関係があるので。」(前回実装で @IN は MML モード時 P3/P6 キャレット限定となり、P1/P2/P4/P5 キャレットでは手動試聴も不可だった)
  - **対応内容**:
    1. `src/utils/keyboardChipMode.ts` (新規・UI 非依存の純粋関数) に CHIP 選択値型 `VirtualKeyboardChipMode` (`'psg_tone3'` = 「PSG P3/P6 (@IN)」モード)・発音エンジン正規化 `normalizeChipModeEngine` (`'psg_tone3'` → `'psg'` / 発音・DCSG 実機音域制限は通常 PSG と同一)・@IN 有効判定 `isNoiseIntegrateChipActive` を集約。
    2. `VirtualKeyboard.tsx`: MML モードの CHIP プルダウンへ `PSG P3/P6 (@IN)` を追加。`isNoiseIntegrateActive` を「実効音源が PSG かつ (キャレットトラックが P3/P6 または CHIP で PSG P3/P6 を明示選択)」に更新 — キャレットが P1/P2/P4/P5 にあっても `@IN0/1/2` の自由試聴が可能。MML キャレット移動時は他の手動選択と同一パターンで `AUTO` へ戻す。CHIP / @IN / 無効バッジの各ツールチップを更新。
    3. ENV エディタモード (VOL ENV / PITCH ENV) の CHIP プルダウンは変更なし (トラック概念が無いため PSG 選択時に @IN 常時有効のまま)。
  - **テスト**: `keyboardChipMode.test.ts` (新規・7 件) — エンジン正規化 / PSG 以外で無効 / P3・P6 キャレットで有効 / P1・P2・P4・P5・N1・N2 キャレットで無効 / `psg_tone3` 明示選択時にキャレット非依存で有効 / ENV エディタモードで常時有効。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 36 ファイル・495 件合格 + 1 skip (+7) / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。

- **仮想キーボードの PSG (DCSG) 発音を実機レジスタ音域に制限 — 出せない低音キーの無効化 & 周波数 10bit レジスタ量子化 (`src/view/VirtualKeyboard.tsx`, `src/utils/virtualSynth.ts`, `src/core/chips/DcsgChip.ts`, `src/core/chips/__tests__/DcsgChip.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー指摘**: 「仮想キーボードについて、DSCGでは出せない音域まで低い音が鳴ってます。」
  - **原因**: 演奏エンジン (TrackSequencer / Z80 ドライバ) は DCSG トーン周期を 10bit レジスタ (0-1023) にクランプするため実機どおり約 109.3Hz (MIDI 45 / A2) が下限だが、仮想キーボードの PSG 発音だけ `midiNoteToFrequency()` の生周波数で Web Audio オシレーターを鳴らしていたため A0 (27.5Hz) まで鳴っていた。
  - **対応内容** (挙動はユーザー確定: 「出せない低音キーは発音しない (グレーアウトして押せなくする)」):
    1. `DcsgChip` に実機レジスタ変換 API を新設: `tonePeriodForFrequency()` (周波数 → 10bit period、0-1023 クランプ / TrackSequencer・`dcsgPeriodFor` と同一式)、`toneFrequencyForPeriod()`、`LowestMidiNote = 45` (A2)、`MaxTonePeriod = 1023`。
    2. `virtualSynth.ts` の PSG 分岐のみ発音周波数を実機レジスタ式に量子化 (矩形波 osc 周波数 + @IN 統合ノイズの bandpass 駆動周波数)。演奏エンジン / 実機と音程一致。BEEP / FM / NOISE は実機音域内のため変更なし。
    3. `VirtualKeyboard.tsx` は PSG 選択時、MIDI 45 未満 (A0〜G#2 / 24 鍵) の鍵盤を暗いグレーで無効化 (`cursor-not-allowed`・ホバー/押下エフェクトなし・`title` ツールチップで理由表示)。鍵盤クリック / ドラッグ / PC キーボード演奏すべて `handleNoteOn` 冒頭ガードで発音阻止 (`isNotePlayable` は `DcsgChip.LowestMidiNote` を唯一の正として参照)。
  - **テスト**: `DcsgChip.test.ts` に `tonePeriodForFrequency` (A4 = period 253 / 低音 20Hz → 1023 クランプ / 高音 → 0) と `LowestMidiNote` 境界 (A2 = period 1016 ≤ 1023 で発音可 / G#2 = period 1076 → 1023 に丸められ発音不可) の 2 ケース追加。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 35 ファイル・488 件合格 + 1 skip (+2) / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。

- **仮想キーボードの @IN セレクタを MML モード時 P3/P6 キャレット限定に変更 (`src/view/VirtualKeyboard.tsx`, `src/utils/mmlCaretParser.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「MMLエディタ 連動の場合で、@INは P3 / P6 の場合のみ有効にしてください。」(前回実装の @IN セレクタは実効音源が PSG なら P1/P2/P4/P5 キャレットでも有効だった)
  - **対応内容**:
    1. `mmlCaretParser.ts` の P3/P6 判定ヘルパーを `isDcsgTone3TrackName` としてエクスポート化 (`resolveEngineFromTrackName` と同一パターン)。
    2. `VirtualKeyboard.tsx` の `isNoiseIntegrateActive` を **「実効音源が PSG かつ (エディタモード or キャレットトラックが P3/P6)」** に変更。MML モードで P1/P2/P4/P5 にキャレットがある場合は `N/A (P3/P6)` 無効バッジ表示となり、手動選択も不可 (MML 演奏へ反映されないため)。V-ENV / P-ENV エディタモードはトラック概念が無いため、PSG 選択時は従来どおり自由試聴として有効。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 35 ファイル・486 件合格 + 1 skip / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。

- **仮想キーボードのコントロール 2 行化（キーアサイン & オクターブ操作バー新設）と @IN / @WN セレクタ追加 (`src/view/VirtualKeyboard.tsx`, `src/utils/virtualSynth.ts`, `src/utils/mmlCaretParser.ts`, `src/utils/__tests__/mmlCaretParser.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「仮想キーボードについて、オクターブ変更のボタンとキーアサインについては、行を追加して配置してほしい（鍵盤のエリアの高さがその分小さくなってもOK）。その上で、PITCHの右側あたりに @IN と @WN の設定を追加してほしい。@IN と @WN の有効・無効など連動については、他の設定と同様にうまく連動するようにしてほしい。」
  - **対応内容**:
    1. **キーアサイン & オクターブ操作バーの新設 (行2)**: 従来コントロールバー (行1) 右側に詰め込んでいた PC キーボード演奏インジケータ (`⌨ PC: A-K`)、オクターブ切替 (`OCT: [Z-] X [X+]`)、オクターブジャンプ (`JUMP: C1`〜`C7`、キャレットオクターブハイライト維持)、`PANIC` ボタンを独立した行 (h-7) へ移動。あわせて **QWERTY キーアサイン表示** (`A W S E D F T G Y H U J K O L P ; '` を鍵盤順にミニキーで視覚化・白鍵/黒鍵で色分け・押下中のキーはシアン発光) を新設。鍵盤エリアは flex-1 のため行追加分だけ自動縮小。MML モード時は `⌨ PC PLAY: OFF (MML)` + `OCT: X (AUTO)` 表示 (従来どおり演奏・オクターブ切替無効)。
    2. **@IN セレクタ追加 (PITCH の右隣)**: `AUTO (@INn)` / `@IN0: 解除` / `@IN1: 周期連動` / `@IN2: 白連動`。**有効化条件は実効音源が PSG のときのみ** (それ以外は `N/A (PSG)` 無効バッジ・BEEP 音量 N/A と同一パターン)。
    3. **@WN セレクタ追加 (@IN の右隣)**: `AUTO (@WNn)` / `@WN0: 周期` / `@WN1: ホワイト`。**有効化条件は実効音源が NOISE のときのみ** (それ以外は `N/A (N1/N2)`)。
    4. **他設定と同一パターンの MML キャレット連動**: `AUTO` 選択時はキャレット解析値を発音へ反映、手動選択時はその値を最優先、MML キャレット移動時の自動連動で手動選択を `AUTO` へ戻す (CHIP / 音量と同一挙動)。
    5. **`mmlCaretParser.ts` に @IN 解析を追加**: `TrackPlayState` / `MmlCaretContext` へ `noiseIntegrate` (0-2) 新設、`COMMAND_PATTERN` へ `@in` トークン追加。**P3/P6 (トーン 3 統合トラック) でのみ状態更新** (正式パーサ `processNoiseSync` 準拠)。
    6. **`virtualSynth.ts` にノイズ統合発音を実装**: `SynthPlayOptions.noiseIntegrate` 新設。PSG エンジン選択時に `@IN1` / `@IN2` なら音程に追従するノイズ (bandpass 中心 = 音程比例、@IN1 = Q10 硬い金属音 / @IN2 = Q2 広がりのあるノイズ) で発音し、`@PE` 併用時は playbackRate でピッチ変調 (実機: tone2 周波数レジスタ変調に相当)。あわせて従来未反映だった NOISE 時の `noiseType` (@WN) も発音オプションへ反映。
  - **テスト**: `mmlCaretParser.test.ts` に `@WN0/@WN1` 波形解析、`@IN0/1/2` (P3/P6 有効・P1/P4/N1 無視・初期値 0) のテスト 5 件追加。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 35 ファイル・486 件合格 + 1 skip / `npm run lint` エラーゼロ (既存警告 10 は変更なし) / `npm run build` 成功。

- **FM TONE / VOL ENV / PITCH ENV の試聴音を MASTER VOLUME の影響下に統合 (`src/app/App.tsx`, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「FM TONE や P-ENV、V-ENV の PreviewボタンもMASTER VOLUMEの影響を受けるようにしてください。」(仮想キーボードの MASTER VOLUME 統合の続き)
  - **従来の問題**: 右ペイン各エディタの試聴 (▶ PREVIEW / ▶ KEY ON) は独自の Web Audio 経路で固定ゲイン (FM: 0.35 / V-ENV: 0.25 / P-ENV: 0.2) により発音しており、TRACK MONITOR の MASTER VOL とは無関係だった。
  - **対応内容**:
    1. `App` で計算済みの `masterLevel` (0-1 / ミュート時 0) を render スコープに引き上げ、3 エディタへ `masterLevel` props として渡すよう変更。
    2. 各エディタは既定出力ゲインをモジュール定数 `PreviewBaseGain` として明示化し、`perceptualMasterGain(masterLevel)` を乗算して発音 (知覚カーブは仮想キーボード / Player と同一の 2 乗曲線)。
    3. **発音中の即時反映** (仮想キーボードと同一挙動):
       - `FmToneEditor`: 発音中の masterGain を `masterGainRef` で追跡し、`useEffect` で `setValueAtTime` 反映 (停止時に null クリア)。
       - `PitchEnvelopeEditor`: 既存 `gainNodeRef` を利用し同様の `useEffect` 反映。
       - `VolEnvelopeEditor`: 60fps 発音タイマー内のゲイン計算で `masterLevelRef` (stale closure 回避) を参照し、フレーム単位で反映。
  - **テスト**: `perceptualMasterGain` は既存単体テストでカバー / AudioContext 依存の発音経路は従来方針どおりブラウザ確認対象。
  - **検証**: `npx tsc -b` エラーゼロ / `npm run lint` エラーゼロ・警告 10 件 (既存分のみ・増加なし) / `npm test` 全 35 ファイル・481 件合格 + 1 skip。

- **仮想キーボードの発音を MASTER VOLUME の影響下に統合 (`src/utils/virtualSynth.ts`, `src/view/TrackMonitor.tsx`, `src/app/App.tsx`, `src/utils/__tests__/virtualSynth.test.ts`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「仮想キーボードの発音についても、MASTER VOLUMEの影響を受けるようにしてください。」
  - **従来の問題**:
    - TRACK MONITOR の MASTER VOL は `Player.setMasterVolume`（演奏プレビュー専用）にのみ接続されており、仮想キーボード（`virtualSynth` / Web Audio 直結）の発音には無関係だった。
    - さらにマスター音量 state が `TrackMonitor` コンポーネント内部に閉じていたため、右ペインタブを離れると値が破棄され初期値 80% に戻る潜在問題もあった。
  - **対応内容**:
    1. `VirtualSynthEngine` に `setMasterVolume(volume)` を新設 (0-1 クランプ + `Player.setMasterVolume` と同一の 2 乗知覚カーブ `perceptualMasterGain`)。発音中の全ボイスの masterGain へ `setValueAtTime` で即時反映、新規 `noteOn` 時も現在のマスター音量で発音する。
    2. マスター音量 / ミュート state を `TrackMonitor` 内部から `App` へ持ち上げ一元管理。`TrackMonitor` は controlled props (`masterVolume` / `masterMuted`) 化し、スライダー / MUTE の変更は `onMasterVolumeChange` で App へ通知する構造へ改修。
    3. `App` の `useEffect` で `Player.setMasterVolume`（演奏）と `virtualSynth.setMasterVolume`（鍵盤）の双方へ同一レベルを反映。`ensurePlayer` の Player 遅延生成時も `masterLevelRef` 経由で現在値を引き継ぐため、音量設定の取りこぼしがない。
    4. 副次効果: TRACK MONITOR タブを離れて戻ってもマスター音量 / ミュート設定が保持されるようになった。
  - **テスト**: `perceptualMasterGain` の知覚カーブ（2 乗）と 0-1 クランプ規約のテストを `virtualSynth.test.ts` に追加。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 35 ファイル・481 件合格 + 1 skip。

- **非連動ノイズの音名 3 段階シフトレート対応 — c/e/g が同じ音になる問題を修正 (`src/core/chips/DcsgChip.ts`, `src/core/player/TrackSequencer.ts`, `src/utils/virtualSynth.ts`, `driver/mzsd_driver.asm`, テスト 3 件・仕様書 2 件更新)** (2026-09-09):
  - **背景・ユーザー指摘**: 「psg_noise_basic.mml に記載のノイズについて c e g のノイズの種類の変化が発音されません。同じ音になっています。仮想キーボード、PLAY ボタン両方。」
  - **原因**: 非連動ノイズの分周ヒントが C# 実装準拠の周波数しきい値 (`freq < 40000 ? 2 : freq < 80000 ? 1 : 0`) だったため、実用音域では常に rate 2 に丸められ c/e/g が同一音になっていた。さらに Web 出力のノイズ LPF が固定 8kHz のため、仮にレートが変わってもホワイトノイズの明るさ差が聞こえない構造だった。
  - **対応内容**:
    1. 分周ヒントを**音名ベースの 3 段階**へ変更 (C# 版リファレンス §5.1 の記述どおり / C# 実装からは意図的差分): `DcsgChip.noiseRateForNote()` を新設 (c〜d# = 2 低 / e〜f# = 1 中 / g〜b = 0 高、オクターブ不問、8bit 桁落ち規約)。`TrackSequencer.startNote` と `mzsd_driver.asm` `play_noise` (`pn_rate_tbl` 12 バイトテーブル + mod 12 ループ) の両エンジンで同一規約に統一。
    2. `DcsgChip.renderSample` のノイズ出力 LPF をホワイトノイズのみ分周レート連動へ (rate 0 = 8kHz / 1 = 4kHz / 2 = 2kHz)。周期ノイズは基本波自体が音の高さ (3.5/7/14kHz) のため固定 8kHz を維持。
    3. 仮想キーボード (`virtualSynth.ts`) も同一規約に対応: 白噪 lowpass を `DcsgChip.lpfCutoffForRate` でレート連動化、周期ノイズ bandpass 中心を `DcsgChip.periodicCenterForRate` (3.5/7/14kHz) へ変更。
  - **ドキュメント**: `noise_channel.md` (§2.3 / §3.1 / §3.3 音名選択へ改訂 / §4.3 / §4.4 / §5)、`web_core_port.md` (LPF レート連動 + ヒント音名ベースの意図的差分 2 件追記)。`mml_reference.md` / `psg_noise_basic.mml` のコメントは当初から音名 3 段階の記述のため変更不要。
  - **テスト**: `NoiseTrackPlayback` に音名 3 段階 (c4→2 / e4→1 / g4→0) を両エンジンで検証するテスト追加、`Z80DriverMachine` の hint 期待値更新 (A4 = rate 0)、`DcsgChip` に音名マッピング + レート別明るさ (隣接標本差 low < mid < high) テスト追加。
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 35 ファイル・479 件合格 + 1 skip / `npm run lint` エラーゼロ (既存警告 10 は変更なし) / `npm run build` 成功。

- **ノイズ統合サンプルを Integrate 系の名称へ変更 & 干渉注記の削除 (`samples/mml_reference/psg/psg_noise_integrate.mml` ※リネーム, `samples/mml_reference/README.md`, [`docs/specification/noise_channel.md`](./specification/noise_channel.md))** (2026-09-09):
  - **背景・ユーザー要望**: 「psg フォルダ配下の psg_noise_interlock.mml について interlock ではなく Integrate としたい。ファイル名およびコメントなど。mml_reference.md の @in の説明として N1 / N2 と干渉する…等の説明が無いようにしてほしい」
  - **対応内容**:
    - `git mv` で履歴保持のままリネーム: `psg_noise_interlock.mml` → `psg_noise_integrate.mml` (`@IN` = Integrate with Noise の由来に合わせた名称)。
    - `#TITLE` を `"PSG Noise Integrate"` へ変更。コメントから「統合中は同一 PSG のノイズチャンネル (N1 / N2) と音量レジスタを共有するため、同時に N1 / N2 を鳴らすと干渉します」の注意書きを削除。
    - 参照パス更新: `samples/mml_reference/README.md` 対応表 (「ノイズ連動」→「ノイズ統合」表記へ)、`noise_channel.md` §6 実サンプル列挙。
    - `mml_reference.md` の `@IN` 行は干渉に関する記述が無いことを確認 (対応不要)。
  - **検証**: `npm test` 全 35 ファイル・476 件合格 + 1 skip (samples 全 .mml のエラー・警告ゼロコンパイル確認を含む)。

- **PSG サンプル 2 ファイルの命名統一 & コメント整備 (`samples/mml_reference/psg/psg_volume_basic.mml`, `samples/mml_reference/psg/psg_quantize_gate.mml` ※リネーム, `samples/mml_reference/README.md`)** (2026-09-09):
  - **背景・ユーザー要望**: 「psg フォルダの volume2.mml と quantize.mml について他のファイルと同様に、コメントを入れたり、ファイル名を変更して統一させてください。」
  - **対応内容**:
    - ファイル名を `psg_<テーマ>.mml` 命名規則へ統一 (`git mv` で履歴保持):
      - `psg/volume2.mml` → `psg/psg_volume_basic.mml` (`v` コマンド基本音量サンプル。`psg_volume_envelope` と対になる命名)
      - `psg/quantize.mml` → `psg/psg_quantize_gate.mml` (`q` / `@q` どちらもゲート関連のため)
    - 既存サンプルと同様のコメント構成へ整備: 冒頭 `/* */` 概要 + `;` 書式説明 (`v` は 0-15・FM/PSG/ノイズ共通・BEEP 不可・FM は `@v` (0-127) 利用可 / `q` は 1-8 のゲートタイム比率・標準 7 / `@q` はフレーム単位ゲートカット・指定中は `q` より優先)、行末の解説コメント、`#TITLE` を "PSG XXX" 形式へ変更 ("PSG Volume Basic" / "PSG Quantize Gate")。
    - `samples/mml_reference/README.md` の「ファイル × 確認できるコマンド」対応表を新ファイル名へ更新。
    - ※ `volume2.mml` に残っていたユーザー編集分の未コミット差分 (`@q0-@q7` 行の削除) は意図を尊重し、`v` 専用サンプルとして本内容を取り込んだ。
  - **検証**: `npm test` 全 35 ファイル・476 件合格 + 1 skip (samples 全 .mml のエラー・警告ゼロコンパイル確認を含む)。

- **`@IN` を P3/P6 トーン 3 統合トラック専用コマンドへ変更 — ノイズ仕様の 2 系統化 (`src/core/mml/TrackId.ts`, `src/core/mml/parser/MmlParser.ts`, `src/core/mml/parser/MmlParserTypes.ts`, `src/core/player/TrackSequencer.ts`, `driver/mzsd_driver.asm`, `src/utils/mmlCaretParser.ts`, テスト 5 件・サンプル 2 件・仕様書 2 件更新)** (2026-09-08):
  - **背景・ユーザー指摘**: 「`@IN` が N1 (Noise) チャンネル用として処理されているのは SN76489 (DCSG) の仕様上明確な誤り。専用ノイズトラック (N1/N2 = `@WN`) と Tone 3 連動トラック (P3/P6 = `@IN`) の 2 系統の仕様と意図に基づいてパーサーおよびコンパイラのルーティングを修正してほしい」
  - **新仕様 (2 系統)**:
    - `@WN` (N1/N2 専用・継続): `@WN1` = ホワイト (**初期値**) / `@WN0` = 周期ノイズ。音高は `c`/`e`/`g` の **3 段階シフトレート**
    - `@IN` (**P3/P6 専用に変更**): `@IN0` = 統合解除 (**初期値**) / `@IN1` = 周期ノイズ連動 (硬いパルス波) / `@IN2` = ホワイトノイズ連動 (音階に追従するノイズ)。音高は `cdefgab` の通常の音符で自由指定
  - **統合モードの動作** (ハードウェアの「トーン 3 がノイズに乗っ取る」に忠実):
    1. P3/P6 の音符音程が自身の周波数レジスタ (tone2) へ書かれ (通常 NOTE 経路のまま)、ノイズシフトクロック = 音程 × 16 で駆動
    2. **発音はノイズチャンネルへ切り替わり**、トラックの音量 `v` はノイズ減衰レジスタへ適用、トーン 3 自体は減衰 15 で無音化
    3. `@IN0` でノイズチャンネルを無音化して解放し、通常の矩形波へ復帰
  - **実装変更**:
    1. `TrackId` へ `isDcsgTone3` (P3/P6) 追加、`TrackState` を `noiseWhite` (初期 1) / `noiseIntegrate` (初期 0) へ分割
    2. `MmlParser.processNoiseSync` (`@IN`): emit 先を N1/N2 → **P3/P6** へ変更。警告文言「@in はトーン 3 トラック (P3, P6) でのみ有効です」
    3. `TrackSequencer` (SourceInterpreter): `isDcsgTone3` / `applyNoiseIntegrate()` 新設、`writeAttenuation` に統合分岐 (ノイズ減衰 = トラック音量 / tone2 = 15)、N1 側の sync/tone2 書き込みを廃止
    4. `mzsd_driver.asm` (実機ドライバ): `ev_noisectl` に tone2 判定分岐 + `apply_noise_integrate` ルーチン新設、`write_att` に統合分岐 (ノイズ減衰 `0xF0|att` 出力 + トーン 3 減衰 `0xDF` 出力)、`init_ch_regs` はノイズトラックのみ `CH_NOISE = 1` (N1/N2 = white 初期値 / P3/P6 = 統合解除)
    5. `mmlCaretParser`: エディタ文脈のノイズ波形初期値を `white` へ統一
  - **MZSD バイナリ互換**: `NOISECTL (0x0A)` 命令のフォーマットは不変。flags の意味をトラック種別 (slot 3/7 = ノイズ波形 bit0 / slot 2/6 = 統合モード値 0-2) で判別
  - **テスト**: `MmlCompilerAdvanced` (`@WN`→N1 / `@IN`→P3 ルーティング + 誤記警告)、`NoiseTrackPlayback` (`P3 @IN1` で tone2 period が c4/e4/g4/c5 = 427/338/284/213 に追従・ノイズ発音 & tone3 無音検証、`@IN2`→white / `@IN0`→解除を両エンジンで)、`Z80DriverEquivalence` (トーン 3 統合トラックの両エンジン全レジスタ等価)、`Z80DriverMachine` (white 初期値) を更新。**`MmlSamplesCompile.test.ts` を新設** (samples/ 配下全 17 .mml のエラー・警告ゼロ検証を恒久テスト化)
  - **サンプル・ドキュメント**: `psg_noise_basic.mml` (@WN のみに整理) / `psg_noise_interlock.mml` (P3 @IN デモに全面改訂)、`noise_channel.md` (2 系統仕様へ全面改訂・§3.4 flags 構成・§7 FAQ 更新)、`mml_reference.md` (`@WN`/`@IN` 行を新仕様に更新)
  - **検証**: `npx tsc -b` エラーゼロ / `npm test` 全 35 ファイル・476 件合格 + 1 skip / `npm run lint` エラーゼロ (既存警告 10 は変更なし) / `npm run build` 成功

- **ノイズ仕様の C# オリジナル照合 (`C:\tools\mz1500_sound_driver` / `mz1500_sound_devenv` 参照) & [`docs/specification/noise_channel.md`](./specification/noise_channel.md) 更新** (2026-09-08):
  - **背景・ユーザー指摘**: 「C:\tools\mz1500_sound_driver を参照してみてください。たしか@in は P3 または P6 で指定する仕様だったように思えます。」
  - **照合結果 (C# オリジナル実装との突合)**:
    - `mz1500_sound_devenv/src/MzSound.MmlCompiler/Internal/MmlParser.AtNoise.cs`: `@WN` は bit0 のみ (`~0x01` マスク)、`@IN` は bit1-2 のみ (`~0x06` マスク) を更新し、**N1/N2 以外のトラックへの記述は警告**「@wn / @in はノイズ トラック (N1, N2) でのみ有効です」— 現行 TS 実装と**同一**。
    - `MzSound.Player/Sequencer/TrackSequencer.cs`: 同期判定 `(_noiseFlags >> 1) & 0x3 != 0` → rate 3、非連動 hint `freq < 40000 ? 2 : freq < 80000 ? 1 : 0` — 現行 TS 実装と**同一**。
    - **結論**: 「`@IN` は P3/P6 で指定する」仕様は存在しない (C# 版も N1/N2 記述が正・P3/P6 への記述は警告)。**現行実装の変更は不要**。`@IN1`/`@IN2` の違いは sync ビット値のみで挙動は同一、波形は `@WN` で決まる点も同一。
  - **ドキュメント更新** (`noise_channel.md`):
    - §3.3 に注意書き追加: C# 版リファレンス (`mz1500_sound_driver/mml_reference.md` §5.1) の「音符 c〜d/e〜f/g 以上で Low/Mid/High が切り替わる」記述は C# 実装と不一致 (実用音域では常に rate 2)。本 IDE は C# **実装**準拠。
    - §3.4「C# オリジナルとの整合」新設: flags 更新式・警告文言・同期判定・hint の対応表と、「`@IN` を P3/P6 に書く仕様は存在しない」を明記。
    - §6 に連動白噪のノウハウ (C# 版リファレンス §5.2 準拠: `@IN2 @WN1 o10` で超高速シフトの細かい白噪) を追記。※同 §5.2 の「@EP 急降下スネア」は C#/TS ともノイズトラックに @EP が適用されないため動作しない旨も注意書き。
    - §7 FAQ に Q7 追加 (`@IN` は N1/N2 記述が正 — 混同しやすい理由の説明)。
  - **テスト**: コード変更なし (`npm test` 全 34 ファイル・457 件合格 + 1 skip を再確認)。

- **ノイズチャンネル総合仕様ドキュメントを新設 ([`docs/specification/noise_channel.md`](./specification/noise_channel.md), `docs/specification/README.md`, [`docs/specification/mml_reference.md`](./specification/mml_reference.md))** (2026-09-08):
  - **背景・ユーザー要望**: 「今一度ノイズのモードや3chとの同期、本ドライバの実装 mmlとの関係について教えてください。いつも忘れてしまうので、どこかに.mdとして仕様をまとめてください。」
  - **対応内容**: ハードウェア (SN76489AN / LFSR / rate 0-3) → MML (`@WN`/`@IN` flags) → ドライバ実装 (SourceInterpreter / mzsd_driver.asm) → Web エミュレーション (DcsgChip 差分) を貫く総合仕様書 `noise_channel.md` を新設。
    - §1 やりたいこと逆引き早見表 (ドラム / 金属音 / 音程追従)、§2 ハードウェア構成 (MZ-1500 の PSG×2 / LFSR / シフトクロック rate / SN76489 レジスタ一覧)、§3 MML コマンド (flags ビット構成 / `@IN1` と `@IN2` は実装上どちらも同期 ON で波形は `@WN` 側で決まる / 有効・無効コマンド一覧 / P3・P6 との tone2 共有の注意)、§4 ドライバ実装 (NOISECTL 命令と両エンジンの処理フロー)、§5 Web 固有実装、§6 MML 記述例、§7 FAQ 6 項。
    - `README.md` 索引へ追加、`mml_reference.md` §3.6 の `@WN`/`@IN` 行を実装実態に合わせて更新 (単体では高さ固定 / `@IN` は N1・N2 に記述) + 相互リンク追記。
  - **テスト**: コード変更なし (`npm test` 全 34 ファイル・457 件合格 + 1 skip を再確認)。

- **周期ノイズの音程追従仕様を明確化 & サンプルを @IN1 併用に修正 (`samples/mml_reference/psg/psg_noise_basic.mml`, `src/core/player/__tests__/NoiseTrackPlayback.test.ts`)** (2026-09-08):
  - **背景・ユーザー指摘**: 「@WN1 はOKです。@WN0 は高い周波数のままキーンとなっていて、音程かわりません。」
  - **仕様の確認・結論**:
    - 非連動 (`@IN` なし) のノイズは **SN76489 ハードウェア仕様上、固定クロック分周 3 段階のみ** (レジスタ bit1-0)。実用音域の音符はすべて hint 2 (=55.9kHz、周期ノイズでは 16 ステップ循環の約 3.5kHz) に丸められるため、`@WN0` 単体では高さが変わらないのは**実機どおりの挙動** (.qdf を実機で鳴らしても同じ)。
    - **音程に追従させる正規の方法は `@IN1` / `@IN2` (同期連動)**: N1 の音符音程が tone2 (P3 相当のレジスタ) へ書かれ、ノイズシフトクロック = 音程 × 16 で駆動される (16 ステップ循環の基本波 = 音符の音程)。
  - **対応内容**:
    1. 回帰テスト 2 件追加 (`NoiseTrackPlayback.test.ts`): `N1 @IN1 @WN0 o4 c4 e4 g4 > c4` を両エンジン (SourceInterpreter / Z80Driver) で駆動し、**tone2 period が 427 → 338 → 284 → 213 (c4/e4/g4/c5) と音程どおりに変化**し noiseRateMode = 3 (tone2 連動)・periodic であることを検証。両エンジンが同一値を出すことも確認 (等価性維持)。
    2. サンプル `psg_noise_basic.mml` を修正: ヘッダコメントに「@WN 単体では高さ固定 / @IN1・@IN2 併用で音程追従」を明記。`@WN0` セクションを `@IN1 @WN0` (音程追従デモ) に、戻しセクションを `@IN0 @WN1` (連動オフ) に変更。
  - **テスト**: `npx tsc -b` エラーゼロ / `npm test` 全 34 ファイル・457 件合格 + 1 skip / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。samples 全 .mml のコンパイル検証も合格。

- **白噪が「キーン/ピー」というトーンになる問題を修正 — ノイズ LFSR を実機準拠の 16bit へ (`src/core/chips/DcsgChip.ts`, `src/core/chips/__tests__/DcsgChip.test.ts`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「ノイズ音まだ改善されていません。鳴ってますけど音はおかしいです。」→ 詳細確認で「キーン、ピー。@WN1 と @WN0 どちらも。ノイズというよりも音程感があります。」
  - **原因**:
    - ノイズ LFSR が **15bit (bit14 挿入)** 実装で、タップ (bit0, bit3) の XOR が 15bit 上では最大長から外れ **63 ステップの短い循環**になっていた。55.9kHz クロックでは **約 890Hz の強いトーン (キーン/ピー)** として聞こえ、白噪 (@WN1) でも音程感が出ていた。
    - 実機 SN76489AN は **16bit シフトレジスタ (bit15 挿入)** で、白噪周期は 65535 ステップ (55.9kHz で約 1.2 秒) → 周期性は知覚できない。
    - 前回修正 (XOR 化 + エイリアスフィルタ) でも白噪は「鳴るがトーン混じり」のままだった (@WN0 周期ノイズの 3.5kHz 音程感は実機仕様)。
  - **対応内容**:
    1. `shiftLfsr` を 16bit 化 (`lfsr = (lfsr >> 1) | (bit << 15)`、初期値 0x8000)。実測で white 周期 63 → **57337 ステップ**、periodic 15 → **16 ステップ** (実機準拠) を確認。
    2. 回帰テスト 2 件追加 (`DcsgChip.test.ts`): 白噪 LFSR 周期 > 30000 ステップ / 周期ノイズ = 16 ステップ (検証用アクセサ `lfsrState` / `advanceLfsrForTest` を追加)。
  - **テスト**: `npx tsc -b` エラーゼロ / `npm test` 全 34 ファイル・455 件合格 + 1 skip / `npm run build` 成功 / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。
  - **備考**: `@WN0` (周期ノイズ) 非連動時の 3.5kHz 程度の音程感は**実機仕様** (16 ステップ循環トーン)。音符音程に連動させる場合は `@IN1` / `@IN2` を使用。

- **ノイズの「超音波のような高音」を抑制 — 出力段の帯域制限フィルタ追加 (`src/core/chips/DcsgChip.ts`, `src/core/chips/__tests__/DcsgChip.test.ts`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「ノイズ、鳴ることはなるようになったのですが、超音波のようなものすごく高い音？がなってます。仮想キーボードは問題なさそうに思えます。」
  - **原因**:
    - ノイズシフトクロック (非連動 55.9 / 111.9 / 223.7kHz) は音声ナイキスト (24kHz @48kHz) を大きく超えており、LFSR ビット列をそのまま標本化すると**折り返し雑音 (エイリアス) が金属的な高音**として出力されていた。実機ではアナログ出力段で高域が減衰するため「シャー」に聞こえる。
    - 仮想キーボード (`virtualSynth.ts`) は白噪に lowpass 8kHz を掛けているため問題がなかった (ユーザー観測と一致)。
  - **対応内容** (`DcsgChip.renderSample` のノイズ出力):
    1. **2 段 1-pole LPF (8kHz)** — エイリアス高音を減衰 (仮想キーボードと同一基準)
    2. **RMS 補正ゲイン** (`(2 - k) / k`) — フィルタによる音量低下を補正し「シャー」の大きさを維持
    3. **DC ブロック (30Hz)** — 周期ノイズ (bit0 循環) の DC 成分を実機の出力コンデンサ相当で除去
    4. `DcsgChip.test.ts` に回帰テスト 2 件追加: エイリアス抑制 (隣接標本差平均 < 0.3、無フィルタ ≈ 1.0 → 実測 0.12) / DC ブロック (周期ノイズの長期平均 < 0.05)
  - **テスト**: `npx tsc -b` エラーゼロ / `npm test` 全 34 ファイル・453 件合格 + 1 skip / `npm run build` 成功 / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。
  - **備考 (仕様)**: 非連動ノイズ (`@WN0`/`@WN1` のみ) は実機仕様上、音符の音程に関係なく分周 3 段階 (低中高) のみ。**音符の音程に合わせて高さが変わる周期ノイズは `@IN1` / `@IN2` (P3 / P6 との同期連動)** を使用する (`psg_noise_interlock.mml` 参照)。`psg_noise_basic.mml` のコメント「音程に合わせて高さが変わる」は `@IN` 併用が前提の表現のため、必要に応じてサンプル側の注記更新を推奨。

- **ノイズが PLAY で鳴らない根本原因を修正 — DCSG ノイズ LFSR のフィードバック誤り (AND → XOR) (`src/core/chips/DcsgChip.ts`, `src/core/chips/__tests__/DcsgChip.test.ts`, `src/core/player/__tests__/NoiseTrackPlayback.test.ts`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))** (2026-09-08):
  - **背景・ユーザー指摘**: 「PLAYボタンではなりませんでした。仮想キーボードではなります。」(前回の TrackId 並び順修正後も PLAY でのノイズ発音が聞こえない)
  - **原因**:
    - `DcsgChip.shiftLfsr` の white ノイズ・フィードバックがコメント (bit0 XOR bit3) に反して **`bit0 && bit3` (AND)** で実装されていた。AND では 15bit LFSR が白噪開始から数ステップ (55.9kHz クロックで約 0.3ms) で `0x0000` (吸引点) に落ちて bit0 固定の DC 出力となり、**以後 `@WN0` (周期ノイズ) に切り替えても復活せず全曲無音**になる。
    - **C# オリジナルも同じ AND 実装のバグ** (`tools/cs-probe/out/reference.json` の `dcsgNoiseSamples` が全 100 標本 `-0.25` 定常 = bit0 固定であることが証拠)。前回の両エンジン検証テストが「最初の 0.3ms のピーク値」を拾う偽陽性だったため検出できなかった。
    - 仮想キーボードが鳴る理由: `virtualSynth.ts` は Web Audio 直結の独自ノイズ合成のためエミュレーションを経由しない。
  - **対応内容**:
    1. `shiftLfsr` を実機準拠の XOR フィードバック (`bit0 ^ bit3`、periodic = bit0 パススルー) へ修正。**C# からの意図的な差分**として `web_core_port.md` §3.1 に記録 (C# 本体修正時は reference.json 再生成 + skip テスト解除で再照合)。
    2. `DcsgChip.test.ts`: C# ノイズ標本照合テストを `it.skip` 化 (差分理由コメント付き) + 「白噪 / 周期ノイズが 1 秒間正負に振動し続ける (吸引点に落ちない)」テスト 2 件追加。
    3. `NoiseTrackPlayback.test.ts`: 観察ロジックを共通化し、**「発音フレーム (att < 15) のすべてで出力が正負に振れている (AC 振幅 > 0.04)」**ことを検証する方式へ強化 (DC 定常化を検出できず過去テストを通してしまう問題の再発防止)。AND 実装へ戻すと 4 テストが失敗することを確認済み。
  - **テスト**: `npx tsc -b` エラーゼロ / `npm test` 全 34 ファイル・451 件合格 + 1 skip (意図的差分) / `npm run build` 成功 / `npm run lint` エラーゼロ (既存警告 10 は変更なし)。
  - **備考**: `samples/mml_reference/psg/volume2.mml` にユーザー側の編集とみられる未コミット差分 (@q0-@q7 行の削除) が残っているため本コミットには含めていない。

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
