/**
 * 仮想キーボード / 各エディタ試聴の発音ファサード。
 * Phase A/B 音源統一により、全エンジン (FM / PSG / ノイズ / BEEP) の合成は
 * KeyboardSoundEngine (MML 演奏と同一のチップエミュレーション) へ委譲される。
 * 本モジュールは既存 UI との接続 API (noteOn / noteOff / allNotesOff / releaseAllNotes /
 * setMasterVolume) と共有ユーティリティの再エクスポートを担う。
 */
import { type FmToneData } from '../core/fm/FmTone';
import { KeyboardSoundEngine } from '../core/keyboard/KeyboardSoundEngine';
import { KeyboardAudioOutput } from '../core/keyboard/KeyboardAudioOutput';
import type { PsgOutputPlacement } from '../core/player/AudioFrameMixer';

export { sustainEnvelopeIndex, VolumeEnvelopePlayback } from '../core/keyboard/VolumeEnvelopePlayback';

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
  detune?: number; // デチューン値 (MML D コマンド相当・レジスタ差分単位)
  noiseType?: 'periodic' | 'white'; // ノイズ種別
  /** ノイズ統合モード (MML @IN コマンド相当、PSG エンジン専用)。0 = 統合なし / 1 = 周期ノイズ連動 / 2 = ホワイトノイズ連動。 */
  noiseIntegrate?: 0 | 1 | 2;
  /** PSG / ノイズ発音先の DCSG チップ (0 = PSG1 = 左 / 1 = PSG2 = 右)。未指定時は空きスロットへ自動割当。 */
  psgChip?: 0 | 1;
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
  /**
   * チップ駆動サウンドエンジン (FM / PSG / ノイズ / BEEP)。
   * MML 演奏と同一の ChipBank + レジスタ経路で発音するため「鍵盤の音 = 本番の音」になる。
   */
  private readonly keyboardEngine = new KeyboardSoundEngine();

  private readonly keyboardOutput: KeyboardAudioOutput;

  constructor() {
    this.keyboardOutput = new KeyboardAudioOutput(this.keyboardEngine, this.keyboardEngine.mixer.sampleRate);
  }

  /**
   * マスター音量を設定する (0-1)。
   * TRACK MONITOR の MASTER VOL から呼ばれ、仮想キーボードの発音音量を制御する
   * (知覚カーブ 2 乗 = Player と共有)。発音中のボイスへも即時反映される。
   */
  public setMasterVolume(volume: number): void {
    this.keyboardEngine.setMasterVolume(volume);
  }

  /**
   * DCSG チップの出力定位を設定する (仮想キーボードの定位表示・ENV 試聴の中央配置用)。
   * 既定 = 実機配線どおり chip0 = 左 / chip1 = 右。
   */
  public setPsgOutputPlacement(chipIndex: 0 | 1, placement: PsgOutputPlacement): void {
    this.keyboardEngine.setPsgOutputPlacement(chipIndex, placement);
  }

  /** 発音中 (リリース中含む) のノート数 (デバッグ / テスト用)。 */
  public get activeVoiceCount(): number {
    return this.keyboardEngine.activeVoiceCount;
  }

  // ノートON (エンジン種別に応じて KeyboardSoundEngine へ委譲)
  public noteOn(midiNote: number, options: SynthPlayOptions) {
    this.dispatchNoteOn(midiNote, options);
  }

  /**
   * 単音ノートON (仮想キーボード用)。
   * 既存の全発音を即時停止 (リリースを打ち切り) してから新ノートを発音するため、
   * 常に 1 音のみ鳴る (モノフォニック)。
   */
  public noteOnMonophonic(midiNote: number, options: SynthPlayOptions) {
    this.keyboardEngine.allNotesOff();
    this.dispatchNoteOn(midiNote, options);
  }

  /** 発音の共通経路 (オーディオ出力の起動 + エンジン種別ディスパッチ)。 */
  private dispatchNoteOn(midiNote: number, options: SynthPlayOptions) {
    void this.keyboardOutput.ensureStarted();

    switch (options.engine) {
      case 'fm':
        this.keyboardEngine.fmNoteOn(midiNote, {
          fmTone: options.fmTone,
          volume: options.volume,
          detune: options.detune ?? 0,
          pitchEnv: options.pitchEnv,
          pitchEnvLoop: options.pitchEnvLoop,
          opMuted: options.fmOpMuted,
        });
        break;
      case 'psg':
        this.keyboardEngine.psgNoteOn(midiNote, {
          volume: options.volume,
          detune: options.detune ?? 0,
          pitchEnv: options.pitchEnv,
          pitchEnvLoop: options.pitchEnvLoop,
          volEnv: options.volEnv,
          volEnvLoop: options.volEnvLoop,
          volEnvRelease: options.volEnvRelease,
          noiseIntegrate: options.noiseIntegrate,
          chip: options.psgChip,
        });
        break;
      case 'noise':
        this.keyboardEngine.noiseNoteOn(midiNote, {
          volume: options.volume,
          noiseType: options.noiseType,
          volEnv: options.volEnv,
          volEnvLoop: options.volEnvLoop,
          volEnvRelease: options.volEnvRelease,
          chip: options.psgChip,
        });
        break;
      case 'beep':
        this.keyboardEngine.beepNoteOn(midiNote, {
          pitchEnv: options.pitchEnv,
          pitchEnvLoop: options.pitchEnvLoop,
        });
        break;
    }
  }

  // ノートOFF (@VE リリース / FM RR 減衰を再生してから自動解放)
  public noteOff(midiNote: number) {
    this.keyboardEngine.fmNoteOff(midiNote);
    this.keyboardEngine.dcsgNoteOff(midiNote);
  }

  /** 指定ノートの発音を即時停止する (リリースは再生しない。エディタ試聴の STOP 用)。 */
  public stopNote(midiNote: number) {
    this.keyboardEngine.stopNote(midiNote);
  }

  // 全ノート停止 (PANIC 相当)
  public allNotesOff() {
    this.keyboardEngine.allNotesOff();
  }

  /**
   * 発音中の全ノートへキーオフを行う (@VE リリース / FM RR 減衰を再生してから自動停止)。
   * マウスドラッグ終了時など「鍵盤を離す」操作用。
   * リリース定義のない音のみ即時停止する (PANIC などの即時停止は allNotesOff を使用)。
   */
  public releaseAllNotes() {
    this.keyboardEngine.releaseAllNotes();
  }
}

// シングルトンインスタンス
export const virtualSynth = new VirtualSynthEngine();
