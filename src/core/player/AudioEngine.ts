/**
 * Web Audio 出力 + 60Hz シーケンサ駆動を担うオーディオエンジン。
 * C# 版の NAudio (WaveOut + ISampleProvider) の代わりに AudioWorklet を使用し、
 * AudioWorklet 非対応環境では ScriptProcessor へフォールバックする。
 * 合成本体は Web Audio 非依存の AudioFrameMixer が担い、AudioWorklet には
 * メインスレッドで合成した標本をリングバッファ経由で供給する
 * (VU / 演奏位置はメインスレッドの mixer からそのまま参照できる)。
 * (移植元: MzSound.Player/Audio/AudioEngine.cs)
 */
import type { MzsdSong } from './MzsdSong';
import { AudioFrameMixer } from './AudioFrameMixer';
import { DefaultSampleRate } from './AudioFrameMixer';
import { FramePlaybackWorkletSource } from './FramePlaybackWorklet';
import { MzsdSequencer } from './MzsdSequencer';

/** 演奏エンジンの駆動方式。 */
export const AudioEngineMode = {
  /** C# リファレンス実装 (MzsdSequencer が MZSD データを直接解釈)。 */
  SourceInterpreter: 'source-interpreter',

  /** Z80 サウンドドライバ (内蔵 Z80 コア上でドライバを実行、Phase 4 で接続)。 */
  Z80Driver: 'z80-driver',
} as const;

export type AudioEngineMode = (typeof AudioEngineMode)[keyof typeof AudioEngineMode];

const WorkletProcessorName = 'mzsd-frame-playback';

/** pump の呼び出し間隔 (ms)。 */
const PumpIntervalMs = 20;

/** 1 回の pump で合成するフレーム数 (≒ 20ms 分)。 */
const PumpChunkFrames = 960;

/** AudioWorklet 側に保持する目標バッファ量 (フレーム数、≒ 85ms)。 */
const TargetBufferedFrames = 4096;

/** ScriptProcessor フォールバックのバッファサイズ (フレーム数)。 */
const ScriptProcessorBufferSize = 2048;

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

export class AudioEngine {
  /** チップ合成 + ミキシング (シーケンサ / UI から操作する)。 */
  readonly mixer: AudioFrameMixer;

  /** シーケンサが終端に達した (オーディオ駆動発火)。 */
  sequencerFinished: (() => void) | null = null;

  private sequencer: MzsdSequencer | null = null;

  private audioContext: AudioContext | null = null;

  private workletNode: AudioWorkletNode | null = null;

  private scriptNode: ScriptProcessorNode | null = null;

  private pumpTimer: ReturnType<typeof setInterval> | null = null;

  private bufferedFrames = 0;

  constructor(sampleRate: number = DefaultSampleRate) {
    this.mixer = new AudioFrameMixer(sampleRate);
  }

  /** 現在の駆動方式 (停止中は null)。 */
  get mode(): AudioEngineMode | null {
    return this.sequencer !== null ? AudioEngineMode.SourceInterpreter : null;
  }

  /** AudioContext と出力ノードを事前に準備する (ユーザ操作内で呼ぶと確実に resume できる)。 */
  async prepare(): Promise<void> {
    await this.ensureOutput();
    await this.resumeIfNeeded();
  }

  /** 演奏を開始する。 */
  async play(
    song: MzsdSong,
    loop: boolean,
    mode: AudioEngineMode = AudioEngineMode.SourceInterpreter,
  ): Promise<void> {
    this.stopInternal();
    await this.ensureOutput();

    this.mixer.resetLevels();
    switch (mode) {
      case AudioEngineMode.SourceInterpreter: {
        this.sequencer = new MzsdSequencer(song, this.mixer.chips, loop);
        this.mixer.attachSequencer(this.sequencer);
        break;
      }

      case AudioEngineMode.Z80Driver:
        // Phase 4: Z80DriverMachine (内蔵 Z80 コア) の実装後に接続する
        throw new Error('Z80Driver モードは未実装です (Phase 4 で移植予定)。');

      default:
        throw new Error(`未知の駆動方式: ${String(mode)}`);
    }

    this.bufferedFrames = 0;
    this.startPump();
  }

  stop(): void {
    this.stopInternal();
  }

  /** ユーザ操作コンテキストで AudioContext を resume する。 */
  async resumeIfNeeded(): Promise<void> {
    const ctx = this.audioContext;
    if (ctx !== null && ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  async dispose(): Promise<void> {
    this.stopInternal();
    this.workletNode?.disconnect();
    this.workletNode = null;
    if (this.scriptNode !== null) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }

    const ctx = this.audioContext;
    this.audioContext = null;
    if (ctx !== null && ctx.state !== 'closed') {
      await ctx.close();
    }
  }

  /** UI ミキサーのトラックゲイン (0-1) を設定する。 */
  setTrackGain(trackIndex: number, gain: number): void {
    this.mixer.setTrackGain(trackIndex, gain);
  }

  setMasterVolume(volume: number): void {
    this.mixer.setMasterVolume(volume);
  }

  /** トラックの VU レベル (0-1) を取得する。 */
  getTrackLevel(trackIndex: number): number {
    return this.mixer.getTrackLevel(trackIndex);
  }

  getMasterLevel(): number {
    return this.mixer.getMasterLevel();
  }

  /** 演奏中トラックの現在データオフセット (ハイライト用、停止中は -1)。 */
  getTrackOffset(trackIndex: number): number {
    if (this.sequencer !== null) {
      return this.sequencer.tracks[trackIndex].currentOffset;
    }

    return -1;
  }

  private stopInternal(): void {
    this.sequencer = null;
    this.mixer.attachSequencer(null);
    if (this.pumpTimer !== null) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }

    this.bufferedFrames = 0;
    this.workletNode?.port.postMessage({ type: 'clear' });
  }

  private async ensureOutput(): Promise<void> {
    if (this.audioContext !== null) {
      return;
    }

    const AudioContextCtor = getAudioContextConstructor();
    if (AudioContextCtor === null) {
      throw new Error('Web Audio API が利用できません。');
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContextCtor({ sampleRate: this.mixer.sampleRate });
    } catch {
      ctx = new AudioContextCtor();
    }

    this.audioContext = ctx;

    // AudioWorklet を優先し、利用できない環境では ScriptProcessor へフォールバックする
    try {
      await this.ensureWorkletModule(ctx);
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
  }

  private async ensureWorkletModule(ctx: AudioContext): Promise<void> {
    // worklet コードは単一ファイルである必要があるため Blob URL 経由でロードする
    // (Vite の base サブパスやバンドル設定に依存しない)
    const blob = new Blob([FramePlaybackWorkletSource], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private createScriptProcessor(ctx: AudioContext): ScriptProcessorNode {
    // 非推奨 API だが AudioWorklet 非対応環境向けのフォールバック
    // (C# 版の ISampleProvider.Read に近い同期駆動)
    const node = ctx.createScriptProcessor(ScriptProcessorBufferSize, 0, 2);
    node.onaudioprocess = (event) => this.onScriptProcess(event);
    node.connect(ctx.destination);
    return node;
  }

  private onScriptProcess(event: AudioProcessingEvent): void {
    const buffer = event.outputBuffer;
    const frames = buffer.length;
    const chunk = new Float32Array(frames * 2);
    this.mixer.read(chunk);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      left[i] = chunk[i * 2];
      right[i] = chunk[(i * 2) + 1];
    }
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
      this.mixer.read(chunk);
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
