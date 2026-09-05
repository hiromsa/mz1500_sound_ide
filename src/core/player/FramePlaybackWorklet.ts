/**
 * AudioWorkletProcessor のソースコード (vanilla JavaScript)。
 * メインスレッド側 AudioEngine が AudioFrameMixer で合成したステレオ標本を
 * リングバッファ経由で再生するだけの軽量プロセッサ。
 *
 * AudioWorklet は単一ファイルを addModule する必要があるため、Vite のバンドルや
 * GitHub Pages のサブパス配信に依存しない文字列定数として提供し、Blob URL でロードする。
 */
export const FramePlaybackWorkletSource = String.raw`
class MzsdFramePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringCapacity = 65536; // ステレオ標本数 (32768 フレーム ≈ 0.68 秒 @48kHz)
    this.ring = new Float32Array(this.ringCapacity);
    this.readPos = 0;
    this.writePos = 0;
    this.availableSamples = 0;
    this.reportCounter = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(data) {
    if (data instanceof Float32Array) {
      this.enqueue(data);
    } else if (data && data.type === 'clear') {
      // 停止要求: リングを即座に空にする
      this.readPos = 0;
      this.writePos = 0;
      this.availableSamples = 0;
    }
  }

  enqueue(chunk) {
    // 満杯時は溢れた分を破棄する (リアルタイム再生を優先)
    const limit = Math.min(chunk.length, this.ringCapacity - this.availableSamples);
    for (let i = 0; i < limit; i++) {
      this.ring[this.writePos] = chunk[i];
      this.writePos = (this.writePos + 1) % this.ringCapacity;
    }
    this.availableSamples += limit;
  }

  process(inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1];
    for (let i = 0; i < left.length; i++) {
      if (this.availableSamples >= 2) {
        left[i] = this.ring[this.readPos];
        right[i] = this.ring[this.readPos + 1];
        this.readPos = (this.readPos + 2) % this.ringCapacity;
        this.availableSamples -= 2;
      } else {
        left[i] = 0;
        right[i] = 0;
      }
    }

    // 消費状況を定期的にメインスレッドへ報告する (バッファ適正量の制御用)
    if (++this.reportCounter >= 4) {
      this.reportCounter = 0;
      this.port.postMessage({ type: 'level', availableSamples: this.availableSamples });
    }
    return true;
  }
}

registerProcessor('mzsd-frame-playback', MzsdFramePlaybackProcessor);
`;
