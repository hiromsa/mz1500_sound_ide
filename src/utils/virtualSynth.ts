import {
  type FmToneData,
  isOpCarrier,
  OP_MODULATION_TARGETS,
} from '../core/fm/FmTone';

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
  detune?: number; // デチューン値 (MML Dコマンド相当, ±cents)
  noiseType?: 'periodic' | 'white'; // ノイズ種別
}

// 発音中インスタンス管理
interface ActiveVoice {
  midiNote: number;
  engine: SoundEngineType;
  stop: () => void;
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
    this.noteOff(midiNote); // 既存の同音を停止

    const baseFreq = midiNoteToFrequency(midiNote, options.detune || 0);
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    // ボリューム計算 (0〜15 ➜ 0.0〜0.25)
    const baseVolumeRatio = Math.max(0, Math.min(15, options.volume)) / 15;
    const peakGain = baseVolumeRatio * 0.22;

    const stopCallbacks: Array<() => void> = [];
    const timers: number[] = [];

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
      const hasVolEnv = options.volEnv && options.volEnv.length > 0;
      const hasPitchEnv = options.pitchEnv && options.pitchEnv.length > 0;

      if (hasVolEnv || hasPitchEnv) {
        const interval = window.setInterval(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;

          // 音量エンベロープ
          if (hasVolEnv && options.volEnv) {
            const vLen = options.volEnv.length;
            let vIdx = currentFrame;
            if (vIdx >= vLen) {
              const vLoop = options.volEnvLoop ?? 0;
              vIdx = vLoop >= 0 && vLoop < vLen ? vLoop + ((vIdx - vLen) % (vLen - vLoop)) : vLen - 1;
            }
            const vVal = options.volEnv[vIdx] ?? 15;
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
        }, 1000 / 60);
        timers.push(interval);
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

      // 周期ノイズまたはホワイトノイズ用のバンドパスフィルター
      const filter = ctx.createBiquadFilter();
      if (options.noiseType === 'periodic') {
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(baseFreq, ctx.currentTime);
        filter.Q.setValueAtTime(10, ctx.currentTime);
      } else {
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(8000, ctx.currentTime);
      }

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peakGain, ctx.currentTime);

      noiseSrc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      noiseSrc.start();

      // ボリュームエンベロープ
      if (options.volEnv && options.volEnv.length > 0) {
        let currentFrame = 0;
        const interval = window.setInterval(() => {
          if (!this.ctx) return;
          const now = this.ctx.currentTime;
          const vLen = options.volEnv!.length;
          let vIdx = currentFrame;
          if (vIdx >= vLen) {
            const vLoop = options.volEnvLoop ?? 0;
            vIdx = vLoop >= 0 && vLoop < vLen ? vLoop + ((vIdx - vLen) % (vLen - vLoop)) : vLen - 1;
          }
          const vVal = options.volEnv![vIdx] ?? 15;
          const currentGain = (vVal / 15) * peakGain;
          gain.gain.setValueAtTime(Math.max(0.0001, currentGain), now);
          currentFrame++;
        }, 1000 / 60);
        timers.push(interval);
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
      stop: () => {
        timers.forEach(t => clearInterval(t));
        stopCallbacks.forEach(cb => cb());
        masterGain.disconnect();
      }
    });
  }

  // ノートOFF
  public noteOff(midiNote: number) {
    const voice = this.activeVoices.get(midiNote);
    if (voice) {
      voice.stop();
      this.activeVoices.delete(midiNote);
    }
  }

  // 全ノート停止
  public allNotesOff() {
    this.activeVoices.forEach(voice => voice.stop());
    this.activeVoices.clear();
  }
}

// シングルトンインスタンス
export const virtualSynth = new VirtualSynthEngine();
