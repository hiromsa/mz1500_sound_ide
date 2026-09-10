/**
 * FramePlaybackWorklet (AudioWorkletProcessor ソース文字列) の挙動テスト。
 * ソースを Function コンストラクタでスタブ環境へ評価し、process() を直接駆動する。
 * 特にアンダーラン時のフェードアウト / 供給回復時のフェードイン (デクリック) と、
 * メインスレッドへのバッファ残量報告タイミングを検証する。
 */
import { describe, expect, it } from 'vitest';
import { FramePlaybackWorkletSource } from '../FramePlaybackWorklet';

/** process() 駆動に必要なプロセッサ表面 (ソースは vanilla JS のため構造で受ける)。 */
interface WorkletProcessorStub {
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postedMessages: unknown[];
  };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}

/** worklet ソースをスタブ環境へロードし、登録されたプロセッサクラスを返す。 */
function loadProcessorClass(): new () => WorkletProcessorStub {
  const registered = new Map<string, new () => WorkletProcessorStub>();

  class StubAudioWorkletProcessor {
    readonly port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postedMessages: [] as unknown[],
      postMessage(this: { postedMessages: unknown[] }, message: unknown): void {
        this.postedMessages.push(message);
      },
    };
  }

  const loader = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    FramePlaybackWorkletSource,
  ) as (
    processorCtor: unknown,
    register: (name: string, ctor: new () => WorkletProcessorStub) => void,
  ) => void;

  loader(StubAudioWorkletProcessor, (name, ctor) => registered.set(name, ctor));

  const processorClass = registered.get('mzsd-frame-playback');
  if (processorClass === undefined) {
    throw new Error('worklet ソースが mzsd-frame-playback を登録していません。');
  }
  return processorClass;
}

function createProcessor(): WorkletProcessorStub {
  return new (loadProcessorClass())();
}

/** process() へ渡す出力バッファ (ステレオ) を生成する。 */
function createOutput(frames: number): Float32Array[][] {
  return [[new Float32Array(frames), new Float32Array(frames)]];
}

/** 定数値のステレオ標本列 (ステレオインターリーブ) を生成する。 */
function stereoChunk(frames: number, left: number, right: number): Float32Array {
  const chunk = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    chunk[i * 2] = left;
    chunk[(i * 2) + 1] = right;
  }
  return chunk;
}

describe('FramePlaybackWorklet', () => {
  it('通常再生は供給された標本をゲイン 1 で出力する', () => {
    const processor = createProcessor();
    processor.port.onmessage?.({ data: stereoChunk(4, 0.5, -0.25) });

    const outputs = createOutput(4);
    expect(processor.process([], outputs)).toBe(true);

    const [left, right] = outputs[0];
    expect(left[0]).toBeCloseTo(0.5);
    expect(right[0]).toBeCloseTo(-0.25);
    expect(left[3]).toBeCloseTo(0.5);
    expect(right[3]).toBeCloseTo(-0.25);
  });

  it('アンダーラン時は直前レベルからフェードアウトし、即座に 0 へ落ちない', () => {
    const processor = createProcessor();
    processor.port.onmessage?.({ data: stereoChunk(4, 0.8, 0.8) });

    // 1 回目: 供給分 4 フレームを出力 (tail が 0.8 になる)
    const first = createOutput(4);
    processor.process([], first);
    expect(first[0][0][3]).toBeCloseTo(0.8);

    // 2 回目: 供給なし (アンダーラン)。直前レベルからの減衰が始まる
    const second = createOutput(128);
    processor.process([], second);
    const magnitude = Math.abs(second[0][0][0]);
    expect(magnitude).toBeGreaterThan(0); // 無音への急落 (クリック) ではない
    expect(magnitude).toBeLessThan(0.8);
    // フェードアウト完了後は無音
    expect(second[0][0][127]).toBe(0);
    expect(second[0][1][127]).toBe(0);
  });

  it('供給回復時はフェードインし、fadeFrames フレームで通常ゲインへ戻る', () => {
    const processor = createProcessor();
    // 先にアンダーランさせてフェードを 0 まで落とす
    processor.port.onmessage?.({ data: stereoChunk(4, 0.8, 0.8) });
    processor.process([], createOutput(4));
    processor.process([], createOutput(200));

    // 供給回復 (0.5 / -0.5 の定音)
    processor.port.onmessage?.({ data: stereoChunk(128, 0.5, -0.5) });
    const recovered = createOutput(128);
    processor.process([], recovered);

    expect(recovered[0][0][0]).toBe(0); // フェードイン開始
    expect(recovered[0][0][1]).toBeGreaterThan(0);
    expect(recovered[0][0][1]).toBeLessThan(0.5);
    expect(recovered[0][0][64]).toBeCloseTo(0.5); // 64 フレーム (≒1.3ms) で通常ゲイン
    expect(recovered[0][1][64]).toBeCloseTo(-0.5);
  });

  it('2 render quantum ごとにバッファ残量を報告する', () => {
    const processor = createProcessor();
    processor.port.onmessage?.({ data: stereoChunk(256, 0.5, 0.5) });

    processor.process([], createOutput(128)); // counter 1 → 報告なし
    processor.process([], createOutput(128)); // counter 2 → 報告あり

    const levelMessages = processor.port.postedMessages.filter(
      (message) => (message as { type?: string }).type === 'level',
    );
    expect(levelMessages).toHaveLength(1);

    const available = (levelMessages[0] as { availableSamples: number }).availableSamples;
    const supplied = 256 * 2; // 供給標本数 (ステレオ)
    const consumed = 128 * 2 * 2; // 2 quantum 分の消費標本数
    expect(available).toBe(supplied - consumed);
  });

  it('clear でリングとフェード状態がリセットされ即時無音になる', () => {
    const processor = createProcessor();
    processor.port.onmessage?.({ data: stereoChunk(64, 0.5, 0.5) });
    processor.port.onmessage?.({ data: { type: 'clear' } });

    const outputs = createOutput(128);
    processor.process([], outputs);

    expect(outputs[0][0].every((value) => value === 0)).toBe(true);
    expect(outputs[0][1].every((value) => value === 0)).toBe(true);
  });
});
