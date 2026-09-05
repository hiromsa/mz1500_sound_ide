/**
 * 1 トラック分の演奏状態機械。MZSD 命令列を解釈し、DCSG / BEEP / FM へレジスタ書き込みを行う。
 * 時間はすべてフレーム (1/60 秒) 基準。呼び出し側 (MzsdSequencer) が 60Hz で tick を呼ぶ。
 * (移植元: MzSound.Player/Sequencer/TrackSequencer.cs)
 */
import { BeepChip } from '../chips/BeepChip';
import { ChipBank } from '../chips/ChipBank';
import { DcsgChip } from '../chips/DcsgChip';
import type { FmToneDef, MzsdSong } from './MzsdSong';
import { MzsdOp, readInt16, readUInt16 } from './MzsdSong';

/** DCSG チャンネル割り当て (チップ + チャンネル番号)。 */
interface DcsgAssignment {
  readonly chip: DcsgChip;

  readonly channel: number;
}

export class TrackSequencer {
  private static readonly maxLoopDepth = 8;

  /** MIDI ノート 60 (C4) に対応する OPM オクターブ。 */
  private static readonly fmC4Octave = 4;

  /** ピッチ内部値の 1 セミトーン (= KC/KF 展開の分解能)。 */
  private static readonly fmPitchUnit = 64;

  /** OPM ノートコード (C=0, C#=1, D=2, D#=4, E=5, F=6, F#=8, G=9, G#=10, A=12, A#=13, B=14)。 */
  private static readonly fmNoteCodes = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];

  /** トラック番号 → DCSG チャンネル対応 (0-2 = tone、3 = noise)。 */
  private static resolveDcsg(trackIndex: number, chips: ChipBank): DcsgAssignment | null {
    if (trackIndex <= 3) {
      return { chip: chips.psg1, channel: trackIndex }; // P1-P3 + N1
    }

    if (trackIndex <= 7) {
      return { chip: chips.psg2, channel: trackIndex - 4 }; // P4-P6 + N2
    }

    return null;
  }

  private readonly song: MzsdSong;

  private readonly chips: ChipBank;

  private readonly trackIndexValue: number;

  private readonly dcsg: DcsgAssignment | null;

  private readonly isBeep: boolean;

  private readonly isFm: boolean;

  private readonly isNoise: boolean;

  private readonly fmChannel: number;

  private readonly loopPositions = new Array<number>(TrackSequencer.maxLoopDepth).fill(0);

  private readonly loopRemaining = new Array<number>(TrackSequencer.maxLoopDepth).fill(0);

  private loopDepth = 0;

  private pointer = 0;

  private lenRemaining = 0;

  private gateRemaining = 0;

  private noteOn = false;

  private ended = false;

  private volume = 15; // MML 音量 (0-15、15 = 最大)

  private attenuation = 0; // レジスタ減衰量 = 15 - 音量 (エンベロープ適用時はその値)

  private transpose = 0;

  private detune = 0;

  private sweep = 0;

  private noiseFlags = 0;

  private venvIndex = -1;

  private venvPos = 0;

  private venvReleasing = false;

  private penvIndex = -1;

  private penvPos = 0;

  private penvValue = 0;

  private basePeriod = 0; // P トラック: ノートから計算した DCSG period

  private baseCounter = 0; // B トラック: ノートから計算した 8253 counter

  private basePitch = 0; // F トラック: ノートから計算したピッチ内部値 (1 semitone = 64)

  private sweepElapsed = 0;

  private fmToneIndex = -1;

  /** 非連動ノイズの分周ヒント (直近のノート周波数から算出)。 */
  private noiseRateHint = 0;

  constructor(song: MzsdSong, trackIndex: number, chips: ChipBank) {
    this.song = song;
    this.chips = chips;
    this.trackIndexValue = trackIndex;
    this.dcsg = TrackSequencer.resolveDcsg(trackIndex, chips);
    this.isBeep = trackIndex === 8;
    this.isFm = trackIndex >= 9;
    this.isNoise = trackIndex === 3 || trackIndex === 7;
    this.fmChannel = trackIndex - 9;
  }

  get trackIndex(): number {
    return this.trackIndexValue;
  }

  /** 現在のデータポインタ (演奏位置ハイライト用)。 */
  get currentOffset(): number {
    return this.pointer;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /** 演奏を開始オフセットへ戻す (L ループ復帰 / 先頭リセット)。 */
  reset(startOffset: number): void {
    this.pointer = startOffset;
    this.lenRemaining = 0;
    this.gateRemaining = 0;
    this.noteOn = false;
    this.loopDepth = 0;
    this.sweepElapsed = 0;
    this.venvReleasing = false;
    this.ended = startOffset <= 0;
    this.keyOff();
  }

  /** 1 フレーム分進める。 */
  tick(): void {
    if (this.ended) {
      return;
    }

    // 残り時間が無ければ、次の NOTE/REST に到達するまで制御命令を実行する
    if (this.lenRemaining <= 0) {
      while (this.lenRemaining <= 0 && !this.ended) {
        this.executeNext();
      }

      if (this.ended) {
        return;
      }
    }

    this.lenRemaining--;

    if (this.noteOn && this.gateRemaining > 0) {
      this.gateRemaining--;
      if (this.gateRemaining === 0) {
        this.keyOff();
      }
    }

    this.applyVolumeFrame();
    this.applyPitchEnvFrame();
    this.applyPitchFrame();
  }

  /** ノート番号 (セミトーン絶対値、A4=69) → 周波数。 */
  private static noteFrequency(note: number): number {
    const clamped = Math.min(Math.max(note, 0), 127);
    return 440.0 * Math.pow(2.0, (clamped - 69) / 12.0);
  }

  /** 周波数 → DCSG トーン period (0-1023)。 */
  private periodFor(frequency: number): number {
    const period = Math.round(DcsgChip.ClockHz / 32.0 / Math.max(1.0, frequency)) - 1;
    return Math.min(Math.max(period, 0), 1023);
  }

  private executeNext(): void {
    const data = this.song.data;
    const op = data[this.pointer++];

    switch (op) {
      case MzsdOp.Note: {
        const note = data[this.pointer++];
        const len = readUInt16(data, this.pointer);
        this.pointer += 2;
        const gate = readUInt16(data, this.pointer);
        this.pointer += 2;
        this.lenRemaining = Math.max(1, len);
        this.gateRemaining = Math.min(Math.max(gate, 0), len);
        this.startNote(note);
        break;
      }

      case MzsdOp.Rest: {
        const len = readUInt16(data, this.pointer);
        this.pointer += 2;
        this.lenRemaining = Math.max(1, len);
        this.keyOff();
        break;
      }

      case MzsdOp.Tempo:
        // 時間はすべてフレーム数で格納済みのため演奏への影響なし (実機ドライバとの互換用)
        this.pointer += 2;
        break;

      case MzsdOp.Volume:
        this.volume = Math.min(Math.max(data[this.pointer++], 0), 15);
        this.venvIndex = -1;
        this.attenuation = 15 - this.volume;
        this.writeAttenuation();
        break;

      case MzsdOp.Venv: {
        const id = data[this.pointer++];
        if (id === 0xff || this.song.volumeEnvelopes.length === 0) {
          this.venvIndex = -1;
          this.venvReleasing = false;
          this.attenuation = 15 - this.volume;
          this.writeAttenuation();
        } else {
          this.venvIndex = Math.min(id, this.song.volumeEnvelopes.length - 1);
          this.venvPos = 0;
          this.venvReleasing = false;
        }

        break;
      }

      case MzsdOp.Penv: {
        const id = data[this.pointer++];
        this.penvIndex =
          id === 0xff || this.song.pitchEnvelopes.length === 0
            ? -1
            : Math.min(id, this.song.pitchEnvelopes.length - 1);
        this.penvPos = 0;
        this.penvValue = 0;
        break;
      }

      case MzsdOp.Sweep:
        this.sweep = toSignedByte(data[this.pointer++]);
        break;

      case MzsdOp.Detune:
        this.detune = readInt16(data, this.pointer);
        this.pointer += 2;
        break;

      case MzsdOp.Transpose:
        this.transpose = toSignedByte(data[this.pointer++]);
        break;

      case MzsdOp.Tone:
        // FM 音色選択: レジスタへ適用する
        this.fmToneIndex = data[this.pointer++];
        if (this.isFm && this.fmToneIndex >= 0 && this.fmToneIndex < this.song.fmTones.length) {
          this.applyFmTone(this.song.fmTones[this.fmToneIndex]);
        }

        break;

      case MzsdOp.NoiseCtl:
        this.noiseFlags = data[this.pointer++];
        if (this.isNoise) {
          this.applyNoiseMode();
        }

        break;

      case MzsdOp.LoopStart:
        if (this.loopDepth < TrackSequencer.maxLoopDepth) {
          this.loopPositions[this.loopDepth] = this.pointer;
          this.loopRemaining[this.loopDepth] = -1;
          this.loopDepth++;
        }

        break;

      case MzsdOp.LoopEnd: {
        const count = data[this.pointer++];
        if (this.loopDepth > 0) {
          const depth = this.loopDepth - 1;
          if (this.loopRemaining[depth] < 0) {
            this.loopRemaining[depth] = count;
          }

          this.loopRemaining[depth]--;
          if (this.loopRemaining[depth] > 0) {
            this.pointer = this.loopPositions[depth];
          } else {
            this.loopDepth = depth;
          }
        }

        break;
      }

      case MzsdOp.TrackEnd:
        this.ended = true;
        this.keyOff();
        break;

      default:
        // 不明命令はデータ破損の可能性が高いためトラックを停止する
        this.ended = true;
        this.keyOff();
        break;
    }
  }

  private startNote(note: number): void {
    this.noteOn = true;
    this.sweepElapsed = 0;
    this.attenuation = 15 - this.volume;
    if (this.venvIndex >= 0) {
      this.venvPos = 0;
      this.venvReleasing = false;
    }

    if (this.penvIndex >= 0) {
      this.penvPos = 0;
    }

    const freq = TrackSequencer.noteFrequency(note + this.transpose);

    if (this.isBeep) {
      this.baseCounter = Math.min(Math.max(Math.round(BeepChip.ClockHz / freq), 1), 65535);
      this.applyPitchFrame();
    } else if (this.isFm) {
      // FM: ピッチ内部値 (C4 = 0、1 semitone = 64) を基準に KC/KF へ展開する
      this.basePitch = (note + this.transpose - 60) * TrackSequencer.fmPitchUnit;
      this.applyPitchFrame();
      this.writeAttenuation();

      // Key On (4 オペレータすべて): $08 = slot bits (bit3-6) + channel (bit0-2)
      this.chips.fm.setReg(0x08, 0x78 | this.fmChannel);
    } else if (this.isNoise) {
      // ノイズの音程 → 非連動時の分周ヒント (低域ほど粗い分周)
      this.noiseRateHint = freq < 40000 ? 2 : freq < 80000 ? 1 : 0;
      this.applyNoiseMode();
      if (this.dcsg !== null && ((this.noiseFlags >> 1) & 0x3) !== 0) {
        // 同期ノイズ: 同一 PSG の tone2 レジスタへ音程を書く (実機の結線に準拠)
        this.dcsg.chip.setTonePeriod(2, this.periodFor(freq));
      }
    } else if (this.dcsg !== null) {
      this.basePeriod = this.periodFor(freq);
      this.applyPitchFrame();
    }

    this.writeAttenuation();
  }

  /** ノイズ波形 / 連動モードをレジスタへ反映する。 */
  private applyNoiseMode(): void {
    if (this.dcsg === null) {
      return;
    }

    const white = (this.noiseFlags & 1) !== 0;
    const sync = (this.noiseFlags >> 1) & 0x3;
    this.dcsg.chip.setNoiseControl(white, sync !== 0 ? 3 : this.noiseRateHint);
  }

  /** スイープ / ピッチエンベロープ / ディチューンを反映してレジスタへ書き込む。 */
  private applyPitchFrame(): void {
    if (!this.noteOn) {
      return;
    }

    // 単位は「レジスタ値の差分、+ = 音程上昇」(mml_envelope_spec.md §6)
    const pitchUp = this.detune + this.penvValue + this.sweep * this.sweepElapsed;

    if (this.isBeep) {
      // BEEP はカウンタ値へ直接加算 (カウンタ増加 = 音程下降)
      this.chips.beep.setCounter(Math.min(Math.max(this.baseCounter + pitchUp, 1), 65535));
    } else if (this.isFm) {
      // FM: ピッチ内部値 (12bit 相当) → KC / KF へ展開
      const total = this.basePitch + pitchUp;
      const semitones = Math.floor(total / TrackSequencer.fmPitchUnit);
      let fraction = total - semitones * TrackSequencer.fmPitchUnit;
      let octave = TrackSequencer.fmC4Octave + Math.floor(semitones / 12);
      let noteIndex = semitones - (octave - TrackSequencer.fmC4Octave) * 12;

      if (octave < 0) {
        octave = 0;
        noteIndex = 0;
        fraction = 0;
      } else if (octave > 7) {
        octave = 7;
        noteIndex = 11;
        fraction = TrackSequencer.fmPitchUnit - 1;
      }

      const kc = (octave << 4) | TrackSequencer.fmNoteCodes[noteIndex];
      this.chips.fm.setReg(0x28 + this.fmChannel, kc);
      this.chips.fm.setReg(0x30 + this.fmChannel, fraction);
    } else if (this.dcsg !== null && !this.isNoise) {
      this.dcsg.chip.setTonePeriod(
        this.dcsg.channel,
        Math.min(Math.max(this.basePeriod - pitchUp, 0), 1023),
      );
    }

    this.sweepElapsed++;
  }

  /** @FM 音色パラメータ (46 個) を OPM レジスタへ展開する。 */
  private applyFmTone(tone: FmToneDef): void {
    const ch = this.fmChannel;
    const p = tone.parameters;

    // RL/RR (PAN: 両チャンネル出力) / FB / ALG
    this.chips.fm.setReg(0x20 + ch, (3 << 6) | ((p[1] & 7) << 3) | (p[0] & 7));

    for (let op = 0; op < 4; op++) {
      const o = 2 + op * 11; // AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME
      this.chips.fm.setReg(0x40 + (op << 3) + ch, ((p[o + 10] & 1) << 7) | ((p[o + 8] & 7) << 4) | (p[o + 7] & 15));
      this.chips.fm.setReg(0x60 + (op << 3) + ch, p[o + 5] & 127); // TL 基準値 (音量で上書き)
      this.chips.fm.setReg(0x80 + (op << 3) + ch, ((p[o + 6] & 3) << 6) | (p[o + 0] & 31));
      this.chips.fm.setReg(0xa0 + (op << 3) + ch, p[o + 1] & 31);
      this.chips.fm.setReg(0xc0 + (op << 3) + ch, ((p[o + 9] & 3) << 6) | (p[o + 2] & 31));
      this.chips.fm.setReg(0xe0 + (op << 3) + ch, ((p[o + 4] & 15) << 4) | (p[o + 3] & 15));
    }
  }

  /** 音量エンベロープを 1 フレーム進め、減衰量へ反映する。 */
  private applyVolumeFrame(): void {
    if (this.venvIndex < 0) {
      return;
    }

    const env = this.song.volumeEnvelopes[this.venvIndex];
    if (env.values.length === 0) {
      this.attenuation = 15;
      this.writeAttenuation();
      return;
    }

    this.attenuation = 15 - env.values[Math.min(this.venvPos, env.values.length - 1)];

    if (this.venvReleasing) {
      // リリース中はループせず末尾でホールド
      if (this.venvPos < env.values.length - 1) {
        this.venvPos++;
      }
    } else if (this.noteOn) {
      if (this.venvPos >= env.values.length - 1) {
        if (env.loopIndex < env.values.length) {
          this.venvPos = env.loopIndex;
        }
      } else {
        this.venvPos++;
      }
    }

    this.writeAttenuation();
  }

  /** ピッチエンベロープを 1 フレーム進める。 */
  private applyPitchEnvFrame(): void {
    if (this.penvIndex < 0) {
      this.penvValue = 0;
      return;
    }

    const env = this.song.pitchEnvelopes[this.penvIndex];
    if (env.values.length === 0) {
      this.penvValue = 0;
      return;
    }

    this.penvValue = env.values[Math.min(this.penvPos, env.values.length - 1)];

    if (this.penvPos >= env.values.length - 1) {
      if (env.loopIndex < env.values.length) {
        this.penvPos = env.loopIndex;
      }
    } else {
      this.penvPos++;
    }
  }

  /** ゲート終端 / 休符 / トラック終了時のキーオフ。 */
  private keyOff(): void {
    this.noteOn = false;
    this.sweepElapsed = 0;

    if (this.isFm) {
      // Key Off: slot bits を 0 にしたチャンネル指定
      this.chips.fm.setReg(0x08, this.fmChannel);
    }

    if (this.venvIndex >= 0) {
      const env = this.song.volumeEnvelopes[this.venvIndex];
      if (env.releaseIndex < env.values.length) {
        this.venvReleasing = true;
        this.venvPos = env.releaseIndex;
        this.attenuation = 15 - env.values[this.venvPos];
      } else {
        this.venvReleasing = false;
        this.attenuation = 15;
      }
    } else {
      this.attenuation = 15;
    }

    this.writeAttenuation();
  }

  private writeAttenuation(): void {
    if (this.isBeep) {
      this.chips.beep.setGate(this.attenuation < 15);
    } else if (this.isFm) {
      // v0-15 → TL = (15 - v) × 8。フェーダー音量は TL トリムとして追加
      const tl = Math.min(Math.max(this.attenuation * 8 + this.chips.getFmTrim(this.fmChannel), 0), 127);
      for (let op = 0; op < 4; op++) {
        this.chips.fm.setReg(0x60 + (op << 3) + this.fmChannel, tl);
      }
    } else if (this.dcsg !== null) {
      this.dcsg.chip.setAttenuation(this.dcsg.channel, this.attenuation);
    }
  }
}

/** C# の (sbyte) キャスト相当 (0-255 → -128-127)。 */
function toSignedByte(value: number): number {
  return (value << 24) >> 24;
}
