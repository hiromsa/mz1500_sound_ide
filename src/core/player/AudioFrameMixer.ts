/**
 * チップ合成 + 60Hz シーケンサ駆動 + ミキシング。
 * 出力は 48kHz / 2ch / float。PSG1 → L、PSG2 → R、BEEP / FM → 中央。
 * C# 版では AudioEngine.MixerProvider が NAudio の ISampleProvider として担っていた部分を、
 * Web Audio に依存しない純粋ロジックとして切り出したもの (vitest で完全にテスト可能)。
 * (移植元: MzSound.Player/Audio/AudioEngine.cs — MixerProvider.Read / UpdateTrackLevels)
 */
import { ChipBank } from '../chips/ChipBank';
import type { MzsdSequencer } from './MzsdSequencer';
import { MzsdSong } from './MzsdSong';

/** 既定の出力サンプルレート (Hz)。C# 版の AudioEngine.SampleRate と同一。 */
export const DefaultSampleRate = 48000;

/** 1 フレーム (1/60 秒) あたりのサンプル数の基準値。 */
const FrameRate = 60;

export class AudioFrameMixer {
  /** 音源デバイス一式 (シーケンサ / UI から操作する)。 */
  readonly chips = new ChipBank();

  /** 出力サンプルレート (Hz)。 */
  readonly sampleRate: number;

  /** シーケンサが終端に達した (合成スレッド発火)。 */
  onSequencerFinished: (() => void) | null = null;

  private readonly samplesPerFrame: number;

  private sequencer: MzsdSequencer | null = null;

  private readonly trackGains = new Array<number>(MzsdSong.TrackCount).fill(0.8);

  private readonly trackLevels = new Array<number>(MzsdSong.TrackCount).fill(0);

  private masterVolume = 1.0;

  private masterLevel = 0;

  private frameAccumulator = 0;

  /** FM 合成用の int バッファ (ステレオインターリーブ)。 */
  private fmBuffer = new Int32Array(0);

  constructor(sampleRate: number = DefaultSampleRate) {
    this.sampleRate = sampleRate;
    this.samplesPerFrame = sampleRate / FrameRate;
    this.chips.fm.initialize(sampleRate);
  }

  /** 駆動するシーケンサを設定する (null = 停止中)。 */
  attachSequencer(sequencer: MzsdSequencer | null): void {
    this.sequencer = sequencer;
  }

  /** UI ミキサーのトラックゲイン (0-1) を設定する (チップ側のチャンネルゲインにも反映)。 */
  setTrackGain(trackIndex: number, gain: number): void {
    const clamped = Math.min(Math.max(gain, 0), 1);
    this.trackGains[trackIndex] = clamped;

    if (trackIndex <= 3) {
      this.chips.psg1.setChannelGain(trackIndex, clamped);
    } else if (trackIndex <= 7) {
      this.chips.psg2.setChannelGain(trackIndex - 4, clamped);
    } else if (trackIndex === 8) {
      this.chips.beep.setChannelGain(clamped);
    } else {
      this.chips.setFmGain(trackIndex - 9, clamped);
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(Math.max(volume, 0), 1);
  }

  /** トラックの VU レベル (0-1) を取得する。 */
  getTrackLevel(trackIndex: number): number {
    return this.trackLevels[trackIndex];
  }

  getMasterLevel(): number {
    return this.masterLevel;
  }

  resetLevels(): void {
    this.trackLevels.fill(0);
    this.masterLevel = 0;
  }

  /** buffer (ステレオインターリーブ float) へ frames サンプル分を合成する (C# Read 相当)。 */
  read(buffer: Float32Array): void {
    const frames = buffer.length >> 1;

    // YM2151 は int ステレオで出力するため、先にまとめて合成しておく
    if (this.fmBuffer.length < frames * 2) {
      this.fmBuffer = new Int32Array(frames * 2);
    }

    this.fmBuffer.fill(0, 0, frames * 2);
    this.chips.fm.mix(this.fmBuffer, frames);

    for (let i = 0; i < frames; i++) {
      if (this.sequencer !== null) {
        this.frameAccumulator += 1.0;
        if (this.frameAccumulator >= this.samplesPerFrame) {
          this.frameAccumulator -= this.samplesPerFrame;
          const sequencer = this.sequencer;
          sequencer.tick();
          if (sequencer.isFinished) {
            this.finishPlayback();
          }
        }
      }

      // PSG1 → L、PSG2 → R、BEEP / FM → 中央 (内蔵スピーカ = モノラルミックス相当)
      const left = this.chips.psg1.renderSample(this.sampleRate);
      const right = this.chips.psg2.renderSample(this.sampleRate);
      const fmLeft = this.fmBuffer[i * 2] / 32768.0 * 0.4;
      const fmRight = this.fmBuffer[(i * 2) + 1] / 32768.0 * 0.4;
      const mono = this.chips.beep.renderSample(this.sampleRate) * 0.5;

      const master = this.masterVolume;
      const leftOut = Math.min(Math.max((left * 0.8 + mono + fmLeft) * master, -1), 1);
      const rightOut = Math.min(Math.max((right * 0.8 + mono + fmRight) * master, -1), 1);

      this.masterLevel = Math.max(Math.abs(leftOut), Math.abs(rightOut)) * 0.8 + this.masterLevel * 0.2;
      this.updateTrackLevels();

      buffer[i * 2] = leftOut;
      buffer[(i * 2) + 1] = rightOut;
    }
  }

  private updateTrackLevels(): void {
    for (let t = 0; t < MzsdSong.TrackCount; t++) {
      this.trackLevels[t] = this.trackChipLevel(t) * this.trackGains[t];
    }
  }

  private finishPlayback(): void {
    this.sequencer = null;
    this.onSequencerFinished?.();
  }

  /** トラック番号 → 対応チップの VU レベル。 */
  private trackChipLevel(trackIndex: number): number {
    if (trackIndex <= 2) {
      return this.chips.psg1.channelLevel(trackIndex);
    }

    if (trackIndex === 3) {
      return this.chips.psg1.channelLevel(3);
    }

    if (trackIndex <= 6) {
      return this.chips.psg2.channelLevel(trackIndex - 4);
    }

    if (trackIndex === 7) {
      return this.chips.psg2.channelLevel(3);
    }

    if (trackIndex === 8) {
      return this.chips.beep.currentLevel;
    }

    return this.chips.getFmLevel(trackIndex - 9);
  }
}
