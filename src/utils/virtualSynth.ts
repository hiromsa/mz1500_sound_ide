import {
  type FmToneData,
} from '../core/fm/FmTone';
import { DcsgChip } from '../core/chips/DcsgChip';
import { KeyboardSoundEngine } from '../core/keyboard/KeyboardSoundEngine';
import { KeyboardAudioOutput } from '../core/keyboard/KeyboardAudioOutput';

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
  /** FM 試聴時の OP 単位ミュート (FM TONE エディタの OP Mute / Solo 表現)。true の OP は TL +127。 */
  fmOpMuted?: boolean[];
  pitchEnv?: number[]; // フレームごとのピッチオフセット値 (1 frame = 1/60s)
  pitchEnvLoop?: number; // -1: ループなし
  volEnv?: number[]; // フレームごとの音量 (0〜15)
  volEnvLoop?: number; // -1: ループなし
  volEnvRelease?: number; // リリース開始インデックス (KEY OFF 後に再生する区間。undefined / -1: なし)
  detune?: number; // デチューン値 (MML Dコマンド相当。FM はレジスタ差分単位、それ以外は cents 近似)
  noiseType?: 'periodic' | 'white'; // ノイズ種別
  /** ノイズ統合モード (MML @IN コマンド相当、PSG エンジン専用)。0 = 統合なし / 1 = 周期ノイズ連動 / 2 = ホワイトノイズ連動。 */
  noiseIntegrate?: 0 | 1 | 2;
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
export class VolumeEnvelopePlayback {
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

  /**
   * KEY OFF: リリースフェーズへ遷移する (リリース未定義は false)。
   * 既にリリース中の場合は進行を壊さないよう true を返すだけの冪等設計
   * (マウスドラッグ終了時の全キーオフで 2 回呼ばれてもリリースが巻き戻らない)。
   */
  beginRelease(): boolean {
    if (!this.hasRelease) return false;
    if (this.releasing) return true;
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
  /** マスター音量変更を発音中のボイスへ即時反映する。 */
  setVolume: (volume: number) => void;
  /** @VE リリース定義がある場合のキーオフ遷移 (false = リリースなしで即停止)。 */
  triggerRelease?: () => boolean;
  /** リリースフェーズ再生中か (2 重キーオフで即停止 / リリース巻き戻しを防ぐガード)。 */
  isReleasing?: boolean;
}

/**
 * マスター音量の知覚カーブ (Player.setMasterVolume と同一の 2 乗曲線)。
 * 0-1 外の入力はクランプする。
 */
export function perceptualMasterGain(volume: number): number {
  const clamped = Math.min(Math.max(volume, 0), 1);
  return clamped * clamped;
}

export class VirtualSynthEngine {
  private ctx: AudioContext | null = null;
  private activeVoices: Map<number, ActiveVoice> = new Map();
  private noiseBuffer: AudioBuffer | null = null;

  /**
   * FM (OPM エミュレーション) 鍵盤音源。
   * MML 演奏と同一の ChipBank + レジスタ経路で発音するため「鍵盤の音 = 本番の音」になる。
   */
  private readonly keyboardEngine = new KeyboardSoundEngine();

  private readonly keyboardOutput: KeyboardAudioOutput;

  /** マスター音量 (知覚カーブ適用済み 0-1)。TRACK MONITOR の MASTER VOL と共有する。 */
  private masterVolume = 1;

  constructor() {
    this.keyboardOutput = new KeyboardAudioOutput(this.keyboardEngine, this.keyboardEngine.mixer.sampleRate);
  }

  /**
   * マスター音量を設定する (0-1 / 知覚カーブ適用)。
   * TRACK MONITOR の MASTER VOL から呼ばれ、仮想キーボードの発音音量を制御する。
   * 発音中のボイスへも即時反映する。
   */
  public setMasterVolume(volume: number): void {
    this.keyboardEngine.setMasterVolume(volume); // FM はエンジン内で知覚カーブ (2 乗) を適用
    this.masterVolume = perceptualMasterGain(volume);
    this.activeVoices.forEach(voice => voice.setVolume(this.masterVolume));
  }

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
    // FM は OPM エミュレーション (KeyboardSoundEngine) へ委譲する。
    // MML 演奏と同一の ChipBank + レジスタ経路で発音するため、鍵盤の音 = 本番の音になる。
    if (options.engine === 'fm') {
      void this.keyboardOutput.ensureStarted();
      this.keyboardEngine.fmNoteOn(midiNote, {
        fmTone: options.fmTone,
        volume: options.volume,
        detune: options.detune ?? 0,
        pitchEnv: options.pitchEnv,
        pitchEnvLoop: options.pitchEnvLoop,
        opMuted: options.fmOpMuted,
      });
      return;
    }

    const ctx = this.getAudioContext();
    this.stopVoice(midiNote); // 既存の同音を停止 (リトリガー時はリリースさせず即時停止)

    const baseFreq = midiNoteToFrequency(midiNote, options.detune || 0);
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.masterVolume, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // ボリューム計算 (0〜15 ➜ 0.0〜0.25)
    const baseVolumeRatio = Math.max(0, Math.min(15, options.volume)) / 15;
    const peakGain = baseVolumeRatio * 0.22;

    const stopCallbacks: Array<() => void> = [];
    const timers: number[] = [];
    let triggerRelease: (() => boolean) | undefined;
    let releaseStopTimer: number | null = null;

    // リリース再生完了後のボイス自動停止 (フェード分を見て +120ms)
    const scheduleAutoStop = (releaseMs: number) => {
      releaseStopTimer = window.setTimeout(() => {
        const voice = this.activeVoices.get(midiNote);
        if (voice) {
          voice.stop();
          this.activeVoices.delete(midiNote);
        }
      }, releaseMs + 120);
    };

    // リリース定義付き @VE のキーオフ遷移トリガー生成 (PSG / NOISE 共通、演奏エンジンと同一挙動)
    const makeVolEnvReleaseTrigger = (state: VolumeEnvelopePlayback): (() => boolean) | undefined => {
      if (!state.hasRelease) return undefined;
      const releaseMs = state.releaseLengthFrames * (1000 / 60);
      return () => {
        if (!state.beginRelease()) return false;
        scheduleAutoStop(releaseMs);
        return true;
      };
    };

    // --- 1. PSG (DCSG 矩形波 / @IN ノイズ統合) ---
    if (options.engine === 'psg') {
      const integrateMode = options.noiseIntegrate ?? 0;
      // @IN 統合時は音程に追従するノイズで発音する
      // (実機仕様: トーン 3 の周波数レジスタでノイズジェネレータを駆動し、発音もノイズへ切替)
      const useIntegrateNoise = integrateMode === 1 || integrateMode === 2;

      // 実機 10bit トーン周期レジスタに量子化した周波数で発音する (演奏エンジンと同一式)。
      // レジスタ上限 (period 1023 ≒ 109.3Hz) を超える低音は実機どおり最低音へ丸められる
      const tonePeriod = DcsgChip.tonePeriodForFrequency(baseFreq);
      const toneFreq = Math.min(20000, DcsgChip.toneFrequencyForPeriod(tonePeriod));

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peakGain, ctx.currentTime);
      gain.connect(masterGain);

      const osc = useIntegrateNoise ? null : ctx.createOscillator();
      const integrateNoiseSrc = useIntegrateNoise ? ctx.createBufferSource() : null;
      const integrateNoiseFilter = useIntegrateNoise ? ctx.createBiquadFilter() : null;

      if (osc) {
        osc.type = 'square';
        osc.frequency.setValueAtTime(toneFreq, ctx.currentTime);
        osc.connect(gain);
        osc.start();
      } else if (integrateNoiseSrc && integrateNoiseFilter) {
        integrateNoiseSrc.buffer = this.getNoiseBuffer(ctx);
        integrateNoiseSrc.loop = true;
        // bandpass 中心を音程に比例させ、ノイズの高さが音階へ追従する
        integrateNoiseFilter.type = 'bandpass';
        integrateNoiseFilter.frequency.setValueAtTime(Math.min(16000, toneFreq * 4), ctx.currentTime);
        // @IN1 = 周期ノイズ連動 (Q高めで硬い金属音) / @IN2 = ホワイトノイズ連動 (Q低めで広がりのあるノイズ)
        integrateNoiseFilter.Q.setValueAtTime(integrateMode === 1 ? 10 : 2, ctx.currentTime);
        integrateNoiseSrc.connect(integrateNoiseFilter);
        integrateNoiseFilter.connect(gain);
        integrateNoiseSrc.start();
      }

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
            if (integrateNoiseSrc) {
              // ノイズ統合時は playbackRate でピッチ変調 (実機: tone2 周波数レジスタの変調に相当)
              integrateNoiseSrc.playbackRate.setValueAtTime(Math.pow(2, detuneCents / 1200), now);
            } else if (osc) {
              osc.detune.setValueAtTime(detuneCents, now);
            }
          }

          currentFrame++;
          volEnvState?.advance();
        }, 1000 / 60);
        timers.push(interval);
      }

      // キーオフで @VE リリース区間 (> 以降) へ遷移するトリガー (演奏エンジンと同一挙動)
      if (volEnvState) {
        triggerRelease = makeVolEnvReleaseTrigger(volEnvState);
      }

      stopCallbacks.push(() => {
        try {
          const now = ctx.currentTime;
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
          setTimeout(() => {
            try {
              osc?.stop();
              osc?.disconnect();
              integrateNoiseSrc?.stop();
              integrateNoiseSrc?.disconnect();
              integrateNoiseFilter?.disconnect();
            } catch { /* ignore */ }
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
        if (noiseVolEnvState) {
          triggerRelease = makeVolEnvReleaseTrigger(noiseVolEnvState);
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
    }

    // 発音中インスタンスを登録
    this.activeVoices.set(midiNote, {
      midiNote,
      engine: options.engine,
      setVolume: (volume) => {
        try {
          masterGain.gain.setValueAtTime(volume, ctx.currentTime);
        } catch { /* ignore */ }
      },
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
    // FM: KEY OFF 後は OPM 内蔵 EG の RR 減衰へ任せる (演奏エンジンのキーオフと同一挙動)
    this.keyboardEngine.fmNoteOff(midiNote);

    const voice = this.activeVoices.get(midiNote);
    if (!voice || voice.isReleasing) return;

    // @VE リリース定義 (PSG / NOISE) へ遷移する
    // (演奏エンジンのキーオフと同一挙動。既にリリース中の音は巻き戻さない)
    if (voice.triggerRelease && voice.triggerRelease()) {
      voice.isReleasing = true;
      return;
    }

    this.stopVoice(midiNote);
  }

  // 全ノート停止 (PANIC 相当)
  public allNotesOff() {
    this.keyboardEngine.allNotesOff();
    this.activeVoices.forEach(voice => voice.stop());
    this.activeVoices.clear();
  }

  /**
   * 発音中の全ノートへキーオフを行う (@VE リリース / FM RR 減衰を再生してから自動停止)。
   * マウスドラッグ終了時など「鍵盤を離す」操作用。
   * リリース定義のない音のみ即時停止する (PANIC などの即時停止は allNotesOff を使用)。
   */
  public releaseAllNotes() {
    this.keyboardEngine.releaseAllNotes();

    // ループ中に Map を変更するためスナップショットへ列挙する
    for (const [midiNote, voice] of [...this.activeVoices]) {
      if (voice.isReleasing) continue;
      if (voice.triggerRelease && voice.triggerRelease()) {
        voice.isReleasing = true;
        continue;
      }
      voice.stop();
      this.activeVoices.delete(midiNote);
    }
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
