/**
 * 仮想キーボード / 各エディタ試聴用のチップ駆動サウンドエンジン (Phase A: FM)。
 * MML 演奏 (TrackSequencer) と同一の ChipBank + OPM レジスタ経路で発音するため
 * 「鍵盤の音 = 本番の音」が保証される。Web Audio 非依存のロジック層で、
 * 出力 (オーディオグラフ) は KeyboardAudioOutput が担う (vitest で完全検証可能)。
 *
 * 音量合成 / KC-KF 展開の式は TrackSequencer と FmToneRegisters で共有する
 * (将来 Phase C: ドライバ制御統一への布石)。
 */
import type { FmToneData } from '../fm/FmTone';
import { AudioFrameMixer, DefaultSampleRate } from '../player/AudioFrameMixer';
import { fmKcKfForPitch, fmToneDataToParameters, FM_PITCH_UNIT, writeFmToneRegisters } from '../player/FmToneRegisters';
import type { FrameDriver } from '../player/FrameDriver';
import { FmToneParameterCount } from '../player/MzsdSong';

/** FM 同時発音数 (OPM 8ch)。超過時は最古ボイスを steal する (リリース中を優先)。 */
const FmChannelCount = 8;

/** キーオフ後の ch 解放までの推定マージン (フレーム。EG 減衰残り分の余裕)。 */
const ReleaseMarginFrames = 8;

/** RR からの減衰時間推定式 (最小保証 0.02 秒): 0.6 秒 × (1 - RR/31)。 */
function releaseSecondsForRr(rr: number): number {
  return Math.max(0.02, 0.6 * (1 - rr / 31));
}

/** FM 発音 1 音分のオプション (SynthPlayOptions の FM 解釈)。 */
export interface KeyboardFmNoteOptions {
  /** 音色 (未指定時は既定のサイン波相当音色)。 */
  fmTone?: FmToneData;

  /** MML 音量 (0-15、v コマンド相当)。音量オフセット = (15 - volume) × 8 を TL へ加算。 */
  volume?: number;

  /** ピッチ内部値への加算 (MML D コマンド相当のレジスタ差分単位)。 */
  detune?: number;

  /** ピッチエンベロープ値列 (@EP 相当・レジスタ差分単位、60Hz で進行)。 */
  pitchEnv?: readonly number[];

  /** ピッチエンベロープのループ位置 (-1 = ループなし)。 */
  pitchEnvLoop?: number;

  /** OP 単位のミュート (FM TONE エディタの OP Mute / Solo 表現用)。true の OP は TL +127。 */
  opMuted?: readonly boolean[];
}

/** 発音中の FM ボイス (1 ノート = OPM 1 チャンネル)。 */
interface FmVoice {
  readonly midiNote: number;

  readonly channel: number;

  /** ノート開始順の通し番号 (steal 対象の「最古」判定用)。 */
  readonly age: number;

  /** ピッチ内部値の基準 (C4 = 0、1 semitone = 64。detune 加算済み)。 */
  readonly basePitch: number;

  readonly pitchEnv: readonly number[] | null;

  readonly pitchEnvLoop: number;

  pitchEnvPos: number;

  pitchEnvValue: number;

  /** キーオフ済みか (RR 減衰の自然終了を待っている状態)。 */
  released: boolean;

  /** キーオフ後に ch を解放するまでの残りフレーム数。 */
  releaseRemainingFrames: number;
}


/** 音色未指定時の既定音色 (ALG 0 / OP4 キャリアのみのサイン波相当)。 */
function createDefaultFmParameters(): Uint8Array {
  const p = new Uint8Array(FmToneParameterCount);
  p[0] = 0; // ALG 0 (1 -> 2 -> 3 -> 4 直列)
  p[1] = 0; // FB 0
  for (let op = 0; op < 4; op++) {
    const o = 2 + op * 11;
    p[o + 0] = 31; // AR (即時)
    p[o + 1] = 0; // D1R
    p[o + 2] = 0; // D2R
    p[o + 3] = 10; // RR
    p[o + 4] = 15; // D1L (サステイン最大)
    p[o + 5] = op === 3 ? 0 : 127; // TL: OP4 (キャリア) のみ発音
    p[o + 7] = 1; // MUL 1
  }
  return p;
}

/** キーオフ後の減衰完了推定フレーム数 (最も遅い OP の RR から算出 + マージン)。 */
function releaseFramesForParameters(parameters: Uint8Array): number {
  let maxSeconds = 0;
  for (let op = 0; op < 4; op++) {
    const o = 2 + op * 11;
    maxSeconds = Math.max(maxSeconds, releaseSecondsForRr(parameters[o + 3] & 31));
  }
  return Math.ceil(maxSeconds * 60) + ReleaseMarginFrames;
}

/** steal 優先度 (リリース中のボイスを先に、次に最古のボイスを犠牲にする)。 */
function stealRank(voice: FmVoice): [number, number] {
  return [voice.released ? 0 : 1, voice.age];
}


export class KeyboardSoundEngine {
  /** チップ合成 + 60Hz 駆動 + ミキシング (MML 演奏と同一コンポーネント)。 */
  readonly mixer: AudioFrameMixer;

  private readonly voices = new Map<number, FmVoice>();

  private nextChannel = 0;

  private nextAge = 0;

  /** ミキサーから 60Hz で呼ばれるボイス進行ドライバ。 */
  private readonly driver: FrameDriver = {
    tick: () => this.tickVoices(),
    get isFinished() {
      return false;
    },
    getTrackOffset: () => -1,
  };

  constructor(sampleRate: number = DefaultSampleRate) {
    this.mixer = new AudioFrameMixer(sampleRate);
    this.mixer.attachDriver(this.driver);
  }

  /** 発音中 (リリース中含む) の FM ボイス数。 */
  get activeVoiceCount(): number {
    return this.voices.size;
  }

  /** 指定ノートのボイスが存在するか (試聴 UI 表示用)。 */
  hasVoice(midiNote: number): boolean {
    return this.voices.has(midiNote);
  }

  /**
   * マスター音量を設定する (0-1)。
   * Player.setMasterVolume と同一の知覚カーブ (2 乗) を適用する。
   */
  setMasterVolume(volume: number): void {
    this.mixer.setMasterVolume(Math.min(Math.max(volume, 0), 1) ** 2);
  }

  /** 合成済み標本を出力へ供給する (KeyboardAudioOutput から呼ばれる)。 */
  read(buffer: Float32Array): void {
    if (this.voices.size === 0) {
      // ボイスが無いときはチップ合成をスキップして無音を返す (常時駆動の CPU 削減)
      buffer.fill(0);
      return;
    }

    this.mixer.read(buffer);
  }

  /** FM ノートオン (音色レジスタ展開 → KC/KF → TL 音量合成 → KEY ON)。 */
  fmNoteOn(midiNote: number, options: KeyboardFmNoteOptions): void {
    // リトリガー時は既存の同音を即時停止させる (MML 演奏のリトリガーと同一挙動)
    this.terminateVoice(midiNote);

    const parameters = options.fmTone ? fmToneDataToParameters(options.fmTone) : createDefaultFmParameters();
    const channel = this.allocateChannel();
    const fm = this.mixer.chips.fm;

    const state = writeFmToneRegisters(parameters, channel, (register, value) => fm.setReg(register, value));

    // 音量オフセット = (15 - v) × 8 (TrackSequencer.writeAttenuation と同一式)。
    // OP Mute / Solo は TL +127 (実質ミュート) で表現する。
    const volume = Math.min(Math.max(options.volume ?? 15, 0), 15);
    const offset = (15 - volume) * 8;
    for (let op = 0; op < 4; op++) {
      const muteExtra = options.opMuted?.[op] === true ? 127 : 0;
      const tl = Math.min(Math.max(state.toneLevels[op] + offset + muteExtra, 0), 127);
      fm.setReg(0x60 + (op << 3) + channel, tl);
    }

    const voice: FmVoice = {
      midiNote,
      channel,
      age: this.nextAge++,
      basePitch: (midiNote - 60) * FM_PITCH_UNIT + (options.detune ?? 0),
      pitchEnv: options.pitchEnv && options.pitchEnv.length > 0 ? options.pitchEnv : null,
      pitchEnvLoop: options.pitchEnvLoop ?? 0,
      pitchEnvPos: 0,
      pitchEnvValue: 0,
      released: false,
      releaseRemainingFrames: releaseFramesForParameters(parameters),
    };
    this.voices.set(midiNote, voice);

    this.applyVoicePitch(voice);

    // Key On (4 オペレータすべて): $08 = slot bits (bit3-6) + channel (bit0-2)
    fm.setReg(0x08, 0x78 | channel);
  }

  /** FM ノートオフ (KEY OFF 後は OPM 内蔵 EG の RR 減衰に任せ、推定時間経過後に ch を解放)。 */
  fmNoteOff(midiNote: number): void {
    const voice = this.voices.get(midiNote);
    if (!voice || voice.released) {
      return;
    }

    voice.released = true;
    this.mixer.chips.fm.setReg(0x08, voice.channel); // Key Off: slot bits = 0
  }

  /** 発音中の全ボイスへキーオフを行う (RR 減衰を再生してから自動解放)。 */
  releaseAllNotes(): void {
    for (const midiNote of [...this.voices.keys()]) {
      this.fmNoteOff(midiNote);
    }
  }

  /** 全ボイスを即時停止する (PANIC 相当。TL 127 で確実に無音化)。 */
  allNotesOff(): void {
    for (const midiNote of [...this.voices.keys()]) {
      this.terminateVoice(midiNote);
    }
  }

  /** ボイスを即時終了する (KEY OFF + TL 127 ミュート + 登録解除)。 */
  private terminateVoice(midiNote: number): void {
    const voice = this.voices.get(midiNote);
    if (!voice) {
      return;
    }

    this.voices.delete(midiNote);
    const fm = this.mixer.chips.fm;
    fm.setReg(0x08, voice.channel);
    for (let op = 0; op < 4; op++) {
      fm.setReg(0x60 + (op << 3) + voice.channel, 127);
    }
  }

  /** FM チャンネルを割り当てる (空きを round-robin、無ければ最古ボイスを steal)。 */
  private allocateChannel(): number {
    for (let i = 0; i < FmChannelCount; i++) {
      const channel = (this.nextChannel + i) % FmChannelCount;
      if (![...this.voices.values()].some((voice) => voice.channel === channel)) {
        this.nextChannel = (channel + 1) % FmChannelCount;
        return channel;
      }
    }

    // 全チャンネル使用中: リリース中を優先し、次に最古のボイスを steal する
    let victim: FmVoice | null = null;
    for (const voice of this.voices.values()) {
      if (victim === null || stealRank(voice) < stealRank(victim)) {
        victim = voice;
      }
    }

    this.voices.delete(victim!.midiNote);
    this.mixer.chips.fm.setReg(0x08, victim!.channel); // steal 元は即時キーオフ
    this.nextChannel = (victim!.channel + 1) % FmChannelCount;
    return victim!.channel;
  }

  /** 60Hz フレーム進行 (@EP 進行 + KC/KF 更新 + リリース完了ボイスの解放)。 */
  private tickVoices(): void {
    for (const voice of [...this.voices.values()]) {
      if (voice.released) {
        voice.releaseRemainingFrames--;
        if (voice.releaseRemainingFrames <= 0) {
          this.voices.delete(voice.midiNote);
        }
        continue;
      }

      this.advancePitchEnv(voice);
      this.applyVoicePitch(voice);
    }
  }

  /** ピッチエンベロープを 1 フレーム進める (TrackSequencer.applyPitchEnvFrame と同一挙動)。 */
  private advancePitchEnv(voice: FmVoice): void {
    const env = voice.pitchEnv;
    if (!env) {
      voice.pitchEnvValue = 0;
      return;
    }

    voice.pitchEnvValue = env[Math.min(voice.pitchEnvPos, env.length - 1)];

    if (voice.pitchEnvPos >= env.length - 1) {
      if (voice.pitchEnvLoop >= 0 && voice.pitchEnvLoop < env.length) {
        voice.pitchEnvPos = voice.pitchEnvLoop;
      }
    } else {
      voice.pitchEnvPos++;
    }
  }

  /** ボイスの現在ピッチを KC / KF レジスタへ書き込む。 */
  private applyVoicePitch(voice: FmVoice): void {
    const { kc, kf } = fmKcKfForPitch(voice.basePitch + voice.pitchEnvValue);
    const fm = this.mixer.chips.fm;
    fm.setReg(0x28 + voice.channel, kc);
    fm.setReg(0x30 + voice.channel, kf);
  }
}

