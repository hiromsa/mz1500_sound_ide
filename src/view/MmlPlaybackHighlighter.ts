/**
 * Monaco Editor 上に演奏中の MML ハイライト・トラッキングを描画するクラス。
 * ロジック (mmlPlaybackTracker) の解決結果を受け取り、
 * - 現在到達している音符 / 休符トークンに emerald の下線
 * - その行全体に薄い emerald 背景 (isWholeLine)
 * をデコレーションとして適用する。Monaco 依存はこのクラスに閉じる。
 */
import type { editor } from 'monaco-editor';
import type { MmlPlaybackPosition } from '../utils/mmlPlaybackTracker';

/** 音符トークンのインライン装飾クラス。 */
const noteTokenClass = 'mml-playback-token-note';

/** 休符トークンのインライン装飾クラス。 */
const restTokenClass = 'mml-playback-token-rest';

/** 現在演奏行の背景装飾クラス。 */
const playbackLineClass = 'mml-playback-line';

/** overviewRuler の表示位置 (monaco OverviewRulerLane.Right 相当)。 */
const OverviewRulerLaneRight = 4;

/** 概要ルーラーの emerald 色。 */
const rulerColor = 'rgba(16, 185, 129, 0.7)';

export class MmlPlaybackHighlighter {
  private readonly editor: editor.IStandaloneCodeEditor;

  private collection: editor.IEditorDecorationsCollection | null = null;

  /** 前回適用時の位置シグネチャ (同一なら DOM 更新をスキップしてアニメーション等を維持)。 */
  private lastSignature = '';

  constructor(editor: editor.IStandaloneCodeEditor) {
    this.editor = editor;
  }

  /** 演奏位置リストをデコレーションへ反映する (変化がない場合は何もしない)。 */
  update(positions: readonly MmlPlaybackPosition[]): void {
    const model = this.editor.getModel();
    if (model === null) {
      return;
    }

    const signature = positions
      .map((p) => `${p.trackIndex}:${p.kind}:${p.line}:${p.column}:${p.length}`)
      .join('|');
    if (signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;

    const lineCount = model.getLineCount();
    const linesWithBackground = new Set<number>();
    const decorations: editor.IModelDeltaDecoration[] = [];

    for (const position of positions) {
      // 古いマップ基準の行がモデル範囲外にならないよう防御
      if (position.line < 1 || position.line > lineCount) {
        continue;
      }

      // 音符 / 休符トークンの下線 (連符由来 column=0 は列が不定のため行のみ)
      if (position.column >= 1) {
        const startColumn = position.column;
        const tokenEnd = startColumn + Math.max(position.length, 1);
        const endColumn = Math.min(tokenEnd, model.getLineMaxColumn(position.line));
        decorations.push({
          range: {
            startLineNumber: position.line,
            startColumn,
            endLineNumber: position.line,
            endColumn,
          },
          options: {
            inlineClassName: position.kind === 'rest' ? restTokenClass : noteTokenClass,
            overviewRuler: { color: rulerColor, position: OverviewRulerLaneRight },
          },
        });
      }

      // 現在演奏行の背景 (同一行に複数トラックが居る場合は 1 つのみ)
      if (!linesWithBackground.has(position.line)) {
        linesWithBackground.add(position.line);
        decorations.push({
          range: {
            startLineNumber: position.line,
            startColumn: 1,
            endLineNumber: position.line,
            endColumn: model.getLineMaxColumn(position.line),
          },
          options: {
            isWholeLine: true,
            className: playbackLineClass,
            overviewRuler: { color: rulerColor, position: OverviewRulerLaneRight },
          },
        });
      }
    }

    if (this.collection === null) {
      this.collection = this.editor.createDecorationsCollection(decorations);
    } else {
      this.collection.set(decorations);
    }
  }

  /** ハイライトを消す (演奏停止 / ソース不一致時)。 */
  clear(): void {
    this.lastSignature = '';
    this.collection?.clear();
  }

  dispose(): void {
    this.clear();
    this.collection = null;
  }
}
