/**
 * 仮想キーボード / 各エディタ試聴用のチップ駆動サウンドエンジン (Phase A: FM / Phase B: PSG・ノイズ・BEEP)。
 * MML 演奏 (TrackSequencer) と同一の ChipBank + レジスタ経路で発音するため
 * 「鍵盤の音 = 本番の音」が保証される。Web Audio 非依存のロジック層で、
 * 出力 (オーディオグラフ) は KeyboardAudioOutput が担う (vitest で完全検証可能)。
 *
 * 音量合成 / KC-KF 展開 / @VE・@PE 進行の式は TrackSequencer と共有レイヤー
 * (FmToneRegisters / VolumeEnvelopePlayback) で統一する (将来 Phase C: ドライバ制御統一への布石)。
 */
import type { FmToneData } from '../fm/FmTone';
import { AudioFrameMixer, DefaultSampleRate } from '../player/AudioFrameMixer';
import { fmKcKfForPitch, fmToneDataToParameters, FM_PITCH_UNIT, writeFmToneRegisters } from '../player/FmToneRegisters';
import type { FrameDriver } from '../player/FrameDriver';
import { FmToneParameterCount } from '../player/MzsdSong';
import { BeepChip } from '../chips/BeepChip';
import { DcsgChip } from '../chips/DcsgChip';
import { VolumeEnvelopePlayback } from './VolumeEnvelopePlayback';

/** FM 同時発音数 (OPM 8ch)。超過時は最古ボイスを steal する (リリース中を優先)。 */
const FmChannelCount = 8;

/** キーオフ後の ch 解放までの推定マージン (フレーム。EG 減衰残り分の余裕)。 */
const ReleaseMarginFrames = 8;

/** @VE リリース再生完了後の ch 解放マージン (フレーム)。 */
const DcsgReleaseMarginFrames = 2;

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

/** PSG (DCSG トーン / @IN ノイズ統合) 発音 1 音分のオプション。 */
export interface KeyboardPsgNoteOptions {
  /** MML 音量 (0-15、v コマンド相当)。減衰 = 15 - volume をレジスタへ書き込む。 */
  volume?: number;

  /** トーン周期レジスタへの加算 (MML D コマンド相当のレジスタ差分単位、+ = 音程上昇)。 */
  detune?: number;

  /** ピッチエンベロープ値列 (@EP 相当・トーン周期差分単位、60Hz で進行)。 */
  pitchEnv?: readonly number[];

  /** ピッチエンベロープのループ位置 (-1 = ループなし)。 */
  pitchEnvLoop?: number;

  /** 音量エンベロープ値列 (@VE 相当・0-15、60Hz で減衰レジスタへ反映)。 */
  volEnv?: readonly number[];

  /** 音量エンベロープのループ位置 (-1 = ループなし)。 */
  volEnvLoop?: number;

  /** 音量エンベロープのリリース位置 (KEY OFF 後に 1 回だけ再生する区間。-1 = なし)。 */
  volEnvRelease?: number;

  /** ノイズ統合モード (@IN コマンド相当)。1 = 周期ノイズ連動 / 2 = ホワイトノイズ連動。 */
  noiseIntegrate?: 0 | 1 | 2;
}

/** ノイズ (DCSG ノイズチャンネル) 発音 1 音分のオプション。 */
export interface KeyboardNoiseNoteOptions {
  /** MML 音量 (0-15)。減衰 = 15 - volume。 */
  volume?: number;

  /** ノイズ波形 (@WN コマンド相当)。 */
  noiseType?: 'periodic' | 'white';

  /** 音量エンベロープ値列 (@VE 相当・0-15)。 */
  volEnv?: readonly number[];

  /** 音量エンベロープのループ位置 (-1 = ループなし)。 */
  volEnvLoop?: number;

  /** 音量エンベロープのリリース位置 (-1 = なし)。 */
  volEnvRelease?: number;
}

/** BEEP (8253 PIT) 発音 1 音分のオプション (音量はハードウェア仕様上なし)。 */
export interface KeyboardBeepNoteOptions {
  /** ピッチエンベロープ値列 (@EP 相当・カウンタ差分単位、60Hz で進行)。 */
  pitchEnv?: readonly number[];

  /** ピッチエンベロープのループ位置 (-1 = ループなし)。 */
  pitchEnvLoop?: number;
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

/** steal 判定に必要な最小構造 (FM / DCSG ボイス共通)。 */
interface StealRankable {
  released: boolean;

  age: number;
}

/** steal 優先度 (リリース中のボイスを先に、次に最古のボイスを犠牲にする)。 */
function stealRank(voice: StealRankable): [number, number] {
  return [voice.released ? 0 : 1, voice.age];
}

/** DCSG ボイスの種別。 */
type DcsgVoiceKind = 'tone' | 'integrate' | 'noise';

/** 発音中の DCSG ボイス (PSG トーン / @IN 統合 / ノイズ共通)。 */
interface DcsgVoice {
  readonly midiNote: number;

  readonly kind: DcsgVoiceKind;

  /** 占有する DCSG チャンネルスロット (chipIndex × 4 + channel のキー集合)。 */
  readonly slots: readonly number[];

  /** 属する PSG (0 = psg1 → L / 1 = psg2 → R)。 */
  readonly chipIndex: number;

  /** 発音 (減衰を書き込む) チャンネル。tone = 0-2 / noise・integrate = 3。 */
  readonly channel: number;

  /** ノート開始順の通し番号 (steal 対象の「最古」判定用・FM と共通)。 */
  readonly age: number;

  /** 基準トーン周期 (tone / integrate のみ使用)。 */
  readonly basePeriod: number;

  /** MML 音量 (0-15)。@VE がある間はエンベロープ値を優先。 */
  readonly volume: number;

  /** @VE 進行状態 (null = 直接送信の音量)。 */
  readonly volEnv: VolumeEnvelopePlayback | null;

  /** @VE 値列 (volEnv と対)。 */
  readonly volEnvValues: readonly number[] | null;

  readonly pitchEnv: readonly number[] | null;

  readonly pitchEnvLoop: number;

  pitchEnvPos: number;

  pitchEnvValue: number;

  /** ピッチ差分の固定加算 (D コマンド相当・レジスタ差分単位)。 */
  readonly detune: number;

  /** キーオフ済みか (@VE リリース再生中)。 */
  released: boolean;

  /** リリース終了までの残りフレーム数。 */
  releaseRemainingFrames: number;
}

/** 発音中の BEEP ボイス (8253 は 1 ch のため同時に 1 音)。 */
interface BeepVoice {
  readonly midiNote: number;

  readonly baseCounter: number;

  readonly pitchEnv: readonly number[] | null;

  readonly pitchEnvLoop: number;

  pitchEnvPos: number;

  pitchEnvValue: number;
}

/** MIDI ノート → 周波数 (TrackSequencer.noteFrequency と同一式)。 */
function midiNoteFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** SynthPlayOptions 流のループ / リリース位置 (-1 = なし) を VolumeEnvelopePlayback 引数へ変換。 */
function optionalIndex(value: number | undefined): number | undefined {
  return value !== undefined && value >= 0 ? value : undefined;
}



export class KeyboardSoundEngine {
  /** チップ合成 + 60Hz 駆動 + ミキシング (MML 演奏と同一コンポーネント)。 */
  readonly mixer: AudioFrameMixer;

  private readonly voices = new Map<number, FmVoice>();

  private readonly dcsgVoices = new Map<number, DcsgVoice>();

  private beepVoice: BeepVoice | null = null;

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

  /** 発音中 (リリース中含む) のボイス数 (FM + DCSG + BEEP の合計)。 */
  get activeVoiceCount(): number {
    return this.voices.size + this.dcsgVoices.size + (this.beepVoice !== null ? 1 : 0);
  }

  /** 指定ノートのボイスが存在するか (試聴 UI 表示用)。 */
  hasVoice(midiNote: number): boolean {
    return this.voices.has(midiNote) || this.dcsgVoices.has(midiNote) || this.beepVoice?.midiNote === midiNote;
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
    if (this.activeVoiceCount === 0) {
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

  /** 発音中の全ボイスへキーオフを行う (FM RR 減衰 / @VE リリースを再生してから自動解放)。 */
  releaseAllNotes(): void {
    for (const midiNote of [...this.voices.keys()]) {
      this.fmNoteOff(midiNote);
    }

    for (const midiNote of [...this.dcsgVoices.keys()]) {
      this.dcsgNoteOff(midiNote);
    }
  }

  /** 全ボイスを即時停止する (PANIC 相当。TL 127 で確実に無音化)。 */
  allNotesOff(): void {
    for (const midiNote of [...this.voices.keys()]) {
      this.terminateVoice(midiNote);
    }

    for (const midiNote of [...this.dcsgVoices.keys()]) {
      this.terminateDcsgVoice(midiNote);
    }

    this.terminateBeepVoice();
  }

  // -------------------------------------------------- PSG / ノイズ / BEEP (Phase B)

  /** PSG ノートオン (トーン周期レジスタ直書き / @IN 統合はノイズ ch へ発音切替)。 */
  psgNoteOn(midiNote: number, options: KeyboardPsgNoteOptions): void {
    // リトリガー時は既存の同音を即時停止させる (MML 演奏のリトリガーと同一挙動)
    this.terminateDcsgVoice(midiNote);

    const integrateMode = options.noiseIntegrate ?? 0;
    const kind: DcsgVoiceKind = integrateMode === 1 || integrateMode === 2 ? 'integrate' : 'tone';
    const slots = this.allocateDcsgSlots(kind);

    const volume = Math.min(Math.max(options.volume ?? 15, 0), 15);
    const volEnvValues = options.volEnv && options.volEnv.length > 0 ? options.volEnv : null;
    const voice: DcsgVoice = {
      midiNote,
      kind,
      slots: slots.slots,
      chipIndex: slots.chipIndex,
      channel: kind === 'tone' ? slots.channel : 3,
      age: this.nextAge++,
      basePeriod: DcsgChip.tonePeriodForFrequency(midiNoteFrequency(midiNote)),
      volume,
      volEnvValues,
      volEnv: volEnvValues
        ? new VolumeEnvelopePlayback(volEnvValues, optionalIndex(options.volEnvLoop), optionalIndex(options.volEnvRelease))
        : null,
      pitchEnv: options.pitchEnv && options.pitchEnv.length > 0 ? options.pitchEnv : null,
      pitchEnvLoop: options.pitchEnvLoop ?? 0,
      pitchEnvPos: 0,
      pitchEnvValue: 0,
      detune: options.detune ?? 0,
      released: false,
      releaseRemainingFrames: 0,
    };
    this.dcsgVoices.set(midiNote, voice);

    if (kind === 'integrate') {
      // 統合開始: 波形はモード値 (1 = periodic / 2 = white)、クロックは tone2 連動 (rate 3)
      // (TrackSequencer.applyNoiseIntegrate と同一経路)
      this.dcsgChip(slots.chipIndex).setNoiseControl(integrateMode === 2, 3);
    }

    this.applyDcsgPitch(voice);
    // ノート開始時の減衰は音量直送 (TrackSequencer.startNote と同一。env[0] は最初の tick で反映)
    const chip = this.dcsgChip(slots.chipIndex);
    if (kind === 'integrate') {
      chip.setAttenuation(3, 15 - volume);
      chip.setAttenuation(2, 15); // トーン 3 自体は無音化
    } else {
      chip.setAttenuation(voice.channel, 15 - volume);
    }
  }

  /** ノイズ ノートオン (音名 3 段階の分周レートヒント + 波形選択)。 */
  noiseNoteOn(midiNote: number, options: KeyboardNoiseNoteOptions): void {
    this.terminateDcsgVoice(midiNote);

    const slots = this.allocateDcsgSlots('noise');
    const volume = Math.min(Math.max(options.volume ?? 15, 0), 15);
    const volEnvValues = options.volEnv && options.volEnv.length > 0 ? options.volEnv : null;
    const voice: DcsgVoice = {
      midiNote,
      kind: 'noise',
      slots: slots.slots,
      chipIndex: slots.chipIndex,
      channel: 3,
      age: this.nextAge++,
      basePeriod: 0,
      volume,
      volEnvValues,
      volEnv: volEnvValues
        ? new VolumeEnvelopePlayback(volEnvValues, optionalIndex(options.volEnvLoop), optionalIndex(options.volEnvRelease))
        : null,
      pitchEnv: null,
      pitchEnvLoop: 0,
      pitchEnvPos: 0,
      pitchEnvValue: 0,
      detune: 0,
      released: false,
      releaseRemainingFrames: 0,
    };
    this.dcsgVoices.set(midiNote, voice);

    // 音名 3 段階の分周ヒント (c〜d# = 低 / e〜f# = 中 / g〜b = 高・TrackSequencer と同一規約)
    this.dcsgChip(slots.chipIndex).setNoiseControl(options.noiseType !== 'periodic', DcsgChip.noiseRateForNote(midiNote));
    this.dcsgChip(slots.chipIndex).setAttenuation(3, 15 - volume);
  }

  /** BEEP ノートオン (8253 カウンタ直書き + ゲートオン。同時 1 音・再発音は上書き)。 */
  beepNoteOn(midiNote: number, options: KeyboardBeepNoteOptions): void {
    this.terminateBeepVoice();

    const freq = midiNoteFrequency(midiNote);
    this.beepVoice = {
      midiNote,
      baseCounter: Math.min(Math.max(Math.round(BeepChip.ClockHz / freq), 1), 65535),
      pitchEnv: options.pitchEnv && options.pitchEnv.length > 0 ? options.pitchEnv : null,
      pitchEnvLoop: options.pitchEnvLoop ?? 0,
      pitchEnvPos: 0,
      pitchEnvValue: 0,
    };

    this.applyBeepPitch(this.beepVoice);
    this.mixer.chips.beep.setGate(true);
  }

  /**
   * PSG / ノイズ / BEEP ノートオフ。
   * @VE リリース定義がある場合はリリース区間を再生してから自動解放、無ければ即時消音
   * (TrackSequencer.keyOff と同一挙動)。
   */
  dcsgNoteOff(midiNote: number): void {
    const voice = this.dcsgVoices.get(midiNote);
    if (voice && !voice.released) {
      if (voice.volEnv !== null && voice.volEnv.beginRelease()) {
        voice.released = true;
        voice.releaseRemainingFrames = voice.volEnv.releaseLengthFrames + DcsgReleaseMarginFrames;
        this.writeDcsgAttenuation(voice); // リリース先頭値を即時反映
        return;
      }

      this.terminateDcsgVoice(midiNote);
    }

    if (this.beepVoice?.midiNote === midiNote) {
      this.terminateBeepVoice();
    }
  }

  /** 指定ノートの発音を全エンジンで即時停止する (エディタ試聴の STOP 用・リリースは再生しない)。 */
  stopNote(midiNote: number): void {
    this.terminateVoice(midiNote);
    this.terminateDcsgVoice(midiNote);
    if (this.beepVoice?.midiNote === midiNote) {
      this.terminateBeepVoice();
    }
  }

  /** chipIndex (0 = psg1 / 1 = psg2) から DCSG チップを取り出す。 */
  private dcsgChip(chipIndex: number): DcsgChip {
    return chipIndex === 0 ? this.mixer.chips.psg1 : this.mixer.chips.psg2;
  }

  /**
   * DCSG チャンネルスロットを割り当てる (実機音声数制限: トーン 6 / ノイズ 2 / @IN 統合 2)。
   * 全スロット使用中はリリース中→最古のボイスを steal する。
   */
  private allocateDcsgSlots(kind: DcsgVoiceKind): { chipIndex: number; channel: number; slots: number[] } {
    // 候補: tone = 各 PSG の ch0-2 / noise = 各 PSG の ch3 / integrate = PSG ごとの (ch2, ch3) ペア
    const candidates: number[][] = kind === 'noise'
      ? [[3], [7]]
      : kind === 'integrate'
        ? [[2, 3], [6, 7]]
        : [[0], [1], [2], [4], [5], [6]];

    const occupied = () => {
      const slots = new Set<number>();
      for (const voice of this.dcsgVoices.values()) {
        for (const slot of voice.slots) {
          slots.add(slot);
        }
      }
      return slots;
    };
    let used = occupied();

    let free = candidates.find((slots) => slots.every((slot) => !used.has(slot)));
    while (free === undefined) {
      // 全候補が使用中: リリース中を優先し、次に最古のボイスを steal する
      let victim: DcsgVoice | null = null;
      for (const voice of this.dcsgVoices.values()) {
        if (victim === null || stealRank(voice) < stealRank(victim)) {
          victim = voice;
        }
      }

      this.terminateDcsgVoice(victim!.midiNote);
      used = occupied();
      free = candidates.find((slots) => slots.every((slot) => !used.has(slot)));
    }

    const slot = free[0];
    return { chipIndex: slot < 4 ? 0 : 1, channel: slot % 4, slots: free };
  }

  /** DCSG ボイスを即時終了する (減衰 15 で無音化 + 登録解除)。 */
  private terminateDcsgVoice(midiNote: number): void {
    const voice = this.dcsgVoices.get(midiNote);
    if (!voice) {
      return;
    }

    this.dcsgVoices.delete(midiNote);
    this.writeDcsgAttenuation(voice, 15);
  }

  /** BEEP ボイスを即時終了する (ゲートオフ + 登録解除)。 */
  private terminateBeepVoice(): void {
    if (this.beepVoice === null) {
      return;
    }

    this.beepVoice = null;
    this.mixer.chips.beep.setGate(false);
  }

  /** ボイスの現在音量を減衰レジスタへ書き込む (attenuation 指定時はそれを優先)。 */
  private writeDcsgAttenuation(voice: DcsgVoice, forced?: number): void {
    const attenuation = forced
      ?? (voice.volEnv !== null && voice.volEnvValues !== null
        ? 15 - Math.min(Math.max(voice.volEnvValues[voice.volEnv.currentIndex()] ?? 0, 0), 15)
        : 15 - voice.volume);

    const chip = this.dcsgChip(voice.chipIndex);
    if (voice.kind === 'integrate') {
      // 統合中: 発音はノイズチャンネルへ切り替わり、トーン 3 自体は無音化する
      chip.setAttenuation(3, attenuation);
      chip.setAttenuation(2, 15);
    } else {
      chip.setAttenuation(voice.channel, attenuation);
    }
  }

  /** DCSG ボイスの現在ピッチをトーン周期レジスタへ書き込む (tone / integrate のみ)。 */
  private applyDcsgPitch(voice: DcsgVoice): void {
    if (voice.kind === 'noise') {
      return; // ノイズは分周レート固定 (ハードウェア仕様)
    }

    // トーン周期: pitchUp (レジスタ差分) の増加 = 音程上昇 = period 減少 (ドライバと同一式)
    const period = Math.min(Math.max(voice.basePeriod - (voice.detune + voice.pitchEnvValue), 0), 1023);
    this.dcsgChip(voice.chipIndex).setTonePeriod(voice.kind === 'integrate' ? 2 : voice.channel, period);
  }

  /** BEEP ボイスの現在ピッチを 8253 カウンタへ書き込む (カウンタ増加 = 音程下降)。 */
  private applyBeepPitch(voice: BeepVoice): void {
    const counter = Math.min(Math.max(voice.baseCounter + voice.pitchEnvValue, 1), 65535);
    this.mixer.chips.beep.setCounter(counter);
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

  /** 60Hz フレーム進行 (@VE / @EP 進行 + レジスタ更新 + リリース完了ボイスの解放)。 */
  private tickVoices(): void {
    // FM: @EP 進行 + KC/KF 更新 + RR 減衰完了の ch 解放
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

    // DCSG: @VE 進行 (減衰レジスタ) + @EP 進行 (トーン周期) + リリース完了の ch 解放
    for (const voice of [...this.dcsgVoices.values()]) {
      if (voice.released) {
        this.writeDcsgAttenuation(voice);
        voice.volEnv?.advance();
        voice.releaseRemainingFrames--;
        if (voice.releaseRemainingFrames <= 0) {
          this.terminateDcsgVoice(voice.midiNote); // リリース終了 = 減衰 15 で無音化して解放
        }
        continue;
      }

      this.writeDcsgAttenuation(voice);
      voice.volEnv?.advance();
      this.advancePitchEnv(voice);
      this.applyDcsgPitch(voice);
    }

    // BEEP: @EP 進行 (8253 カウンタ)
    if (this.beepVoice !== null) {
      this.advancePitchEnv(this.beepVoice);
      this.applyBeepPitch(this.beepVoice);
    }
  }

  /** ピッチエンベロープを 1 フレーム進める (TrackSequencer.applyPitchEnvFrame と同一挙動)。 */
  private advancePitchEnv(voice: FmVoice | DcsgVoice | BeepVoice): void {
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

