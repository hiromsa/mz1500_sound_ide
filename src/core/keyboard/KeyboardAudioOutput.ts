/**
 * 仮想キーボード / エディタ試聴用の低レイテンシ Web Audio 出力アダプタ。
 * 演奏プレビュー用 AudioEngine (20ms pump / 目標 4096 frames ≒ 85ms) と異なり、
 * 10ms pump + 中小バッファ (目標 2048 frames ≒ 43ms) で常時駆動し、
 * 打鍵応答とアンダーラン (プチノイズ) 耐性のバランスを取る。
 * AudioWorklet には演奏と同じ FramePlaybackWorkletSource (Blob URL) を流用する。
 */
import { FramePlaybackWorkletSource } from '../player/FramePlaybackWorklet';

const WorkletProcessorName = 'mzsd-frame-playback';

/** pump の呼び出し間隔 (ms)。 */
const PumpIntervalMs = 10;

/** 1 回の pump で合成するフレーム数 (≒ 10ms 分 @48kHz)。 */
const PumpChunkFrames = 512;

/**
 * AudioWorklet 側に保持する目標バッファ量 (フレーム数、≒ 43ms)。
 * 小さすぎるとメインスレッドの一時的な遅延 (UI 描画 / GC 等) でワークレット側が
 * 供給枯渇 (アンダーラン) し、無音への急落と再開の不連続 = プチノイズとして聞こえる。
 * worklet からの残量報告には ≒ 5ms の遅延 + 1 チャンク分の補充粒度があるため、
 * 実効在庫下限は目標値から (pump 間隔 + 報告遅延 + チャンク) 分を差し引いた量になる。
 */
const TargetBufferedFrames = 2048;

/** ScriptProcessor フォールバックのバッファサイズ (フレーム数)。 */
const ScriptProcessorBufferSize = 512;

/** 合成済み標本の供給源 (KeyboardSoundEngine)。 */
export interface KeyboardAudioSource {
  read(buffer: Float32Array): void;
}

/** AudioWorklet からのバッファ残量報告。 */
interface WorkletLevelMessage {
  readonly type: string;

  readonly availableSamples: number;
}

type AudioContextConstructor = new (options?: { sampleRate?: number }) => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;

    webkitAudioContext?: AudioContextConstructor;
  };

  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class KeyboardAudioOutput {
  private readonly source: KeyboardAudioSource;

  private readonly sampleRate: number;

  private audioContext: AudioContext | null = null;

  private workletNode: AudioWorkletNode | null = null;

  private scriptNode: ScriptProcessorNode | null = null;

  private pumpTimer: ReturnType<typeof setInterval> | null = null;

  private bufferedFrames = 0;

  private startPromise: Promise<void> | null = null;

  constructor(source: KeyboardAudioSource, sampleRate: number) {
    this.source = source;
    this.sampleRate = sampleRate;
  }

  /**
   * 出力を起動する (初回のみ AudioContext / worklet を生成し、以降は常時駆動)。
   * 発音のユーザー操作内で呼ばれるため AudioContext の resume も確実に効く。
   */
  ensureStarted(): Promise<void> {
    this.startPromise ??= this.start();
    return this.startPromise;
  }

  /** AudioWorklet 非対応環境で ScriptProcessor フォールバックに落ちたか (デバッグ用)。 */
  get usesScriptProcessorFallback(): boolean {
    return this.scriptNode !== null;
  }

  private async start(): Promise<void> {
    const AudioContextCtor = getAudioContextConstructor();
    if (AudioContextCtor === null) {
      return; // Web Audio 非対応環境では黙って無音にフォールバック
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContextCtor({ sampleRate: this.sampleRate });
    } catch {
      ctx = new AudioContextCtor();
    }

    this.audioContext = ctx;

    // AudioWorklet を優先し、利用できない環境では ScriptProcessor へフォールバックする
    try {
      // worklet コードは単一ファイルである必要があるため Blob URL 経由でロードする
      const blob = new Blob([FramePlaybackWorkletSource], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }

      const node = new AudioWorkletNode(ctx, WorkletProcessorName, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.port.onmessage = (event) => this.onWorkletMessage(event.data as WorkletLevelMessage);
      node.connect(ctx.destination);
      this.workletNode = node;
    } catch {
      this.scriptNode = this.createScriptProcessor(ctx);
    }

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => { /* ignore */ });
    }

    this.startPump();
  }

  private createScriptProcessor(ctx: AudioContext): ScriptProcessorNode {
    // 非推奨 API だが AudioWorklet 非対応環境向けのフォールバック
    const node = ctx.createScriptProcessor(ScriptProcessorBufferSize, 0, 2);
    node.onaudioprocess = (event) => {
      const buffer = event.outputBuffer;
      const frames = buffer.length;
      const chunk = new Float32Array(frames * 2);
      this.source.read(chunk);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let i = 0; i < frames; i++) {
        left[i] = chunk[i * 2];
        right[i] = chunk[(i * 2) + 1];
      }
    };
    node.connect(ctx.destination);
    return node;
  }

  private startPump(): void {
    if (this.pumpTimer !== null || this.workletNode === null) {
      return;
    }

    this.pumpTimer = setInterval(() => this.pump(), PumpIntervalMs);
  }

  private pump(): void {
    const node = this.workletNode;
    if (node === null || this.audioContext === null || this.audioContext.state !== 'running') {
      return;
    }

    while (this.bufferedFrames < TargetBufferedFrames) {
      const chunk = new Float32Array(PumpChunkFrames * 2);
      this.source.read(chunk);
      node.port.postMessage(chunk, [chunk.buffer]);
      this.bufferedFrames += PumpChunkFrames;
    }
  }

  private onWorkletMessage(data: WorkletLevelMessage): void {
    if (data.type === 'level') {
      this.bufferedFrames = data.availableSamples / 2;
    }
  }
}
