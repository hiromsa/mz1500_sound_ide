import {
  type FmToneData,
  isOpCarrier,
  OP_MODULATION_TARGETS,
} from '../core/fm/FmTone';
import { DcsgChip } from '../core/chips/DcsgChip';

// MIDIノート番号から周波数 (Hz) を計算
export function midiNoteToFrequency(midiNote: number, detuneCents: number = 0): number {
  // A4 = 440Hz = MIDI Note 69
  const freq = 440 * Math.pow(2, (midiNote - 69 + detuneCents / 100) / 12);
  return Math.max(20, Math.min(20000, freq));
}

// 音源種別
export type SoundEngineType = 'psg' | 'fm' | 'beep' | 'noise';

// 再生オプション
export interface SynthPlayOptions {
  engine: SoundEngineType;
  volume: number; // 0〜15 (MML準拠)
  fmTone?: FmToneData;
  pitchEnv?: number[]; // フレームごとのピッチオフセット値 (1 frame = 1/60s)
  pitchEnvLoop?: number; // -1: ループなし
  volEnv?: number[]; // フレームごとの音量 (0〜15)
  volEnvLoop?: number; // -1: ループなし
  volEnvRelease?: number; // リリース開始インデックス (KEY OFF 後に再生する区間。undefined / -1: なし)
  detune?: number; // デチューン値 (MML Dコマンド相当, ±cents)
  noiseType?: 'periodic' | 'white'; // ノイズ種別
}

/**
 * KEY ON 中の音量エンベロープインデックスを算出する。
 * リリース位置がある場合はその直前まで (サステイン区間) でループ / ホールドし、
 * リリース区間には決して入らない (MZSD 演奏エンジンと同一挙動)。
 */
export function sustainEnvelopeIndex(
  frame: number,
  length: number,
  loop: number | undefined,
  release: number | undefined,
): number {
  const sustainEnd = release !== undefined && release >= 0 && release < length ? release : length;
  if (frame < sustainEnd) return frame;
  if (loop !== undefined && loop >= 0 && loop < sustainEnd) {
    return loop + ((frame - sustainEnd) % (sustainEnd - loop));
  }
  return sustainEnd - 1;
}

/**
 * 音量エンベロープ 1 発音分の進行状態。
 * KEY ON 中はサステイン区間 (`[loop, release)` / リリースなしは末尾) を進み、
 * beginRelease() 以降はリリース区間を末尾まで 1 回だけ再生する。
 */
class VolumeEnvelopePlayback {
  private readonly values: readonly number[];

  private readonly loop: number | undefined;

  private readonly release: number | undefined;

  private frame = 0;

  private releaseFrame = 0;

  private releasing = false;

  constructor(values: readonly number[], loop: number | undefined, release: number | undefined) {
    this.values = values;
    this.loop = loop;
    this.release = release;
  }

  /** リリース定義 (`>` マーカー) を持つかどうか。 */
  get hasRelease(): boolean {
    return this.validRelease() !== null;
  }

  /** リリース区間のフレーム数 (hasRelease 時のみ意味を持つ)。 */
  get releaseLengthFrames(): number {
    const start = this.validRelease();
    return start === null ? 0 : this.values.length - start;
  }

  /** 現在フレームの音量インデックス (進行はしない)。 */
  currentIndex(): number {
    const len = this.values.length;
    if (this.releasing) {
      const start = this.validRelease();
      if (start !== null) {
        return Math.min(start + this.releaseFrame, len - 1); // リリース末尾でホールド
      }
    }

    return sustainEnvelopeIndex(this.frame, len, this.loop, this.release);
  }

  /** 1 フレーム進める。 */
  advance(): void {
    this.frame++;
    if (this.releasing) {
      this.releaseFrame++;
    }
  }

  /** KEY OFF: リリースフェーズへ遷移する (未定義 / 遷移済みの場合は false)。 */
  beginRelease(): boolean {
    if (this.releasing || !this.hasRelease) return false;
    this.releasing = true;
    this.releaseFrame = 0;
    return true;
  }

  private validRelease(): number | null {
    return this.release !== undefined && this.release >= 0 && this.release < this.values.length
      ? this.release
      : null;
  }
}

// 発音中インスタンス管理
interface ActiveVoice {
  midiNote: number;
  engine: SoundEngineType;
  stop: () => void;
  /** @VE リリース定義がある場合のキーオフ遷移 (false = リリースなしで即停止)。 */
  triggerRelease?: () => boolean;
}

export class VirtualSynthEngine {
  private ctx: AudioContext | null = null;
  private activeVoices: Map<number, ActiveVoice> = new Map();
  private noiseBuffer: AudioBuffer | null = null;

  private getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // ホワイトノイズ生成バッファ
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const bufferSize = ctx.sampleRate * 2; // 2秒分
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  // ノートON
  public noteOn(midiNote: number, options: SynthPlayOptions) {
    const ctx = this.getAudioContext();
    this.stopVoice(midiNote); // 既存の同音を停止 (リトリガー時はリリースさせず即時停止)

    const baseFreq = midiNoteToFrequency(midiNote, options.detune || 0);
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    // ボリューム計算 (0〜15 ➜ 0.0〜0.25)
    const baseVolumeRatio = Math.max(0, Math.min(15, options.volume)) / 15;
    const peakGain = baseVolumeRatio * 0.22;

    const stopCallbacks: Array<() => void> = [];
    const timers: number[] = [];
    let triggerRelease: (() => boolean) | undefined;
    let releaseStopTimer: number | null = null;

    // --- 1. PSG (DCSG 矩形波) ---
    if (options.engine === 'psg') {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peakGain, ctx.currentTime);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();

      // エンベロープ処理 (60fps)
      let currentFrame = 0;
      const volEnv = options.volEnv && options.volEnv.length > 0 ? options.volEnv : null;
      const volEnvState = volEnv
        ? new VolumeEnvelopePlayback(volEnv, options.volEnvLoop, options.volEnvRelease)
        : null;
      const hasPitchEnv = options.pitchEnv && options.pitchEnv.length > 0;

      if (volEnvState || hasPitchEnv) {
        const interval = window.setInterval(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;

          // 音量エンベロープ (KEY ON 中はサステイン区間をループ / キーオフ後はリリース区間を再生)
          if (volEnvState && volEnv) {
            const vVal = volEnv[volEnvState.currentIndex()] ?? 15;
            const currentGain = (vVal / 15) * peakGain;
            gain.gain.setValueAtTime(Math.max(0.0001, currentGain), now);
          }

          // ピッチエンベロープ (1単位 = 25 cents)
          if (hasPitchEnv && options.pitchEnv) {
            const pLen = options.pitchEnv.length;
            let pIdx = currentFrame;
            if (pIdx >= pLen) {
              const pLoop = options.pitchEnvLoop ?? 0;
              pIdx = pLoop >= 0 && pLoop < pLen ? pLoop + ((pIdx - pLen) % (pLen - pLoop)) : pLen - 1;
            }
            const pVal = options.pitchEnv[pIdx] ?? 0;
            const detuneCents = (options.detune || 0) + pVal * 25;
            osc.detune.setValueAtTime(detuneCents, now);
          }

          currentFrame++;
          volEnvState?.advance();
        }, 1000 / 60);
        timers.push(interval);
      }

      // キーオフで @VE リリース区間 (> 以降) へ遷移するトリガー (演奏エンジンと同一挙動)
      if (volEnvState?.hasRelease) {
        const releaseMs = volEnvState.releaseLengthFrames * (1000 / 60);
        triggerRelease = () => {
          if (!volEnvState.beginRelease()) return false;
          releaseStopTimer = window.setTimeout(() => {
            const voice = this.activeVoices.get(midiNote);
            if (voice) {
              voice.stop();
              this.activeVoices.delete(midiNote);
            }
          }, releaseMs + 120); // リリース再生後、フェード分を見て自動停止
          return true;
        };
      }

      stopCallbacks.push(() => {
        try {
          const now = ctx.currentTime;
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
          setTimeout(() => {
            try { osc.stop(); osc.disconnect(); } catch { /* ignore */ }
          }, 60);
        } catch { /* ignore */ }
      });

    // --- 2. BEEP (8253 PIT 1bit矩形波) ---
    } else if (options.engine === 'beep') {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

      const gain = ctx.createGain();
      // BEEPは固定音量 (音量制御不可のハードウェア仕様)
      gain.gain.setValueAtTime(0.18, ctx.currentTime);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();

      // ピッチエンベロープ対応
      if (options.pitchEnv && options.pitchEnv.length > 0) {
        let currentFrame = 0;
        const interval = window.setInterval(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const pLen = options.pitchEnv!.length;
          let pIdx = currentFrame;
          if (pIdx >= pLen) {
            const pLoop = options.pitchEnvLoop ?? 0;
            pIdx = pLoop >= 0 && pLoop < pLen ? pLoop + ((pIdx - pLen) % (pLen - pLoop)) : pLen - 1;
          }
          const pVal = options.pitchEnv![pIdx] ?? 0;
          osc.detune.setValueAtTime((options.detune || 0) + pVal * 25, now);
          currentFrame++;
        }, 1000 / 60);
        timers.push(interval);
      }

      stopCallbacks.push(() => {
        try {
          const now = ctx.currentTime;
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.04);
          setTimeout(() => {
            try { osc.stop(); osc.disconnect(); } catch { /* ignore */ }
          }, 50);
        } catch { /* ignore */ }
      });

    // --- 3. NOISE (DCSG ノイズ) ---
    } else if (options.engine === 'noise') {
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = this.getNoiseBuffer(ctx);
      noiseSrc.loop = true;

      // 音名で 3 段階のシフトレート (c〜d# = 低 / e〜f# = 中 / g〜b = 高、演奏エンジンと同一規約)
      const noiseRate = DcsgChip.noiseRateForNote(midiNote);

      // 周期ノイズ / ホワイトノイズ用のフィルタ (DcsgChip の出力特性と同一基準)
      const filter = ctx.createBiquadFilter();
      if (options.noiseType === 'periodic') {
        filter.type = 'bandpass';
        // 周期ノイズの基本波 = シフトクロック / 16 (低 = 3.5kHz / 中 = 7kHz / 高 = 14kHz)
        filter.frequency.setValueAtTime(DcsgChip.periodicCenterForRate(noiseRate), ctx.currentTime);
        filter.Q.setValueAtTime(10, ctx.currentTime);
      } else {
        filter.type = 'lowpass';
        // ホワイトノイズの明るさ = 分周レート連動 (低 = 2kHz / 中 = 4kHz / 高 = 8kHz)
        filter.frequency.setValueAtTime(DcsgChip.lpfCutoffForRate(noiseRate, true), ctx.currentTime);
      }

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peakGain, ctx.currentTime);

      noiseSrc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      noiseSrc.start();

      // ボリュームエンベロープ (KEY ON 中はサステイン区間をループ / キーオフ後はリリース区間を再生)
      const noiseVolEnv = options.volEnv && options.volEnv.length > 0 ? options.volEnv : null;
      const noiseVolEnvState = noiseVolEnv
        ? new VolumeEnvelopePlayback(noiseVolEnv, options.volEnvLoop, options.volEnvRelease)
        : null;
      if (noiseVolEnvState && noiseVolEnv) {
        const interval = window.setInterval(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const vVal = noiseVolEnv[noiseVolEnvState.currentIndex()] ?? 15;
          const currentGain = (vVal / 15) * peakGain;
          gain.gain.setValueAtTime(Math.max(0.0001, currentGain), now);
          noiseVolEnvState.advance();
        }, 1000 / 60);
        timers.push(interval);

        // キーオフで @VE リリース区間 (> 以降) へ遷移するトリガー (演奏エンジンと同一挙動)
        if (noiseVolEnvState.hasRelease) {
          const releaseMs = noiseVolEnvState.releaseLengthFrames * (1000 / 60);
          triggerRelease = () => {
            if (!noiseVolEnvState.beginRelease()) return false;
            releaseStopTimer = window.setTimeout(() => {
              const voice = this.activeVoices.get(midiNote);
              if (voice) {
                voice.stop();
                this.activeVoices.delete(midiNote);
              }
            }, releaseMs + 120); // リリース再生後、フェード分を見て自動停止
            return true;
          };
        }
      }

      stopCallbacks.push(() => {
        try {
          const now = ctx.currentTime;
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
          setTimeout(() => {
            try { noiseSrc.stop(); noiseSrc.disconnect(); } catch { /* ignore */ }
          }, 60);
        } catch { /* ignore */ }
      });

    // --- 4. FM (YM2151 4-OP OPM) ---
    } else if (options.engine === 'fm') {
      const tone = options.fmTone;
      if (!tone) {
        // デフォルトのFMサイン波
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(peakGain, ctx.currentTime);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        stopCallbacks.push(() => {
          gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          setTimeout(() => { try { osc.stop(); osc.disconnect(); } catch { /* ignore */ } }, 60);
        });
      } else {
        const oscs: OscillatorNode[] = [];
        const opGains: GainNode[] = [];
        const now = ctx.currentTime;

        for (let i = 0; i < 4; i++) {
          const op = tone.ops[i];
          const osc = ctx.createOscillator();
          const mult = op.mul === 0 ? 0.5 : op.mul;
          const detuneCents = (options.detune || 0) + (op.dt1 - 3) * 6 + op.dt2 * 30;
          osc.frequency.setValueAtTime(baseFreq * mult, now);
          osc.detune.setValueAtTime(detuneCents, now);

          const gain = ctx.createGain();
          // TL (0=Max, 127=Mute)
          const maxVol = Math.max(0, (127 - op.tl) / 127) * (peakGain * 1.5);
          const attackTime = Math.max(0.01, 0.4 * (1 - op.ar / 31));
          const decayTime = Math.max(0.02, 0.6 * (1 - op.d1r / 31));
          const sustainLevel = Math.max(0.001, maxVol * (1 - op.d1l / 15));

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(maxVol, now + attackTime);
          gain.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);

          osc.connect(gain);
          osc.start(now);
          oscs.push(osc);
          opGains.push(gain);
        }

        // アルゴリズム変調接続
        for (let i = 0; i < 4; i++) {
          const isCarrier = isOpCarrier(tone.alg, i);
          if (isCarrier) {
            opGains[i].connect(masterGain);
          }
          const targets = OP_MODULATION_TARGETS[tone.alg]?.[i] || [];
          for (const targetIdx of targets) {
            const modScale = ctx.createGain();
            modScale.gain.setValueAtTime(baseFreq * 2.5, now);
            opGains[i].connect(modScale);
            modScale.connect(oscs[targetIdx].frequency);
          }
        }

        // ピッチエンベロープ
        if (options.pitchEnv && options.pitchEnv.length > 0) {
          let currentFrame = 0;
          const interval = window.setInterval(() => {
            if (!this.ctx) return;
            const curTime = this.ctx.currentTime;
            const pLen = options.pitchEnv!.length;
            let pIdx = currentFrame;
            if (pIdx >= pLen) {
              const pLoop = options.pitchEnvLoop ?? 0;
              pIdx = pLoop >= 0 && pLoop < pLen ? pLoop + ((pIdx - pLen) % (pLen - pLoop)) : pLen - 1;
            }
            const pVal = options.pitchEnv![pIdx] ?? 0;
            for (let i = 0; i < 4; i++) {
              const op = tone.ops[i];
              const detuneCents = (options.detune || 0) + (op.dt1 - 3) * 6 + op.dt2 * 30 + pVal * 25;
              oscs[i].detune.setValueAtTime(detuneCents, curTime);
            }
            currentFrame++;
          }, 1000 / 60);
          timers.push(interval);
        }

        stopCallbacks.push(() => {
          try {
            const curTime = ctx.currentTime;
            masterGain.gain.linearRampToValueAtTime(0.0001, curTime + 0.12);
            setTimeout(() => {
              oscs.forEach(o => {
                try { o.stop(); o.disconnect(); } catch { /* ignore */ }
              });
            }, 150);
          } catch { /* ignore */ }
        });
      }
    }

    // 発音中インスタンスを登録
    this.activeVoices.set(midiNote, {
      midiNote,
      engine: options.engine,
      triggerRelease,
      stop: () => {
        if (releaseStopTimer !== null) {
          clearTimeout(releaseStopTimer);
          releaseStopTimer = null;
        }
        timers.forEach(t => clearInterval(t));
        stopCallbacks.forEach(cb => cb());
        masterGain.disconnect();
      }
    });
  }

  // ノートOFF
  public noteOff(midiNote: number) {
    const voice = this.activeVoices.get(midiNote);
    if (!voice) return;

    // @VE リリース定義がある場合はキーオフでリリースフェーズへ遷移する (演奏エンジンと同一挙動)
    if (voice.triggerRelease && voice.triggerRelease()) {
      return;
    }

    this.stopVoice(midiNote);
  }

  // 全ノート停止
  public allNotesOff() {
    this.activeVoices.forEach(voice => voice.stop());
    this.activeVoices.clear();
  }

  /** 指定ノートの発音を即時停止する (リリースは行わない)。 */
  private stopVoice(midiNote: number) {
    const voice = this.activeVoices.get(midiNote);
    if (voice) {
      voice.stop();
      this.activeVoices.delete(midiNote);
    }
  }
}

// シングルトンインスタンス
export const virtualSynth = new VirtualSynthEngine();
