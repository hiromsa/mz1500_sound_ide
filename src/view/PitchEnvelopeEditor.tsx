import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  X, 
  Activity, 
  FlipHorizontal, 
  ArrowUpDown, 
  Trash2, 
  Copy, 
  LineChart,
  Sparkles,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

const MAX_FRAMES = 128;

// 選択可能ピッチレンジ定義
export const PITCH_RANGES = [
  { value: 7, label: '±7 (Micro/Vib)', desc: '微小デチューン・浅いビブラート' },
  { value: 15, label: '±15 (Standard)', desc: '標準ビブラート・効果音' },
  { value: 24, label: '±24 (2 Octaves)', desc: '2オクターブ・ポルタメント' },
  { value: 48, label: '±48 (Wide Bend)', desc: 'ワイドピッチベンド・急降下/急上昇' },
];

interface PitchPreset {
  name: string;
  desc: string;
  range: number;
  data: number[];
  loopPoint: number;
  releasePoint: number;
}

const PRESETS: Record<string, PitchPreset> = {
  vibrato_mild: {
    name: 'VIBRATO (MILD)',
    desc: '自然で心地よい浅いビブラート',
    range: 7,
    data: [
      0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1,
      0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1,
      0, 1, 2, 3, 2, 1, 0, -1
    ],
    loopPoint: 0,
    releasePoint: -1,
  },
  vibrato_deep: {
    name: 'VIBRATO (DEEP)',
    desc: '深く揺れるダイナミックなビブラート',
    range: 15,
    data: [
      0, 3, 6, 8, 6, 3, 0, -3, -6, -8, -6, -3,
      0, 3, 6, 8, 6, 3, 0, -3, -6, -8, -6, -3,
      0, 3, 6, 8, 6, 3, 0, -3
    ],
    loopPoint: 0,
    releasePoint: -1,
  },
  delayed_vib: {
    name: 'DELAYED VIB',
    desc: 'ストレート発音後にビブラート開始',
    range: 15,
    data: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 2, 5, 7, 5, 2, 0, -2, -5, -7, -5, -2,
      0, 2, 5, 7, 5, 2, 0, -2
    ],
    loopPoint: 12,
    releasePoint: -1,
  },
  pitch_drop: {
    name: 'PITCH DROP',
    desc: '高音から急激に落ちるレーザー・効果音',
    range: 24,
    data: [
      24, 20, 16, 12, 9, 6, 4, 2, 1, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    loopPoint: -1,
    releasePoint: 10,
  },
  pitch_up: {
    name: 'PITCH UP',
    desc: '低音から素早く立ち上がるベンドアップ',
    range: 24,
    data: [
      -24, -18, -12, -7, -4, -2, -1, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    loopPoint: -1,
    releasePoint: 8,
  },
  fast_trill: {
    name: 'FAST TRILL',
    desc: '高速で2音間を行き来するトリル',
    range: 7,
    data: [
      0, 0, 4, 4, 0, 0, 4, 4, 0, 0, 4, 4, 0, 0, 4, 4,
      0, 0, 4, 4, 0, 0, 4, 4, 0, 0, 4, 4, 0, 0, 4, 4
    ],
    loopPoint: 0,
    releasePoint: -1,
  },
};

// デフォルト32フレームの初期ビブラートデータ
const createInitialPitchData = (): number[] => {
  return [
    0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1,
    0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1,
    0, 1, 2, 3, 2, 1, 0, -1
  ];
};

export interface PitchEnvelopeEditorProps {
  onChangeEnvData?: (data: number[], loopPoint: number) => void;
  /** MML右クリックメニューから指定されたID。変化したらenvNumberを更新する。 */
  loadEnvId?: number | null;
  /** 「MMLに反映」ボタン押下時に呼び出されるコールバック。 */
  onApplyToMml?: (mmlSnippet: string, id: number) => void;
}

export function PitchEnvelopeEditor({ onChangeEnvData, loadEnvId, onApplyToMml }: PitchEnvelopeEditorProps = {}) {
  // ピッチエンベロープデータ (各フレームの周波数/ピッチオフセット値)
  const [envData, setEnvData] = useState<number[]>(createInitialPitchData());

  // ピッチレンジ (±7, ±15, ±24, ±48)
  const [pitchRange, setPitchRange] = useState<number>(15);

  // ループポイント (-1 はループなし)
  const [loopPoint, setLoopPoint] = useState<number>(0);

  // エンベロープデータ・ループ変更時に外部通知
  useEffect(() => {
    onChangeEnvData?.(envData, loopPoint);
  }, [envData, loopPoint, onChangeEnvData]);

  // リリースポイント (-1 はなし)
  const [releasePoint, setReleasePoint] = useState<number>(-1);

  // エンベロープ定義番号 (例: @p1)
  const [envNumber, setEnvNumber] = useState<number>(1);

  // loadEnvId の変化を監視: 右クリックメニューからIDが指定されたらenvNumberを更新
  useEffect(() => {
    if (loadEnvId == null) return;
    setEnvNumber(loadEnvId);
  }, [loadEnvId]);

  // ズーム倍率 (0.6x 〜 3.5x, デフォルト 1.0x)
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  // ズームに応じた寸法計算 (ピッチ = stepWidth + 4px [gap-1])
  const stepWidth = Math.max(10, Math.round(18 * zoomLevel));
  const barWidth = Math.max(6, Math.min(36, stepWidth - 2));
  const graphHeight = Math.max(120, Math.round(180 * zoomLevel));
  const columnPitch = stepWidth + 4; // gap-1 = 4px

  // マウスホバー中のステップとピッチ値 { step: number, pitch: number } | null
  const [hoveredPos, setHoveredPos] = useState<{ step: number; pitch: number } | null>(null);

  // ズーム・スクロールコンテナ参照 & バー描画エリア参照
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastDrawnPosRef = useRef<{ step: number; pitch: number } | null>(null);

  // スペースキードラッグスクロール（ハンドツール/パン）用ステート・Ref
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const isSpacePressedRef = useRef<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartScrollLeftRef = useRef<number>(0);

  // Web Audio 試聴ステート
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscNodeRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const activeStepRef = useRef<number>(-1);
  const [previewActiveStep, setPreviewActiveStep] = useState<number>(-1);

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

  // Ctrl + マウスホイールでタイムラインの拡大・縮小
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

  // バーコンテナ上でのマウスホイール操作 (Ctrlなし時: ホバー中ステップのピッチを ±1 変更)
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
        const next = Math.max(-pitchRange, Math.min(pitchRange, current + delta));
        if (next === current) return prev;
        const copy = [...prev];
        copy[step] = next;
        return copy;
      });

      setHoveredPos(prev => {
        if (prev && prev.step === step) {
          const next = Math.max(-pitchRange, Math.min(pitchRange, prev.pitch + delta));
          return { step, pitch: next };
        }
        return prev;
      });
    };

    el.addEventListener('wheel', handleBarWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleBarWheel);
    };
  }, [columnPitch, envData.length, pitchRange]);

  // レンジ切替時、既存のデータを新しいレンジにクランプ
  const handleChangeRange = (newRange: number) => {
    setPitchRange(newRange);
    setEnvData(prev => prev.map(v => Math.max(-newRange, Math.min(newRange, v))));
  };

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
    setPitchRange(p.range);
    setEnvData([...p.data]);
    setLoopPoint(p.loopPoint);
    setReleasePoint(p.releasePoint >= 0 ? Math.min(p.releasePoint, p.data.length - 1) : -1);
  };

  // ビブラート自動生成ツール (正弦波ビブラート生成)
  const handleGenerateVibrato = (cycleFrames: number = 8) => {
    const amplitude = Math.max(2, Math.round(pitchRange * 0.5));
    setEnvData(prev => {
      return prev.map((_, i) => {
        const rad = (i / cycleFrames) * 2 * Math.PI;
        return Math.round(Math.sin(rad) * amplitude);
      });
    });
  };

  // 上下反転 (正負反転: -pitch)
  const handleInvertPitch = () => {
    setEnvData(prev => prev.map(v => -v));
  };

  // 左右反転
  const handleFlipHorizontal = () => {
    setEnvData(prev => [...prev].reverse());
  };

  // スムージング (前後の平均化)
  const handleSmooth = () => {
    setEnvData(prev => {
      return prev.map((v, i) => {
        const prevV = i > 0 ? prev[i - 1] : v;
        const nextV = i < prev.length - 1 ? prev[i + 1] : v;
        return Math.round((prevV + v * 2 + nextV) / 4);
      });
    });
  };

  // センターリセット (全ステップ 0)
  const handleResetToCenter = () => {
    setEnvData(prev => prev.map(() => 0));
  };

  // 値の上下左右シフト (1ステップ / 1レベル変化)
  const handleShiftUp = () => {
    setEnvData(prev => prev.map(v => Math.min(pitchRange, v + 1)));
  };

  const handleShiftDown = () => {
    setEnvData(prev => prev.map(v => Math.max(-pitchRange, v - 1)));
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

  // 特定ステップのピッチ値設定
  const setStepPitch = useCallback((index: number, pitch: number) => {
    const clamped = Math.max(-pitchRange, Math.min(pitchRange, pitch));
    setEnvData(prev => {
      if (prev[index] === clamped) return prev;
      const next = [...prev];
      next[index] = clamped;
      return next;
    });
  }, [pitchRange]);

  // 複数ステップの線形補間更新 (素早いドラッグ時のステップ抜け防止)
  const applyPitchInterpolated = useCallback((fromStep: number, fromPitch: number, toStep: number, toPitch: number) => {
    setEnvData(prev => {
      const next = [...prev];
      const minS = Math.min(fromStep, toStep);
      const maxS = Math.max(fromStep, toStep);
      let changed = false;

      for (let s = minS; s <= maxS; s++) {
        if (s < 0 || s >= next.length) continue;
        let p: number;
        if (fromStep === toStep) {
          p = toPitch;
        } else {
          const t = (s - fromStep) / (toStep - fromStep);
          p = Math.round(fromPitch + t * (toPitch - fromPitch));
        }
        const clamped = Math.max(-pitchRange, Math.min(pitchRange, p));
        if (next[s] !== clamped) {
          next[s] = clamped;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pitchRange]);

  // マウス座標からステップとピッチ値を計算 (センター0の双極性マッピング)
  const calculateStepAndPitch = useCallback((clientX: number, clientY: number) => {
    const container = barsContainerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();

    // X座標: 列ピッチ columnPitch に基づいて計算
    const x = clientX - rect.left;
    if (x < 0) return null;
    const step = Math.floor(x / columnPitch);
    if (step < 0 || step >= envData.length) return null;

    // Y座標: センターが 0、上端が +pitchRange、下端が -pitchRange
    const padY = 4;
    const innerHeight = Math.max(1, rect.height - padY * 2);
    const y = clientY - (rect.top + padY);
    const clampedY = Math.max(0, Math.min(innerHeight, y));

    // ratio: 0.0 (上端) 〜 0.5 (中央) 〜 1.0 (下端)
    const ratio = clampedY / innerHeight;
    // 上方向がプラス、下方向がマイナス
    const bipolarRatio = 1 - 2 * ratio; // +1.0 (上端) 〜 0 (中央) 〜 -1.0 (下端)
    const pitch = Math.max(-pitchRange, Math.min(pitchRange, Math.round(bipolarRatio * pitchRange)));

    return { step, pitch };
  }, [columnPitch, envData.length, pitchRange]);

  // 水平ドラッグスクロール (パン操作)
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

  // バーコンテナ上のポインターダウン
  const handleBarsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSpacePressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e.clientX);
      return;
    }

    const pos = calculateStepAndPitch(e.clientX, e.clientY);
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
    setStepPitch(pos.step, pos.pitch);
  };

  // バーコンテナ上のポインター移動
  const handleBarsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSpacePressedRef.current) return;
    const pos = calculateStepAndPitch(e.clientX, e.clientY);

    if (!pos) {
      if (!isDraggingRef.current) setHoveredPos(null);
      return;
    }
    setHoveredPos(pos);

    if (isDraggingRef.current) {
      const last = lastDrawnPosRef.current;
      if (last) {
        applyPitchInterpolated(last.step, last.pitch, pos.step, pos.pitch);
      } else {
        setStepPitch(pos.step, pos.pitch);
      }
      lastDrawnPosRef.current = pos;
    }
  };

  // バーコンテナ上のポインターアップ
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

  // スクロールコンテナ背景でのポインターダウン
  const handleContainerPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSpacePressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e.clientX);
    }
  };

  // ループポイントのトグル
  const handleToggleLoopPoint = (stepIdx: number) => {
    setLoopPoint(prev => (prev === stepIdx ? -1 : stepIdx));
  };

  // リリースポイントのトグル
  const handleToggleReleasePoint = (stepIdx: number) => {
    setReleasePoint(prev => (prev === stepIdx ? -1 : stepIdx));
  };

  // Web Audio 試聴停止
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

  // Web Audio 試聴開始 (KEY ON - ピッチ変調をリアルタイムシミュレート)
  const handlePlayKeyOn = () => {
    stopAudio();

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = audioCtxRef.current || new AudioContextClass();
    audioCtxRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    const baseFreq = 440; // A4

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    oscNodeRef.current = osc;
    gainNodeRef.current = gain;
    setIsPlaying(true);

    let currentStep = 0;
    activeStepRef.current = currentStep;
    setPreviewActiveStep(currentStep);

    // 1フレーム = 1/60秒 (約16.6ms)
    const frameIntervalMs = 1000 / 60;

    const timer = window.setInterval(() => {
      if (!oscNodeRef.current || !gainNodeRef.current) return;

      const pVal = envData[currentStep] ?? 0;
      // ピッチ変調: 1ステップあたり 25 cents (1/4半音)
      const detuneCents = pVal * 25;
      oscNodeRef.current.detune.setValueAtTime(detuneCents, ctx.currentTime);

      setPreviewActiveStep(currentStep);
      activeStepRef.current = currentStep;

      currentStep++;

      // ループまたは末尾処理
      const loopEnd = releasePoint >= 0 ? releasePoint : envData.length;
      if (currentStep >= loopEnd) {
        if (loopPoint >= 0 && loopPoint < loopEnd) {
          currentStep = loopPoint;
        } else {
          stopAudio();
        }
      }
    }, frameIntervalMs);

    playbackTimerRef.current = timer;
  };

  // MMLスニペット生成 (mml_reference.md の @PEN = { } 書式に準拠。ループ `|`、リリース `>`)
  const generateMmlSnippet = (): string => {
    const parts: string[] = [];
    for (let i = 0; i < envData.length; i++) {
      if (i === loopPoint) {
        parts.push('|');
      }
      if (i === releasePoint) {
        parts.push('>');
      }
      parts.push(envData[i].toString());
    }
    return `@PE${envNumber} = { ${parts.join(', ')} }`;
  };

  // 「MMLに反映」ボタン処理
  const handleApplyToMml = () => {
    const snippet = generateMmlSnippet();
    onApplyToMml?.(snippet, envNumber);
  };

  return (
    <div className="flex flex-col h-full bg-[#090a0f] p-3.5 overflow-hidden font-mono text-zinc-300 gap-3">
      {/* 1. Bento Card: ヘッダー & トランスポート & プリセット */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#12131a] p-3 rounded-lg border border-white/[0.08] shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5">
          <LineChart className="w-4 h-4 text-[#00A8FF]" />
          <h2 className="text-xs font-semibold text-zinc-200 tracking-wide">
            PITCH ENVELOPE EDITOR
          </h2>
          <span className="text-[10px] text-cyan-300 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 font-medium">
            VIBRATO & BEND
          </span>
          <div className="flex items-center gap-1.5 ml-2 border-l border-white/10 pl-2.5">
            <span className="text-zinc-500 text-[10px] font-medium">ID:</span>
            <select
              value={envNumber}
              onChange={e => setEnvNumber(Number(e.target.value))}
              className="bg-[#0c0d12] text-cyan-300 border border-white/10 rounded h-6 px-1.5 text-xs font-mono font-semibold cursor-pointer focus:border-cyan-400 focus:outline-none"
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i} className="bg-[#12131a] text-zinc-200">
                  @PE{i}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 試聴トランスポート & MMLに反映ボタン */}
        <div className="flex items-center gap-2">
          {!isPlaying ? (
            <button
              onClick={handlePlayKeyOn}
              className="h-6 px-2.5 rounded text-[11px] font-semibold bg-[#122b1f] hover:bg-[#163827] text-emerald-400 hover:text-emerald-300 border border-emerald-500/50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Play preview tone with pitch modulation (KEY ON)"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>TEST TONE</span>
            </button>
          ) : (
            <button
              onClick={stopAudio}
              className="h-6 px-2.5 rounded text-[11px] font-semibold bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-500/60 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs animate-pulse"
              title="Stop audio playback"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>STOP</span>
            </button>
          )}
          {/* MMLに反映ボタン (onApplyToMml が設定されている場合のみ表示) */}
          {onApplyToMml && (
            <button
              onClick={handleApplyToMml}
              className="h-6 px-3 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 border border-emerald-600/60 hover:border-emerald-400 font-medium transition-colors flex items-center gap-1.5 text-xs cursor-pointer shadow-xs"
              title={`@PE${envNumber} の MML定義をカーソル位置に挿入`}
            >
              <span>▶ MMLに反映</span>
            </button>
          )}
        </div>

        {/* プリセット選択 & ループ/リリース情報 */}
        <div className="flex flex-wrap items-center gap-4 w-full pt-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500 text-[10px] font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              PRESET:
            </span>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => handleApplyPreset(key)}
                  title={p.desc}
                  className="h-5 px-2 rounded bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.06] transition-colors text-[10px] font-medium cursor-pointer"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs ml-auto">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 font-medium text-[10px]">| LOOP:</span>
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
              <span className="text-zinc-500 font-medium text-[10px]">{'>'} RELEASE:</span>
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

      {/* 2. Bento Card: タイムライン設定 & レンジ切替 & 編集ツールバー */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#12131a] p-2.5 rounded-lg border border-white/[0.08] text-xs shrink-0 shadow-xs">
        {/* フレーム長変更 */}
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

        {/* ピッチレンジ切替 (ダイナミックレンジ) */}
        <div className="flex items-center gap-1.5 border-l border-white/[0.08] pl-2.5">
          <span className="text-zinc-500 text-[10px] font-medium">RANGE:</span>
          <div className="flex items-center gap-1">
            {PITCH_RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => handleChangeRange(r.value)}
                title={r.desc}
                className={`h-5 px-2 rounded text-[10px] font-mono font-medium border transition-colors cursor-pointer ${
                  pitchRange === r.value
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-400/60 font-bold shadow-xs'
                    : 'bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-white/[0.06]'
                }`}
              >
                ±{r.value}
              </button>
            ))}
          </div>
        </div>

        {/* プロDAW クイック編集ツール */}
        <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2.5">
          <span className="text-zinc-500 text-[10px] font-medium mr-1">TOOLS:</span>
          {/* ビブラート自動生成 */}
          <button
            onClick={() => handleGenerateVibrato(8)}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Generate Vibrato Sine Wave (~8 frames cycle)"
          >
            <Activity className="w-3 h-3 text-cyan-400" />
            <span>GEN VIB ~</span>
          </button>
          {/* 上下反転 (正負反転) */}
          <button
            onClick={handleInvertPitch}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Invert Pitch (+ <-> -)"
          >
            <ArrowUpDown className="w-3 h-3" />
            <span>INVERT</span>
          </button>
          {/* 左右反転 */}
          <button
            onClick={handleFlipHorizontal}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Flip Horizontally (Reverse Timeline)"
          >
            <FlipHorizontal className="w-3 h-3" />
            <span>FLIP</span>
          </button>
          {/* スムース */}
          <button
            onClick={handleSmooth}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 hover:text-cyan-300 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Smooth Pitch Curve"
          >
            <RefreshCw className="w-3 h-3" />
            <span>SMOOTH</span>
          </button>
          {/* センター0リセット */}
          <button
            onClick={handleResetToCenter}
            className="h-5 px-1.5 rounded bg-zinc-900/80 hover:bg-red-950/80 hover:text-red-400 text-zinc-400 border border-white/[0.06] text-[10px] font-medium cursor-pointer transition-colors flex items-center gap-1"
            title="Reset All Steps to 0 (Center Pitch)"
          >
            <Trash2 className="w-3 h-3" />
            <span>CENTER 0</span>
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

        {/* ズーム & カーソル位置 */}
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
                scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
              }
            }}
            className="h-5 px-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/10 text-[10px] font-mono cursor-pointer"
            title="Reset Zoom to 100% & Scroll to start"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            onClick={() => setZoomLevel(prev => Math.max(0.6, Math.min(3.5, Math.round((prev + 0.25) * 100) / 100)))}
            disabled={zoomLevel >= 3.5}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-20 border border-white/10 text-xs cursor-pointer"
            title="Zoom In (Ctrl + Wheel Up)"
          >
            +
          </button>

          {/* カーソル位置 */}
          <div className="min-w-[100px] text-right font-mono text-[10px] ml-2 text-zinc-400">
            {hoveredPos ? (
              <span className="text-cyan-300 font-semibold">
                F{hoveredPos.step} : P{hoveredPos.pitch > 0 ? `+${hoveredPos.pitch}` : hoveredPos.pitch}
              </span>
            ) : (
              <span className="text-zinc-600">POS: --</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Bento Card: グラフィカル・ピッチスタジオキャンバス (双極性バーグラフ) */}
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
            <span className="w-18 text-[9px] text-zinc-500 text-right shrink-0">REGION:</span>
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

          {/* 上部: | (ループ) / > (リリース) 直接指定レーン */}
          <div className="flex flex-col gap-1 z-20 pb-2 border-b border-white/[0.06] mb-2">
            {/* | LOOP 直接指定レーン */}
            <div className="flex items-center gap-2">
              <span className="w-18 text-[9px] font-semibold text-cyan-400 tracking-wider text-right shrink-0">
                | LOOP:
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
                      {isLoop ? '|' : '·'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* > RELEASE 直接指定レーン */}
            <div className="flex items-center gap-2">
              <span className="w-18 text-[9px] font-semibold text-amber-400 tracking-wider text-right shrink-0">
                {'>'} RELEASE:
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
                      {isRelease ? '>' : '·'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 中央: 双極性ピッチ描画バーグラフ本体 */}
          <div 
            className="flex items-center gap-2 relative z-20 my-2"
            style={{ minHeight: `${graphHeight}px`, height: `${graphHeight}px` }}
          >
            {/* 左側スケール目盛り (+Range, 0, -Range) */}
            <div className="w-18 flex flex-col justify-between h-full text-[9px] font-mono text-zinc-500 text-right pr-1 shrink-0 select-none">
              <span className="text-cyan-400 font-semibold">+{pitchRange}</span>
              <span className="text-zinc-300 font-bold">0</span>
              <span className="text-amber-400 font-semibold">-{pitchRange}</span>
            </div>

            <div 
              ref={barsContainerRef}
              className={`flex-1 h-full flex items-center gap-1 relative select-none py-1 touch-none ${
                isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'
              }`}
              onPointerDown={handleBarsPointerDown}
              onPointerMove={handleBarsPointerMove}
              onPointerUp={handleBarsPointerUp}
              onPointerCancel={handleBarsPointerUp}
              onPointerLeave={handleBarsPointerLeave}
            >
              {/* リージョン背景カラー帯 */}
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

              {/* センター水平基準ライン (0レベル) */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/20 pointer-events-none z-10 border-t border-dashed border-white/25" />

              {/* 各ステップの双極バー (Bipolar Bar) */}
              {envData.map((val, idx) => {
                const isHovered = hoveredPos?.step === idx;
                const isPlayingStep = previewActiveStep === idx;
                const isPositive = val > 0;
                const isNegative = val < 0;
                const isZero = val === 0;

                // 半分の高さ (中央から上下それぞれへ)
                const halfHeight = (graphHeight - 8) / 2;
                // バーの高さ計算 (0〜halfHeight)
                const barH = isZero ? 2 : Math.max(3, (Math.abs(val) / pitchRange) * halfHeight);

                return (
                  <div
                    key={idx}
                    style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                    className="h-full flex flex-col justify-center items-center relative group shrink-0"
                  >
                    {/* 上半分 (正の値) */}
                    <div className="flex-1 w-full flex items-end justify-center relative">
                      {isPositive && (
                        <div
                          style={{
                            height: `${barH}px`,
                            width: `${barWidth}px`,
                          }}
                          className={`rounded-t transition-all ${
                            isPlayingStep
                              ? 'bg-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.9)]'
                              : isHovered
                              ? 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                              : 'bg-cyan-500/80 hover:bg-cyan-400'
                          }`}
                        />
                      )}
                    </div>

                    {/* センターゼロドット / インジケータ */}
                    <div 
                      style={{ width: `${barWidth}px` }}
                      className={`h-[2px] z-20 rounded-full transition-colors ${
                        isZero 
                          ? (isPlayingStep ? 'bg-cyan-300 shadow-[0_0_6px_#22d3ee]' : 'bg-zinc-400') 
                          : 'bg-white/40'
                      }`} 
                    />

                    {/* 下半分 (負の値) */}
                    <div className="flex-1 w-full flex items-start justify-center relative">
                      {isNegative && (
                        <div
                          style={{
                            height: `${barH}px`,
                            width: `${barWidth}px`,
                          }}
                          className={`rounded-b transition-all ${
                            isPlayingStep
                              ? 'bg-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.9)]'
                              : isHovered
                              ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                              : 'bg-amber-500/80 hover:bg-amber-400'
                          }`}
                        />
                      )}
                    </div>

                    {/* 再生中の縦ラインオーバーレイ */}
                    {isPlayingStep && (
                      <div className="absolute inset-0 bg-cyan-400/20 border-x border-cyan-400 pointer-events-none z-30" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 下部: 数値ラベル行 (ピッチ値 & フレーム番号) */}
          <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-1.5 mt-1">
            {/* 各ステップのピッチ数値 */}
            <div className="flex items-center gap-2">
              <span className="w-18 text-[9px] font-medium text-zinc-500 text-right shrink-0">
                PITCH:
              </span>
              <div className="flex-1 flex gap-1">
                {envData.map((val, idx) => {
                  const isHovered = hoveredPos?.step === idx;
                  const isPlayingStep = previewActiveStep === idx;
                  return (
                    <div
                      key={idx}
                      style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                      className={`text-[9px] font-mono text-center font-bold shrink-0 truncate ${
                        isPlayingStep
                          ? 'text-cyan-300 scale-110'
                          : isHovered
                          ? 'text-white'
                          : val > 0
                          ? 'text-cyan-400'
                          : val < 0
                          ? 'text-amber-400'
                          : 'text-zinc-600'
                      }`}
                    >
                      {val > 0 ? `+${val}` : val}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* フレーム番号 (0, 1, 2... または 4ステップ刻み) */}
            <div className="flex items-center gap-2">
              <span className="w-18 text-[9px] font-medium text-zinc-600 text-right shrink-0">
                FRAME:
              </span>
              <div className="flex-1 flex gap-1">
                {envData.map((_, idx) => (
                  <div
                    key={idx}
                    style={{ width: `${stepWidth}px`, minWidth: `${stepWidth}px` }}
                    className={`text-[8px] font-mono text-center shrink-0 ${
                      idx % 4 === 0 ? 'text-zinc-400 font-semibold' : 'text-zinc-600'
                    }`}
                  >
                    {idx % 4 === 0 || stepWidth >= 24 ? idx : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bento Card: MML出力 & コピー */}
      <div className="p-3 bg-[#12131a] rounded-lg border border-white/[0.08] flex flex-col gap-2 shrink-0 shadow-xs">
        <div className="flex justify-between items-center text-[10px] font-medium text-zinc-400">
          <span className="flex items-center gap-1.5 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            GENERATED PITCH ENVELOPE MML
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(generateMmlSnippet())}
            className="h-6 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 border border-white/10 transition-colors text-[10px] cursor-pointer shadow-xs flex items-center gap-1"
          >
            <Copy className="w-3 h-3 text-zinc-400" />
            <span>COPY TO CLIPBOARD</span>
          </button>
        </div>
        <div className="bg-[#0c0d12] p-2.5 rounded border border-white/[0.06] font-mono text-cyan-300 text-xs tracking-wide select-all overflow-x-auto shadow-inner whitespace-pre-wrap">
          {generateMmlSnippet()}
        </div>
      </div>
    </div>
  );
}
