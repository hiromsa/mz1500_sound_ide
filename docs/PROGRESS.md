# MZ-1500 Sound IDE 開発進捗記録 (`PROGRESS.md`)

本書は、MZ-1500 Sound IDE の実装進捗状況、完了した機能、および次期 ToDo を記録・管理するドキュメントです。エージェント開発ルール（[GEMINI.md](./GEMINI.md) / [AGENTS.md](./AGENTS.md)）に基づき、作業完了時に随時更新します。

---

## 1. 直近の完了作業（最新）
- **右ペイン（TRACK MONITOR ～ SONG SETUP / SETTINGS）ヘッダーのUI統一 & PRESET左詰め・非選択化 & テスト発音ボタン共通化・仮想キーボード相互連動 (`src/view/components/TestNoteButton.tsx`, `src/view/TrackMonitor.tsx`, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, `src/view/SongSetupPanel.tsx`, `src/view/SettingsPanel.tsx`, `src/app/App.tsx`, `src/view/VirtualKeyboard.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー要望**:
    - 「TRACK MONITOR ～ SONG SETUP 内のヘッダ部分 に統一感が無いように思えます。
      ・アイコンが無い、タブと違う→タブと同じがよさそう
      ・IDの位置が異なる→左に配置で統一がよさそう
      ・PRESETの動き・配置が異なる→左詰めで統一がよさそう＆押せるけど選択状態にはしなくてよさそう（あくまでもテンプレのデフォルト値のような扱いなので）
      ・テスト発音のボタンの名称など→いいかんじに統一したい※
      ※ボタン一つで試しにならせるのは良い、ただオクターブと音名くらい変えたいこともありそう、ただこだわると仮想キーボード使えってなっちゃうけど、ボタン一つで試しにならせるというシンプルさも捨てがたい、仮想キーボード上の設定とうまく連動できないか」
  - **変更内容**:
    1. **ヘッダー Bento Card スタイルの統一**:
       - 右ペインの全タブ（`TRACK MONITOR`, `YM2151 TONE`, `VOL ENV`, `PITCH ENV`, `SONG SETUP`, `SETTINGS`）のヘッダーを `bg-[#12131a] p-3 rounded-lg border border-white/[0.08]` の Bento Card デザインに統一。
    2. **タブアイコンとの完全一致**:
       - `TRACK MONITOR`: 左端に `<Sliders className="w-4 h-4 text-[#00A8FF]" />` を新設。
       - `YM2151 TONE`: `<AudioWaveform className="w-4 h-4 text-[#00A8FF]" />`（シアン色統一）。
       - `VOL ENV`: 旧デザインの青丸ポチを廃止し、タブと同一の `<TrendingUp className="w-4 h-4 text-[#00A8FF]" />` に変更。
       - `PITCH ENV`: `<LineChart className="w-4 h-4 text-[#00A8FF]" />`。
       - `SONG SETUP`: `<Music className="w-4 h-4 text-[#00A8FF]" />`。
       - `SETTINGS`: `<Settings className="w-4 h-4 text-[#00A8FF]" />`（シアン色統一）。
    3. **定義番号IDの左寄せ配置統一**:
       - `@ID`（FM TONE）、`@vID`（VOL ENV）、`@PEID`（PITCH ENV）の `DefinitionIdInput` を、タイトル・バッジのすぐ右隣（左側エリア、縦仕切り線区切り）に統一配置。
    4. **PRESET の配置・挙動統一**:
       - 各エディタの 2 行目サブバー左端に `PRESET:` を左詰めで統一配置。
       - `FmToneEditor` のアクティブ選択ハイライトを廃止し、他エディタと同様に「クリックするとテンプレート値がセットされるアクションボタン」に統一。
    5. **テスト発音コントロール (`TestNoteButton`) の共通化 & 仮想キーボード連動**:
       - `[▶ TEST NOTE] [C4 ▼]` 形式の統一コントロールを作成し、全エディタに配置。
       - 再生中は `[⏹ STOP] [C4]`（赤色パルスアニメーション）に切り替わり、ワンクリックで停止可能。
       - `[C4 ▼]` ドロップダウンから代表的な音高（C2〜C6, A3, E4, G4, A4等）をクイック選択可能。
       - **双方向連動**:
         - 仮想キーボードで鍵盤を弾くと、その音高がエディタ側のテストノートとして自動記憶され、次回のワンクリック試聴もその音で発音。
         - 仮想キーボードのオクターブ切替（Z/Xキーやボタン）に連動してテストノートのオクターブも自動更新。
         - エディタ側で音高を変更した場合も、全エディタおよびキーボード間で同期。
  - **検証**:
    - `npm test`: 全 298 件すべて合格。
    - `npm run lint`: エラー 0 件。
    - `npm run build`: 成功。
    - 組み込みブラウザサブエージェント（`browser_subagent`）により実機検証完了:
      1. `TRACK MONITOR`: Sliders アイコン付き Bento Card ヘッダーの描画を確認。
      2. `YM2151 TONE`: AudioWaveform アイコン、@1 左寄せ、PRESET 左詰め（非選択）、TEST NOTE [C4 v] から [A4 v] への変更と発音トグルを確認。
      3. `VOL ENV`: TrendingUp アイコン（青丸から変更）、@v1 左寄せ、TEST NOTE [A4 v]（音高引き継ぎ）、PRESET 左詰めを確認。
      4. `PITCH ENV`: LineChart アイコン、@PE1 左寄せ、TEST NOTE [A4 v]、PRESET 左詰めを確認。
      5. `SONG SETUP` / `SETTINGS`: Bento Card スタイルでの美しいヘッダー表示を確認。

- **MML モード時の PC キーボード (A〜K) 演奏無効化 — エディタへの誤入力防止と各エディタ専用化 (`src/view/VirtualKeyboard.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー要望**:
    - 「キーボード A ～ K による演奏は MML モードの時はできないようにします。mmlエディタに入力されちゃうので・・・」
  - **課題**:
    - MML モードで作業中、エディタへの文字入力と PC キーボード演奏（A〜K, W, E...）が競合し、意図せぬ文字入力や誤発音が発生していた。
  - **変更内容**:
    - `VirtualKeyboard.tsx`:
      - `activeTabContext === 'mml'` の場合、PC キーボード演奏（A〜K, W, E, T...）およびオクターブ切り替え（Z/X）のキーイベントハンドラを即時バイパス（`return`）し無効化。
      - 右ペインの各種エディタ（TONE エディタ、PITCH ENV、VOLUME ENV 等）を選択している時（`activeTabContext !== 'mml'`）のみ PC キーボード演奏が有効になるよう制御。
      - コントロールバーのインジケータ表示:
        - 非 MML 時: `⌨ PC: A-K | OCT X [Z-][X+]` (シアン色で有効表示)
        - MML 時: `⌨ PC PLAY: OFF (MML)` (グレー色で無効表示し、理由を明示)
      - 鍵盤上の PC キーガイドラベル（A, S, D, W...）を `activeTabContext !== 'mml'` の時のみ表示するよう変更（MML 時は視覚的にも鍵盤をすっきり表示）。
      - マウスによる鍵盤のクリック・ドラッグ演奏は MML モードを含め常時有効を維持。
    - `docs/specification/ui.md`:
      - バーチャルキーボード仕様の PC キーボード演奏項目に、MML モード時の無効化ルールを追記。
  - **検証**:
    - `npm test`: 全 298 件すべて合格。
    - `npm run lint`: エラーゼロ。
    - `npm run build`: 成功。
    - 組み込みブラウザサブエージェント（`browser_subagent`）により実機検証完了:
      1. MML モード時: インジケータが `⌨ PC PLAY: OFF (MML)` と表示され、鍵盤上のガイド文字が非表示であることを確認。
      2. MML モード時: PC キーボード `KeyA` を押しても鍵盤 C4 が反応しないことを確認。
      3. MML モード時: マウスで鍵盤 C4 をクリックすると沈み込んで正常に発音することを確認。
      4. 右ペイン（VOL ENV / TONE 等）選択時: `⌨ PC: A-K` インジケータおよび鍵盤上のガイド文字が表示され、`KeyA` で C4 が光って沈み込むことを確認。
      5. MML エディタを再クリックして復帰時: 即座に PC キーボード演奏が無効化されることを確認。

- **バーチャルキーボードのクリック無反応不具合の解消 & 押し込み打鍵感強化 & PCキーボード (QWERTY) 演奏対応 (`src/view/VirtualKeyboard.tsx`, `src/view/MmlEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー報告**:
    - 「仮想キーボードが押し込めません。弾けてない？」（鍵盤をクリックしても色が変わらず無反応、沈み込みがない）。
  - **原因**:
    - 前回の修正で下部ツールエリアのコンテナ `div`（`MmlEditor.tsx`）および `VirtualKeyboard.tsx` のルート `div` に追加された `onMouseDownCapture={(e) => e.stopPropagation()}` により、**キャプチャフェーズ（Capture Phase: 親から子へ向かう）でイベント伝播が完全に停止**していた。そのため、子要素である各鍵盤の `onMouseDown` にイベントが一切到達せず、マウスクリックが完全に無反応になっていた。
  - **変更内容**:
    - `MmlEditor.tsx`: 下部エリアコンテナから `onMouseDownCapture={(e) => e.stopPropagation()}` を削除。
    - `VirtualKeyboard.tsx`: ルート要素から `handleKeyboardMouseDownCapture` を削除し、鍵盤へのイベント伝播を完全復旧。
    - `VirtualKeyboard.tsx`: 鍵盤押下時の視覚スタイルを強化（`translate-y-1` で 4px 沈み込み＋インナーシャドウ `shadow-[inset_0_3px_6px_rgba(0,0,0,0.35)]`＋シアン発光）。150ms トランジション遅延を排除し、打鍵した瞬間にスパッと沈み込むリアルな打鍵フィーリングを実現。
    - `VirtualKeyboard.tsx`: 黒鍵・白鍵ともに `onMouseDown` で `isMouseDownRef.current = true` を設定し、白鍵/黒鍵をまたぐスムーズなドラッグ演奏（グリッサンド）に対応。
    - **PCキーボード (QWERTY) 演奏対応 (新設)**:
      - 白鍵: `A`, `S`, `D`, `F`, `G`, `H`, `J`, `K`（C〜C+1）、黒鍵: `W`, `E`, `T`, `Y`, `U`, `O`, `P` による直接タイピング演奏を実装。
      - `Z` / `X` キーで演奏オクターブ（1〜7）を即座にシフト可能。
      - 鍵盤上に対応する PC キーの文字ガイドラベルを表示。
      - コントロールバー右側に `⌨ PC: A-K | OCT X [Z-][X+]` インジケータを表示。
      - Monaco Editor や入力欄へのテキスト入力中は演奏を自動バイパス。
  - **検証**:
    - `npm test`: 全 298 件すべて合格。
    - `npm run lint`: エラーゼロ。
    - `npm run build`: 成功。
    - 組み込みブラウザサブエージェント（`browser_subagent`）により実機検証:
      1. 白鍵 C4 (A) をマウスでクリック ➔ 即座に `translate-y-1` とインナーシャドウ・シアン発光で沈み込みを確認。
      2. 黒鍵 C#4 (W) をマウスでクリック ➔ シアン発光と押し込みを確認。
      3. PC キーボードの `KeyA` を押下 ➔ C4 が光って沈み込み、離すと戻る連動を確認。
      4. 鍵盤上のキーラベル表示およびコントロールバーの `⌨ PC: A-K` インジケータを確認。


- **バーチャルキーボード演奏時の発音モード意図せぬMML切替の修正 (`src/view/MmlEditor.tsx`, `src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー報告**:
    - TONE エディタ、PITCH ENV、VOLUME ENV 等を選択してから仮想キーボードで演奏すると、MML のモード（MML CARET）に変化してしまう。
  - **原因**:
    - `App.tsx` の Left Pane 全体コンテナに `onMouseDownCapture={() => setFocusedPane('mml')}` が付与されていた。
    - React のイベント処理において親の Capture リスナーは子の Capture リスナーより先に実行されるため、`VirtualKeyboard.tsx` 側で `e.stopPropagation()` を行っても親の `setFocusedPane('mml')` が先に発火してしまい、`focusedPane` が強制的に `'mml'` へ切り替わっていた。
    - さらに、下部ツールエリア（KEYBOARD / PROBLEMS / CONSOLE）が MML エディタ領域と同一視されていたため、キーボードやタブのクリックでもエディタフォーカスが奪われていた。
  - **変更内容**:
    - `App.tsx`: Left Pane 全体ラッパーの `onMouseDownCapture={() => setFocusedPane('mml')}` を削除し、MmlEditor に `onFocusEditor={() => setFocusedPane('mml')}` を渡す構造へ改善。
    - `App.tsx`: 右クリックメニュー（「@1 を TONE エディタで編集」等）や新規作成ハンドラからの遷移時にも `setFocusedPane('rightPane')` を設定するよう強化。
    - `App.tsx`: `focusedPane` および `activeTabContext` の宣言順をコールバックの上へ移動し、未初期化アクセス警告を解消。
    - `MmlEditor.tsx`: 上部エリア（エクスプローラー + エディタ主ペイン）のクリックおよび Monaco Editor のフォーカス（`onDidFocusEditorWidget`）時のみ `onFocusEditor` を通知するよう分離。
    - `MmlEditor.tsx`: 下部エリア（KEYBOARD / PROBLEMS / CONSOLE / スプリッター）のコンテナに `onMouseDownCapture={(e) => e.stopPropagation()}` を設定し、下部ツールの操作がエディタフォーカスに影響を与えないよう完全隔離。
  - **検証**:
    - `npm test`: 全 298 件すべて合格。
    - `npm run lint`: エラーゼロ。
    - `npm run build`: 成功。
    - 組み込みブラウザサブエージェント（`browser_subagent`）により実機検証:
      1. 右ペインで `YM2151 TONE` 選択 ➔ キーボードバッジ `FM TONE EDITOR`。鍵盤をクリックして演奏 ➔ `FM TONE EDITOR` を確実に維持。
      2. 右ペインで `PITCH ENV` 選択 ➔ キーボードバッジ `PITCH ENV EDITOR`。鍵盤をクリックして演奏 ➔ `PITCH ENV EDITOR` を確実に維持。
      3. 右ペインで `VOL ENV` 選択 ➔ キーボードバッジ `VOL ENV EDITOR`。鍵盤をクリックして演奏 ➔ `VOL ENV EDITOR` を確実に維持。
      4. MML エディタ内をクリック ➔ キーボードバッジが `MML CARET: P1` に正しく復帰することを確認。


- **下部タブパネル (PROBLEMS / CONSOLE / KEYBOARD) の全幅化 — エクスプローラー領域の下まで横幅を拡大 (`src/view/MmlEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー意図**:
    - 従来、下部タブエリア (PROBLEMS / CONSOLE / VIRTUAL KEYBOARD) はエクスプローラーの右側 (エディタ主ペイン内) にのみ表示されており横幅が狭かった。エクスプローラーの左端まで使える全幅表示にしたい。
  - **変更内容**:
    - `MmlEditor.tsx` のレイアウトを「ルート (横並び) 直下に [エクスプローラー + エディタ主ペイン]」という構成から、「ルート (縦並び) 直下に [上部エリア (横並び: エクスプローラー + エディタ主ペイン) / 上下スプリッター / 下部タブエリア]」へ再構成。
    - 上下スプリッターと下部タブエリアをエディタ主ペインの外 (ルート直下) へ移動し、エクスプローラー領域を含む左ペイン全幅で表示。
    - スプリッターのドラッグリサイズ (60px〜480px クランプ) / ダブルクリックリセット (160px) / 折りたたみトグルは従来動作を維持 (clientY 差分ベースのため移動の影響なし)。
  - **検証**: `npm test` 全 298 合格 / `npm run lint` エラーゼロ / `npm run build` 成功。


- **バーチャルキーボードの発音コンテキスト修正 — 「選択中のエディタ」のプレビューとして機能 (`src/view/VirtualKeyboard.tsx`, `src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー意図**:
    - バーチャルキーボードは「選択しているもの」(MMLエディタ / FM TONE / PITCH ENV / VOL ENV) のプレビュー音が鳴るべきだが、右ペインで TONE / ENV エディタを開いていても、鍵盤をクリックすると強制的に MML キャレットコンテキスト扱いになり、編集中データの音が鳴らなかった。
    - 原因: キーボードパネルが左ペイン (MmlEditor 下部) 内に配置されており、鍵盤クリックが左ペインの `onMouseDownCapture` → `setFocusedPane('mml')` を発火させ、`activeTabContext` が常に `'mml'` にフォールバックしていた。
  - **変更内容**:
    - `VirtualKeyboard.tsx`: ルート要素の `onMouseDownCapture` でイベント伝播を停止し、キーボード上のクリック (鍵盤・コントロール類すべて) がペインフォーカスを奪わないよう修正。「最後に選択したエディタ」の発音コンテキストが鍵盤演奏中も維持される。
    - `VirtualKeyboard.tsx`: `handleNoteOn` の FM 音色設定分岐を整理 (if/else が同一処理だったのを解消、依存配列から不要な `activeTabContext` を削除)。
    - `App.tsx`: `focusedPane` / `activeTabContext` に発音コンテキスト決定ルールのコメントを追記 (判定ロジック自体は変更なし)。
  - **動作**:
    - MMLエディタ選択中 → キャレット位置のトラック/音色/オクターブ/音量/エンベロープ/デチューンで発音。
    - 右ペイン `YM2151 TONE` 選択中 → 編集中の 4OP FM 音色で発音 (FM 固定)。
    - 右ペイン `VOL ENV` 選択中 → 編集中の音量エンベロープを PSG / NOISE で発音。
    - 右ペイン `PITCH ENV` 選択中 → 編集中のピッチカーブを FM / PSG / BEEP で発音。
    - 現在のコンテキストはキーボード上部バッジ (`MML CARET: xx` / `FM TONE EDITOR` / `VOL ENV EDITOR` / `PITCH ENV EDITOR`) に常時表示。
  - **検証**: `npm test` 全 298 合格 / `npm run lint` エラーゼロ / `npm run build` 成功。


- **各エディタの ID 数値入力化・MML定義済み/未定義バッジ・反映ボタンの置換/挿入動作 (`src/utils/mmlDefinitionLoader.ts` 新設, `src/view/DefinitionIdInput.tsx` 新設, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, `src/app/App.tsx`, `src/core/mml/MmlCompilerMacros.ts`, `src/utils/__tests__/mmlDefinitionLoader.test.ts` 新設, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー意図**:
    - FM TONE / VOL ENV / PITCH ENV の ID 指定を数値入力にしたい (100 程度まで使用する利用者を想定)。
    - ID を変更したら、MML 定義済みなら定義内容をタブにロード、未定義なら初期値にする。
    - 定義済み/未定義の区別を ID 付近に表示したい。
    - 「MMLに反映」は定義済み ID なら定義箇所を置き換え、未定義 ID なら挿入する動きにしたい。
    - 右クリック「編集」では該当 ID をタブに表示、「新規」では未使用 ID (最大ID+1) をデフォルトにする。
  - **決定事項 (矛盾の相談結果)**:
    - 未定義 ID の挿入位置は「MML 内の最後の定義ブロックの直後」(定義エリアに集約)。定義ブロックが 1 つも無い場合のみカーソル位置へ挿入。
    - 「新規」右クリック時は未定義のため初期値で初期化される (現行の「編集内容引き継ぎ」から変更)。
    - 定義済み判定は「定義ブロックの有無」ベース (`collectUsedIds` の「定義+利用」ではなく) — 利用のみの ID は未定義扱い。
    - ID 範囲は 0-255 に統一。
  - **変更内容**:
    - `src/utils/mmlDefinitionLoader.ts` 新設: 定義本文 → エディタデータの逆変換純粋関数 (`loadFmToneDefinition` / `loadVolEnvDefinition` / `loadPitchEnvDefinition` / `isIdDefined`)。FM 音色名は `/* 音色名 */` コメントから復元、パラメータは有効範囲にクランプ。
    - `src/view/DefinitionIdInput.tsx` 新設: 3 エディタ共通の ID 数値入力 (0-255) + `DEFINED` / `UNDEFINED` バッジ部品。
    - 3 エディタ: ID 入力を DefinitionIdInput 化 (VOL ENV / PITCH ENV はプルダウン 0-15 から数値入力 0-255 へ)、ID 変更時に定義ロード (定義済み → 定義内容 / 未定義 → 初期値)、MML 定義状態バッジ表示。PITCH ENV の RANGE は MML 定義に含まれないためロード時に現在値を保持。
    - `App.tsx`: ロードリクエストを `{ id, requestNo }` 形式に変更 (同一 ID の再ロード対応)。`handleApplyToMml` を種別 (tone/volEnv/pitchEnv) + ID 受け取りに拡張し、定義済み → 定義ブロック置換 (+自動スクロール) / 未定義 → 最後の定義ブロック直後に挿入 / 定義ゼロ → カーソル位置挿入。アクティブ MML 全文を state 化し各エディタへ `mmlSource` として供給。
    - **既存不整合の修正**: VOL ENV エディタの `generateMmlSnippet` 出力 (`| 12` / `> 8` のカンマなしマーカー) がコンパイラで「無効なエンベロープ要素」エラーになる問題を、`splitMacroTokens` (MmlCompilerMacros.ts) と `splitDefinitionTokens` (mmlDefinitionLoader.ts) の両方に「マーカー+数値」分離処理を追加して解消 (カンマ付き `|,` 形式も継続対応)。
  - **テスト**:
    - `src/utils/__tests__/mmlDefinitionLoader.test.ts` 新設 (15 ケース): ループ/リリースマーカー変換、複数行定義、未定義 null、利用のみ null、エイリアス (@VE) 対応、音量クランプ、FM 音色の音色名/ALG/FB/OP 復元、パラメータ不足 null、定義済み判定。
    - `MmlCompilerAdvanced.test.ts` に「エディタ出力形式 (`| 12` / `> 8`) のパース」テストを追加。
  - **検証**: `npm test` 全 **298 合格** (新規 16 ケース含む) / `npm run lint` エラーゼロ / `npm run build` 成功。


- **コンパイル診断の列位置 (Col) の正確化 & PROBLEMS パネル表示改善 (`src/core/mml/parser/MmlParser.ts`, `src/core/mml/MmlCompilerMacros.ts`, `src/core/mml/MmlCompiler.ts`, `src/view/CompileErrorPanel.tsx`, `src/app/App.tsx`, `src/core/mml/__tests__/MmlDiagnosticLocation.test.ts` 新設, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー意図**:
    - PROBLEMS パネルの `Ln xx, Col xx` 表示のうち `Col` は `mmlError` / `mmlWarn` 内でハードコードされた `column: 1` 固定であり、列位置として実質機能していなかった (実質 行単位の精度)。
    - 「Col = 列まで特定できているのか」という確認に対し、列位置の正確な特定 + `Ln` → `Line` 表記への変更を実施。
  - **変更内容**:
    - `mmlError` / `mmlWarn` を `column` 必須シグネチャに変更し、全診断発行箇所 (~30 箇所) で正確な 1-based 列位置を報告するよう改善。
      - エラー (引数欠落等) はコマンド文字の列、値の範囲警告は該当数値の列、連符内の不正文字はその文字の列を報告。
      - `@t` のカンマ欠落はカンマ期待位置、フレーム数不正はフレーム数位置を報告 (`readUnsigned` の戻り位置を活用)。
      - `tryProcessGlobalTempo` を trimmed 文字列ではなく元行 + 先頭非空白位置で処理するようリファクタリングし、先頭空白のあるテンポ行でも列がズレないよう修正。
      - 付点警告は付点開始位置 (`dotsStart`) を報告。
      - マクロ定義 (`@v` / `@EP` / `@FM`) 内の問題は定義ヘッダ `@` の列位置を報告 (`MmlCompiler.ts` に `countColumn` 新設、`match.indexOf('@')` でヘッダ位置を特定)。
      - 行単位の問題 (トラック未指定、ループ閉じ忘れ等) は従来通り `Col 1` を報告。
    - PROBLEMS パネルの位置バッジを `Ln xx, Col xx` → `Line xx, Col xx` に変更 (`CompileErrorPanel.tsx`)。コンソールの `[NAVIGATE]` ログも `Line` 表記へ統一 (`App.tsx`)。
    - エラー行クリック時の Monaco ジャンプ (`handleSelectErrorItem`) は既に `item.column` を使用しており、column 精度向上により「行頭の単語」ではなくエラー箇所そのものが反転選択されるようになった。
  - **テスト**:
    - `src/core/mml/__tests__/MmlDiagnosticLocation.test.ts` を新設し、14 ケースで診断の line / column を統合検証 (不明文字・引数欠落・範囲警告・未定義エンベロープ・マクロ定義ヘッダ・グローバルテンポの列ズレ防止・コメント除外等)。
    - `MmlCompilerAdvanced.test.ts` の `parseVolumeEnvelope` / `parsePitchEnvelope` 直接呼び出し 2 箇所を新シグネチャに追従。
  - **検証**:
    - `npm test` 全 **282 合格** (新規 14 ケース含む)。
    - `node scripts/verify-mml-parser.mjs` 全 17 ケース合格。
    - `npm run lint` エラーゼロ (既存警告 5 のみ)。
    - `npm run build` 成功。
  - **制限事項 (将来拡張)**:
    - マクロ定義 body 内のトークン単位の列位置 (複数行定義の相対行を含む) は、`splitMacroTokens` が元位置を保持しないため今回は定義ヘッダ位置での報告。トークン単位の位置追跡が必要になった時点で再検討。


- **PLAYエラー時のPROBLEMSタブ自動選択・PLAYボタン失敗フィードバック・エラー行ジャンプの実装 (`src/index.css`, `src/view/MmlEditor.tsx`, `src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景・ユーザー意図**:
    - 再生開始時（PLAYボタン押下など）にコンパイルエラーがある場合、下部パネルで `KEYBOARD` や `CONSOLE` タブを開いているとエラーの発生に気付けず、何度PLAYを押しても音が鳴らないような感覚に陥る問題があった。
    - また、PLAYボタンが失敗したことを視覚的に一瞬で体感できるようにしたいという要望、および `PROBLEMS` タブのエラー行をクリックした際にMMLの該当箇所（Line, Column）を自動選択してほしいという要望に対応。
  - **変更内容**:
    - **PLAYボタンの失敗フィードバック (`App.tsx`, `index.css`)**:
      - `isPlayFailed` state および `triggerPlayFailed` (900msタイマーで自動復帰) を導入。
      - `src/index.css` に `@keyframes shake` および `.animate-shake` クラスを追加。
      - エラー発生時は約900ms間、PLAYボタンが赤色背景・赤色ボーダー・赤色テキスト（`bg-red-950/70 text-red-300 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]`）となり、左右にブルブル揺れるシェイクアニメーションとともに `AlertCircle` アイコンと `FAILED` テキストを表示。
    - **PROBLEMS タブへの自動アクティブ化 & 自動展開 (`App.tsx`, `MmlEditor.tsx`)**:
      - `activeBottomTab` および `isBottomCollapsed` を App 側から制御可能に拡張（controlled / uncontrolled 両立設計）。
      - PLAY または EXPORT 時にコンパイルエラー（または再生開始例外）を検出した場合、現在どのタブを開いていても自動で `PROBLEMS` タブに切り替わり、下部エリアが折りたたまれていた場合は自動展開。
    - **PROBLEMS エラー行選択時の MML 該当箇所ジャンプ & 選択 (`MmlEditor.tsx`)**:
      - `handleSelectErrorItem` を実装。エラー行クリック時に、対象ファイルが非アクティブな場合は該当タブへ自動切替。
      - Monaco Editor のモデルを取得し、該当行・桁を特定して `model.getWordAtPosition` により単語（または該当文字）を `setSelection` で反転選択。
      - `revealPositionInCenter` でエディタ中央へスクロールし、`focus` でキャレットをフォーカス。
  - **検証**:
    - `npm test` 全 **268 合格**。
    - `npm run lint` エラーゼロ（既存警告 5 のみ）。
    - `npm run build` 成功。
    - 組み込みブラウザサブエージェント（`browser_subagent`）により、KEYBOARDタブ選択中のPLAYエラー発生でPROBLEMSタブへ自動切り替え、PLAYボタンの赤色シェイク、およびPROBLEMS行クリックでのMML該当箇所ハイライト・フォーカスを実機描画にて確認完了。

- **MMLエディタ右クリックメニューの「編集」項目を定義行のみ表示に変更 & 複数行 (折り返し) 定義対応 (`src/utils/mmlContextParser.ts`, `src/view/MmlEditor.tsx`, `src/utils/__tests__/mmlContextParser.test.ts` 新設, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **背景**: 右クリックコンテキストメニューの「編集」項目 (`@N を TONE エディタで編集` 等) は、行に `@N` / `@vN` / `@PEN` が含まれていれば**定義・利用を問わず**表示されていた。また `@1 = { ... }` のような複数行 (折り返し) 定義では、ID はヘッダ行 (`@1 = {`) にしかないため、ブロック内の他の行ではメニューが出なかった。
  - **変更内容**:
    - `mmlContextParser.ts` に `findDefinitionBlocks` / `findDefinitionAt` を新設。コンパイラ (`MmlCompiler.macroRegex`) と同一書式 (`@<種別><番号> = { ... }`、`=` 必須) で定義ブロックを抽出し、`{` / `}` の深さカウントで対応する `}` の行までを `startLine`〜`endLine` の行範囲として返す。
    - `handleEditorContextMenu` を行内 ID 抽出 (`analyzeMmlLine`) ベースから定義ブロック判定 (`findDefinitionAt`) ベースへ変更 → **利用箇所では「編集」を非表示**、複数行定義は**ブロック内のどの行でも**表示。
    - コメント除去 `stripComment` を共通化し、同一行完結の `/* ... */` ブロックコメントにも対応 (コメント内の `}` を定義の閉じと誤判定しない)。未完 (未閉鎖) の定義は抽出対象外。
    - サンプル main.mml のガイドコメントを新仕様 (`; 定義行 (@1 / @v1 / @PE1) を右クリックすると対応エディタで編集できます (複数行定義はどの行でもOK)`) に更新。
  - **検証**: `npm test` 全 **268 合格** (新テスト 16 ケース追加: `src/utils/__tests__/mmlContextParser.test.ts`) / `node scripts/verify-mml-parser.mjs` 全 17 ケース合格 / `npm run lint` エラーゼロ (既存警告 5 のみ) / `npm run build` 成功。

- **Z80 ドライバ `apply_fm_tone` のレジスタマッピング 3 バグ修正 & C# 版持ち越し skip 2 テストの解消 (`driver/mzsd_driver.asm`, `src/core/player/__tests__/Z80DriverEquivalence.test.ts`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))** (2026-09-06):
  - **背景**: C# 版から持ち越された「Z80 `apply_fm_tone` の 0x98/0xA0 系レジスタが C# 版とズレる」課題 (等価性テスト 11 シナリオ中 2 が skip) を解消。
  - **原因 (3 バグ)**:
    1. `ev_tone` の音色番号範囲チェックが `音色数 - 1` と比較しており、最後の音色番号 (音色数 1 時は音色 0) が常に範囲外扱いでスキップ → `apply_fm_tone` が一度も呼ばれず FM 音色レジスタが全く書かれない。
    2. `aft_reg` のオペレータアドレス計算が `op*4` (`add a,a` ×2) で、OPM 正の `op*8` でなかった (op1 以降の書き込みが ch4-7 のレジスタ領域へ衝突)。
    3. 0xC0 系 (DT2/D2R) の DT2 読み出しが、`hl` が既に p2 を指した状態で `+9` しており p11 (次オペレータの AR) を読んでいた (`+7` = p9 が正)。
  - **検証**: 等価性テスト 11 シナリオ **全合格 (skip 0)** / `npm test` 全 252 合格 (旧 skip 2 を有効化) / lint エラーゼロ / build 成功。`DriverAsmBuild` テスト (実ドライバ再アセンブル) も合格。
  - **影響**: EXPORT (.qdf) のドライバイメージは修正版アセンブリから再ビルドされる。

- **Z80dotNet 由来コードのライセンス表記整備 (`LICENSE`, `README.md`, `src/core/z80/*.ts` × 4)** (2026-09-06):
  - `src/core/z80/` の 4 ファイル (Z80Processor / Z80Registers / MainRegisters / Z80Bus) 冒頭ヘッダーに「TypeScript port of Z80.Net」明示・**改変者と日付 (`Modified by hiromsa on 2026-09-06`)**・**Permission 条文全文の併記**を追加 (改変版 MIT の条項要件を完全充足)。
  - ルート `LICENSE` に Z80dotNet のライセンス全文 (改変版 MIT) を追記。
  - `README.md` に Credits セクション (移植・改変の明記 + ライセンス誘導) を追加。

- **z80-test (1356 テスト) 命令セット全数検証の実現可能性調査完了 ([`docs/specification/web_core_port.md`](./specification/web_core_port.md) §4.5)** (2026-09-06):
  - `lkesteloot/trs80` の `packages/z80-test` (MIT, Copyright (c) 2019 Lawrence Kesteloot) を調査。テキスト形式 `tests.in` / `tests.expected` (計約 484 KB) を `Delegate` インターフェース経由で任意のエミュレータへ接続する設計、`checkTStates` / `checkEvents` は無効化可能と判明。
  - **前提要件を確定**: 全テストが **MEMPTR** レジスタを検証するが、内製コアは MEMPTR 未実装 (移植時に省略)。完全合格には全命令ディスパッチへの MEMPTR 設定追加 (コア大規模変更) が必要。MEMPTR は割り込み系挙動にのみ影響し、演奏ドライバ (割り込み未使用) には無関係。**MEMPTR 実装の要否を含め別タスクで判断する** (詳細は web_core_port.md §4.5)。

- **システムコンソールの機能拡張 (`src/view/ConsolePanel.tsx` 新設, `src/view/MmlEditor.tsx`, `src/app/App.tsx`, `src/utils/consoleLogStyle.ts` / `diagnosticsLog.ts` 新設, [`docs/specification/ui.md`](./specification/ui.md))** (2026-09-06):
  - **コンソール本体の部品化 (`ConsolePanel.tsx` 新設)**:
    - `MmlEditor.tsx` 内にインライン実装されていた CONSOLE タブのログ表示を `ConsolePanel` コンポーネントとして分離 (高凝集・疎結合化)。
    - **末尾自動追従**: ユーザーが末尾付近 (下部 24px 以内) を見ている場合のみログ追記時に自動スクロールし、過去ログを読み上げ中は追従しない。
    - **空状態表示**: ログ 0 件時は `No logs. BUILD / PLAY / EXPORT events will appear here.` を表示。
  - **行色分けロジックの純粋関数化 (`src/utils/consoleLogStyle.ts` 新設)**:
    - `classifyConsoleLog` / `resolveConsoleLogStyle` を分離してテスト可能に。従来 `[ERROR]` 固定判定のため赤表示されなかった `[AUDIO] ERROR: ...` 形式のログも赤に修正。
  - **ビルドエラー詳細のコンソール出力 (`src/utils/diagnosticsLog.ts` 新設)**:
    - PLAY / EXPORT 失敗時、診断 1 件毎に `[BUILD] ERROR 行:桁 - メッセージ` / `[BUILD] WARNING 行:桁 - メッセージ` 形式でコンソールへ出力 (上限 20 件、超過分は `[BUILD] ... and N more. See the PROBLEMS panel.` と要約)。
  - **下部エリアの折りたたみトグル (`MmlEditor.tsx`)**:
    - 下部タブバー右端に `ChevronDown` / `ChevronUp` の折りたたみボタンを新設 (タブ選択に依存せず常時表示)。折りたたみ時はタブバーのみ (28px) を残し、リサイズ用スプリッターを非表示化。再押下で直前の高さに復帰。
  - **ログコピー (`COPY`) ボタン (`MmlEditor.tsx`)**:
    - CONSOLE タブ選択時に `COPY` ボタン (ログ全文をクリップボードへコピー) を追加。成功時は `COPIED` を約 1.5 秒表示。
  - **テスト追加**: `consoleLogStyle.test.ts` / `diagnosticsLog.test.ts` の 12 ケース追加 → 合計 **250 passed + 2 skipped**。
  - **検証**: `npm test` 全合格 / `npm run lint` エラーゼロ (既存警告 5 のみ) / `npm run build` 成功。

- **GitHub Actions による GitHub Pages 自動デプロイの導入 (`.github/workflows/deploy.yml` 新設, [`docs/specification/ci_deploy.md`](./specification/ci_deploy.md) 新設)** (2026-09-06):
  - `main` push / 手動実行 (`workflow_dispatch`) をトリガーに `npm ci` → `npm run lint` → `npm run build` → `actions/deploy-pages@v4` で自動公開。連続 push 時は `concurrency.group: pages` で古いデプロイを打ち切り。
  - **CI で `npm test` を実行しない理由を明記**: チップ照合テストは `tools/cs-probe` (ターゲット `net9.0-windows` / リポジトリ外の `mz1500_sound_devenv/src/MzSound.Player` を ProjectReference) が生成する `out/reference.json` を必要とし、CI 環境では生成不可能なため。単体テストは push 前にローカル実行する運用。
  - **残作業 (ユーザー操作)**: リポジトリ Settings → Pages → Build and deployment の **Source** を `GitHub Actions` へ切替すること (切替後は `npm run deploy` 手動方式は不要)。

- **`<title>` タグの更新 (`index.html`)** (2026-09-06):
  - ビルド出力のタイトルが `temp_vite` のままだったため `MZ-1500 Sound IDE` へ変更 (`lang` も `ja` へ統一)。

- **TRACK MONITOR から不要なノート表示列 (`---`) を削除 (`src/view/TrackMonitor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))**:
  - **背景・ユーザー意図**:
    - `extra` 欄削除に続き、未発音・停止時に `---` が並ぶノート表示欄も不要として削除し、トラックモニターを「ミュートトグル ＋ トラックID/名 ＋ VUメーター」のシンプルな構成へ整理。
  - **削除内容**:
    - `ChannelState` から `note` フィールドを削除、`generateInitialChannels` の初期化を整理。
    - `ChannelRow` 内のノート表示要素 (`w-12 text-xs ...`) を削除し、VUメーターの可視幅を拡張。
    - 演奏位置からノート文字列を逆引きしていた `resolveTrackNote` 関数および毎 100ms の不要なノート計算処理を削除し、ポーリングを軽量化。
  - **仕様書更新**: `docs/specification/ui.md` にノート表示列削除の決定事項を反映。
  - **検証**: `npm test` 全合格 (238 passed + 2 skipped) / `npm run lint` エラーゼロ / `npm run build` 成功。

- **TRACK MONITOR から不要な extra 欄 (付加情報) を削除 (`src/view/TrackMonitor.tsx`, [`docs/specification/ui.md`](./specification/ui.md))**:
  - **削除内容**:
    - `ChannelState` インターフェースから未実装の `extra?: string` フィールドを削除。
    - `ChannelRow` 内の不要な付加情報レンダリング要素 (`w-12 text-right ... {ch.extra || ''}`) を削除。
  - **仕様書更新**: `docs/specification/ui.md` のエクストラ情報欄のステータスを「削除済み」に更新。
  - **検証**: `npm test` 全合格 (238 passed + 2 skipped) / `npm run lint` エラーゼロ / `npm run build` 成功。

- **PSG (DCSG) のプレビューミュートが実音に反映されない & 初期状態で VU が動作しない不具合を修正 (`src/core/chips/DcsgChip.ts`, `src/core/chips/__tests__/DcsgChip.test.ts`)**:
  - **不具合の内容 (TRACK MONITOR での報告)**:
    - P1 等の PSG トラックで発音メーター (VU) が初期状態で動かず、プレビュー OFF → ON を行うと動き出す。
    - プレビューを OFF にしても PSG の音が鳴り続ける (FM / BEEP は正常にミュートされる)。
  - **原因**:
    - `DcsgChip` の UI チャンネルゲイン (`gain`) 初期値が 0 (BEEP = 1.0 / FM = 1 と不整合) で、VU (`channelLevel`) が初期状態で常に 0 になる。
    - `renderSample` がチャンネルゲインを一切参照しておらず、`setChannelGain(0)` (プレビューミュート) を実音出力へ反映できていなかった。
  - **修正**:
    - `gain` 初期値を 1 (鳴る状態) に変更し、`renderSample` のトーン 3 ch / ノイズの音量にチャンネルゲインを乗算 (ゲイン 0 で実音も VU も無音に)。
    - ゲイン初期値 1 のため C# 版との標本一致検証 (`dcsgSamples` / `dcsgNoiseSamples` ビット完全一致) には影響なし (全テスト合格で確認)。
  - **テスト追加**: チャンネルゲイン 0 (ミュート) で VU / 実音が無音になること、ノイズチャンネルも同様であることを検証 (2 ケース追加 → 合計 238 passed + 2 skipped)。
  - **検証**: `npm test` 全合格 / `npm run lint` エラーゼロ / `npm run build` 成功。

- **TRACK MONITOR 発音メーターの FM VU 不具合修正 & 既定演奏エンジンを Z80 DRIVER に変更 (`src/core/chips/fm/Ym2151.ts`, `src/core/chips/ChipBank.ts`, `src/app/App.tsx`, [`docs/specification/ui.md`](./specification/ui.md))**:
  - **FM VU 不具合修正 (複数チャンネル同時発音で VU が消える)**:
    - KEYON レジスタ ($08) は全 FM チャンネル共有のため、従来の「書き戻し値 (`tryGetRegister(0x08)`) の直接参照」では最後に操作した 1 チャンネルしか判定できず、TRACK MONITOR の FM 発音メーターが 1 ch 分しか点灯しない (他チャンネルが無音扱いで消える) 不具合があった。
    - `Ym2151` が $08 への書き込み (bit0-2 = ch / bit3-6 = slot、slot 0 = キーオフ) を監視してチャンネル毎のキーオン状態を追跡する `isKeyOn(channel)` を新設。`ChipBank.getFmLevel` はこれを参照するよう変更。reset 時は全チャンネルクリア。
    - 既存テスト `'reports the FM level only while key on'` (`ChipBank.test.ts`) は旧 (バグ) 挙動を固定していたため修正後の仕様に更新し、同時発音・キーオフ・ミュートの各ケースを拡充。`Ym2151.test.ts` にキーオン状態追跡テストを新設。
  - **既定演奏エンジンを Z80 DRIVER に変更**:
    - `App.tsx` の `playbackMode` 初期値を `AudioEngineMode.Z80Driver` に変更 (実機ドライバと同一経路を既定に)。
    - `SOURCE INTERPRETER` は SETTINGS から切替可能なまま維持 (リファレンス実装・Z80DriverEquivalence テスト等の比較基準として必要)。
  - **TRACK MONITOR 拡張 (現在の音のオクターブ/音名表示・ノイズ種別表示) は不採用**:
    - チップレジスタからの音程逆算は、スイープ / デチューン / ピッチエンベロープ / KF 等で実際の発音が MML 上の音符とズレるため、MML トークン表示 (`MmlMap` ベース) と矛盾を生じる見込み → 見送り。
    - 「エクストラ情報」欄 (ノイズ種別等) は未実装のまま常に空欄のため、UI 側で削除対象とすることを `ui.md` に記録。
  - **検証**: `npm test` 全合格 / `npm run lint` エラーゼロ / `npm run build` 成功。

- **MMLシンタックスハイライト機能の実装 (`src/utils/mmlLanguage.ts`, `src/utils/mmlLanguage.test.ts`, `src/view/MmlEditor.tsx`, [`docs/PROGRESS.md`](./PROGRESS.md))**:
  - **Monaco Monarch 言語定義の実装**:
    - `docs/specification/mml_reference.md` に準拠した MML 専用言語 `mz1500-mml` および Monaco 言語設定（コメント `;` / `/* */`、括弧オートクローズ等）を新設。
    - ディレクティブ（`#TITLE`, `#COMPOSER`, `#OCTAVE`, `#OPM`, `#FM`）、全17トラック識別子（`P1`〜`P6`, `N1`〜`N2`, `B1`, `F1`〜`F8`）、音色・エンベロープマクロ定義（`@1 = { ... }`, `@v1 = { ... }`, `@PE1 = { ... }`）、演奏コマンド（音符・休符、オクターブ、テンポ、音量、クオンタイズ、ループ `L`, `[ ]` など）を字句解析。
    - 空白区切りだけでなく、MML特有のコマンド連続記述（詰め打ち）にも対応。
  - **直感的な系統別カスタムダークテーマ (`mz1500-mml-theme`) の設計**:
    - ディレクティブ: マゼンタ（`#C586C0`）、文字列: ウォームアンバー（`#CE9178`）、設定値: ティール（`#4EC9B0`）。
    - トラック識別子: DCSG矩形波はスカイブルー（`#00A8FF`）、DCSGノイズはオレンジ（`#FF9E3B`）、BEEPはライム（`#50FA7B`）、FM音源はバイオレット（`#BD93F9`）。
    - マクロ定義/適用: FM音色はピンク（`#FF79C6`）、音量エンベロープはゴールド（`#F1FA8C`）、ピッチエンベロープはミント（`#50FA7B`）、ノイズはコーラル（`#FF6E6E`）。
    - 演奏記号: 音符はクリアホワイト（`#E6EDF3`）、休符はソフトミント（`#85E89D`）、オクターブはシアン（`#4EC9B0` / `#00E5FF`）、永久ループ `L` は太字ネオンイエロー（`#FFDF5D`）、マクロ内 `|` はネオンシアン。
    - コメント: オリーブグリーン斜体（`#6A9955`）。
  - **検証**: `npm test` 235 passed (新規テスト5件追加)、`npm run lint` エラーゼロ、`npm run build` 成功、ブラウザサブエージェントによる描画確認・キャプチャ完了。

- **PITCH ENV エディタからのリリースポイント仕様の削除 (`src/view/PitchEnvelopeEditor.tsx`, [`docs/specification/ui.md`](./specification/ui.md), [`docs/PROGRESS.md`](./PROGRESS.md))**:
  - **仕様整理**: ピッチエンベロープ（`@PE`）はドライバ・MML言語仕様上リリース（`>`）に対応しておらず未実装であるため、UI側の混乱を防ぐため PITCH ENV エディタから Release ポイント関連の全仕様・UI要素を削除。
  - **エディタUIの改修** (`PitchEnvelopeEditor.tsx`):
    - `PitchPreset` インターフェースおよび各プリセットデータから `releasePoint` を削除。
    - `releasePoint` state、およびフレーム長変更・プリセットロード時のクランプ/リセット処理を削除。
    - トグルハンドラ `handleToggleReleasePoint` を削除。
    - ヘッダー部の `> RELEASE: STEP X (Clear)` バッジ表示を削除（`| LOOP` のみ表示）。
    - タイムライン上部の `> RELEASE 直接指定レーン` を削除。
    - リージョン表示ブラケットおよびバーグラフ背景カラー帯の `RELEASE` 透過帯を削除（`LOOP` ブラケットおよび背景のみ表示、幅計算を `envData.length - loopPoint` に統一）。
    - Web Audio リアルタイム試聴処理での `releasePoint` 終了判定を廃止し、`envData.length` に達した際に `loopPoint` へジャンプするようシンプル化。
    - MML生成処理 (`generateMmlSnippet`) から `>` 出力を削除（`|` ループマーカーのみ出力）。
  - **UI仕様書の更新** (`docs/specification/ui.md`):
    - ピッチエンベロープエディタ仕様からリリースポイント（`>`）に関する記載を削除し、`@PE` はリリースポイント対象外である旨を明記。
  - **検証**: `npm test` 230 合格 + 2 skip (全テストパス) / `npm run lint` 既存警告5件・エラーゼロ / `npm run build` 成功。

- **MML リファレンス準拠の全面修正: マクロ定義の全書式対応・`|` / `>` マーカー統一・FM音色 46 パラメータ・ヘッダディレクティブ対応 (`src/core/mml/MmlCompiler.ts`, `src/core/mml/parser/MmlParser.ts`, `src/view/FmToneEditor.tsx`, `src/view/VolEnvelopeEditor.tsx`, `src/view/PitchEnvelopeEditor.tsx`, `src/view/MmlEditor.tsx`, `src/app/App.tsx`, [`docs/specification/mml_reference.md`](./specification/mml_reference.md), [`docs/specification/ui.md`](./specification/ui.md))**:
  - **コンパイラのマクロ定義認識を `mml_reference.md` 4章の全書式へ拡張** (`MmlCompiler.ts`):
    - 従来 `@v / @EP / @FM` のみだった定義行認識を、`@v / @VE` (音量エンベロープ)・`@EP / @PE` (ピッチエンベロープ)・`@FM / @<n>` (FM音色) の全エイリアス + `=` 必須書式 (`@<種別><番号> = { ... }`) に対応 (`parseMacroHeader` で正規化)。
    - これまで `@1 = { ... }` / `@PE1 = { ... }` がマクロ除去されず本体パーサへ流れ、「トラック指定がありません」と誤検出されていた問題を解消。
    - **ヘッダディレクティブ行 (`#TITLE` / `#COMPOSER` / `#OCTAVE` / `#OPM` / `#FM`) をコンパイル前に除去** (1章準拠)。サンプル main.mml がヘッダ行でコンパイルエラーになる潜在バグも解消。
    - 適用コマンドも `@VE<n>` / `@PE<n>` / `@FM<n>` エイリアスに対応 (`MmlParser.processAt` 拡張、FM 音色処理は `processTone` として切り出し)。
  - **エンベロープのループ / リリースマーカーを `|` / `>` に統一** (ユーザー確定仕様。旧 `|L` / `|R` はモック期の誤記のため廃止):
    - VOL ENV / PITCH ENV エディタの MML 出力・マーカーレーン表示・ガイドを `|` / `>` に変更。
    - `|L` / `|R` は仕様外記述として「無効なエンベロープ要素」エラーのまま (テストで明示)。
  - **TONE エディタの「MMLに反映」を 46 パラメータ書式に修正** (`FmToneEditor.generateMmlSnippet`):
    - `@N /* 音色名 */ {` (「=」なし・38パラメータ) → `@N = { /* 音色名 */ ... }` (「=」あり・`ALG, FB + OP1〜OP4 各 11 値: AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME`)。
    - TONE エディタ反映 → そのまま PLAY がコンパイル可能に (旧出力は「46 個必要」エラー)。
  - **サンプル main.mml をリファレンス準拠に更新** (`MmlEditor.tsx`): FM音色定義を 46 パラメータへ、エンベロープを `|` / `>` 表記へ。
  - **PROBLEMS の初期モック警告を廃止** (`App.tsx`): 実コンパイル結果のみを表示するよう初期値を空に。
  - **ドキュメント更新**: `mml_reference.md` 4.1 / 4.2 をユーザー確定仕様に書き換え、4.3 / 5節を 46 パラメータ書式に更新。`ui.md` の MML 出力書式・マーカー表記を同期。
  - **検証**: `npx tsc -b` エラーゼロ / **`npm test` 230 合格 + 2 skip (合計 232、+8)** / `npm run lint` エラーゼロ (既存 UI 警告 5 のみ) / `npm run build` 成功。
    新規テスト: MmlCompilerAdvanced に「MML reference compliance」8件 (`@1 = {}` / `@FM1 = {}` 定義・適用、`@VE1` / `@PE1` 定義・適用、`|` / `>` マーカー位置解析、`|L`/`|R` 不合格、サンプル main.mml 全文コンパイル)。
  - **判明事項 / 次の予定**: `@PE` のリリース (`>`) は MZSD データ形式の penv テーブル拡張 (C# 版ドライバと一体で変更が必要) のため未対応 (現行は警告して無視)。リファレンス 4.2 には「リリース `>` は `@v` のみ対応」と明記済み。

- **Phase 5 完了: UI 接続 (`src/core/player/FrameDriver.ts` / `Z80DriverPlayback.ts`, `src/core/export/QdfImageBuilder.ts`, `src/app/App.tsx`, `src/view/*`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md), [`docs/specification/quickdisk_export.md`](./specification/quickdisk_export.md))**:
  - **Z80Driver モード接続**: `FrameDriver` (tick / isFinished / getTrackOffset の共通契約) を新設し、
    `MzsdSequencer` と `Z80DriverPlayback` (内蔵 Z80 コアでドライバを 60Hz フレーム駆動) を同一視。
    `AudioEngine` に `AudioEngineMode.Z80Driver` を実装 (これまでは throw の未実装)。
    ドライバブート (STAT_PLAY 待ち・最大 4 フレーム) は Phase 4 の等価テストと同一手順。
    `AudioFrameMixer` は `attachDriver` 方式に変更。
  - **BUILD / PLAY 接続 (`App.tsx` + `MmlEditor.tsx`)**: `MmlEditor` がアクティブタブの MML ソースを
    `onActiveSourceChange` で通知 → `PLAY` (Ctrl+Enter) で `MmlCompiler.compile()` を実行。
    エラー/警告は `MmlDiagnostic` → `CompileErrorItem` 変換で PROBLEMS パネル + システムコンソールへ表示
    (エラー時は再生しない)。成功時は `Player.play(musicData, loop, mode)` で再生
    (SourceInterpreter / Z80Driver 切替可)。自然終了で PLAY 表示が復帰。
  - **TrackMonitor 実データ化**: VU レベル (`getTrackLevel`) / マスター (`getMasterLevel`) /
    演奏位置 (`getTrackOffset`) を 100ms ポーリングで実データ表示 (モックのランダム値廃止)。
    ノート欄は `MmlMap` + 演奏位置から現在演奏中の MML 上の文字列をリアルタイム表示。
    トラックのプレビュー ON/OFF / マスター音量は `Player.setTrackVolume` / `setMasterVolume` に接続
    (プレビュー専用パラメータ、コンパイル・エクスポートには影響しない)。
  - **EXPORT (.qdf) 実装**: `src/core/export/QdfImageBuilder.ts` — 実機エミュレータでの起動実績がある
    C# 版 (`mz1500_sound_driver` / QdcImageBuilder.BuildStandardExecutable) を 1:1 移植
    (81,936 バイト固定 / SYNC 0x16x10 区切り / CRC-16/ARC / ロード・実行アドレス 0x1200 / 0xBE00 固定サイズ)。
    格納データは `Z80DriverImage.buildExecutableImage` (新設) でドライバの music_data 位置へ MZSD データを
    埋め込んだ**実機起動イメージ** (QD からロード→実行で演奏開始)。
    ファイル名は `#TITLE` を ASCII 正規化 (16 文字) して使用。形式仕様は quickdisk_export.md に記録。
  - **SETTINGS に PLAYBACK ENGINE セクション追加** (`SettingsPanel.tsx`):
    SOURCE INTERPRETER (既定) / Z80 DRIVER の切替 UI。切替は次回 PLAY から適用。
  - **検証**: `npx tsc -b` エラーゼロ / **`npm test` 222 合格 + 2 skip (合計 224、+13)** /
    `npm run lint` エラーゼロ (既存 UI 警告 5 のみ) / `npm run build` 成功。
    新規テスト: QdfImageBuilder 9 (構造 / CRC 既知ベクトル 0xBB3D / 上限超過拒否) +
    Z80DriverPlayback 3 (ブート & 発音 / 演奏位置 / 自然終了 HALT 検知) +
    Z80DriverMachine に buildExecutableImage 検証を追加 (+1)。
  - **判明事項**: QD ファイル名の C# 版は Shift-JIS (Encoding 932) エンコードだが、ブラウザ標準 API が
    存在しないため ASCII 限定 (`?` 置換) とした。演奏中の TrackMonitor 表示は Z80Driver モードでも
    ドライバの CB_PTRS (MZSD データ先頭基準オフセット) が MzsdSequencer.currentOffset と同系のため、
    MmlMap 経由のハイライトが両エンジンで共通動作する。
- **Phase 4 完了: Z80 CPU コア移植 + ドライバ実行 (`src/core/z80/`, `src/core/player/Z80DriverImage.ts` / `Z80DriverMachine.ts`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))**:
  - **Z80 CPU コア (`src/core/z80/`)**: Z80dotNet と同一挙動の TypeScript 内製移植。
    `Z80Processor.ts` (全命令セット: メイン + CB + ED + DD/FD + DDCB/FDCB、公式 + 主要未文書命令
    (IXH/IXL 系 / SLL / DDCB の RES・SET レジスタロード / 未定義オペコード挙動))、
    `Z80Registers.ts` + `MainRegisters.ts` (メイン + 代替 + IX/IY/PC/SP/I/R/IFF1/IFF2/IM)、
    `Z80Bus.ts` (メモリ / ポートバスインターフェース)。命令ごとの実 T-state 積算、HALT 検出
    (以降 NOP 4T)、16bit ポート空間 (`UseExtendedPortsSpace` 相当) を実装。
    INT/NMI 割り込み線は本プロジェクトでは未使用のため対象外 (将来拡張)。
  - **検証 (単体)**: 57 テスト (`z80/__tests__/Z80Processor.test.ts`)。ALU フラグ (F3/F5 未文書
    ビット含む)、ロテート/シフト、16bit 演算、ジャンプ/コール、ブロック命令 (LDIR/CPIR/OTIR)、
    I/O (16bit ポート 0708h/0709h 形式)、DD/FD・DDCB 未文書動作、未定義オペコードの PC 進行、
    R レジスタ、RETN/LD A,I 等を検証。
  - **`Z80DriverImage.ts`**: ドライバソースを Vite `?raw` import でバンドルし、既存 TS アセンブラで
    ビルド (C# 版 `Z80DriverImage.Build` と同一契約: origin = 0x1200 / `music_data` ラベル /
    org パディング除去)。`defaultDriver` はキャッシュ。
  - **`Z80DriverMachine.ts`**: C# 版 `Z80DriverMachine.cs` の 1:1 移植。64KB RAM + メモリマップド I/O
    (E004h 8253 / E007h 8253 コントロール / E008h H-BLANK + BEEP ゲート) + I/O バス (PSG x2 =
    F2h/F3h/E9h、YM2151 = 0708h/0709h) を内製 Z80 コアへ接続。1 フレーム = 59,659T、
    フレーム先頭 4,560T をブランキング扱い (E008h bit7)、STAT_PLAY 待ち / STAT_LOOP / CB_PTRS
    (演奏位置ハイライト) / DcsgLatch デコードを実装。`traceSteps` / `traceWritesTo` デバッグ API も移植。
  - **等価性テスト**: C# `Z80DriverEquivalenceTests` 相当の 11 シナリオを移植し、
    **SourceInterpreter (`MzsdSequencer`) vs Z80Driver の全フレーム・全レジスタ比較で 9 合格**。
    比較対象: PSG×2 (period×3 / attenuation×4 / ノイズ波形・分周)、BEEP (counter/gate)、
    YM2151 全 256 レジスタ (書き込み有無 + 値)。残り 2 (FM 音色レジスタマッピング) は
    **C# 版がスキップしている同一理由** (`apply_fm_tone` のレジスタマッピング未一致) で `it.skip`。
  - **Z80DriverMachineTests も 11 テスト移植** (PSG/BEEP/ノイズ発音、キーオフ、L ループ巻き戻し、
    ネストループ、VOLUME、FM トラック、演奏位置ハイライト)。
  - **ライセンス**: Z80dotNet は「著作権 / 許諾表示の保持 + 改変の明示」条項付きライセンスのため、
    `src/core/z80/*` のソース冒頭に表示を記載。仕様書 §4.1 にも方針を記録。
  - **判明事項**: 実装中に `DD 34/35/36 (INC/DEC/LD (IX+d))` のディスプレースメント未フェッチバグを
    テストで検出・修正。Z80dotNet の T-state は実機サイクル準拠 (LD r,n = 7T 等) であることを確認。
  - 検証: `npx tsc -b` エラーゼロ / **`npm test` 209 合格 + 2 skip (合計 211)** /
    `npm run lint` エラーゼロ (既存 UI 警告 5 のみ) / `npm run build` 成功。
- **Phase 3 完了: 演奏エンジン移植 (`src/core/player/`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))**:
  - **移植元**: `MzSound.Player/Sequencer/*` + `Audio/AudioEngine.cs` + `Player.cs`。
    C# xUnit テスト (`MzsdSequencerTests.cs` のシーケンサ / FM 分) を vitest へ 1:1 移植。
  - **`MzsdSong.ts`**: MZSD バイナリ解析 (ヘッダ / 17 トラックテーブル / 音量エンベロープ /
    ピッチエンベロープ / FM 音色テーブル 46 パラメータ)。
  - **`TrackSequencer.ts`**: 1 トラック状態機械 (MZSD 命令列解釈 → DCSG / BEEP / FM レジスタ書き込み)。
    ノート / ゲート / スイープ / ディチューン / 転調 / 音量・ピッチエンベロープ (ループ・リリース付き) /
    ノイズ制御 (同期・非連動) / FM KC/KF 展開 (C4 基準・1 セミトーン = 64) / @FM 音色レジスタ展開。
  - **`MzsdSequencer.ts`**: 17 トラックを 60Hz で駆動、全トラック終了時に L ループ復帰 / 演奏終了を判定。
  - **`AudioFrameMixer.ts`**: NAudio `MixerProvider.Read` 相当の合成部を Web Audio 非依存の
    純粋ロジックとして切り出し (vitest で完全テスト可能)。60Hz フレーム駆動 /
    ミックス (PSG1→L、PSG2→R、BEEP・FM→中央、FM 0.4 / BEEP 0.5 / PSG 0.8) / トラックゲイン /
    VU レベル / シーケンサ終了検知を実装。
  - **`AudioEngine.ts`**: Web Audio 出力。AudioWorklet (Blob URL ロード、Vite の base サブパスに依存しない) を
    推奨とし、ScriptProcessor へ自動フォールバック。メインスレッドの pump (20ms) が FrameMixer を
    合成して worklet 側リングバッファ (≒ 0.68 秒) へ転送。`AudioEngineMode` は C# 版と同じ
    SourceInterpreter / Z80Driver の 2 モード構成 (Z80Driver は Phase 4 で接続)。
  - **`Player.ts`**: UI 向けファサード (`play` / `stop` / `rewindToStart` / `setTrackVolume` 2 乗曲線 /
    `setMasterVolume` / `getTrackLevel` / `getMasterLevel` / `getTrackOffset` / `onPlaybackFinished`)。
    AudioWorklet ロードのため `play` / `rewindToStart` のみ async (C# 版との差分は JSDoc に明記)。
  - **テスト移植**: `SongBuilder` (MZSD ビルダー) + MZSD 解析 3 + シーケンサ/FM 12 + ミキサー 5 +
    Player 2 = **新規 22 テスト (合計 132/132 合格)**。DcsgChipTests / Ym2151 分は Phase 2 移植済のため対象外。
  - 検証: `npx tsc -b` エラーゼロ / `npm run build` 成功 / `npm run lint` エラーゼロ (既存 UI 警告 5 のみ)。
  - 備考: 実機ブラウザでの試聴 (AudioWorklet 動作確認) は Phase 5 (UI 接続) で実施予定。
- **Phase 2 完了: C# 版音源エミュレーション (Chips) の TypeScript 移植 (`src/core/chips/`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))**:
  - **移植元**: `MzSound.Player/Chips/*` (DCSG / BEEP 8253 / YM2151)。C# partial class は
    1 ファイル 1 クラスへ統合 (FmTables 3 → 1、FmOperator 4 → 1、FmChannel4 2 → 1、Opm 4 → 1、Ym2151 2 → 1)。
  - **DCSG ×2 (`DcsgChip.ts`)**: SN76489AN 相当。トーン 3ch + ノイズ 1ch (15bit LFSR)、
    2dB/step 減衰、周期/減衰のクランプ、VU 用 ChannelLevel、チャンネルゲイン (UI 連携)。
  - **BEEP (`BeepChip.ts`)**: Intel 8253 PIT Ch.0 相当。クロック 894,886.25Hz (PHI/16)、
    mode 3 矩形波、PC0 SOUNDMSK 相当の ON/OFF ゲート。
  - **YM2151 (OPM) フル実装 (`chips/fm/`)**: fmgen (cisc 1998, 2003) 由来の C# 実装からの移植。
    `FmTables.ts` (サイン/対数→線形/LFO 深度/KF/エンベロープテーブルの実行時構築)、
    `FmTimer.ts` (Timer A/B + CSM)、`FmChip.ts` (比率/LFO 深度共有)、
    `FmOperator.ts` (位相/EG/サイン検索)、`FmChannel4.ts` (8 アルゴリズム接続 + FB + KC/KF)、
    `Opm.ts` (レジスタ 0x00-0xFF デコード、LFO 4 波形 + ノイズ LFO、8ch ステレオ合成)、
    `Ym2151.ts` (MZ-1E14 風ボード層: 0708h/0709h ポート、8μs busy、タイマ IRQ イベント、
    クロック切替 4MHz/3.58MHz)、`ISoundChip.ts`、`SystemRandom.ts`。
  - **C# 乱数の完全再現 (`SystemRandom.ts`)**: OPM の LFO ノイズ波形は `Random(1234)` に依存するため、
    .NET の Knuth 減算法を忠実に移植し乱数列を一致させた (これにより C# との出力ビット一致が成立)。
  - **uint 系の再現**: `lfoCount` / `pgCount` / `noise` 等 C# uint の 32bit ラップ挙動を
    `>>> 0` / `Math.imul(... ) >>> 0` で再現。`Span<int>` は `Int32Array` + offset 引数で代替。
  - **C# リファレンス値ダンプツール (`tools/cs-probe/`)**: .NET コンソールツールで C# 版の
    実出力を JSON にダンプし、vitest とビット単位照合。検証対象: 乱数列 16 値 / DCSG トーン・ノイズ /
    BEEP の連続標本 (double 完全一致) / YM2151 キーオン出力 (部分最大・総和・先頭 48 int 完全一致) /
    YM2151 + saw LFO / noise LFO 出力 (完全一致)。**FM エンジン全体が C# 版とビット一致することを確認**。
  - **テスト移植**: C# `DcsgChipTests` (3 ケースの C# テスト) + `Ym2151_ProducesOutputAfterKeyOn` +
    ChipBank/Beep/SystemRandom 契約テスト → 新規 25 テスト (**合計 110/110 合格**)。
  - 検証: `npx tsc -b` エラーゼロ / `npm run build` 成功 / `npm run lint` エラーゼロ (既存 UI 警告 5 のみ) /
    `npm test` 110/110 合格。
  - 備考: ChipBank の FM チップクロックは C# 版と同じ既定 4MHz (ReferenceClockHz)。cpuClock (3579545) は
    busy 期間 (8μs → 29 T-state) の計算にのみ使用。
- **Z80 CPU コアの外部ライブラリ選定評価 → 既存方針 (内製移植) を再確定**:
  - 別 AI からの提案で `lkesteloot/z80-emulator` (TypeScript 製・MIT・z80-test 1356 テスト合格) を評価。
  - **依存ライブラリとしての採用は見送り**: GitHub リポジトリは 2024/1/5 にアーカイブ、npm パッケージも
    deprecated (最終版 2.3.0 は 2021-11) でメンテ終了。`Hal` のポート I/O が 8bit 前提で
    C# 版が使用する Z80dotNet の 16bit ポート空間 (`UseExtendedPortsSpace`) と非互換。
    IM0 が常に RST 38h 扱い・IM2 ベクタ下位バイトが 0xFF 固定など割り込み精度も不足
    (EI 後の iff 遅延の実装も未確認)。
  - **決定**: Z80dotNet 相当コアの TypeScript 内製移植は既存方針どおりとし、lkesteloot 系は
    **検証基盤として活用** (モノレポ `lkesteloot/trs80` 内の `z80-test` 1356 テストを内製コアの
    命令セット検証に使用、`GenerateOpcodes.ts` のオペコードデータを表実装の参考に、
    挙動突き合わせデバッグ用リファレンスに)。詳細は
    [`docs/specification/web_core_port.md`](./specification/web_core_port.md) §1.1。
- **C# 版コア (内部機能) の TypeScript への移植開始・アセンブラ+MML コンパイラ完了 (`src/core/`, `driver/`, [`docs/specification/web_core_port.md`](./specification/web_core_port.md))**:
  - **背景**: 別プロジェクト `C:\tools\mz1500_sound_devenv` (C# 版 MZ-1500 サウンド開発環境) の
    内部機能 (UI 以外: MML コンパイラ / Z80 アセンブラ / 演奏コア / Z80 ドライバ) を本プロジェクトへ移植。
    UI は本プロジェクトの既存実装 (React + Monaco + Tailwind) を最優先。
  - **プロジェクト構成の再編** (モックからの本格実装移行):
    - `src/components` → `src/view` (UI コンポーネント層)
    - `src/App.tsx` → `src/app/App.tsx` (アプリシェル層)、`src/main.tsx` の import 更新
    - `src/core/` (ロジック層・UI 非依存) を新設
    - `src/core/fm/FmTone.ts` に FmTone 型とアルゴリズム純粋ロジックを抽出し、
      `src/utils/virtualSynth.ts` → `src/components/FmToneEditor` の **UI 逆依存を解消**
  - **Z80 2 パスアセンブラを移植** (`src/core/assembler/`、移植元: `MzSound.DriverAssembler`):
    - `Z80Assembler.ts` (2 パス / org / equ / db / dw / dctbl / beeptbl)、`Z80Encoding.ts` (命令エンコーダ)、
      `OperandParser.ts`、`ExpressionEvaluator.ts`、`Z80Operand.ts`、`AssembleResult.ts` の 6 モジュール。
    - enum 非使用 (`erasableSyntaxOnly` 対応のため const オブジェクト + union 型で実装)。
  - **MML コンパイラを移植** (`src/core/mml/`、移植元: `MzSound.MmlCompiler`):
    - `MmlCompiler.ts` (マクロ抽出 → パース → MZSD バイナリ組立)、`MmlCompilerMacros.ts` (@v/@EP/@FM)、
      `MmlCompilerAssemble.ts`、`parser/MmlParser.ts` (C# partial class を 1 クラスに統合)、
      `TrackId.ts`、`Envelopes.ts`、`MmlMap.ts`、`parser/MmlParserTypes.ts`。
  - **Z80 ドライバ実ソースの取り込み** (`driver/mzsd_driver.asm`、C# 版 v1.2 = FM 対応版 1945 行):
    - C# 版 `Z80DriverImage.Build` と同一契約 (origin = 0x1200、`music_data` ラベル、org パディング除去) を
      vitest で検証するテストを追加。**実ドライバ 1945 行が TypeScript 版アセンブラで正常にアセンブルできることを確認**。
  - **テスト基盤の導入と C# テストの移植** (vitest、`npm test`):
    - アセンブラ 51 テスト (エンコード 45 パターン + ラベル解決 / db・dw / ノートテーブル式 / 範囲エラー / 行番号)、
      MML 24 テスト (基本 7 + 高度 13 + マクロ複数行 4)、実ドライバ検証 3 テスト → **計 85 テスト全合格**。
    - C# 版と同一の期待値 (オペコード列・フレーム数・DCSG/8253 周波数テーブル式) をビット単位で検証。
  - **npm ライブラリ選定調査**: Z80 CPU エミュレータは npm に実用レベルのものが存在しないことを確認
    (`jsz80` / `z80-cpu` は 404、`z80` は v0.0.1 のみ)。**Z80dotNet 相当のコアを TypeScript で内製移植する**方針を確定
    (移植元との挙動一致・等価テスト流用のため)。
  - **仕様ドキュメント新設**: [`docs/specification/web_core_port.md`](./specification/web_core_port.md)
    (移植アーキテクチャ・フォルダ構成・C#↔TS 対応表・検証方針)。
  - 検証: `npx tsc -b` エラーゼロ / `npm run build` 成功 / `npm run lint` エラーゼロ / `npm test` 85/85 合格。

## 2. 次のフェーズ (Web コア移植の続き)
- [x] **Phase 4: Z80 コア移植 + ドライバ実行** (完了 → §1 参照)
  - [x] Z80dotNet 相当の TS コア (全命令セット / 16bit ポート相当 / T-state 精度 / HALT)
  - [x] `Z80DriverImage.ts` (ドライバビルド + MZSD 配置) / `Z80DriverMachine.ts` (E008h bit7 H-BLANK 同期)
  - [x] **等価性テスト**: SourceInterpreter vs Z80Driver の全フレーム音源レジスタ比較
    (**11/11 合格**。旧 skip 2 は 2026-09-06 の `apply_fm_tone` 修正で解消 → §1 参照)
  - [ ] (残タスク) `lkesteloot/trs80` の `z80-test` (1356 テスト) による命令セット全数検証
    (実現可能性調査完了。テストデータ取り込み + Delegate 実装に加え、**MEMPTR 実装 (コア大規模変更)** が
    前提要件。詳細は [`web_core_port.md`](./specification/web_core_port.md) §4.5)
- [x] **Phase 5: UI 接続** (完了 → §1 参照)
  - [x] MML エディタ BUILD/PLAY → `MmlCompiler` 実行 (コンパイルエラー→ CompileErrorPanel / システムコンソール)
  - [x] PLAY → `Player` (SourceInterpreter 既定、SETTINGS で Z80Driver 切替)
  - [x] トラックモニターへの VU・演奏位置反映 (`Player.getTrackLevel` / `getTrackOffset` + `MmlMap`)
  - [x] エクスポート (.qdf) 実装 (MZT は次フェーズへ持ち越し・C# 版に MZT 出力実装なしとの判断により
    実機起動実績のある .qdf を先行実装。仕様: quickdisk_export.md)
  - [ ] (残タスク) 実機 / エミュレータでの試聴・起動確認 (Phase 3 時点の AudioWorklet 実機検証込み)
- [x] **@FM 音色レジスタマッピングの課題** (2026-09-06 解消): C# 版持ち越しの Z80 `apply_fm_tone`
  バグ 3 件 (音色範囲チェック / op アドレス倍率 / DT2 オフセット) を修正し、等価性テスト 11/11 合格。→ §1 参照

---


# Z80.Net (TypeScript移植版) ライセンス対応タスク

Konamiman氏の `Z80.Net` をTypeScriptへ移植するにあたり、以下のライセンス条件（改変版MITライセンス）を満たす必要がある。

**✅ 2026-09-06 に全項目完了** (→ §1 参照)。

## 1. ドキュメント類の整備
- [x] `LICENSE` ファイルの作成 (2026-09-06 完了)
  - 元の著作権表示（`Copyright (C) 2014 Konamiman...`）およびライセンス全文をそのままコピーして配置する。追記でいいかな。→ 追記方式で配置済み。
- [x] `README.md` への記載 (2026-09-06 完了)
  - Konamiman氏の `Z80.Net` を元に、C#からTypeScriptへ移植（改変）した旨を明記する。
  - `README.md` 内にも著作権表示とライセンス文を併記する。

## 2. ソースコードヘッダーへの記載
- [x] 移植した各 `.ts` ファイルの先頭に、以下の内容を含むコメントブロックを追記する。 (2026-09-06 完了: Z80Processor / Z80Registers / MainRegisters / Z80Bus の 4 ファイル)
  - 元の著作権表示（`Copyright (C) 2014 Konamiman...`）
  - 「Konamiman氏のコードをTypeScriptに移植・改変した」という明確な宣言
  - 改変者（自分）の名前と改変日

**▼ ソースコード用ヘッダーのテンプレート**
```typescript
/*
 * This file is a TypeScript port of Z80.Net originally written by Konamiman.
 * Modified by [あなたの名前/アカウント名] on [YYYY-MM-DD].
 * 
 * Copyright (C) 2014 Konamiman ([www.konamiman.com](https://www.konamiman.com))
 * [ここにライセンスのPermission条文を併記]
 */
```

---

## 3. 過去の完了作業 (モック期)

- **公式 MZ-1500 SVG ロゴの assets 配置 & ヘッダー「Sound IDE」バッジ化 ([`src/assets/mz1500logo.svg`](./../src/assets/mz1500logo.svg), [`public/assets/mz1500logo.svg`](./../public/assets/mz1500logo.svg), [`src/app/App.tsx`](./../src/app/App.tsx), [`docs/specification/ui.md`](./specification/ui.md))**:

  - **SVG ロゴファイルの配置**:
    - 実機公式デザイン準拠のベクターロゴファイル（`mz1500logo.svg`: 縦3本バーM、シャープなZ、中空アウトライン1500）を `src/assets/` および `public/assets/` 配下に格納。
  - **ヘッダーロゴ・バッジの刷新**:
    - 従来の暫定「角丸四角MZバッジ + MZ-1500 テキスト」を撤去し、`import mz1500Logo from './assets/mz1500logo.svg';` による鮮明なベクターSVGロゴ画像（高さ `h-5`）へ置き換え。
    - 隣接するバッジの表記を `IDE` から **`Sound IDE`** へ更新。
    - 実機通りの美麗なプロポーションと色合い（ライトアイスブルー）がダークヘッダーに調和し、製品名「MZ-1500 Sound IDE」としてのブランド・ビジュアルを確立。
  - **ビルド & 実機ブラウザ検証通過**:
    - `npm run build` エラーゼロ通過。実機ブラウザにてヘッダー左上に公式 MZ-1500 ロゴおよび `Sound IDE` バッジが美麗にレンダリングされることをスクリーンショットにて確認。

- **`Ctrl + Enter` 再生/停止トグルの確実化 & MMLエディタ右クリックメニューへの切り取り・コピー・貼り付け復活 ([`src/App.tsx`](./src/App.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/MmlContextMenu.tsx`](./src/components/MmlContextMenu.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **`Ctrl + Enter` による再生停止トグルの安定化**:
    - `MmlEditor.tsx` のマウント時に登録される `addCommand` のコールバックが初期の `onTogglePlay`（`isPlaying: false`）をキャプチャし続ける stale closure 問題を解消。
    - `App.tsx` に `isPlayingRef` を導入して常に最新の再生状態を追跡し、`MmlEditor.tsx` にも `onTogglePlayRef` を設けて常に最新のトグル関数を実行。
    - Monaco Editor 内およびグローバルのいずれにおいても、再生中に `Ctrl + Enter` を押すことで確実に再生が停止するよう修正。
  - **MMLエディタ右クリックメニューのクリップボード操作復活**:
    - カスタムコンテキストメニュー（overlay 方式）へ、標準編集アクション「`切り取り` (`Ctrl+X`)」「`コピー` (`Ctrl+C`)」「`貼り付け` (`Ctrl+V`)」を追加。
    - アイコンは `lucide-react` の `Scissors`, `Copy`, `ClipboardPaste` を使用し、右端にショートカットキー表記（`Ctrl+X` 等）を配置。
    - 選択範囲がある場合はその範囲を、選択範囲がない場合はカーソル行を対象とする VS Code 準拠のスマートなクリップボード動作を実装（右クリック位置への自動キャレット追従もサポート）。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過、`npm run lint` (oxlint) エラーゼロ。
    - ブラウザ実機にて Monaco Editor 内での `Ctrl + Enter` による再生開始 ➜ 再度 `Ctrl + Enter` での確実な停止を確認。
    - MMLエディタ上の右クリックメニューに「切り取り」「コピー」「貼り付け」が整然と表示されることをスクリーンショットおよびDOM検証にて確認完了。

- **開発環境の役割分担・MCP 設定の適用範囲に関する注意点をドキュメント化 ([.clinerules](./.clinerules), [`docs/specification/mcp-browser-debug.md`](./specification/mcp-browser-debug.md))**:
  - 開発環境の役割分担を `.clinerules` に新規セクションとして追加: **VSCode + Cline = 内部実装 / Antigravity = デザイン・UI** (`.clinerules` は GEMINI.md 経由で Antigravity にも共有される)。
  - **chrome-devtools-mcp の MCP 設定は Cline 専用**である旨を明記 (Antigravity は組み込み Browser を使用するため原則不要・Antigravity 側への流し込みはしない)。
  - **`.clinerules` は GEMINI.md 経由で Antigravity からも参照されるため、読み取り拒否・除外・参照ブロックの設定を一切行ってはいけない**旨を規定。
- **MCP による自動ブラウザ操作 & デバッグ環境の構築 (chrome-devtools-mcp)**:
  - Cline の MCP 設定 (`%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`) に **chrome-devtools-mcp** (Google ChromeDevTools 公式) を追加。Gemini Antigravity の MCP Store「Frontend & Design」と同じ Chrome DevTools 系を採用 (コンソールログ収集・ネットワーク検査・パフォーマンストレースなどデバッグ機能が豊富)。
  - Windows 向けに `cmd /c npx -y chrome-devtools-mcp@latest` 形式で設定 (初回パッケージ DL を考慮し timeout 100 秒)。`autoApprove` は空 = 全ツール呼び出しでユーザー承認 (安全優先)。
  - 仕様ドキュメント [`docs/specification/mcp-browser-debug.md`](./specification/mcp-browser-debug.md) を新設し、索引 [`docs/specification/README.md`](./specification/README.md) を新規作成。
  - **実ブラウザでの動作確認は未実施** (ユーザー指示により仕組みのみ整備)。次回ブラウザデバッグが必要になった際に初回動作確認を実施すること (ToDo 参照)。
- **GitHub Pages 公開対応・モックのデプロイ (gh-pages ブランチ方式) ([`vite.config.ts`](./vite.config.ts), [`package.json`](./package.json))**:
  - `vite.config.ts` に `base: '/mz1500_sound_ide/'` を設定 (GitHub Pages プロジェクトページのサブパス対応)。
  - `package.json` に `predeploy` (`npm run build`) / `deploy` (`gh-pages -d dist`) スクリプトを追加。**`npm run deploy` 一発でビルド〜gh-pagesブランチ公開まで完結**。
  - `gh-pages` を devDependency として追加。
  - **公開URL**: <https://hiromsa.github.io/mz1500_sound_ide/> (動作確認済み: index.html / JS / CSS いずれも 200 OK 配信)
  - 今後のモック更新手順: 修正後に `npm run deploy` を実行するだけ。
- **サンプルMMLデータの `mml_reference.md` 準拠修正・旧 `TR` トラック表記の全面排除 ([`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/utils/mmlCaretParser.ts`](./src/utils/mmlCaretParser.ts), [`src/components/VirtualKeyboard.tsx`](./src/components/VirtualKeyboard.tsx), [`src/App.tsx`](./src/App.tsx), [`scripts/verify-mml-parser.mjs`](./scripts/verify-mml-parser.mjs))**:
  - **サンプルデータの文法修正**:
    - `main.mml`: FM音色定義を `@1 { ... }` から **`@1 = { ... }` (`=` 必須)** に修正し、実パラメータ (ALG/FB/OP1〜OP4) を記載。`TR1` → `P1` トラック、音符は小文字・`t120 l8` 付きのリファレンス実例準拠スタイルに統一。
    - `drums.mml`: 無効トラック `TR7` → ノイズトラック `N1` (`@WN1` ホワイトノイズ) に修正。
    - 新規ファイル / 新規タブのテンプレートも `TR1 O4 C D E` → `P1 t120 l8 o4 c d e` に修正。
  - **旧 `TR\d+` トラック表記の全面排除** (正: `P1`〜`P6` / `N1` `N2` / `B1` / `F1`〜`F8` の全17ch 表記):
    - `mmlCaretParser.ts`: デフォルトトラック名 `'TR1'` → `'P1'`、`trackRegex` から `TR\d+` を削除、TR系エンジン判定ブロックを削除。
    - `VirtualKeyboard.tsx`: `MML CARET:` 表示のフォールバック `'TR1'` → `'P1'`。
    - `App.tsx`: コンパイルエラーモックの `track` を `'P1'` に修正し、`line`/`column` も新サンプルの `@v1` 記述位置 (20行目/15列) に整合。
    - `verify-mml-parser.mjs`: テスト入力を `P1`〜`P3`・小文字音符・`@1 = { }` 準拠に更新。
  - **検証**: `node scripts/verify-mml-parser.mjs` 全17テスト合格、`npm run build` 成功、`npm run lint` エラーゼロ (警告8件は既存の set-state-in-effect 系で本件と無関係)。
  - 備考: `mml_reference.md` はユーザーにより FM音色定義 `@N = { ... }` / `@FMN = { ... }` の **`=` 必須** 仕様へ修正済み (4.3節・5節実例とも整合)。

- **MMLエディタ 右クリックコンテキストメニュー & 各エディタ⇔MML連携の実装 ([`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/utils/mmlContextParser.ts`](./src/utils/mmlContextParser.ts), [`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx), [`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **カスタム右クリックコンテキストメニュー (計6アクション・overlay方式)**:
    - `@N を TONE エディタで編集` / `@VEN を VOL ENV エディタで編集` / `@PEN を PITCH ENV エディタで編集`: 右クリックした行を解析し、記述済みの `@N` / `@FMN`、`@vN` / `@VEN`、`@PEN` を対応エディタで開く (右ペインタブ自動切替・非表示時は自動オープン)。
    - `新規 FM TONE を挿入...` / `新規 VOL ENV を挿入...` / `新規 PITCH ENV を挿入...`: MML全文から既存IDを収集し、**最大ID+1の未使用ID**で各エディタを新規作成状態で開く。
    - **メニューアイコンは右ペインタブ (TONE / VOL ENV / PITCH ENV) と同一の Lucide SVG** (`AudioWaveform` / `TrendingUp` / `ChartLine`)。Monaco 内蔵メニューは Lucide アイコンを表示できないため、新設コンポーネント [`src/components/MmlContextMenu.tsx`](./src/components/MmlContextMenu.tsx) による **overlay 方式** (Monaco `contextmenu: false` 化 + エディタラッパー `onContextMenu` で `preventDefault`) を採用。
    - 「編集」系は対象IDを含む行でのみ表示し、区切り線を挟んで「新規」3種を常時表示。外クリック / `Esc` / ウィンドウ非活性で閉じ、画面端では表示位置を自動補正。`getTargetAtClientPoint` によりカーソル位置に依存しない行特定を実装。
  - **MMLパーサーユーティリティの新設 (`src/utils/mmlContextParser.ts`)**:
    - `analyzeMmlLine` (1行解析) / `collectUsedIds` (全文ID収集) / `nextAvailableId` (未使用ID採番) をUIと切り離した純粋関数として分離 (高凝集・疎結合)。
    - コメント (`;` / `//`) 以降の除外、`@WN` / `@SW` / `@q` 等の他コマンドの音色ID誤検出防止を実装。
    - ロジック検証スクリプト [`scripts/verify-mml-parser.mjs`](./scripts/verify-mml-parser.mjs) (**全17ケース自動アサート、全パス**)。`node scripts/verify-mml-parser.mjs` で実行可能。
  - **各エディタに「▶ MMLに反映」ボタンを新設 (エディタ⇔MML双方向連携)**:
    - FM TONE: `@N /* 音色名 */ { ALG, FB, OP1〜OP4パラメータ }` 複数行ブロック / VOL ENV: `@vN = { |L, |R マーカー付き音量列 }` / PITCH ENV: `@PEN = { ... }` を、Monaco Editor のカーソル位置に挿入 (選択範囲があれば置換)。
    - 3エディタのMML生成ロジックを `generateMmlSnippet` に統一。FM TONE の「GENERATED FM TONE MML」プレビューも擬似表記から実コマンド形式 (`mml_reference.md` 準拠) に刷新。
    - エディタ側は `loadToneId` / `loadEnvId` props を監視し、右クリックメニュー指定IDをIDセレクタへ即時反映。
  - **App.tsx 連携ハンドラ**:
    - `handleRequestEdit*` / `handleRequestNew*` (6種) + `handleApplyToMml` を実装。`onEditorMount` による Monaco インスタンスの共有で右ペインからMMLへの挿入を実現。
  - **ビルド & ロジックテスト通過**:
    - `npm run build` エラーゼロ通過。`npm run lint` (oxlint) エラーゼロ。パーサーロジック全17テストパス。
    - 実機ブラウザでの右クリック操作・スニペット挿入のE2E確認は次セッションで実施推奨 (自動化MCP未接続環境のため)。

- **PLAYボタンのトグル停止化、`Ctrl + Enter` 再生ショートカット、無限ループ（`LOOP`）ON/OFFスイッチ、および下部エリア（PROBLEMS / CONSOLE）のタブ化 ([`src/App.tsx`](./src/App.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/CompileErrorPanel.tsx`](./src/components/CompileErrorPanel.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **PLAYボタンのトグル停止動作**:
    - 再生中（`PLAYING...` / `STOP / PLAYING`）にもう一度 PLAY ボタンを押すと停止するトグル動作を実装（`STOP` ボタンも引き続き配置）。
  - **`Ctrl + Enter` ショートカットキー**:
    - ウィンドウ全体および Monaco Editor 内の両方で `Ctrl + Enter`（Mac: `Cmd + Enter`）を押すことで、即座に再生/停止をトグル可能に実装。
  - **無限ループ（`LOOP`）ON/OFF トグルボタン**:
    - PLAY ボタンのすぐ左側に、Repeat アイコンと自照式 LED ランプ付きの `LOOP` トグルボタンを新設（デフォルト: **ON**）。
    - ビルドおよび再生ログに `Loop mode: ENABLED (L infinite loop)` / `DISABLED (Play once)` が明瞭に出力されるよう連動。
  - **下部エリア（PROBLEMS / CONSOLE）のタブ化統合**:
    - 従来上下2段に分割されていたコンパイルエラー（PROBLEMS）とシステムコンソール（CONSOLE）を、下部の共通タブバー（`[PROBLEMS (件数)]` / `[CONSOLE (行数)]`）によるタブ切り替え方式に統合。
    - 将来的に追加される別の作業エリア（逆アセンブラ、メモリマップ、波形プレビューなど）をスムーズに拡張できるスロット構造を確保。
    - 上部境界のスプリッターにより、下部エリア全体の高さをマウスドラッグで自在に上下伸縮可能（ダブルクリックで初期高さ 160px にリセット）。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて、PLAYトグル、LOOPボタン切替、`Ctrl+Enter` キーバインド、タブ切り替え（PROBLEMS ⇔ CONSOLE）、上下ドラッグリサイズがすべて正常動作することを確認。

- **トランスポート統合（PLAY/STOP/EXPORT .qdf）、右ペイン開閉ボタン移設、コンパイルエラーパネル新設 & 上下ドラッグリサイズの実装 ([`src/components/CompileErrorPanel.tsx`](./src/components/CompileErrorPanel.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **EXPORT ボタン表記の `.qdf` 化**:
    - 実機MZ-1500のQuickDisk形式に合わせて `EXPORT (.qdf)` に更新。クリック時にコンソールへ生成成功ログを出力。
  - **`F1: BUILD` 廃止 & `PLAY` ボタン統合**:
    - ヘッダーの単独 `F1: BUILD` を削除し、`PLAY` ボタンで「MMLコンパイル ➜ 再生開始」をワンクリックで実行可能に統合。
  - **`PLAY` / `STOP` ボタンのモック連動**:
    - 再生中（`PLAYING...` 自照式シアン発光）と停止（`STOPPED`）のステートを管理。
    - クリック時に SYSTEM CONSOLE へビルドログ・再生開始ログ・停止ログをリアルタイム出力。
  - **右ペイン開閉トグルボタンの移設**:
    - ヘッダー右端のボタンを撤去し、**MMLエディタタブバーの最右端（`ml-auto`）**に左右対称の開閉ボタン（`HIDE` / `PANE`）を配置。ワンクリックで右ペインの開閉が可能。
  - **コンパイルエラー（文法エラー・問題）パネルの新設 (`CompileErrorPanel.tsx`)**:
    - ご指定の「MMLエディタの下部(CONSOLE)の上かつEXPLORERの右側」に `PROBLEMS / COMPILE ERRORS` パネルを新設。
    - エラー数バッジ（`X Errors`, `Y Warnings`）、トラック名、行・列番号、エラーメッセージ、CLEARボタンを完備。
  - **エクスプローラー右側領域の3段上下ドラッグリサイズ**:
    - [Monaco MMLエディタ] ⇔ [コンパイルエラーパネル] ⇔ [システムコンソール] の間に水平スプリッターを導入。
    - マウスドラッグにより、エラーパネルおよびコンソールの高さを自在に上下伸縮可能（ダブルクリックで初期高さにリセット）。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて、PLAY/STOPによるログ出力とボタン発光、EXPORT (.qdf) 動作、エディタタブバー右端ボタンでの右ペイン開閉、スプリッターのマウスドラッグによる上下リサイズをすべて確認。

- **TRACK MONITOR の実機標準音源の `MZ-1500 BASICS` タイトル化 & 3サブカテゴリ（DCSG1 / DCSG2 / BEEP）整流化 ([`src/components/TrackMonitor.tsx`](./src/components/TrackMonitor.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **1パネル内でのサブカテゴリ構造化**:
    - 実機標準音源の左カラムタイトルを `MZ-1500 BASICS`（バッジ: `STANDARD 9ch`）へアップデート。
    - パネル全体の `ALL ON` / `MUTE` 一括操作ボタン（標準9ch全体を一括ON/MUTE）の操作性はそのまま維持。
    - パネル内部に、各音源チップ系統ごとの洗練されたサブカテゴリヘッダーを導入：
      - **`DCSG 1 (SN76489)`**: `P1`, `P2`, `P3` (PSG 1-3) ＋ `N1` (Noise 1)
      - **`DCSG 2 (SN76489)`**: `P4`, `P5`, `P6` (PSG 4-6) ＋ `N2` (Noise 2)
      - **`BEEP`**: `B1` (1-bit Pulse 8253 Timer)
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて `MZ-1500 BASICS` カラム内に `DCSG 1`、`DCSG 2`、`BEEP` が整然とカテゴリ分け表示され、ヘッダーの `ALL ON` / `MUTE` で全9chが一括操作できることを確認。

- **`SETTINGS` タブの将来バージョン実装予定（COMING SOON）への表示刷新 & `SONG SETUP` への誘導設置 ([`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **設定混同・誤解防止のUI改善**:
    - `SETTINGS` タブにダミー値が並ぶことによるユーザーの混乱（「ここで変更できるのか？曲設定とどう違うのか？」）を防止するため、タブ全体を「将来バージョンで実装予定（FUTURE FEATURE）」の案内パネルへ刷新。
  - **アンダーコンストラクション案内カード**:
    - 「アプリ環境設定は将来バージョンで実装予定です」のメッセージを表示。
    - 「楽曲に関する設定（#TITLE, #OPM, #OCTAVE 等）をお探しですか？」という誘導バナーおよび、ワンクリックで第5タブへ遷移する「`SONG SETUP を開く ➔`」ボタンを設置。
  - **ロードマップ表示 (PLANNED PREFERENCE MODULES)**:
    - 将来的に実装を計画しているIDE共通設定（`KEYBINDINGS & SHORTCUTS`, `THEMES & SYNTAX COLORS`, `AUDIO & MIDI HARDWARE ROUTING`）を控えめな `COMING SOON` スタイルで提示。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザにて `SETTINGS` タブを表示し、将来実装予定の案内および「`SONG SETUP を開く ➔`」クリックで `SONG SETUP` タブに即座に遷移することを確認。

- **楽曲専用設定パネル `SONG SETUP` の新設 & MMLディレクティブ双方向同期 & `SETTINGS` の環境設定分離 ([`src/components/SongSetupPanel.tsx`](./src/components/SongSetupPanel.tsx), [`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/App.tsx`](./src/App.tsx), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **`SONG SETUP` タブの新設 (RightTab 第5タブ)**:
    - 楽曲（MML）に紐づくヘッダー情報・コンパイルディレクティブを設定する専用パネル [`SongSetupPanel.tsx`](./src/components/SongSetupPanel.tsx) を新規作成。
    - **Bento Card 1: 楽曲メタデータ (`#TITLE` / `#COMPOSER`)**: タイトルや作曲者名を入力・編集し、MMLヘッダーと即座に同期。
    - **Bento Card 2: 楽曲別音源構成 (`#OPM ON / OFF`)**: この楽曲で拡張FM音源ボード（ACZ-8BS1MZ 8ch）を使用するかを自照式トグルスイッチで設定。ONにすると MML に `#OPM ON`、OFFで `#OPM OFF` が自動反映。トラックモニターや TONE タブの有効/無効とも完全連動。
    - **Bento Card 3: MML記法・方言ディレクティブ (`#OCTAVE`)**: オクターブ記号（`<` `>`）の動作規則を「NORMAL（デフォルト: `<` 下げる, `>` 上げる）」または「REVERSE（逆向き: `<` 上げる, `>` 下げる）」から選択し、MMLヘッダーの `#OCTAVE NORMAL / REVERSE` と双方向連動。
    - **Bento Card 4: リアルタイム同期プレビュー**: 現在設定されている全ディレクティブをコードカードでライブ表示。
  - **MMLエディタとGUIパネルのリアルタイム双方向完全同期 (Single Source of Truth)**:
    - パネル側でタイトル変更、トグル切替、オクターブ選択を行った際は即座にアクティブMMLファイル内の `#` ディレクティブ行へ反映（未記述の場合はヘッダー部に自動挿入）。
    - 逆にユーザーが MML エディタ上で直接 `#TITLE`、`#COMPOSER`、`#OPM`、`#OCTAVE` をタイピング編集した場合も、SONG SETUP パネル側の各フィールド・スイッチ状態が自動追従。
  - **`SETTINGS` タブの役割整理・リファクタリング**:
    - 楽曲依存の設定を `SONG SETUP` へ移管したことで、`SETTINGS` タブ（第6タブ）は純粋な「アプリケーション自体の環境設定（エディタフォントサイズ、オーディオプレビューエンジン、ターゲットマシン仕様）」として役割を明確化。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザにて `SONG SETUP` タブを開き、タイトル変更・#OPMトグル・#OCTAVE切り替えを行い、左側 MML エディタのテキストがリアルタイムに更新されることを確認。また `SETTINGS` パネルへの切り替えも正常動作を確認。

- **FM音源 `#OPM ON/OFF` ディレクティブの連動 & TONEエディタのホイール誤動作防止 ([`src/App.tsx`](./src/App.tsx), [`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx), [`docs/specification/mml_reference.md`](./docs/specification/mml_reference.md), [`docs/specification/ui.md`](./docs/specification/ui.md))**:
  - **TONEエディタのスピン入力ホイール誤操作防止**:
    - エディタ全体をマウスホイールでスクロールする際、カーソルが数値ボックス（`AR` や `D1R` 等）の上を通るとスクロールが阻害されて値が勝手に増減してしまう不具合を解消。`SpinInput` から `onWheel` リスナーを削除し、スムーズな画面スクロールと上下ボタン/直接入力による確実な編集操作を両立。
  - **FM音源オプションのデフォルトOFF化**:
    - MZ-1500 実機標準構成（DCSG & BEEP 9ch）に合わせて、拡張ボード ACZ-8BS1MZ（YM2151）の初期ステートを `OFF`（無効）に設定。
  - **SETTINGS スイッチと MML `#OPM ON / OFF` ディレクティブの完全双方向連動**:
    - SETTINGS パネルでスイッチを `ON` にすると、MMLエディタ内のアクティブファイルに `#OPM ON` が自動追記（既存ディレクティブ行があれば置換）。
    - スイッチを `OFF` にすると、MML内のディレクティブが `#OPM OFF` に自動更新。
    - 逆にユーザーが MML エディタ上で直接 `#OPM ON` / `#OPM OFF`（または `#FM ON` / `#FM OFF`）を記述・編集した場合も、SETTINGS のスイッチ状態がリアルタイムに自動追従。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。
    - ブラウザ実機にて、SETTINGS パネルでのスイッチ切り替えに応じて `main.mml` 内の `#OPM ON` ➜ `#OPM OFF` が自動反映されること、および TONE エディタの AR 入力欄上でホイールしても値が勝手に変化しないことを完全確認。

- **MML言語仕様書 (`docs/specification/mml_reference.md`) の策定 & ピッチエンベロープ `@PE` 記法統一 ([`docs/specification/mml_reference.md`](./docs/specification/mml_reference.md), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx))**:
  - **MML言語仕様の体系化 & ジャンル別リファレンス**:
    - 全コマンドを「基本・音符・休符」「オクターブ・移調」「テンポ・演奏速度」「音量・ボリュームエンベロープ」「ピッチ・効果音」「音色・ノイズ・FM制御」「フロー制御・ループ」の7ジャンルに整理。
    - 全コマンドに**英語名（由来・覚え方）**を併記（例: `q`: Quantize, `@q`: Quick Cut, `@WN`: Waveform Noise, `@IN`: Interlock Noise, `@PE`: Pitch Envelope, `K`: Key Transpose 等）。
  - **音源チップ別対応機能マトリクス (Chip Capability Matrix)**:
    - YM2151 (FM 8ch), DCSG 矩形波 (P1〜P6), DCSG ノイズ (N1, N2), BEEP (B1) ごとの対応コマンド・制約を網羅。
    - BEEP の音量指定不可（1bitパルスのみ）、DCSGノイズの周期/ホワイト切替（`@WN`）、矩形波連動（`@IN`）等を明確化。
  - **方言切り替えディレクティブ (`#OCTAVE NORMAL / REVERSE`)**:
    - オクターブ記号（`<` `>`）の増減方向切り替えディレクティブを定義。
  - **エンベロープ・音色マクロ記法の統一**:
    - ピッチエンベロープ: **`@PE`**（定義: `@PE1 = { ... }`, 適用: `@PE1`, 解除: `@PE` または `@PE0`）。`PitchEnvelopeEditor.tsx` のMML出力・IDセレクタも `@PE` に完全連動。
    - 音量エンベロープ: **`@v` / `@VE`**（両対応）。
    - FM音色マクロ: **`@` / `@FM`**（両対応）。
  - **ビルド通過**: `npm run build` エラーゼロ通過。

- **VOL ENV ホバー＆マウスホイール時のバー上部数値バッジ表示不具合の修正 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**:
  - **バー頭上バッジの表示対象の修正**:
    - バー上部に表示されるピルバッジがマウスカーソルのY軸位置（`hoveredPos.vol`）を参照していたため、バー本体の音量値と乖離していた不具合を修正。該当ステップの現在の音量値（`vol`）をダイレクトに表示するよう変更。
    - マウスホイールによる値の増減時、ドラッグ描画時、ホバー時のいずれにおいても、バーの高さ（現在の音量値）とバー上部バッジの数値が完全に同期。
  - **ゴーストプレビューバーの整理**:
    - ホイール操作中やホバー中にカーソル位置に重なって表示されていた半透明のゴーストプレビュー矩形を削除し、実際の音量バーと数値バッジのみがすっきりと美しく連動するプロDAW表示へ最適化。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にてバー上でマウスホイールを上下操作し、頭上の数値バッジが 15 ➜ 14 ➜ 13 と正確に同期して変化することを確認。

- **VOL ENV & PITCH ENV のバー上マウスホイールによる1ステップ単位の数値変更操作の実装 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx))**:
  - **バー上でのマウスホイール上下連動**:
    - VOL ENV および PITCH ENV のバーグラフ領域にマウスカーソルを合わせた状態でマウスホイールをスクロールした際、**カーソル位置のステップの値が 1 ずつ上下にダイレクトに変化**する直感操作を実装。
    - ホイール上（`deltaY < 0`）: +1 増加（VOL: 最大15、PITCH: 最大+RANGE でクランプ）。
    - ホイール下（`deltaY > 0`）: -1 減少（VOL: 最小0、PITCH: 最小-RANGE でクランプ）。
    - ホバー情報（`hoveredPos`）およびツールチップ、下部MMLテキスト出力もリアルタイムに完全同期。
  - **Ctrl+ホイール（タイムラインズーム）との安全な共存**:
    - `Ctrl` キー押下中はタイムライン拡縮ズーム（60%〜350%）、通常ホイール時はバーの数値増減として明確に分離・共存。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にて VOL ENV の音量バーおよび PITCH ENV のビブラート波形バー上でマウスホイールを上下し、対象ステップの数値が +1 / -1 ずつ正確に増減することを確認。

- **VOL ENV & PITCH ENV の値シフト機能（上下左右 SHIFT: [←][→][↑][↓]）の実装 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx), [`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx))**:
  - **タイムライン左右シフト (Frame Shift)**:
    - `右シフト [→]`: タイムラインを1フレーム右へシフト。一番左（Step 0）の値が複製されて先頭に挿入され、末尾の値は押し出される（長尺維持）。
    - `左シフト [←]`: タイムラインを1フレーム左へシフト。一番右の末尾の値が複製されて末尾に挿入され、先頭の値は押し出される（長尺維持）。
  - **値レベル上下シフト (Value Level Shift)**:
    - `上シフト [↑]`: 全ステップの値を +1 加算（VOL: 最大15クランプ、PITCH: 最大+RANGEクランプ）。
    - `下シフト [↓]`: 全ステップの値を -1 減算（VOL: 最小0クランプ、PITCH: 最小-RANGEクランプ）。
  - **洗練されたDAWツールUI**:
    - 各エディタのツールバーに `SHIFT:` ボタングループ（`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`）を配置。ワンクリックで直感的に波形位置や音量・ピッチの全体オフセットを調整可能。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にて VOL ENV および PITCH ENV の左右・上下シフトが正確に動作し、生成MMLとグラフがリアルタイムに更新されることを確認。

- **TONEエディタの複数選択時・直接数値入力（絶対値一括指定）と相対同期編集のハイブリッド実装 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **直接数値入力時の絶対値一括反映 (Absolute Mode)**:
    - 複数OPを選択中に、いずれかのOPの数値テキストボックスへ直接数値をタイピング入力した場合（またはセレクトボックスで選択した場合）、**入力した値そのものが選択中の全OPへ一括適用**されるよう実装。一括で同じ値（AR: 31等）に揃えたい操作にダイレクトに対応。
  - **上下ボタン・ホイール・グラフドラッグ時の相対差分反映 (Relative Mode)**:
    - スピンボタン（`▲` / `▼`）やマウスホイール、Canvasグラフのドラッグ、TLスライダー操作時は、**操作元OPの変化差分（delta）を各選択OPへ相対的に加算・反映**（min〜maxの許容範囲でクランプ）。
  - **UIガイドテキストの更新**:
    - コントロールバーの案内を「`※数値直接入力: その値に一括変化 / 上下ボタン・グラフドラッグ: 相対変化`」へ更新。
  - **ビルド & 実機ブラウザ自動テスト通過**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にて直接数値入力時の絶対値反映および上下ボタン時の相対変化を完全確認。

- **TONEエディタのOP選択解除の操作性改善 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **Shift/Ctrlキーなしでの選択解除に対応**:
    - 通常クリック時、すでに選択されているOPカード（`[SELECTED]` ボタンまたは余白）をクリックした場合に選択が解除（トグルオフ）されるよう修正。
    - 未選択OPをクリックした際は従来通りそのOPのみを選択。
    - ガイドテキストおよびツールチップを「クリック: 選択/解除 / Shift・Ctrl + クリック: 複数選択」へ更新。

- **PITCH ENV（ピッチエンベロープエディタ）の新規実装 ([`src/components/PitchEnvelopeEditor.tsx`](./src/components/PitchEnvelopeEditor.tsx), [`src/App.tsx`](./src/App.tsx))**:
  - **Bento Grid & Linear Style DAW UIの適用**:
    - `VolEnvelopeEditor` の洗練された操作体系・設計を踏襲しつつ、ピッチ変調に特化したUIを完全新規構築。
  - **センターゼロ基準の双極性バーグラフ (Bipolar Bar Graph)**:
    - 中央「0」に破線基準ラインを配置。プラス方向のピッチ変化（音高上昇）はQDシアン（`cyan-400`）、マイナス方向のピッチ変化（音高下降）はアンバー（`amber-400`）で上下に伸びる双極バーを描画。
  - **用途に応じたダイナミックレンジ切替 (RANGE)**:
    - `±7` (微小デチューン・浅いビブラート)
    - `±15` (標準ビブラート・効果音)
    - `±24` (2オクターブ・ポルタメント)
    - `±48` (ワイドピッチベンド・急降下/急上昇)
    - レンジ切替時も既存データを自動クランプしてシームレスに編集可能。
  - **ビブラート特化プリセット & 編集ツール (TOOLS)**:
    - プリセット: `VIBRATO (MILD)`, `VIBRATO (DEEP)`, `DELAYED VIB`, `PITCH DROP`, `PITCH UP`, `FAST TRILL` を搭載。
    - ツール: `GEN VIB ~` (正弦波ビブラート自動生成)、`INVERT ⇅` (正負反転)、`FLIP ⇄` (左右反転)、`SMOOTH` (スムージング)、`CENTER 0` (0リセット)。
  - **プロDAW操作性**:
    - スペースキードラッグスクロール（パン）、Ctrl+ホイールズーム、線形補間（Interpolation）ドラッグ描画。
    - ループ（`|L`）/ リリース（`|R`）直接指定マーカーレーンおよび上部リージョンブラケット。
  - **Web Audio リアルタイム試聴 (TEST TONE)**:
    - 1フレーム（1/60秒）単位で発音ピッチをリアルタイム変調（デチューンセント）し、ビブラートやピッチベンドの効果を直接耳で確認可能。
  - **MMLテキストリアルタイム出力 & コピー**:
    - `@p1 = { |L, 0, 3, 6, 8, ... }` 形式でリアルタイム生成・クリップボードコピー。
  - **ビルド・実機表示・Web Audio・スクリーンショット検証完了**:
    - `npm run build` エラーゼロ通過。ブラウザ実機にてOP選択解除、PITCH ENVの全ツール・レンジ切替・ビブラート波形描画・試聴トランスポートの完全動作を確認。

- **全画面アイコンの幾何学的フラットデザイン（Lucide Icons）への完全統一**:
  - **インラインSVGおよび文字・絵文字アイコンの全廃**:
    - 全画面（ヘッダー、エクスプローラー、MMLエディタ、システムコンソール、トラックモニター、FMトーンエディタ、ボリュームエンベロープエディタ、設定パネル）のアイコンを `lucide-react` のソリッドカラー・幾何学的フラットアイコンへ統一。
  - **各領域での統一アイコン**:
    - **Header**: `Zap` (F1:BUILD), `Play` (PLAY), `Square` (STOP), `Download` (EXPORT), `PanelRightClose`/`PanelRightOpen` (HIDE/SHOW PANE)
    - **File Explorer**: `Folder`, `FolderOpen`, `FileCode`, `ChevronRight`/`ChevronDown`, `FilePlus` (+MML), `FolderPlus` (+Folder), `Pencil` (Rename), `Trash2` (Delete), `FolderOpen` (Open Folder)
    - **MML Editor & Console**: `PanelLeftClose`/`PanelLeftOpen` (Explorer Toggle), `FileCode` (Tab), `X` (Close), `Plus` (New Tab), `Terminal` (System Console)
    - **Right Pane Tabs**: `Sliders` (Track Monitor), `AudioWaveform` (YM2151 Tone), `TrendingUp` (Vol Env), `LineChart` (Pitch Env), `Settings` (Settings)
    - **Track Monitor**: `Volume2` / `VolumeX` (Preview Toggle)
    - **FM Tone Editor**: `AudioWaveform` (Header), `ChevronUp`/`ChevronDown` (SpinInput), `Play` (Test Note), `Square` (Stop), `Copy` (Copy OP / MML), `ClipboardPaste` (Paste OP)
    - **Vol Envelope Editor**: `Play` (Key On), `Square` (Key Off / Stop), `X` (Clear L/R), `TrendingUp` (Ramp Up), `TrendingDown` (Ramp Down), `FlipHorizontal` (Flip), `ArrowUpDown` (Invert), `Trash2` (Clear), `Copy` (Copy MML)
    - **Settings**: `Settings` (Header), `Cpu` (Hardware Options), `HardDrive` (Target Spec)
  - **ビルド & 実機動作検証完了**:
    - `npm run build` エラーゼロ通過。全画面（TRACK MONITOR, TONE, VOL ENV, SETTINGS）のスクリーンショットを撮影し、ソリッドかつ統一されたモダンDAWルックを確認。

- **SETTINGS（システム設定パネル）のプロDAWライク・デザイン刷新 ([`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx))**:
  - **シアン装飾の完全排除 & 静的テキストの落ち着いたグレー/白化**:
    - 見出しの歯車アイコン（`text-zinc-400`）および四角いドット装飾（`text-zinc-500`）からシアンを排除し、シルバー/グレーへ変更。
    - チャンネル一覧（`F1, F2...`）やターゲットフォーマット（`MZT`）のシアンテキストをライトグレー/白（`text-zinc-200` / `text-zinc-100`）へ統一。
  - **Bento Card 枠線の統一**:
    - YM2151カードのシアン枠線を廃止し、標準音源やビルド設定カードと同じ 1px のダークグレーボーダー（`border-[#3C3C3C]`、背景 `#2D2D2D`）へ完全統一。
  - **ミニマルなピルバッジ化**:
    - `INSTALLED`, `NOT INSTALLED`, `STANDARD`, `HARDWARE` バッジを、色付き枠線から落ち着いたグレー背景＋白文字のミニマルなピルバッジ（`rounded-full bg-[#3A3A3A] text-zinc-200` 等）へ変更。
  - **アクティブ要素（ONトグルスイッチ）のみクリアブルーで際立たせ**:
    - 「ON」状態のトグルスイッチのみ、鮮やかなクリアブルー（`#00A8FF`）とグローを採用し、操作可能・アクティブな要素としての視覚的ヒエラルキーを明確化。
  - **ビルド・実機表示・トグル動作の自動検証完了**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザで ON / OFF の各状態のスクリーンショットを撮影・表示確認済み。

- **VOL ENV（ボリュームエンベロープエディタ）のプロDAWライク・デザイン刷新 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**:
  - **Bento Grid & Linear Style の完全適用**:
    - 古いslate系カラーや粗いスリットパターン、過度なネオン装飾を全廃し、マットダークサーフェス（`#090a0f` / `#12131a`）と極細境界線（`border-white/[0.08]`）で整理された4つのBento Card構成へ再設計。
  - **DAW風ループ＆リリース・リージョン可視化 (Loop & Release Region Brackets)**:
    - `|L` から `|R` までのループ区間を薄いシアンの透過帯（`bg-cyan-500/[0.03]`）と上部 `LOOP` ブラケットで表示し、再生時にどこが循環するかが一目瞭然。
    - `|R` 以降のリリース区間を薄いレッドの透過帯（`bg-red-500/[0.03]`）と上部 `RELEASE` ブラケットで表示。
  - **プロDAW波形クイック編集ツール (TOOLS) の搭載**:
    - `RAMP ↗`（0→15 リニア上昇スロープ自動生成）
    - `RAMP ↘`（15→0 リニア下降スロープ自動生成）
    - `FLIP ⇄`（タイムライン左右反転）
    - `INVERT ⇅`（音量上下反転: `15 - vol`）
    - `CLEAR`（全ステップ消音クリア）
    - ボタン操作と同時に波形および生成MMLテキストが即座に同期更新。
  - **洗練されたプロDAWバーグラフ**:
    - スリット線を排し、エッジが上品に発色するモダン角丸バー（通常スレート、ループ区間シアン、リリース区間レッド、再生中シアン発光）。
  - **ビルド・実機表示・ツール動作の自動検証完了**:
    - `npm run build` エラーゼロ通過。
    - 実機ブラウザで初期画面、`RAMP ↗` 実行後、`FLIP ⇄` 実行後のスクリーンショットを撮影・検証済み。


- **ボリュームエンベロープエディタの当たり判定・ドラッグ描画の改善・バグ修正 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**:
  - **列ピッチ計算の厳密化によるステップずれ解消**:
    - 旧実装では各列の幅と間隔ギャップ（`stepWidth + 4px`）を考慮せずコンテナ幅の単純等分でステップを計算していたため、カーソル位置と実際の更新対象バーが 1〜数ステップずれていた不具合を根本解消。
  - **Y軸の均等16等分スロット化**:
    - 上下パディングを除いた高さを 0〜15（16段階）で完全等分割し、VOL 0 と VOL 15 も中央の値と同じ快適な高さで狙えるように改善。
  - **素早いドラッグ時の線形補間（Interpolation）**:
    - マウスを素早く滑らせて描画した際の中間ステップ抜け（虫食い）を防止し、前回の位置から今回の位置まで自動で線形補間して一筆書きで綺麗なカーブを描画可能に。
  - **Pointer Events & 遅延ゼロ化**:
    - `setPointerCapture` による枠外追従と、描画バーの不要なCSS遅延アニメーション（`transition-all duration-75`）を撤廃し、マウス操作に完全に同期したダイレクトなレスポンスを実現。
- **YM2151 トーンエディタのエンベロープグラフ・ドラッグ操作の改善・バグ修正 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **ドラッグ操作追従の根本修正（Pointer Events & 累積変位方式）**:
    - 旧実装では毎イベントごとに微小差分（`dx`）を計算していたため、古いクロージャ変数との比較で値が `+1 / -1` を往復してブルブル震えて実際の値が変化しない現象が発生していた問題を解消。
    - ドラッグ開始時の基準位置とパラメータ初期値を Ref で保持し、開始地点からの累積移動量から滑らかに絶対値を再計算する方式へ刷新。
    - `setPointerCapture` による Pointer Events（`onPointerDown` / `onPointerMove` / `onPointerUp`）を採用し、マウスがキャンバス枠外へ移動しても途切れることなくドラッグを継続可能。
    - キャンバス上の当たり判定を半径18pxへ微拡大し、ドラッグ中もノードの選択グロー・カーソル形状を安定維持。
- **システムコンソールの移設 ([`src/App.tsx`](./src/App.tsx))**:
  - 右ペイン下部から「MMLエディタ下部（中央ペイン）」へ移設。右ペインの作業スペースを最大化。
- **右ペイン開閉トグルボタン ([`src/App.tsx`](./src/App.tsx))**:
  - ヘッダー右上に `[HIDE PANE] / [SHOW PANE]` ボタンを設置。ワンクリックで右ペインを非表示にしてMMLエディタ＋コンソールを画面全体の100%全幅に展開可能。直前の比率でスムーズに復帰。
- **右ペインタブの直感的SVGアイコン追加 ([`src/App.tsx`](./src/App.tsx))**:
  - 各タブタイトルの左側に専用のSVGアイコンを配置（`📊 TRACK MONITOR`, `∿ YM2151 TONE`, `📈 VOL ENV`, `↗ PITCH ENV`, `⚙ SETTINGS`）。
- **YM2151 トーンエディタの操作性・UI改善 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**:
  - **数値入力エリアのサイズ拡大 & カスタム上下スピンボタン (`▲` `▼`) の実装**:
    - `MUL`, `DT1`, `DT2`: 高さを 28px（`h-7`）、フォントを `text-xs font-bold`（太字）に拡大し、ドロップダウンがクリックしやすく現在の値が一目でわかるように改善。
    - `AR`, `D1R`, `D1L`, `D2R`, `RR`: ブラウザ標準の極小矢印を廃止し、幅20pxの押しやすい独立上下ボタン（`SpinInput` コンポーネント）を搭載。マウスでのクリック連打が快適に行え、さらに**マウスホイール上下スクロールでの増減**にも対応。
    - `TL` (Total Level): スライダーの高さを 1.5 に微拡大し、操作しやすく調整。
  - **接続ルート表示 (`SIGNAL ROUTE`) の静的インフォメーション化**:
    - ボタンのように見えて誤操作を誘発しないよう、独立した囲み枠やボタン風バッジを撤去し、落ち着いたフラットなテキストインフォメーション表示に変更。
  - **OPセクション間の重なり矢印オーバーレイの削除**:
    - 画面の煩雑さを解消するため、2×2パネル間の重なり配線矢印オーバーレイを撤去し、クリーンなUIに刷新。
  - **エンベロープグラフのグラデーション廃止 & QDブルー統一**:
    - 余計な塗りを排し、スライダー等と統一感のあるソリッドなQDブルー（`#06b6d4`）の折れ線のみを描画。
  - **ドラッグノード（〇）のサイズ拡大 & QDブルー＋白枠**:
    - 直径11px〜13px（`r=5.5〜6.5`）に拡大し、QDブルー塗りつぶし＋純白の輪郭線でダーク背景でも視認性を大幅向上。
  - **ピクセルベースの当たり判定改善**:
    - アスペクト比に依存しないピクセル距離（半径16px）を導入し、「掴みにくい・反応が悪い」問題を根本解決。
  - **操作方向に応じた動的マウスカーソル表現**:
    - `AR`（アタックレート）: 左右時間のみ変更可能 ➜ `ew-resize`（`↔`）
    - `D1`（ディケイ1変曲点）: 左右時間＋上下サステインレベル変更可能 ➜ `move`（全方位十字）
    - `D2`（ディケイ2終了点）: 上下減衰深度のみ変更可能 ➜ `ns-resize`（`↕`）
    - `RR`（リリースレート）: 左右時間のみ変更可能 ➜ `ew-resize`（`↔`）

---

## 4. これまでに完了した機能一覧 (モック期詳細)
1. **プロジェクト初期化 & 技術スタック選定**
   - Vite + React (TypeScript) + Tailwind CSS + Monaco Editor
   - Webネイティブ技術完結（C#/.NET WASM不使用）
   - MZ-1500実機リスペクト（チャコールブラック、QDブルー、MZレッド、QD方眼グリッド）
2. **基本レイアウト & ペインスプリッター**
   - ヘッダー（QD方眼グリッド、MZ自照式ロゴ、F1:BUILD、PLAY、STOP、EXPORT、右ペイン開閉トグル）
   - 左ペイン（中央ペイン）: MMLエディタ ＋ システムコンソール
   - スプリッターバー（可変幅 20%〜80%、ダブルクリックで50:50リセット、ドラッグ全画面オーバーレイ）
   - 右ペイン（タブ切り替え式）
3. **MMLエディタ & ファイルエクスプローラー ([`src/components/MmlEditor.tsx`](./src/components/MmlEditor.tsx), [`src/components/FileExplorer.tsx`](./src/components/FileExplorer.tsx))**
   - Monaco Editor 組み込み（カスタムダークテーマ、行ハイライト、ズーム対応）
   - 複数タブ管理（開く、閉じる、新規作成、切り替え）
   - エクスプローラー開閉トグル（`📁◀` / `📁▶`）
   - サンプルMML（デモ・テンプレート）、ローカルフォルダファイル操作（新規作成、リネーム、削除）
   - エクスプローラースプリッター（140px〜460pxリサイズ、ダブルクリックで240px復帰）
4. **トラックモニター ([`src/components/TrackMonitor.tsx`](./src/components/TrackMonitor.tsx))**
   - 全17ch構成（DCSG×2 8ch + BEEP 1ch [左カラム] / 拡張FM ACZ-8BS1MZ 8ch [右カラム]）
   - 自照式スピーカーボタン（各ch発音/消音プレビュートグル）
   - 音源系統別 `ALL ON` / `MUTE` 一括ボタン
   - シックなスレートグレーバッジによる統一デザイン
5. **システム設定パネル ([`src/components/SettingsPanel.tsx`](./src/components/SettingsPanel.tsx))**
   - 拡張FM音源ボード「ACZ-8BS1MZ (YM2151 / OPM)」（開発: ぽよこまだんな 氏 / [@poyokoma_danna](https://x.com/poyokoma_danna)）オプション切替トグル
   - ボード搭載（ON）/非搭載（OFF）の画面連動（OFF時は実機標準の9ch表示・FMタブ無効化案内）
6. **ボリュームエンベロープエディタ ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**
   - DCSG向けの1フレーム（1/60秒）単位の音量シーケンスエディタGUI（音量0〜15）
   - 可変長ステップ（デフォルト32F / 2〜128F可変、長尺時自動スクロール）
   - マーカーレーンによるループポイント (`|L`) / リリースポイント (`|R`) の直接ワンクリック指定
   - タイムライン縦横同時ズーム（Ctrl+ホイール / ツールバー操作で60%〜350%拡大縮小）
   - スペースキードラッグスクロール（ハンドツール / パン）
   - Web Audio プレビュー試聴（`▶ KEY ON` ループ再生 / `■ KEY OFF` リリース減衰）
   - MMLテキストリアルタイム生成＆ワンクリックコピー
7. **YM2151 (OPM) FM 音色エディタ ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**
   - ヤマハ公式・OPM仕様準拠のALG 0〜7接続ブロック図（白塗りキャリア、OP1自己フィードバック線）
   - 全8アルゴリズムの横1列レスポンシブ収まり
   - 4-OP 2×2固定グリッド配置
   - シグナルルート表示（`SIGNAL ROUTE`）
   - 各OPのI/Oストリップ（`IN:` / `OUT:`）
   - 自照式 Mute (`M`) / Solo (`S`) トグル、パラメータ一括 Copy / Paste
   - 出力＆ピッチパラメータ（TLスライダー、MUL/DT1/DT2セレクトボックス拡大）
   - インタラクティブCanvasエンベロープ（ソリッドQDブルー線、拡大ノード、ピクセル当たり判定、操作方向別カーソル）
   - 押しやすいカスタム上下ボタン付きスピン入力（`SpinInput`、ホイール対応）
   - Web Audio 4-Op FM 合成プレビュー試聴（`▶ TEST NOTE`）
   - 音色プリセット（`E.PIANO 1`, `SLAP BASS`, `BRASS ENSEMBLE`, `CRYSTAL BELL`）
   - MML音色定義リアルタイム出力＆コピー
8. **ボリュームエンベロープエディタ リリース区間配色の最適化 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**
   - 眩しく刺激が強かった蛍光レッド（`red-500` 系）を撤廃。
   - プロDAW（Serum, Vital等）のモダン配色セオリーに基づき、目に優しく温かみのある**アンバー（琥珀色・ウォームオレンジ/ゴールド系: `amber-500` / `amber-600` / `amber-700`）**に全面トーンダウン。
   - 上部ブラケット、Rマーカーボタン、タイムライン背景透過帯、ステップバー、音量フレーム数値ラベルまで統一調整し、QDシアン（ループ区間）との美しいコントラストと長時間の作業視認性を両立。
9. **ボリュームエンベロープエディタ 水平スクロールパン（ドラッグ操作）の刷新 ([`src/components/VolEnvelopeEditor.tsx`](./src/components/VolEnvelopeEditor.tsx))**
   - 画面外への沈み込みや迷子を完全防止するため、DAW標準の**水平スクロール（`scrollLeft`）方式**に全面刷新。
   - 上下方向（Y軸）のブレや沈み込みを完全に排除し、常にコンテナ上端に整然と配置（`overflow-y-hidden`）。
   - スペースキー＋ドラッグでスムーズに左右にスクロール可能とし、スクロールバーによる可視化と境界制御により画面外へ消える問題を根本解決。
   - ズームパーセンテージボタン（`350%` 等）や `SPACE: PAN` ボタンのクリック、またはダブルクリックで瞬時に `100%` & スクロール先頭（`0`）へ完全復帰。
10. **YM2151 FM 音色エディタ マルチOP複数選択＆一括連動編集 ([`src/components/FmToneEditor.tsx`](./src/components/FmToneEditor.tsx))**
    - 各OPカードの空き領域（背景・余白）や `[SELECT]` ボタンをクリックして複数オペレータを直感的に選択可能。
    - 選択中カードをシアン枠＋ネオングロー（`border-cyan-400 ring-1 ring-cyan-400/50`）と `[SELECTED]` バッジで強調。
    - 2×2グリッド上部に `MULTI-OP EDIT` バーを配置し、連動状況インジケータ（`x OPs SELECTED (LINKED)`）および `SELECT ALL` / `CLEAR` 一括ボタンを搭載。
    - 複数選択中にいずれかのOPの数値（スピンボタン、スライダー、セレクトボックス）やエンベロープCanvasノードを変更すると、**変更された該当パラメータのみが選択中の全OPへスマートに同期反映**され、各OP固有のTL等は安全に保持。
11. **UIレイアウト改善 & システムコンソール移設 ([`src/App.tsx`](./src/App.tsx))**
    - システムコンソールの中央ペイン下部移設
    - 右ペイン開閉ボタン（`[HIDE PANE] / [SHOW PANE]`）
    - 右ペインタブアイコン追加
12. **ドキュメント整備**
    - UI仕様書 [`docs/specification/ui.md`](./docs/specification/ui.md) 作成・継続更新
    - ルール定義 [`GEMINI.md`](./GEMINI.md), [`AGENTS.md`](./AGENTS.md) 作成
    - 進捗管理 [`PROGRESS.md`](./PROGRESS.md) 作成・継続更新

---

## 5. その他の ToDo (UI・環境まわり)
- [x] **システムコンソールのMMLエディタ下部移設 & 右ペイン開閉ボタン** (完了)
- [x] **右ペインタブの直感的アイコン追加** (完了)
- [x] **YM2151 音色エディタのエンベロープグラフ改善** (完了: グラデーション廃止、QDブルー統一、ノード拡大、判定改善、カーソル対応、OP間配線矢印削除)
- [x] **接続ルート表示 (`SIGNAL ROUTE`) の静的インフォメーション化** (完了: 誤操作防止のフラットテキスト表示)
- [x] **数値入力エリアのサイズ拡大 & カスタム上下スピンボタン (`▲` `▼`) の実装** (完了: MUL/DT1/DT2拡大、AR〜RRの独立上下ボタン・ホイール対応)
- [x] **ピッチエンベロープエディタ (`PITCH ENV`) のUI実装** (完了: 双極性バーグラフ、ダイナミックレンジ±7〜±48切替、ビブラートプリセット＆生成ツール、Web Audio試聴、MML出力)
- [x] **システムコンソールの機能拡張** (完了 2026-09-06)
  - ログ出力 (末尾自動追従・コピー・空状態表示)、MMLビルドエラーの詳細表示 (行:桁・メッセージ、上限 20 件)、折りたたみトグル新設 (高さリサイズは既存スプリッターで対応済み)。→ §1 参照
- [x] **GitHub Actions による自動デプロイの導入** (完了 2026-09-06)
  - `.github/workflows/deploy.yml` 新設 (main push 時に lint + build → actions/deploy-pages)。CI で `npm test` を実行しない理由は [`docs/specification/ci_deploy.md`](./specification/ci_deploy.md) 参照。
  - **残作業 (ユーザー操作)**: リポジトリ Settings → Pages の Source を `GitHub Actions` へ切替。
- [x] **`<title>` タグの更新** (完了 2026-09-06)
  - `temp_vite` → `MZ-1500 Sound IDE` に変更 (`lang="ja"` へ統一)。
- [ ] **MCP chrome-devtools-mcp の初回動作確認**
  - 設定済み・未検証 ([`docs/specification/mcp-browser-debug.md`](./specification/mcp-browser-debug.md))。次回ブラウザデバッグが必要になった際、`npm run dev` → `http://localhost:5173/mz1500_sound_ide/` を Chrome で起動 → コンソールログ / スクリーンショット取得の一連の流れを確認する。
