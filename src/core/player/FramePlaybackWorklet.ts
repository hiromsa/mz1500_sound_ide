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
    // アンダーラン (供給枯渇) 時のプチノイズ抑制用。
    // 無音への急落 / 供給回復時の波形不連続を、直前レベルの短いフェードで緩和する。
    this.fadeFrames = 64; // ≒ 1.3ms @48kHz
    this.fade = this.fadeFrames; // 通常再生中はフェード完了 (= ゲイン 1)
    this.tailLeft = 0;
    this.tailRight = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(data) {
    if (data instanceof Float32Array) {
      this.enqueue(data);
    } else if (data && data.type === 'clear') {
      // 停止要求: リングを即座に空にする (フェード状態もリセットして即時無音へ)
      this.readPos = 0;
      this.writePos = 0;
      this.availableSamples = 0;
      this.tailLeft = 0;
      this.tailRight = 0;
      this.fade = this.fadeFrames;
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
        // 供給回復直後は短いフェードインで波形の不連続を緩和する (通常再生中はゲイン 1)
        const gain = this.fade / this.fadeFrames;
        if (this.fade < this.fadeFrames) {
          this.fade++;
        }
        this.tailLeft = this.ring[this.readPos] * gain;
        this.tailRight = this.ring[this.readPos + 1] * gain;
        left[i] = this.tailLeft;
        right[i] = this.tailRight;
        this.readPos = (this.readPos + 2) % this.ringCapacity;
        this.availableSamples -= 2;
      } else if (this.fade > 0) {
        // アンダーラン: 直前のレベルから短くフェードアウトして 0 へ落とす (クリック防止)
        this.fade--;
        this.tailLeft *= this.fade / this.fadeFrames;
        this.tailRight *= this.fade / this.fadeFrames;
        left[i] = this.tailLeft;
        right[i] = this.tailRight;
      } else {
        left[i] = 0;
        right[i] = 0;
      }
    }

    // 消費状況を定期的にメインスレッドへ報告する (バッファ適正量の制御用)。
    // 報告が遅れるとメインスレッド側が実残量より多く見積もって補充を遅らせ、
    // アンダーラン (プチノイズ) の原因になるため 2 render quantum (≒ 5ms) ごとに報告する
    if (++this.reportCounter >= 2) {
      this.reportCounter = 0;
      this.port.postMessage({ type: 'level', availableSamples: this.availableSamples });
    }
    return true;
  }
}

registerProcessor('mzsd-frame-playback', MzsdFramePlaybackProcessor);
`;
