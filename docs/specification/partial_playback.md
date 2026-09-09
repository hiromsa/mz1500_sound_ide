# 部分再生 (キャレット位置から再生 / 選択範囲のみ再生) 機能仕様

本書は、MML エディタ上の「選択範囲のみの再生」および「キャレット位置からの再生」機能の設計・実装仕様をまとめたドキュメントです。UI (ボタン・ショートカット・コンテキストメニュー) の仕様は [`ui.md`](./ui.md) §エディタを参照してください。

---

## 1. 要件

1. エディタ上で選択した範囲、またはキャレットの現在位置から曲の最後までを再生できること。
2. 再生開始位置の直前までの状態 (音量 `v` / `@v`、音色 `@`、オクターブ `o` / `>` / `<`、デフォルト音符長 `l`、テンポ `t`、各エンベロープ等のコマンド) を正確に引き継いだ上で再生を開始すること。
3. ユーザーのテキスト選択が中途半端な構文境界 (例: `c4 e4` の `4 e` のみを選択) であっても、パースや再生が破綻しない堅牢な設計であること。

## 2. 解決方針 (トークン単位 + Tick ベース)

文字列を強引に切り出す方式は採用しない。以下の 3 層構成で実現する。

```
[MmlEditor]                       [App]                          [Player / AudioEngine]
Monaco のキャレット / 選択範囲 →  MML 再コンパイル → MmlMap  →   プリシーク + 範囲制限再生
(1-based 行 / 列)                 (1) 時間範囲解決                 (3) 高速シミュレート → 同期再生
                                  (2) PlaybackRange
```

### 2.1 MmlMapEvent の時間情報拡張 (`src/core/mml/parser/MmlParserTypes.ts`)

パーサーがノート / レスト命令を emit する際に、ソース位置だけでなく演奏時刻も記録する。

| フィールド | 内容 |
| :--- | :--- |
| `startFrame` | イベントの演奏開始フレーム (0-based / 曲先頭基準 / 60Hz) |
| `durationFrames` | 音符 / 休符の長さ (フレーム数) |

`MmlParser.emitNote` / `emitRest` 内で `advance()` 呼び出し前の累積時刻から算出する。テンポ変更 (`t`) が途中にあってもパーサーのフレーム積算 (`quarterFrames`) が都度反映されるため、位置は常に正確。

### 2.2 時間範囲の解決 (`src/utils/mmlSelectionResolver.ts`・新規)

Monaco と同一の 1-based 行 / 列座標系で部分再生要求を受け取り、MmlMap を走査してフレーム範囲へ解決する純粋関数 (`resolvePlaybackRange`)。

- **キャレット再生 (`kind: 'caret'`)**: キャレット所属トラック (`mmlCaretParser.parseMmlCaretContext` による行頭トラック宣言の追跡で判定・`resolvePlaybackRange` にソース全文を渡す) の「キャレット位置以降で最初のイベント」の開始フレームを `startFrame` (アンカー) とし、`endFrame = null` (曲末尾まで)。**全トラックがアンカーへプリシークした上で同期再生を開始する**ため、ソース上はキャレット行より後ろに書かれていても演奏時刻がアンカーより前の他トラックのイベントが開始位置を曲先頭へ引き戻すことはない (2026-09-09 修正: 修正前は全トラックの「テキスト上キャレット以降のイベント」の最小フレームを採っていたため、P2 等がソース後方に書かれていると曲先頭から再生される問題があった)。キャレットが自トラックの全イベントより後ろの場合は最終イベントの終端フレームをアンカーにし、他トラックの残りを継続再生する。キャレットトラックが MmlMap に存在しない (W1〜W99 等) / アンカー以降に発音イベントが無い場合はテキスト位置ベースの解決 (`resolveByTokenPosition`) へフォールバックする。
- **選択範囲再生 (`kind: 'selection'`)**: 選択範囲に含まれるイベントの開始フレーム最小値を `startFrame`、`startFrame + durationFrames` の最大値を `endFrame` とする。範囲終端で全パート消音・演奏終了 (1 周で停止・範囲ループ非対応)。
- **イベントの範囲判定**:
  - 位置確定イベント (`column > 0`): トークン開始列を基点とする 1 列幅の区間 `[column, column + 1)` で判定。
  - 連符内音符 (`column = 0`、正式パーサが列位置を記録しない): 「直前の位置確定トークン列位置 〜 次の位置確定トークン列位置」の区間で近似 (`buildEventSpans` / 後ろから走査して確定)。これにより連符の真ん中にキャレットがあれば連符先頭から再生され、連符より後のキャレットでは連符が誤採用されない。
- **堅牢性**: 判定はあくまで「イベント (トークン) の開始位置」ベースであり、選択テキストそのものをパースし直さない。`4 e` のような中途半端な選択でも、含まれるイベントが無ければ `null` (再生不可を案内) を返すのみで破綻しない。W1〜W99 トラックはバイナリ生成対象外のため MmlMap に存在せず、単に解決対象から除外される。

### 2.3 プレイヤーのプリシーク + 範囲制限

「曲の先頭から開始フレームまでは発音させずに内部状態のみを高速シミュレート」する。プリシーク中はドライバが mixer に接続されていないため無音で、L ループ復帰も抑制される。プリシーク完了時点で v / o / @ 等の状態がチップレジスタへ反映済みのまま本番再生が始まる。

| コンポーネント | 拡張内容 |
| :--- | :--- |
| `PlaybackRange` (`src/core/player/PlaybackRange.ts`・新規) | `{ startFrame, endFrame \| null }` の再生範囲型 |
| `MzsdSequencer` (`src/core/player/MzsdSequencer.ts`) | コンストラクタに `seekFrames` / `stopAfterFrames` を追加。コンストラクタ内で `seekFrames` 回 `tick()` (プリシーク)。`tick()` ごとに残りフレームを減算し、0 到達で `finishAtRangeEnd()` → 全トラック `silence()` + `isFinished = true` |
| `Z80DriverPlayback` (`src/core/player/Z80DriverPlayback.ts`) | `play()` に `seekFrames` / `stopAfterFrames` を追加。ブート完了後に `machine.runFrame()` を `seekFrames` 回先行実行。範囲終端で `chips.silenceAll()` して `isFinished = true` (範囲終端後の tick は無視) |
| `ChipBank` (`src/core/chips/ChipBank.ts`) | `silenceAll()` を新設 (DCSG 2 チップ全チャンネル減衰 15 / BEEP ゲート off / FM 全チャンネル Key Off)。Z80 ドライバのワークメモリを操作せずに確実に無音化する |
| `TrackSequencer` | `silence()` を public 化 (範囲終端処理から呼ぶため) |
| `AudioEngine` (`src/core/player/AudioEngine.ts`) | `play(song, loop, mode, range?)`。range から `seekFrames` / `stopAfterFrames` を算出して FrameDriver 構築へ渡す |
| `Player` (`src/core/player/Player.ts`) | `play(musicData, loop, mode, range?)`。範囲を `currentRange` に保持し、`rewindToStart()` は範囲先頭から再スタート |

**両エンジン等価性**: SourceInterpreter と Z80Driver はプリシーク後のチップレジスタ状態が一致する (`PartialPlayback.test.ts` の等価テストで担保)。既定エンジンが Z80Driver のため、Z80 ドライバ経路でも部分再生が動作する。

## 3. UI 結線 (`src/view/MmlEditor.tsx` / `src/app/App.tsx`)

- `MmlEditor` は Monaco からキャレット / 選択範囲を取得し、`onPlayRangeRequest(request)` で App へ通知する (`PlaybackRangeRequest`)。ボタン・右クリックメニュー・`Alt+Enter` / `Ctrl+Shift+Enter` ショートカットの全経路が同一ハンドラ (`handlePlayFromCaret` / `handlePlaySelection`) に集約されている。
- `App.handlePlay(request?)` が 1 回のコンパイルで「エラー診断 → MmlMap 時間範囲解決 → Player 再生」までを実行する。部分再生でも都度再コンパイルするため、編集直後のソースに対して常に正確な位置解決が行われる。
- 実行ログ例: `[AUDIO] Playback started (Z80 DRIVER / Web Audio / PARTIAL 1.00s - 2.50s (8 events))`。
- 再生中の MML ハイライト (`mmlPlaybackTracker`) は `getTrackOffset` ベースのため、部分再生中もそのまま動作する。
- **NOTE PREVIEW (打鍵プレビュー / 2026-09-09 新設)**: MML エディタへの入力が停止してから 250ms 経過した時点で、デバウンス期間中に編集されたオフセット区間を `src/utils/notePreview.ts` の `expandToTokenStart` により音符・休符トークン開始位置へ後方拡張し、`kind: 'selection'` として同一の解決・再生経路へ渡す。サイレント実行 (CONSOLE ログ / PROBLEMS 更新 / FAILED 演出なし)。他の開始元 (PLAY / FROM CARET / SELECTION) の演奏中は発火せず、プレビュー演奏中の連続発音は上書き開始する。範囲集計 (`accumulatePreviewChange`) と拡張 (`expandToTokenStart`) は純粋関数として `src/utils/__tests__/notePreview.test.ts` (24 ケース) で検証。UI 仕様は [`ui.md`](./ui.md) §エディタ内トランスポート参照。

## 4. 制限事項・将来拡張

- **選択範囲の範囲ループ**: 初期実装は 1 周で停止。範囲をループ再生するには範囲開始への再プリシーク復帰が必要なため将来拡張とする。
- **Z80 モードの長距離プリシーク**: 曲先頭から数分先へのシークは Z80 エミュレーション分の実行時間がかかる (同期実行)。体感的に問題が出る場合は Web Worker 化やシーク進捗表示を検討。
- **連符の部分再生**: 連符は最小単位として先頭トークン単位で判定される (連符の途中 1 音からのみの再生は不可・先頭から再生)。

## 5. テスト

- `src/utils/__tests__/mmlSelectionResolver.test.ts` (11 ケース): キャレット / 選択 / 複数トラック / 複数行選択 / テンポ変更 / 連符近似区間 / W トラック除外 / 再生不可ケース (`null`)。
- `src/core/player/__tests__/PartialPlayback.test.ts` (9 ケース): プリシーク直後のレジスタ状態 (音量・音程の引き継ぎ)、目標ノートの開始、範囲終端での消音 + `isFinished`、L ループ不復帰、Z80Driver と SourceInterpreter のプリシーク後レジスタ等価、範囲終端後 tick の無視。
