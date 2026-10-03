import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Zap,
  FlipHorizontal,
  ArrowUpDown,
  Trash2,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Sparkles
} from 'lucide-react';
import { isIdDefined, loadPitchSweepDefinition } from '../utils/mmlDefinitionLoader';
import { DefinitionIdInput } from './DefinitionIdInput';
import { TestNoteButton } from './components/TestNoteButton';
import { virtualSynth } from '../utils/virtualSynth';
import { MmlLiveDock } from './MmlLiveDock';

const MAX_FRAMES = 128;

// 選択可能ピッチレンジ定義 (PSGトーン周期レジスタ差分値: C4 Period=427基準で 1オクターブ上昇 ≒ +213, 2オクターブ上昇 ≒ +320)
// コンポーネント内でのみ使用するため非 export (fast refresh 制約回避)
const PITCH_RANGES = [
  { value: 25, label: '±25 (Subtle)', desc: '微小ベンド・デチューン (C4基準で約1半音)' },
  { value: 50, label: '±50 (Moderate)', desc: '中ベンド (C4基準で約2半音)' },
  { value: 100, label: '±100 (Wide)', desc: 'ワイドベンド (C4基準で約半オクターブ)' },
  { value: 200, label: '±200 (1 Octave / C4)', desc: '約1オクターブ (C4基準 +213)' },
  { value: 400, label: '±400 (2 Octaves / C4)', desc: '約2オクターブ (C4基準 +320 / レーザー音)' },
  { value: 800, label: '±800 (Extreme)', desc: '極大ピッチスイープ・ダイナミック効果音' },
];

export type SweepCurveType = 'linear' | 'easeIn' | 'easeOut' | 'sCurve';

interface SweepPreset {
  name: string;
  desc: string;
  direction: 'up' | 'down';
  delay: number;
  duration: number;
  curve: SweepCurveType;
  depth: number;
  range: number;
  data: number[];
  loopPoint: number;
}

const PRESETS: Record<string, SweepPreset> = {
  laser_drop: {
    name: 'LASER DROP',
    desc: '高音から急激に落ちるレーザー・効果音 (約2オクターブ急降下)',
    direction: 'down',
    delay: 0,
    duration: 16,
    curve: 'easeIn',
    depth: 300,
    range: 400,
    data: [
      0, -8, -20, -45, -80, -125, -180, -230, -270, -290, -300, -300,
      -300, -300, -300, -300, -300, -300, -300, -300, -300, -300, -300, -300
    ],
    loopPoint: -1,
  },
  fast_bend_up: {
    name: 'FAST BEND UP',
    desc: '低音から素早く立ち上がるベンドアップ (約1オクターブ上昇)',
    direction: 'up',
    delay: 0,
    duration: 14,
    curve: 'easeOut',
    depth: 200,
    range: 200,
    data: [
      0, 50, 95, 130, 155, 175, 188, 195, 198, 200, 200, 200,
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200
    ],
    loopPoint: -1,
  },
  delayed_sweep: {
    name: 'DELAYED SWEEP',
    desc: 'ストレート発音後にスイープ開始',
    direction: 'up',
    delay: 8,
    duration: 16,
    curve: 'linear',
    depth: 150,
    range: 200,
    data: [
      0, 0, 0, 0, 0, 0, 0, 0,
      10, 20, 30, 45, 60, 75, 90, 105, 120, 135, 145, 150, 150, 150, 150, 150
    ],
    loopPoint: -1,
  },
  slow_dive: {
    name: 'SLOW DIVE',
    desc: 'ゆっくり沈み込む重低音スイープ',
    direction: 'down',
    delay: 0,
    duration: 24,
    curve: 'linear',
    depth: 350,
    range: 400,
    data: [
      0, -15, -30, -45, -60, -75, -90, -105, -120, -135, -150, -165,
      -180, -195, -210, -225, -240, -255, -270, -285, -300, -320, -340, -350
    ],
    loopPoint: -1,
  },
  hyper_jump: {
    name: 'HYPER JUMP',
    desc: 'SF風の超急上昇スイープ (約2オクターブ以上急上昇)',
    direction: 'up',
    delay: 2,
    duration: 20,
    curve: 'easeIn',
    depth: 380,
    range: 400,
    data: [
      0, 0, 10, 25, 45, 75, 115, 165, 220, 275, 320, 350,
      370, 378, 380, 380, 380, 380, 380, 380, 380, 380, 380, 380
    ],
    loopPoint: -1,
  },
};

/** カーブ計算関数 */
function calculateCurveProgress(t: number, curve: SweepCurveType, tension: number): number {
  const clampedT = Math.max(0, Math.min(1, t));

  // tensionスライダー優先 (-1.0〜+1.0)
  if (Math.abs(tension) > 0.05) {
    if (tension > 0) {
      // Ease Out (減速・凸)
      return 1 - Math.pow(1 - clampedT, 1 + tension * 3);
    } else {
      // Ease In (加速・凹)
      return Math.pow(clampedT, 1 + (-tension) * 3);
    }
  }

  switch (curve) {
    case 'easeIn':
      return Math.pow(clampedT, 2.5);
    case 'easeOut':
      return 1 - Math.pow(1 - clampedT, 2.5);
    case 'sCurve':
      return clampedT < 0.5
        ? 2 * clampedT * clampedT
        : 1 - Math.pow(-2 * clampedT + 2, 2) / 2;
    case 'linear':
    default:
      return clampedT;
  }
}

/** スイープ波形生成関数 (コンポーネント内でのみ使用するため非 export: fast refresh 制約回避) */
function generateSweepWaveform(options: {
  totalFrames: number;
  direction: 'up' | 'down';
  delay: number;
  duration: number;
  curve: SweepCurveType;
  tension: number;
  depth: number;
}): number[] {
  const { totalFrames, direction, delay, duration, curve, tension, depth } = options;
  const result: number[] = new Array(totalFrames).fill(0);
  const dur = Math.max(1, duration);

  for (let i = 0; i < totalFrames; i++) {
    if (i < delay) {
      result[i] = 0;
    } else if (i < delay + dur) {
      const t = (i - delay) / Math.max(1, dur - 1);
      const progress = calculateCurveProgress(t, curve, tension);
      const value = Math.round(progress * depth);
      result[i] = direction === 'up' ? value : -value;
    } else {
      result[i] = direction === 'up' ? depth : -depth;
    }
  }

  return result;
}

// デフォルト24フレームの初期スイープデータ (Fast Bend Up)
const createInitialSweepData = (): number[] => {
  return generateSweepWaveform({
    totalFrames: 24,
    direction: 'up',
    delay: 0,
    duration: 14,
    curve: 'easeOut',
    tension: 0.5,
    depth: 150,
  });
};

export interface PitchSweepEditorProps {
  onChangeEnvData?: (data: number[], loopPoint: number) => void;
  loadEnvId?: { id: number; requestNo: number } | null;
  mmlSource?: string;
  onApplyToMml?: (snippet: string, id: number) => void;
  testMidiNote?: number;
  onChangeTestMidiNote?: (note: number) => void;
}

export function PitchSweepEditor({
  onChangeEnvData,
  loadEnvId,
  mmlSource = '',
  onApplyToMml,
  testMidiNote = 60,
  onChangeTestMidiNote,
}: PitchSweepEditorProps = {}) {
  // ピッチ変調データ列
  const [envData, setEnvData] = useState<number[]>(createInitialSweepData);
  // ループ開始位置 (-1 = なし)
  const [loopPoint, setLoopPoint] = useState<number>(-1);
  // ピッチレンジ (±25, ±50, ±100, ±200, ±400, ±800)
  const [pitchRange, setPitchRange] = useState<number>(200);

  // 定義番号 (@PS1)
  const [envNumber, setEnvNumber] = useState<number>(1);
  // 定義名
  const [envName, setEnvName] = useState<string>('');

  // 波形ジェネレーターパラメータ
  const [generatorDirection, setGeneratorDirection] = useState<'up' | 'down'>('up');
  const [generatorDelay, setGeneratorDelay] = useState<number>(0);
  const [generatorDuration, setGeneratorDuration] = useState<number>(16);
  const [generatorDepth, setGeneratorDepth] = useState<number>(150);
  const [generatorCurve, setGeneratorCurve] = useState<SweepCurveType>('easeOut');
  const [generatorTension, setGeneratorTension] = useState<number>(0.5);
  const [autoApplyGenerator, setAutoApplyGenerator] = useState<boolean>(true);

  // 親コンポーネントへの変更通知
  useEffect(() => {
    onChangeEnvData?.(envData, loopPoint);
  }, [envData, loopPoint, onChangeEnvData]);

  // 最新 MML の ref
  const mmlSourceRef = useRef(mmlSource);
  useEffect(() => {
    mmlSourceRef.current = mmlSource;
  });

  // loadEnvId の監視
  useEffect(() => {
    if (!loadEnvId) return;
    const { id } = loadEnvId;
    const loaded = mmlSourceRef.current ? loadPitchSweepDefinition(mmlSourceRef.current, id) : null;
    if (loaded) {
      setEnvData(loaded.data);
      setLoopPoint(loaded.loopPoint);
      setEnvName(loaded.name || '');
    } else {
      setEnvData(createInitialSweepData());
      setLoopPoint(-1);
      setEnvName('');
    }
    setEnvNumber(id);
  }, [loadEnvId]);

  // MML 定義済み判定
  const isPitchSweepIdDefined = useMemo(
    () => (mmlSource ? isIdDefined(mmlSource, 'pitchSweep', envNumber) : false),
    [mmlSource, envNumber],
  );

  // ID 変更
  const handleIdChange = (id: number) => {
    setEnvNumber(id);
    const loaded = mmlSource ? loadPitchSweepDefinition(mmlSource, id) : null;
    if (loaded) {
      setEnvData(loaded.data);
      setLoopPoint(loaded.loopPoint);
      setEnvName(loaded.name || '');
    } else {
      setEnvData(createInitialSweepData());
      setLoopPoint(-1);
      setEnvName('');
    }
  };

  // 波形ジェネレーター適用
  const applyGenerator = useCallback((overrideParams?: Partial<{
    direction: 'up' | 'down';
    delay: number;
    duration: number;
    depth: number;
    curve: SweepCurveType;
    tension: number;
  }>) => {
    const direction = overrideParams?.direction ?? generatorDirection;
    const delay = overrideParams?.delay ?? generatorDelay;
    const duration = overrideParams?.duration ?? generatorDuration;
    const depth = overrideParams?.depth ?? generatorDepth;
    const curve = overrideParams?.curve ?? generatorCurve;
    const tension = overrideParams?.tension ?? generatorTension;

    const newWaveform = generateSweepWaveform({
      totalFrames: envData.length,
      direction,
      delay,
      duration,
      curve,
      tension,
      depth,
    });
    setEnvData(newWaveform);
  }, [envData.length, generatorDirection, generatorDelay, generatorDuration, generatorDepth, generatorCurve, generatorTension]);

  // ジェネレーターパラメータ変更ハンドラ
  const updateGeneratorParam = <K extends keyof {
    direction: 'up' | 'down';
    delay: number;
    duration: number;
    depth: number;
    curve: SweepCurveType;
    tension: number;
  }>(key: K, value: any) => {
    if (key === 'direction') setGeneratorDirection(value);
    if (key === 'delay') setGeneratorDelay(value);
    if (key === 'duration') setGeneratorDuration(value);
    if (key === 'depth') setGeneratorDepth(value);
    if (key === 'curve') setGeneratorCurve(value);
    if (key === 'tension') setGeneratorTension(value);

    if (autoApplyGenerator) {
      applyGenerator({ [key]: value });
    }
  };

  // ズーム倍率
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const stepWidth = Math.max(10, Math.round(18 * zoomLevel));
  const barWidth = Math.max(6, Math.min(36, stepWidth - 2));
  const graphHeight = Math.max(120, Math.round(180 * zoomLevel));
  const columnPitch = stepWidth + 4;

  const [hoveredPos, setHoveredPos] = useState<{ step: number; pitch: number } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastDrawnPosRef = useRef<{ step: number; pitch: number } | null>(null);

  // スペースキードラッグスクロール
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const isSpacePressedRef = useRef<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartScrollLeftRef = useRef<number>(0);

  // 試聴ステート
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playbackTimerRef = useRef<number | null>(null);
  const previewNoteRef = useRef<number | null>(null);
  const activeStepRef = useRef<number>(-1);
  const [previewActiveStep, setPreviewActiveStep] = useState<number>(-1);

  // スペースキー検知
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement | null;
        const activeEl = document.activeElement as HTMLElement | null;
        if (
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          target?.isContentEditable ||
          target?.closest('.monaco-editor') ||
          activeEl?.tagName === 'INPUT' ||
          activeEl?.tagName === 'TEXTAREA' ||
          activeEl?.tagName === 'SELECT' ||
          activeEl?.isContentEditable ||
          activeEl?.closest('.monaco-editor')
        ) {
          return;
        }
        e.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
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

  // バーコンテナ上でのマウスホイール操作 (Ctrlなし時: ホバー中ステップのピッチを微調整)
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

      const stepDelta = pitchRange >= 200 ? 5 : 1;
      const delta = e.deltaY < 0 ? stepDelta : -stepDelta;
      setEnvData(prev => {
        const current = prev[step] ?? 0;
        const next = Math.max(-pitchRange, Math.min(pitchRange, current + delta));
        if (next === current) return prev;
        const copy = [...prev];
        copy[step] = next;
        return copy;
      });
    };

    el.addEventListener('wheel', handleBarWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleBarWheel);
    };
  }, [columnPitch, envData.length, pitchRange]);

  // ステップ数変更
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
  };

  // プリセット適用
  const handleApplyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setPitchRange(p.range);
    setGeneratorDirection(p.direction);
    setGeneratorDelay(p.delay);
    setGeneratorDuration(p.duration);
    setGeneratorCurve(p.curve);
    setGeneratorDepth(p.depth);
    setEnvData([...p.data]);
    setLoopPoint(p.loopPoint);
  };

  // 座標からステップとピッチ値を算出
  const calculateStepAndPitch = useCallback(
    (clientX: number, clientY: number): { step: number; pitch: number } | null => {
      const container = barsContainerRef.current;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      if (relX < 0 || relX >= rect.width || relY < 0 || relY >= rect.height) {
        return null;
      }

      const step = Math.floor(relX / columnPitch);
      if (step < 0 || step >= envData.length) return null;

      const halfH = graphHeight / 2;
      const normY = (halfH - relY) / halfH;
      const pitch = Math.max(-pitchRange, Math.min(pitchRange, Math.round(normY * pitchRange)));

      return { step, pitch };
    },
    [columnPitch, envData.length, graphHeight, pitchRange],
  );

  const setStepPitch = useCallback((step: number, pitch: number) => {
    setEnvData(prev => {
      if (step < 0 || step >= prev.length) return prev;
      if (prev[step] === pitch) return prev;
      const copy = [...prev];
      copy[step] = pitch;
      return copy;
    });
  }, []);

  const applyPitchInterpolated = useCallback(
    (stepA: number, pitchA: number, stepB: number, pitchB: number) => {
      const startStep = Math.min(stepA, stepB);
      const endStep = Math.max(stepA, stepB);
      const startPitch = stepA <= stepB ? pitchA : pitchB;
      const endPitch = stepA <= stepB ? pitchB : pitchA;

      setEnvData(prev => {
        const copy = [...prev];
        const count = endStep - startStep;
        if (count === 0) {
          copy[startStep] = endPitch;
          return copy;
        }
        for (let s = startStep; s <= endStep; s++) {
          const t = (s - startStep) / count;
          const p = Math.round(startPitch + (endPitch - startPitch) * t);
          copy[s] = Math.max(-pitchRange, Math.min(pitchRange, p));
        }
        return copy;
      });
    },
    [pitchRange],
  );

  // マウスドラッグハンドラ
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

  const startPan = (clientX: number) => {
    if (!scrollContainerRef.current) return;
    isPanningRef.current = true;
    setIsPanning(true);
    panStartXRef.current = clientX;
    panStartScrollLeftRef.current = scrollContainerRef.current.scrollLeft;

    const onPointerMove = (moveEv: PointerEvent) => {
      if (!isPanningRef.current || !scrollContainerRef.current) return;
      const dx = moveEv.clientX - panStartXRef.current;
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

  // 試聴停止
  const stopAudio = () => {
    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (previewNoteRef.current !== null) {
      virtualSynth.stopNote(previewNoteRef.current);
      previewNoteRef.current = null;
    }
    setIsPlaying(false);
    setPreviewActiveStep(-1);
    activeStepRef.current = -1;
  };

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  // 試聴開始 (KEY ON): PSG 矩形波 + @PS トーン周期差分駆動
  const handlePlayKeyOn = (previewNote?: number) => {
    stopAudio();

    const note = previewNote ?? testMidiNote ?? 60;
    previewNoteRef.current = note;

    virtualSynth.noteOn(note, {
      engine: 'psg',
      volume: 15,
      pitchEnv: envData,
      pitchEnvLoop: loopPoint,
    });

    setIsPlaying(true);

    let currentStep = 0;
    activeStepRef.current = currentStep;
    setPreviewActiveStep(currentStep);

    const frameIntervalMs = 1000 / 60;
    const timer = window.setInterval(() => {
      setPreviewActiveStep(currentStep);
      activeStepRef.current = currentStep;

      currentStep++;
      if (currentStep >= envData.length) {
        if (loopPoint >= 0 && loopPoint < envData.length) {
          currentStep = loopPoint;
        } else {
          stopAudio();
        }
      }
    }, frameIntervalMs);

    playbackTimerRef.current = timer;
  };

  // MMLスニペット生成 (@PSN = { ... })
  const generateMmlSnippet = (): string => {
    const parts: string[] = [];
    for (let i = 0; i < envData.length; i++) {
      if (i === loopPoint) {
        parts.push('|');
      }
      parts.push(envData[i].toString());
    }
    return [
      `@PS${envNumber} = {`,
      `  /* NAME: ${envName || 'UNNAMED'} */`,
      `  ${parts.join(', ')}`,
      `}`,
    ].join('\n');
  };

  // 「MMLに反映」ボタン処理
  const handleApplyToMml = () => {
    const snippet = generateMmlSnippet();
    onApplyToMml?.(snippet, envNumber);
  };

  return (
    <div className="flex flex-col h-full bg-[#090a0f] p-3.5 overflow-hidden font-mono text-zinc-300 gap-3">
      {/* 1. Bento Card: ヘッダー & トランスポート */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#12131a] p-3 rounded-lg border border-white/[0.08] shrink-0 shadow-xs">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="w-4 h-4 text-[#00A8FF]" />
          <h2 className="text-xs font-semibold text-zinc-200 tracking-wide">
            PITCH SWEEP EDITOR
          </h2>
          <span className="text-[10px] text-cyan-300 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 font-medium flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" /> P-SW
          </span>
          <div className="flex items-center ml-2 border-l border-white/10 pl-2.5">
            <DefinitionIdInput
              prefix="@PS"
              value={envNumber}
              isDefined={isPitchSweepIdDefined}
              onChange={handleIdChange}
              maxId={255}
              accentClassName="text-cyan-300"
              badgeTitle={isPitchSweepIdDefined
                ? `@PS${envNumber} は MML に定義済み (反映時は定義を置き換え)`
                : `@PS${envNumber} は MML に未定義 (反映時は最後の定義の後に新規挿入)`}
            />
          </div>
          {/* 名称 (NAME) 入力欄 */}
          <div className="flex items-center gap-1.5 ml-2 border-l border-white/10 pl-2.5">
            <span className="text-[10px] text-zinc-500 font-medium shrink-0">NAME:</span>
            <input
              type="text"
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              className="h-6 w-32 px-2 text-xs bg-zinc-900 border border-white/10 rounded text-zinc-100 focus:border-[#00A8FF] focus:outline-none font-mono placeholder:text-zinc-600"
              placeholder="Sweep Name"
              title="ピッチスイープ名 (MMLに /* NAME: ... */ として記録)"
            />
          </div>
        </div>

        {/* 試聴 & MMLに反映ボタン */}
        <div className="flex items-center gap-2">
          <TestNoteButton
            isPlaying={isPlaying}
            onPlay={(note) => handlePlayKeyOn(note)}
            onStop={stopAudio}
            midiNote={testMidiNote}
            onChangeNote={onChangeTestMidiNote}
            title="Play preview tone with pitch sweep"
          />
          {onApplyToMml && (
            <button
              onClick={handleApplyToMml}
              className="h-6 px-3 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 border border-emerald-600/60 hover:border-emerald-400 font-medium transition-colors flex items-center gap-1.5 text-xs cursor-pointer shadow-xs"
              title={isPitchSweepIdDefined
                ? `@PS${envNumber} の MML定義を置き換え`
                : `@PS${envNumber} を新規定義として最後の定義の後に挿入`}
            >
              <span>▶ MMLに反映</span>
            </button>
          )}
        </div>

        {/* プリセット選択 & ループ情報 */}
        <div className="flex flex-wrap items-center justify-between gap-2 w-full pt-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 text-[10px] font-medium shrink-0">PRESET:</span>
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
          </div>
        </div>
      </div>

      {/* 2. Bento Card: SWEEP GENERATOR (波形生成コントロール) */}
      <div className="bg-[#12131a] p-3 rounded-lg border border-cyan-500/20 shadow-xs shrink-0 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-zinc-200 tracking-wide">
              SWEEP GENERATOR (波形コントロール)
            </span>
            <span className="text-[9px] text-zinc-400">
              パラメータでカーブを生成し、下のグラフで手動微調整できます
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoApplyGenerator}
                onChange={(e) => setAutoApplyGenerator(e.target.checked)}
                className="w-3 h-3 rounded bg-zinc-800 border-zinc-700 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              即時適用 (Auto)
            </label>
            <button
              onClick={() => applyGenerator()}
              className="h-5 px-2.5 rounded bg-cyan-900/60 hover:bg-cyan-800/80 text-cyan-200 border border-cyan-500/40 font-medium transition-colors flex items-center gap-1 text-[10px] cursor-pointer"
              title="現在のパラメータで波形を再生成してグラフに適用"
            >
              <Zap className="w-2.5 h-2.5" />
              <span>波形を生成</span>
            </button>
          </div>
        </div>

        {/* パラメータ操作群 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1 border-t border-white/[0.06] text-xs">
          {/* 方向 */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-zinc-400 font-medium">方向 (Direction):</span>
            <div className="grid grid-cols-2 gap-1 h-6">
              <button
                type="button"
                onClick={() => updateGeneratorParam('direction', 'up')}
                className={`flex items-center justify-center gap-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                  generatorDirection === 'up'
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/60 font-semibold'
                    : 'bg-zinc-900 text-zinc-400 border-white/10 hover:text-zinc-200'
                }`}
              >
                <ArrowUp className="w-2.5 h-2.5" /> 上昇 (UP)
              </button>
              <button
                type="button"
                onClick={() => updateGeneratorParam('direction', 'down')}
                className={`flex items-center justify-center gap-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                  generatorDirection === 'down'
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/60 font-semibold'
                    : 'bg-zinc-900 text-zinc-400 border-white/10 hover:text-zinc-200'
                }`}
              >
                <ArrowDown className="w-2.5 h-2.5" /> 下降 (DN)
              </button>
            </div>
          </div>

          {/* かかり始め (Delay) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-zinc-400 font-medium">かかり始め:</span>
              <span className="text-cyan-300 font-mono">{generatorDelay} frame</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.min(32, envData.length - 2)}
              value={generatorDelay}
              onChange={(e) => updateGeneratorParam('delay', parseInt(e.target.value, 10))}
              className="h-6 w-full accent-cyan-400 cursor-pointer"
              title="スイープが開始するまでの待機フレーム数 (発音直後は 0 を維持)"
            />
          </div>

          {/* 期間 (Duration) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-zinc-400 font-medium">変化期間:</span>
              <span className="text-cyan-300 font-mono">{generatorDuration} frame</span>
            </div>
            <input
              type="range"
              min={2}
              max={envData.length}
              value={generatorDuration}
              onChange={(e) => updateGeneratorParam('duration', parseInt(e.target.value, 10))}
              className="h-6 w-full accent-cyan-400 cursor-pointer"
              title="ディレイ経過後、目標値に到達するまでのフレーム数"
            />
          </div>

          {/* 角度・カーブ具合 (Curve Shape) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-zinc-400 font-medium">角度/カーブ:</span>
              <span className="text-cyan-300 font-mono">
                {generatorTension === 0
                  ? '直線'
                  : generatorTension > 0
                  ? `減速 +${Math.round(generatorTension * 100)}%`
                  : `加速 ${Math.round(generatorTension * 100)}%`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={-100}
                max={100}
                step={5}
                value={Math.round(generatorTension * 100)}
                onChange={(e) => updateGeneratorParam('tension', parseInt(e.target.value, 10) / 100)}
                className="h-6 w-full accent-cyan-400 cursor-pointer"
                title="角度のカーブ具合 (-100%=急加速 Ease In, 0%=直線 Linear, +100%=減速 Ease Out)"
              />
              <button
                type="button"
                onClick={() => updateGeneratorParam('tension', 0)}
                className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[9px] cursor-pointer"
                title="直線 (Linear) にリセット"
              >
                直線
              </button>
            </div>
          </div>

          {/* 変化量 (Depth) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-zinc-400 font-medium">変化量 (Depth):</span>
              <span className="text-cyan-300 font-mono">±{generatorDepth}</span>
            </div>
            <input
              type="range"
              min={1}
              max={pitchRange}
              value={Math.min(pitchRange, generatorDepth)}
              onChange={(e) => updateGeneratorParam('depth', parseInt(e.target.value, 10))}
              className="h-6 w-full accent-cyan-400 cursor-pointer"
              title="目標ピッチ到達量 (選択中のピッチレンジ範囲内)"
            />
          </div>
        </div>
      </div>

      {/* 3. グラフ描画エリア */}
      <div className="flex-1 min-h-[140px] bg-[#0c0d12] rounded-lg border border-white/[0.08] flex flex-col overflow-hidden relative shadow-inner">
        {/* ホバー情報 & 操作ガイド */}
        <div className="h-6 px-3 bg-zinc-950/60 border-b border-white/[0.06] flex items-center justify-between text-[10px] select-none shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-zinc-500">
              {hoveredPos !== null ? (
                <span className="text-cyan-300 font-semibold">
                  STEP {hoveredPos.step} : {hoveredPos.pitch >= 0 ? `+${hoveredPos.pitch}` : hoveredPos.pitch} (
                  レジスタ周期差分 {hoveredPos.pitch >= 0 ? `+${hoveredPos.pitch}` : hoveredPos.pitch})
                </span>
              ) : (
                'グラフをクリック＆ドラッグで波形を手動微調整できます (Space+ドラッグでパン)'
              )}
            </span>
          </div>

          <div className="flex items-center gap-3 text-zinc-500">
            <span>RANGE: ±{pitchRange}</span>
            <span>STEPS: {envData.length}</span>
          </div>
        </div>

        {/* スクロールコンテナ */}
        <div
          ref={scrollContainerRef}
          onPointerDownCapture={isSpacePressed ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            startPan(e.clientX);
          } : undefined}
          className={`flex-1 overflow-x-auto overflow-y-hidden p-3 relative select-none ${
            isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair'
          }`}
        >
          {/* バー描画コンテナ */}
          <div
            ref={barsContainerRef}
            onPointerDown={handleBarsPointerDown}
            onPointerMove={handleBarsPointerMove}
            onPointerUp={handleBarsPointerUp}
            onPointerLeave={() => {
              if (!isDraggingRef.current) setHoveredPos(null);
            }}
            style={{
              width: envData.length * columnPitch,
              height: graphHeight,
            }}
            className="relative flex items-center"
          >
            {/* センターライン (ピッチ 0) */}
            <div
              className="absolute left-0 right-0 h-px bg-white/20 pointer-events-none z-10"
              style={{ top: `${graphHeight / 2}px` }}
            />

            {/* 各ステップのバー描画 */}
            {envData.map((val, stepIdx) => {
              const isLoop = loopPoint === stepIdx;
              const isPreviewActive = previewActiveStep === stepIdx;
              const isHovered = hoveredPos?.step === stepIdx;
              const halfH = graphHeight / 2;
              const barHeight = Math.max(2, Math.round((Math.abs(val) / pitchRange) * (halfH - 2)));
              const isPositive = val >= 0;

              return (
                <div
                  key={stepIdx}
                  style={{
                    width: stepWidth,
                    marginRight: 4,
                  }}
                  className="h-full flex flex-col justify-center items-center relative group"
                >
                  {/* ループマーカーボタン (上部) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLoopPoint(prev => (prev === stepIdx ? -1 : stepIdx));
                    }}
                    title={isLoop ? `Step ${stepIdx} のループを解除` : `Step ${stepIdx} をループ開始点に設定`}
                    className={`absolute top-0 w-full flex justify-center pb-1 text-[8px] font-bold cursor-pointer transition-colors z-20 ${
                      isLoop ? 'text-cyan-300' : 'text-zinc-600 hover:text-zinc-400 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    |
                  </button>

                  {/* 発音ハイライトライン */}
                  {isPreviewActive && (
                    <div className="absolute inset-y-0 w-full bg-cyan-400/20 border-x border-cyan-400/60 pointer-events-none z-0 animate-pulse" />
                  )}

                  {/* ピッチ変調バー (正=上、負=下) */}
                  <div
                    style={{
                      width: barWidth,
                      height: `${barHeight}px`,
                      marginTop: isPositive ? `-${barHeight}px` : undefined,
                      marginBottom: !isPositive ? `-${barHeight}px` : undefined,
                      transformOrigin: isPositive ? 'bottom' : 'top',
                    }}
                    className={`rounded-xs transition-transform duration-75 relative ${
                      isHovered
                        ? 'bg-cyan-300 ring-2 ring-cyan-300/40'
                        : isLoop
                        ? 'bg-cyan-400'
                        : isPositive
                        ? 'bg-[#00A8FF]'
                        : 'bg-amber-400'
                    }`}
                  />

                  {/* ステップ番号 (下部) */}
                  <div className="absolute bottom-0 w-full text-center text-[8px] text-zinc-600 pointer-events-none select-none">
                    {stepIdx % 4 === 0 ? stepIdx : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. ツールバー (レンジ切替・ステップ数・反転・クリア・ズーム) */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#12131a] px-3 py-2 rounded-lg border border-white/[0.08] shrink-0 text-xs shadow-xs">
        <div className="flex items-center gap-3">
          {/* ピッチレンジセレクタ */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 text-[10px]">RANGE:</span>
            <select
              value={pitchRange}
              onChange={(e) => {
                const newRange = parseInt(e.target.value, 10);
                setPitchRange(newRange);
                setEnvData(prev => prev.map(v => Math.max(-newRange, Math.min(newRange, v))));
              }}
              className="h-6 px-1.5 bg-zinc-900 border border-white/10 rounded text-zinc-200 text-xs focus:border-[#00A8FF] focus:outline-none cursor-pointer"
            >
              {PITCH_RANGES.map(r => (
                <option key={r.value} value={r.value} title={r.desc}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* ステップ数変更 */}
          <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
            <span className="text-zinc-500 text-[10px]">LENGTH:</span>
            <input
              type="number"
              min={2}
              max={MAX_FRAMES}
              value={envData.length}
              onChange={(e) => changeLength(parseInt(e.target.value, 10) || envData.length)}
              className="h-6 w-14 px-1.5 bg-zinc-900 border border-white/10 rounded text-zinc-200 text-xs focus:border-[#00A8FF] focus:outline-none text-center"
            />
            <span className="text-[10px] text-zinc-600">frames</span>
          </div>

          {/* 変形操作 (反転・クリア) */}
          <div className="flex items-center gap-1 border-l border-white/10 pl-3">
            <button
              onClick={() => setEnvData(prev => prev.map(v => -v))}
              className="h-6 px-2 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors flex items-center gap-1 text-[10px] cursor-pointer"
              title="上下反転 (上昇 ⇔ 下降)"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>反転</span>
            </button>
            <button
              onClick={() => setEnvData(prev => [...prev].reverse())}
              className="h-6 px-2 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors flex items-center gap-1 text-[10px] cursor-pointer"
              title="左右反転 (タイムリバース)"
            >
              <FlipHorizontal className="w-3 h-3" />
              <span>逆再生</span>
            </button>
            <button
              onClick={() => {
                setEnvData(new Array(envData.length).fill(0));
                setLoopPoint(-1);
              }}
              className="h-6 px-2 rounded bg-zinc-900 hover:bg-red-950/50 text-zinc-400 hover:text-red-300 border border-white/10 hover:border-red-500/40 transition-colors flex items-center gap-1 text-[10px] cursor-pointer"
              title="全ステップを 0 (リセット) にクリア"
            >
              <Trash2 className="w-3 h-3" />
              <span>クリア</span>
            </button>
          </div>
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

      {/* 5. MML Live Dock (チラ見えボトムドック) */}
      <div className="shrink-0">
        <MmlLiveDock
          title="PITCH SWEEP MML"
          code={generateMmlSnippet()}
          onApplyToMml={onApplyToMml ? handleApplyToMml : undefined}
        />
      </div>
    </div>
  );
}
