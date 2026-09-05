import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  X, 
  TrendingUp, 
  TrendingDown, 
  FlipHorizontal, 
  ArrowUpDown, 
  Trash2, 
  Copy,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

const MAX_FRAMES = 128;

interface EnvelopePreset {
  name: string;
  data: number[];
  loopPoint: number;
  releasePoint: number;
}

const PRESETS: Record<string, EnvelopePreset> = {
  piano: {
    name: 'PIANO (DECAY)',
    data: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    loopPoint: -1,
    releasePoint: 16,
  },
  organ: {
    name: 'ORGAN (SUSTAIN)',
    data: [15, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0],
    loopPoint: 4,
    releasePoint: 20,
  },
  strings: {
    name: 'SLOW ATTACK',
    data: [1, 2, 4, 6, 8, 10, 12, 14, 15, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0],
    loopPoint: 8,
    releasePoint: 20,
  },
  pluck: {
    name: 'SHORT PLUCK',
    data: [15, 11, 7, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    loopPoint: -1,
    releasePoint: 4,
  },
};

// デフォルト32フレームの初期エンベロープデータ
const createInitialEnvData = (): number[] => {
  return [
    15, 15, 14, 13, 12, 11, 10, 9,
    8, 8, 8, 8, 8, 8, 8, 8,
    8, 8, 8, 8,
    7, 6, 5, 4, 3, 2, 2, 1,
    1, 0, 0, 0
  ];
};

export function VolEnvelopeEditor() {
  // エンベロープデータ (デフォルト32フレーム, 各フレーム 0〜15)
  const [envData, setEnvData] = useState<number[]>(createInitialEnvData());
  
  // 繰り返しポイント (Loop Point): -1 はループなし
  const [loopPoint, setLoopPoint] = useState<number>(8);

  // KEYOFF時リリースポイント (Release Point): -1 はなし
  const [releasePoint, setReleasePoint] = useState<number>(20);

  // エンベロープ定義番号 (例: @v1)
  const [envNumber, setEnvNumber] = useState<number>(1);

  // ズーム倍率 (0.6x 〜 3.5x, デフォルト 1.0x - 縦横同時ズーム)
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  // ズームに応じた寸法計算 (ピッチ = stepWidth + 4px [gap-1])
  const stepWidth = Math.max(10, Math.round(18 * zoomLevel));
  const barWidth = Math.max(6, Math.min(36, stepWidth - 2));
  const graphHeight = Math.max(100, Math.round(160 * zoomLevel));
  const columnPitch = stepWidth + 4; // gap-1 = 4px

  // マウスホバー中のステップとボリューム { step: number, vol: number } | null
  const [hoveredPos, setHoveredPos] = useState<{ step: number; vol: number } | null>(null);

  // ズーム・スクロールコンテナ参照 & バー描画エリア参照
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  // ドラッグ時の直前ポイント（素早いドラッグ時のステップ抜け防止・線形補間用）
  const lastDrawnPosRef = useRef<{ step: number; vol: number } | null>(null);

  // スペースキードラッグスクロール（ハンドツール/パン）用ステート・Ref
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const isSpacePressedRef = useRef<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartScrollLeftRef = useRef<number>(0);

  // スペースキー押下検知 (フォーカスが入力欄にない場合のみパンモード有効化)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        if (!isSpacePressedRef.current) {
          isSpacePressedRef.current = true;
          setIsSpacePressed(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
        isPanningRef.current = false;
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Ctrl + マウスホイールでタイムラインの拡大・縮小 (縦横同時ズーム、ブラウザデフォルトズームを防止)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        setZoomLevel(prev => {
          const next = Math.round((prev + delta) * 100) / 100;
          return Math.max(0.6, Math.min(3.5, next));
        });
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // バーコンテナ上でのマウスホイール操作 (Ctrlなし時: ホバー中ステップの音量を ±1 変更)
  useEffect(() => {
    const el = barsContainerRef.current;
    if (!el) return;

    const handleBarWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // ズーム処理を優先

      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < 0) return;
      const step = Math.floor(x / columnPitch);
      if (step < 0 || step >= envData.length) return;

      const delta = e.deltaY < 0 ? 1 : -1;
      setEnvData(prev => {
        const current = prev[step] ?? 0;
        const next = Math.max(0, Math.min(15, current + delta));
        if (next === current) return prev;
        const copy = [...prev];
        copy[step] = next;
        return copy;
      });

      setHoveredPos(prev => {
        if (prev && prev.step === step) {
          const next = Math.max(0, Math.min(15, prev.vol + delta));
          return { step, vol: next };
        }
        return prev;
      });
    };

    el.addEventListener('wheel', handleBarWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleBarWheel);
    };
  }, [columnPitch, envData.length]);

  // Web Audio 試聴ステート
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isKeyOff, setIsKeyOff] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscNodeRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const activeStepRef = useRef<number>(-1);
  const [previewActiveStep, setPreviewActiveStep] = useState<number>(-1);

  // ステップ数を指定値に変更 (2〜MAX_FRAMES)
  const changeLength = (newLen: number) => {
    const clamped = Math.max(2, Math.min(MAX_FRAMES, newLen));
    setEnvData(prev => {
      if (clamped === prev.length) return prev;
      if (clamped > prev.length) {
        const lastVal = prev.length > 0 ? prev[prev.length - 1] : 0;
        const added = new Array(clamped - prev.length).fill(lastVal);
        return [...prev, ...added];
      } else {
        return prev.slice(0, clamped);
      }
    });
    if (loopPoint >= clamped) setLoopPoint(-1);
    if (releasePoint >= clamped) setReleasePoint(-1);
  };

  // プリセット適用
  const handleApplyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setEnvData([...p.data]);
    setLoopPoint(p.loopPoint);
    setReleasePoint(Math.min(p.releasePoint, p.data.length - 1));
  };

  // 波形クイック編集ユーティリティ (プロDAWツール)
  const handleRampUp = () => {
    setEnvData(prev => {
      const len = prev.length;
      return prev.map((_, i) => Math.round((i / Math.max(1, len - 1)) * 15));
    });
  };

  const handleRampDown = () => {
    setEnvData(prev => {
      const len = prev.length;
      return prev.map((_, i) => Math.round(((len - 1 - i) / Math.max(1, len - 1)) * 15));
    });
  };

  const handleFlipHorizontal = () => {
    setEnvData(prev => [...prev].reverse());
  };

  const handleInvertVolume = () => {
    setEnvData(prev => prev.map(v => 15 - v));
  };

  const handleClearAll = () => {
    setEnvData(prev => prev.map(() => 0));
  };

  // 値の上下左右シフト (1ステップ / 1レベル変化)
  const handleShiftUp = () => {
    setEnvData(prev => prev.map(v => Math.min(15, v + 1)));
  };

  const handleShiftDown = () => {
    setEnvData(prev => prev.map(v => Math.max(0, v - 1)));
  };

  // 左へシフト: 一番右の値がコピーされ一番右に挿入
  const handleShiftLeft = () => {
    setEnvData(prev => {
      if (prev.length === 0) return prev;
      const lastVal = prev[prev.length - 1];
      return [...prev.slice(1), lastVal];
    });
  };

  // 右へシフト: 一番左の値がコピーされ一番左に挿入
  const handleShiftRight = () => {
    setEnvData(prev => {
      if (prev.length === 0) return prev;
      const firstVal = prev[0];
      return [firstVal, ...prev.slice(0, prev.length - 1)];
    });
  };

  // 特定ステップの音量設定 (0〜15)
  const setStepVolume = useCallback((index: number, vol: number) => {
    const clamped = Math.max(0, Math.min(15, vol));
    setEnvData(prev => {
      if (prev[index] === clamped) return prev;
      const next = [...prev];
      next[index] = clamped;
      return next;
    });
  }, []);

  // 複数ステップの線形補間更新 (素早いドラッグ時のステップ抜けを防止し一筆書き)
  const applyVolumeInterpolated = useCallback((fromStep: number, fromVol: number, toStep: number, toVol: number) => {
    setEnvData(prev => {
      const next = [...prev];
      const minS = Math.min(fromStep, toStep);
      const maxS = Math.max(fromStep, toStep);
      let changed = false;

      for (let s = minS; s <= maxS; s++) {
        if (s < 0 || s >= next.length) continue;
        let v: number;
        if (fromStep === toStep) {
          v = toVol;
        } else {
          const t = (s - fromStep) / (toStep - fromStep);
          v = Math.round(fromVol + t * (toVol - fromVol));
        }
        const clamped = Math.max(0, Math.min(15, v));
        if (next[s] !== clamped) {
          next[s] = clamped;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // マウス座標からステップとボリュームを計算するヘルパー（ピクセル完全一致・均等スロット）
  const calculateStepAndVol = useCallback((clientX: number, clientY: number) => {
    const container = barsContainerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();

    // X座標: 列ピッチ columnPitch (= stepWidth + 4px) に基づいて正確に計算
    const x = clientX - rect.left;
    if (x < 0) return null;
    const step = Math.floor(x / columnPitch);
    if (step < 0 || step >= envData.length) return null;

    // Y座標: 上下パディング py-1 (4pxずつ) を考慮し、0〜15の16段階に均等マッピング
    const padY = 4;
    const innerHeight = Math.max(1, rect.height - padY * 2);
    const y = clientY - (rect.top + padY);
    const clampedY = Math.max(0, Math.min(innerHeight, y));
    const ratio = 1 - (clampedY / innerHeight);
    const vol = Math.max(0, Math.min(15, Math.floor(ratio * 16)));

    return { step, vol };
  }, [columnPitch, envData.length]);

  // パン操作 (水平ドラッグスクロール) の開始ハンドラ
  const startPan = (clientX: number) => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    isPanningRef.current = true;
    setIsPanning(true);
    panStartXRef.current = clientX;
    panStartScrollLeftRef.current = scrollEl.scrollLeft;

    const onPointerMove = (e: PointerEvent) => {
      if (!isPanningRef.current || !scrollContainerRef.current) return;
      const dx = e.clientX - panStartXRef.current;
      // マウスを左へドラッグすると右側のコンテンツが現れる (scrollLeft増加)
      scrollContainerRef.current.scrollLeft = panStartScrollLeftRef.current - dx;
    };

    const onPointerUp = () => {
      isPanningRef.current = false;
      setIsPanning(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // バーコンテナ上のポインターダウン (ペン描画開始またはパン)
  const handleBarsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSpacePressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e.clientX);
      return;
    }

    const pos = calculateStepAndVol(e.clientX, e.clientY);
    if (!pos) return;

    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    isDraggingRef.current = true;
    lastDrawnPosRef.current = pos;
    setHoveredPos(pos);
    setStepVolume(pos.step, pos.vol);
  };

  // バーコンテナ上のポインター移動 (ホバー追従 & ドラッグ補間描画)
  const handleBarsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSpacePressedRef.current) return;
    const pos = calculateStepAndVol(e.clientX, e.clientY);

    if (!pos) {
      if (!isDraggingRef.current) setHoveredPos(null);
      return;
    }
    setHoveredPos(pos);

    if (isDraggingRef.current) {
      const last = lastDrawnPosRef.current;
      if (last) {
        applyVolumeInterpolated(last.step, last.vol, pos.step, pos.vol);
      } else {
        setStepVolume(pos.step, pos.vol);
      }
      lastDrawnPosRef.current = pos;
    }
  };

  // バーコンテナ上のポインターアップ / キャンセル (描画終了)
  const handleBarsPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      isDraggingRef.current = false;
      lastDrawnPosRef.current = null;
    }
  };

  const handleBarsPointerLeave = () => {
    if (!isDraggingRef.current) {
      setHoveredPos(null);
    }
  };

  // スクロールコンテナ背景でのポインターダウン (スペースキー押下中のパン開始用)
  const handleContainerPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSpacePressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e.clientX);
    }
  };

  // ループポイントの直接トグル指定
  const handleToggleLoopPoint = (stepIdx: number) => {
    if (loopPoint === stepIdx) {
      setLoopPoint(-1); // 解除
    } else {
      setLoopPoint(stepIdx);
    }
  };

  // リリースポイントの直接トグル指定
  const handleToggleReleasePoint = (stepIdx: number) => {
    if (releasePoint === stepIdx) {
      setReleasePoint(-1); // 解除
    } else {
      setReleasePoint(stepIdx);
    }
  };

  // Web Audio 再生プレビューの停止処理
  const stopAudio = () => {
    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (oscNodeRef.current) {
      try {
        oscNodeRef.current.stop();
        oscNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      oscNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    setIsPlaying(false);
    setIsKeyOff(false);
    setPreviewActiveStep(-1);
    activeStepRef.current = -1;
  };

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // Web Audio 試聴再生 (KEY ON)
  const handlePlayKeyOn = () => {
    stopAudio();

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = audioCtxRef.current || new AudioContextClass();
    audioCtxRef.current = ctx;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const osc = ctx.createOscillator();
    osc.type = 'square'; // DCSGの矩形波
    osc.frequency.setValueAtTime(440, ctx.currentTime); // 基準音 A4 (440Hz)

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    oscNodeRef.current = osc;
    gainNodeRef.current = gain;
    setIsPlaying(true);
    setIsKeyOff(false);

    let currentStep = 0;
    activeStepRef.current = 0;
    setPreviewActiveStep(0);

    // 1フレーム = 約16.6ms (60fps)
    const FRAME_MS = 1000 / 60;

    playbackTimerRef.current = window.setInterval(() => {
      if (!gainNodeRef.current || !audioCtxRef.current) return;

      const val = envData[currentStep] ?? 0;
      const gainVal = (val / 15) * 0.25;
      gainNodeRef.current.gain.setValueAtTime(gainVal, audioCtxRef.current.currentTime);

      setPreviewActiveStep(currentStep);

      // 次のステップを計算
      if (!isKeyOff && loopPoint >= 0 && currentStep === releasePoint - 1) {
        // キーオン中はリリース直前でループポイントに戻る
        currentStep = loopPoint;
      } else if (!isKeyOff && loopPoint >= 0 && currentStep >= envData.length - 1) {
        // ループ指定があるがリリース未指定の場合は末尾からループ
        currentStep = loopPoint;
      } else {
        currentStep++;
        if (currentStep >= envData.length) {
          // 末尾に達したら再生終了
          stopAudio();
        }
      }
    }, FRAME_MS);
  };

  // KEY OFF 実行
  const handleTriggerKeyOff = () => {
    if (!isPlaying) return;
    setIsKeyOff(true);
    if (releasePoint >= 0 && releasePoint < envData.length) {
      activeStepRef.current = releasePoint;
      setPreviewActiveStep(releasePoint);
    }
  };

  // MML テキスト生成
  const generateMmlText = () => {
    const parts: string[] = [];
    envData.forEach((vol, idx) => {
      let prefix = '';
      if (idx === loopPoint) prefix += '|L ';
      if (idx === releasePoint) prefix += '|R ';
      parts.push(`${prefix}${vol}`);
    });
    return `@v${envNumber} = { ${parts.join(', ')} }`;
  };

  return (
    <div className="flex flex-col h-full bg-[#090a0f] p-3.5 overflow-y-auto font-mono text-xs select-none text-zinc-300 gap-3">
      {/* 1. Bento Card: エディタヘッダー & トランスポート & プリセット */}
      <div className="flex flex-col gap-2.5 bg-[#12131a] p-3 rounded-lg border border-white/[0.08] shrink-0 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
            <h2 className="text-xs font-semibold text-zinc-200 tracking-wide">
              VOLUME ENVELOPE EDITOR
            </h2>
            <span className="text-[10px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-800/80 border border-white/10 font-medium">
              DCSG (SN76489)
            </span>
          </div>

          {/* 試聴プレビュー操作 & エンベロープ番号 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="text-zinc-500 font-medium text-[10px]">ID:</span>
              <select
                value={envNumber}
                onChange={e => setEnvNumber(Number(e.target.value))}
                className="h-6 bg-[#0c0d12] text-zinc-200 border border-white/10 hover:border-white/20 focus:border-cyan-500 rounded px-2 text-xs font-mono cursor-pointer"
              >
                {[...Array(16)].map((_, i) => (
                  <option key={i} value={i}>@v{i}</option>
                ))}
              </select>
            </div>

            {/* プレビューボタン群 */}
            <div className="flex items-center gap-1.5">
              {!isPlaying ? (
                <button
                  onClick={handlePlayKeyOn}
                  className="h-6 px-3 rounded bg-[#00A8FF]/20 hover:bg-[#00A8FF]/30 text-[#00A8FF] border border-[#00A8FF]/60 font-medium transition-colors flex items-center gap-1.5 text-xs cursor-pointer shadow-xs"
                  title="Play Key-On (Loops at loop point)"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>KEY ON</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={handleTriggerKeyOff}
                    disabled={isKeyOff}
                    className={`h-6 px-2.5 rounded text-xs font-medium border transition-colors flex items-center gap-1 cursor-pointer ${
                      isKeyOff
                        ? 'bg-zinc-900 text-zinc-600 border-white/[0.04]'
                        : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-xs'
                    }`}
                    title="Trigger Release Phase"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>KEY OFF</span>
                  </button>
                  <button
                    onClick={stopAudio}
                    className="h-6 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                    title="Stop Audio Preview"
                  >
                    <Square className="w-2.5 h-2.5" />
                    <span>STOP</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* プリセットセレクタ & L/Rステータス */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-[10px] font-medium shrink-0">PRESET:</span>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => handleApplyPreset(key)}
                  className="h-5 px-2 rounded bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.06] transition-colors text-[10px] font-medium cursor-pointer"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 font-medium text-[10px]">|L LOOP:</span>
              {loopPoint >= 0 ? (
                <span className="px-2 h-5 rounded bg-cyan-950/40 text-cyan-300 border border-cyan-500/40 font-medium flex items-center gap-1 text-[10px]">
                  STEP {loopPoint}
                  <button 
                    onClick={() => setLoopPoint(-1)} 
                    className="hover:text-red-400 text-zinc-400 p-0.5 rounded cursor-pointer" 
                    title="Clear Loop Point"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ) : (
                <span className="text-zinc-600 text-[10px]">NONE</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 font-medium text-[10px]">|R RELEASE:</span>
              {releasePoint >= 0 ? (
                <span className="px-2 h-5 rounded bg-amber-950/40 text-amber-300 border border-amber-500/40 font-medium flex items-center gap-1 text-[10px]">
                  STEP {releasePoint}
                  <button 
                    onClick={() => setReleasePoint(-1)} 
                    className="hover:text-amber-200 text-zinc-400 p-0.5 rounded cursor-pointer" 
                    title="Clear Release Point"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ) : (
                <span className="text-zinc-600 text-[10px]">NONE</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Bento Card: タイムライン & 編集ユーティリティツールバー */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#12131a] p-2.5 rounded-lg border border-white/[0.08] text-xs shrink-0 shadow-xs">
        {/* 長さ変更 */}
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-[10px] font-medium">LENGTH:</span>
          <div className="flex items-center gap-1">
            {[16, 32, 64, 128].map(len => (
              <button
                key={len}
                onClick={() => changeLength(len)}
                className={`h-5 px-1.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                  envData.length === len
                    ? 'bg-zinc-700 text-white border-white/20'
                    : 'bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-white/[0.06]'
                }`}
                title={`Set length to ${len} frames`}
              >
                {len}F{len === 32 ? '*' : ''}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => changeLength(envData.length - 1)}
              disabled={envData.length <= 2}
              className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-20 border border-white/10 font-bold cursor-pointer"
              title="Decrease 1 frame"
            >
              -
            </button>
            <span className="font-semibold text-zinc-200 min-w-[34px] text-center text-xs font-mono">{envData.length}F</span>
            <button
              onClick={() => changeLength(envData.length + 1)}
              disabled={envData.length >= MAX_FRAMES}
              className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-20 border border-white/10 font-bold cursor-pointer"
              title="Increase 1 frame"
            >
              +
            </button>
          </div>
        </div>

        {/* プロDAW 波形クイック編集ツール */}
        <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2.5">
          <span className="text-zinc-500 text-[10px] font-medium mr-1">TOOLS:</span>
          <button
            onClick={handleRampUp}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Generate Linear Ramp Up (0 -> 15)"
          >
            <TrendingUp className="w-3 h-3" />
            <span>RAMP ↗</span>
          </button>
          <button
            onClick={handleRampDown}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Generate Linear Ramp Down (15 -> 0)"
          >
            <TrendingDown className="w-3 h-3" />
            <span>RAMP ↘</span>
          </button>
          <button
            onClick={handleFlipHorizontal}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Flip Horizontally (Reverse Timeline)"
          >
            <FlipHorizontal className="w-3 h-3" />
            <span>FLIP</span>
          </button>
          <button
            onClick={handleInvertVolume}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Invert Volume (15 - vol)"
          >
            <ArrowUpDown className="w-3 h-3" />
            <span>INVERT</span>
          </button>
          <button
            onClick={handleClearAll}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-red-950/80 hover:text-red-400 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Clear all to 0"
          >
            <Trash2 className="w-3 h-3" />
            <span>CLEAR</span>
          </button>
        </div>

        {/* 値の上下左右シフト (SHIFT) */}
        <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2.5">
          <span className="text-zinc-500 text-[10px] font-medium mr-0.5">SHIFT:</span>
          <button
            onClick={handleShiftLeft}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] transition-colors cursor-pointer"
            title="Shift Left (1 Frame, duplicate right end)"
          >
            <ArrowLeft className="w-3 h-3" />
          </button>
          <button
            onClick={handleShiftRight}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] transition-colors cursor-pointer"
            title="Shift Right (1 Frame, duplicate left end)"
          >
            <ArrowRight className="w-3 h-3" />
          </button>
          <button
            onClick={handleShiftUp}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] transition-colors cursor-pointer"
            title="Shift Up (+1)"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            onClick={handleShiftDown}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] transition-colors cursor-pointer"
            title="Shift Down (-1)"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
        </div>

        {/* ズームコントロール & パン & カーソル位置 */}
        <div className="flex items-center gap-1.5 border-l border-white/[0.08] pl-2.5">
          <span className="text-zinc-500 font-medium text-[10px]">ZOOM:</span>
          <button
            onClick={() => setZoomLevel(prev => Math.max(0.6, Math.round((prev - 0.25) * 100) / 100))}
            disabled={zoomLevel <= 0.6}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-20 border border-white/10 text-xs cursor-pointer"
            title="Zoom Out (Ctrl + Wheel Down)"
          >
            -
          </button>
          <button
            onClick={() => {
              setZoomLevel(1.0);
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollLeft = 0;
              }
            }}
            className={`px-1.5 h-5 rounded text-[10px] font-mono border transition-colors min-w-[40px] text-center cursor-pointer ${
              zoomLevel === 1.0
                ? 'bg-zinc-900 text-zinc-400 border-white/10'
                : 'bg-zinc-800 text-cyan-300 border-cyan-500/50'
            }`}
            title="Reset Zoom to 100% & Scroll to Start"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            onClick={() => setZoomLevel(prev => Math.min(3.5, Math.round((prev + 0.25) * 100) / 100))}
            disabled={zoomLevel >= 3.5}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-20 border border-white/10 text-xs cursor-pointer"
            title="Zoom In (Ctrl + Wheel Up)"
          >
            +
          </button>

          {/* スペースキー・パン状態インジケータ */}
          <button
            type="button"
            onClick={() => {
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
              }
            }}
            className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors flex items-center gap-1 cursor-pointer ${
              isSpacePressed
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500'
                : 'bg-zinc-900 text-zinc-500 border-white/10 hover:text-zinc-300'
            }`}
            title="Hold Space key + drag to scroll horizontally. Click to scroll to beginning."
          >
            <span>{isSpacePressed ? '✋ PANNING' : 'SPACE: PAN'}</span>
          </button>

          {/* カーソル位置 */}
          <div className="ml-1 px-2 py-0.5 rounded bg-[#0c0d12] border border-white/[0.06] text-xs font-mono flex items-center gap-1.5 min-w-[100px] justify-center">
            <span className="text-zinc-500 text-[10px]">POS:</span>
            {hoveredPos ? (
              <span className="text-cyan-300 font-semibold">
                F<span className="text-zinc-200">{hoveredPos.step}</span>:V<span className="text-zinc-200">{hoveredPos.vol}</span>
              </span>
            ) : (
              <span className="text-zinc-600">--</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Bento Card: グラフィカル・エンベロープ・エディタ領域 (Studio Canvas) */}
      <div 
        ref={scrollContainerRef}
        onPointerDownCapture={handleContainerPointerDownCapture}
        onDoubleClick={() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
          }
        }}
        className={`flex-1 min-h-[280px] bg-[#0c0d12] rounded-lg border border-white/[0.08] p-3 relative shadow-inner overflow-x-auto overflow-y-hidden select-none ${
          isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
      >
        <div 
          className="flex flex-col relative"
          style={{ 
            minWidth: `${Math.max(640, envData.length * columnPitch + 80)}px`,
            width: 'max-content',
          }}
        >
          {/* 上部: リージョン表示ブラケット (DAW風 ループ区間 & リリース区間) */}
          <div className="flex items-center gap-2 h-4 mb-1 relative">
            <span className="w-16 text-[9px] text-zinc-500 text-right shrink-0">REGION:</span>
            <div className="flex-1 relative h-full">
              {/* ループ区間ブラケット */}
              {loopPoint >= 0 && (
                <div 
                  className="absolute top-0 bottom-0 border-t-2 border-x border-cyan-400/60 bg-cyan-500/10 rounded-t flex items-center justify-center text-[8px] font-bold text-cyan-300 tracking-wider overflow-hidden"
                  style={{
                    left: `${loopPoint * columnPitch}px`,
                    width: `${((releasePoint >= 0 ? releasePoint : envData.length) - loopPoint) * columnPitch - 4}px`
                  }}
                >
                  LOOP
                </div>
              )}
              {/* リリース区間ブラケット */}
              {releasePoint >= 0 && (
                <div 
                  className="absolute top-0 bottom-0 border-t-2 border-x border-amber-500/50 bg-amber-500/10 rounded-t flex items-center justify-center text-[8px] font-bold text-amber-300 tracking-wider overflow-hidden"
                  style={{
                    left: `${releasePoint * columnPitch}px`,
                    width: `${(envData.length - releasePoint) * columnPitch - 4}px`
                  }}
                >
                  RELEASE
                </div>
              )}
            </div>
          </div>

          {/* 上部: L (ループ) / R (リリース) 直接指定レーン */}
          <div className="flex flex-col gap-1 z-20 pb-2 border-b border-white/[0.06] mb-2">
            {/* |L LOOP 直接指定レーン */}
            <div className="flex items-center gap-2">
              <span className="w-16 text-[9px] font-semibold text-cyan-400 tracking-wider text-right shrink-0">
                |L LOOP:
              </span>
              <div className="flex-1 flex gap-1">
                {envData.map((_, idx) => {
                  const isLoop = idx === loopPoint;
                  const isHovered = hoveredPos?.step === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleToggleLoopPoint(idx)}
                      style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                      className={`h-5 rounded text-[9px] font-bold transition-all flex items-center justify-center border shrink-0 cursor-pointer ${
                        isLoop
                          ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.7)]'
                          : isHovered
                          ? 'bg-zinc-800 text-cyan-300 border-cyan-700/60'
                          : 'bg-zinc-900/60 text-zinc-600 border-white/[0.04] hover:bg-zinc-800 hover:text-zinc-300'
                      }`}
                      title={`Click to set/clear LOOP point at Step ${idx}`}
                    >
                      {isLoop ? 'L' : '·'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* |R RELEASE 直接指定レーン */}
            <div className="flex items-center gap-2">
              <span className="w-16 text-[9px] font-semibold text-amber-400 tracking-wider text-right shrink-0">
                |R RELEASE:
              </span>
              <div className="flex-1 flex gap-1">
                {envData.map((_, idx) => {
                  const isRelease = idx === releasePoint;
                  const isHovered = hoveredPos?.step === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleToggleReleasePoint(idx)}
                      style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                      className={`h-5 rounded text-[9px] font-bold transition-all flex items-center justify-center border shrink-0 cursor-pointer ${
                        isRelease
                          ? 'bg-amber-600 text-amber-50 border-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.3)]'
                          : isHovered
                          ? 'bg-zinc-800 text-amber-300 border-amber-700/60'
                          : 'bg-zinc-900/60 text-zinc-600 border-white/[0.04] hover:bg-zinc-800 hover:text-zinc-300'
                      }`}
                      title={`Click to set/clear RELEASE point at Step ${idx}`}
                    >
                      {isRelease ? 'R' : '·'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 中央: ボリューム描画バーグラフ本体 */}
          <div 
            className="flex items-center gap-2 relative z-20 my-2"
            style={{ minHeight: `${graphHeight}px`, height: `${graphHeight}px` }}
          >
            <span className="w-16 text-[9px] font-medium text-zinc-500 tracking-wider text-right shrink-0 self-center">
              VOL (0-15):
            </span>
            <div 
              ref={barsContainerRef}
              className={`flex-1 h-full flex items-end gap-1 relative select-none py-1 touch-none ${
                isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'
              }`}
              onPointerDown={handleBarsPointerDown}
              onPointerMove={handleBarsPointerMove}
              onPointerUp={handleBarsPointerUp}
              onPointerCancel={handleBarsPointerUp}
              onPointerLeave={handleBarsPointerLeave}
            >
              {/* リージョン背景カラー帯 (ループ区間: 薄いシアン, リリース区間: 薄いアンバー) */}
              {loopPoint >= 0 && (
                <div 
                  className="absolute inset-y-0 bg-cyan-500/[0.03] border-x border-cyan-500/20 pointer-events-none z-0"
                  style={{
                    left: `${loopPoint * columnPitch}px`,
                    width: `${((releasePoint >= 0 ? releasePoint : envData.length) - loopPoint) * columnPitch - 4}px`
                  }}
                />
              )}
              {releasePoint >= 0 && (
                <div 
                  className="absolute inset-y-0 bg-amber-500/[0.03] border-x border-amber-500/20 pointer-events-none z-0"
                  style={{
                    left: `${releasePoint * columnPitch}px`,
                    width: `${(envData.length - releasePoint) * columnPitch - 4}px`
                  }}
                />
              )}

              {/* 背景目盛線 (15, 10, 5, 0) */}
              <div className="absolute inset-x-0 inset-y-1 flex flex-col justify-between pointer-events-none z-0">
                {[15, 10, 5, 0].map(v => (
                  <div key={v} className="border-b border-white/[0.04] flex items-center justify-between text-[8px] text-zinc-600 leading-none">
                    <span>VOL {v}</span>
                    <span>VOL {v}</span>
                  </div>
                ))}
              </div>

              {/* ホバー中の水平ガイドライン */}
              {hoveredPos && hoveredPos.vol > 0 && (
                <div 
                  className="absolute inset-x-0 border-t border-cyan-400/40 pointer-events-none z-20 flex justify-end pr-1"
                  style={{ bottom: `${(hoveredPos.vol / 15) * 100}%` }}
                >
                  <span className="text-[8px] font-mono text-cyan-300 bg-[#090a0f] px-1 rounded -translate-y-1/2 border border-cyan-500/30">
                    VOL {hoveredPos.vol}
                  </span>
                </div>
              )}

              {envData.map((vol, idx) => {
                const heightPercent = (vol / 15) * 100;
                const isLoop = idx === loopPoint;
                const isRelease = idx === releasePoint;
                const inLoopRegion = loopPoint >= 0 && idx >= loopPoint && (releasePoint < 0 || idx < releasePoint);
                const inReleaseRegion = releasePoint >= 0 && idx >= releasePoint;
                const isActivePlaying = idx === previewActiveStep;
                const isHoveredColumn = hoveredPos?.step === idx;

                return (
                  <div
                    key={idx}
                    style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                    className={`h-full flex flex-col items-center justify-end relative pointer-events-none shrink-0 z-10 rounded-xs ${
                      isHoveredColumn ? 'bg-white/[0.04]' : ''
                    }`}
                  >
                    {/* 再生中インジケータ */}
                    {isActivePlaying && (
                      <div className="absolute -top-2.5 inset-x-0 flex justify-center">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,1)] animate-ping" />
                      </div>
                    )}

                    {/* ホバー列の現在値バッジ */}
                    {isHoveredColumn && (
                      <div className="absolute -top-4.5 inset-x-0 flex justify-center z-30 pointer-events-none">
                        <span className="text-[8px] font-mono font-bold text-cyan-300 bg-[#12131a] border border-cyan-500/60 px-1 rounded shadow-xs">
                          {vol}
                        </span>
                      </div>
                    )}

                    {/* 実データ縦バー (0〜15) - 洗練されたプロDAWバー */}
                    <div 
                      className={`rounded-t-xs relative flex flex-col justify-end overflow-hidden z-20 transition-colors ${
                        isActivePlaying
                          ? 'bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.9)] border-t border-white'
                          : isLoop
                          ? 'bg-cyan-500 border-t-2 border-cyan-200 shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                          : isRelease
                          ? 'bg-amber-500 border-t-2 border-amber-200 shadow-[0_0_6px_rgba(245,158,11,0.3)]'
                          : inLoopRegion
                          ? 'bg-cyan-600/70 border-t border-cyan-400/60 hover:bg-cyan-600/90'
                          : inReleaseRegion
                          ? 'bg-amber-700/60 border-t border-amber-500/40 hover:bg-amber-700/80'
                          : 'bg-zinc-700/90 hover:bg-zinc-600 border-t border-zinc-400'
                      }`}
                      style={{ 
                        height: `${Math.max(3, heightPercent)}%`,
                        width: `${barWidth}px`
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* 下部: 数値 & ステップ番号 */}
          <div className="flex items-center gap-2 z-20 pt-1.5">
            <span className="w-16 text-[9px] text-zinc-500 text-right shrink-0">
              FRAME:
            </span>
            <div className="flex-1 flex gap-1">
              {envData.map((vol, idx) => {
                const isLoop = idx === loopPoint;
                const isRelease = idx === releasePoint;
                const isActivePlaying = idx === previewActiveStep;

                return (
                  <div 
                    key={idx} 
                    style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                    className="flex flex-col items-center text-[10px] font-bold shrink-0"
                  >
                    <span className={`leading-none mb-0.5 ${
                      isActivePlaying 
                        ? 'text-cyan-300' 
                        : isLoop 
                        ? 'text-cyan-400' 
                        : isRelease 
                        ? 'text-amber-400' 
                        : 'text-zinc-400'
                    }`}>
                      {vol}
                    </span>
                    <span className="text-[8px] text-zinc-600 font-normal">
                      {idx}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ガイド */}
          <div className="pt-2 mt-2 border-t border-white/[0.05] flex justify-between items-center text-[9px] text-zinc-500">
            <div className="flex items-center gap-3">
              <span className="text-cyan-400/90">● Click/Drag bar to paint volume</span>
              <span>● |L / |R: Direct Toggle</span>
              <span className="text-zinc-400 font-mono">● Zoom: Ctrl + Wheel</span>
              <span className="text-zinc-400 font-mono">● Pan: Space + Drag</span>
            </div>
            <div>
              1 Frame = 1/60s | Length: 2〜128 Frames (Default: 32F) | Attenuation 0 (Mute) 〜 15 (Max)
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bento Card: MML エクスポートプレビュー */}
      <div className="p-3 bg-[#12131a] rounded-lg border border-white/[0.08] flex flex-col gap-2 shrink-0 shadow-xs">
        <div className="flex justify-between items-center text-[10px] font-medium text-zinc-400">
          <span className="flex items-center gap-1.5 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
            GENERATED MML COMMAND
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(generateMmlText())}
            className="h-6 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-white/10 transition-colors text-[10px] cursor-pointer shadow-xs flex items-center gap-1"
          >
            <Copy className="w-3 h-3" />
            <span>COPY MML</span>
          </button>
        </div>
        <div className="bg-[#0c0d12] p-2.5 rounded border border-white/[0.06] font-mono text-cyan-300 text-xs tracking-wide select-all overflow-x-auto shadow-inner">
          {generateMmlText()}
        </div>
      </div>
    </div>
  );
}

