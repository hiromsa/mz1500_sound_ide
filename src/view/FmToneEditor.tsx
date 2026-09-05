import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  ChevronUp, 
  ChevronDown, 
  Play, 
  Square, 
  Copy, 
  ClipboardPaste, 
  AudioWaveform 
} from 'lucide-react';

// ==========================================
// YM2151 (OPM) 4-Operator FM 音色データ型定義・アルゴリズム純粋ロジック
// ==========================================
// UI とロジックの疎結合のため、型定義とアルゴリズム計算は src/core/fm/FmTone.ts へ移管。
// 他モジュールからの型利用は core/fm/FmTone を直接 import すること。
import {
  type FmToneData,
  type OperatorParams,
  isOpCarrier,
  getOpSources,
  OP_MODULATION_TARGETS,
} from '../core/fm/FmTone';

// プリセット音色定義
const PRESET_TONES: FmToneData[] = [
  {
    id: 1,
    name: 'E.PIANO 1',
    alg: 4,
    fb: 6,
    ops: [
      { tl: 45, ar: 31, d1r: 12, d1l: 3, d2r: 4, rr: 10, mul: 1, dt1: 0, dt2: 0, ks: 1, ame: false },
      { tl: 24, ar: 31, d1r: 18, d1l: 6, d2r: 2, rr: 8,  mul: 1, dt1: 3, dt2: 0, ks: 1, ame: false },
      { tl: 32, ar: 31, d1r: 14, d1l: 4, d2r: 3, rr: 9,  mul: 14,dt1: 0, dt2: 0, ks: 2, ame: false },
      { tl: 0,  ar: 31, d1r: 8,  d1l: 2, d2r: 1, rr: 7,  mul: 1, dt1: 0, dt2: 0, ks: 1, ame: false },
    ],
  },
  {
    id: 2,
    name: 'SLAP BASS',
    alg: 2,
    fb: 7,
    ops: [
      { tl: 28, ar: 31, d1r: 22, d1l: 5, d2r: 10, rr: 12, mul: 1, dt1: 2, dt2: 0, ks: 2, ame: false },
      { tl: 40, ar: 31, d1r: 18, d1l: 4, d2r: 8,  rr: 10, mul: 2, dt1: 0, dt2: 0, ks: 1, ame: false },
      { tl: 15, ar: 31, d1r: 25, d1l: 8, d2r: 12, rr: 14, mul: 1, dt1: 1, dt2: 0, ks: 2, ame: false },
      { tl: 0,  ar: 31, d1r: 12, d1l: 3, d2r: 0,  rr: 8,  mul: 1, dt1: 0, dt2: 0, ks: 1, ame: false },
    ],
  },
  {
    id: 3,
    name: 'BRASS ENSEMBLE',
    alg: 5,
    fb: 5,
    ops: [
      { tl: 38, ar: 24, d1r: 10, d1l: 2, d2r: 2, rr: 8,  mul: 1, dt1: 0, dt2: 0, ks: 1, ame: false },
      { tl: 8,  ar: 20, d1r: 8,  d1l: 3, d2r: 1, rr: 6,  mul: 1, dt1: 4, dt2: 0, ks: 1, ame: false },
      { tl: 12, ar: 22, d1r: 9,  d1l: 2, d2r: 2, rr: 7,  mul: 1, dt1: 1, dt2: 0, ks: 1, ame: false },
      { tl: 0,  ar: 20, d1r: 6,  d1l: 2, d2r: 0, rr: 6,  mul: 1, dt1: 0, dt2: 0, ks: 1, ame: false },
    ],
  },
  {
    id: 4,
    name: 'CRYSTAL BELL',
    alg: 7,
    fb: 0,
    ops: [
      { tl: 10, ar: 31, d1r: 10, d1l: 1, d2r: 4, rr: 8,  mul: 1,  dt1: 0, dt2: 0, ks: 1, ame: false },
      { tl: 18, ar: 31, d1r: 14, d1l: 3, d2r: 6, rr: 10, mul: 3,  dt1: 2, dt2: 0, ks: 2, ame: false },
      { tl: 22, ar: 31, d1r: 18, d1l: 5, d2r: 8, rr: 12, mul: 7,  dt1: 5, dt2: 0, ks: 2, ame: false },
      { tl: 0,  ar: 31, d1r: 8,  d1l: 2, d2r: 2, rr: 6,  mul: 11, dt1: 1, dt2: 0, ks: 3, ame: false },
    ],
  },
];

// YM2151 (OPM) アルゴリズムにおけるキャリア判定・変調関係・FM接続マトリクスは
// src/core/fm/FmTone.ts (UI 非依存の純粋ロジック) に実装し再エクスポート済み。

const OP_NAMES = ['OP1 (M1)', 'OP2 (C1)', 'OP3 (M2)', 'OP4 (C2)'];

// ==========================================
// アルゴリズムの接続ブロック図アイコン (SVG - Linear Style)
// ==========================================
function AlgDiagramIcon({ alg, active }: { alg: number; active: boolean }) {
  // 線の色 (通常時は落ち着いた半透明グレー、アクティブ時のみクリアブルー)
  const lineColor = active ? '#00A8FF' : 'rgba(255, 255, 255, 0.2)';
  const arrowColor = active ? '#00A8FF' : 'rgba(255, 255, 255, 0.25)';

  // オペレータボックス描画関数 (14x14, 番号入り)
  const renderBox = (opNum: number, cx: number, cy: number, isCarrier: boolean) => {
    let bg = '#2D2D2D';         // 通常時モジュレータ: パネル色
    let border = '#484848';     // 通常時枠線
    let text = '#A1A1AA';       // 通常時文字

    if (isCarrier) {
      bg = active ? '#FFFFFF' : '#3A3A3A'; // キャリア: 白塗りまたはライトグレー
      border = active ? '#00A8FF' : '#484848';
      text = active ? '#1E1E1E' : '#FFFFFF';
    } else {
      // モジュレータ
      if (active) {
        bg = '#1E293B';       // 選択時モジュレータ: 暗青中抜き
        border = '#00A8FF';   // クリアブルー枠
        text = '#F8FAFC';     // 白文字
      }
    }

    return (
      <g key={opNum}>
        <rect
          x={cx - 7}
          y={cy - 7}
          width={14}
          height={14}
          fill={bg}
          stroke={border}
          strokeWidth={active ? 1.5 : 1.2}
          rx={1.5}
        />
        <text
          x={cx}
          y={cy + 0.5}
          fill={text}
          fontSize="9.5"
          fontWeight="900"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {opNum}
        </text>
      </g>
    );
  };

  // 下向き矢印描画関数 (↓)
  const renderArrow = (cx: number, startY: number, endY: number) => {
    return (
      <g key={`arr-${cx}-${startY}`}>
        <line
          x1={cx}
          y1={startY}
          x2={cx}
          y2={endY}
          stroke={arrowColor}
          strokeWidth={1.5}
        />
        <path
          d={`M ${cx - 3.5} ${endY - 3.5} L ${cx} ${endY} L ${cx + 3.5} ${endY - 3.5}`}
          fill="none"
          stroke={arrowColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  };

  // OP1の自己フィードバックループ描画関数 (OP1から出てOP1に入る配線)
  const renderFeedbackLoop = (cx: number, cy: number, dir: 'right' | 'left' | 'top') => {
    const loopColor = active ? '#00A8FF' : '#52525B';
    if (dir === 'right') {
      return (
        <g key="fb-loop">
          <path
            d={`M ${cx + 7} ${cy - 3} H ${cx + 12} V ${cy + 3} H ${cx + 7}`}
            fill="none"
            stroke={loopColor}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
          <path
            d={`M ${cx + 9} ${cy + 1.2} L ${cx + 7} ${cy + 3} L ${cx + 9} ${cy + 4.8}`}
            fill="none"
            stroke={loopColor}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    } else if (dir === 'left') {
      return (
        <g key="fb-loop">
          <path
            d={`M ${cx - 7} ${cy - 3} H ${cx - 12} V ${cy + 3} H ${cx - 7}`}
            fill="none"
            stroke={loopColor}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
          <path
            d={`M ${cx - 9} ${cy + 1.2} L ${cx - 7} ${cy + 3} L ${cx - 9} ${cy + 4.8}`}
            fill="none"
            stroke={loopColor}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    } else {
      return (
        <g key="fb-loop">
          <path
            d={`M ${cx - 3} ${cy - 7} V ${cy - 12} H ${cx + 3} V ${cy - 7}`}
            fill="none"
            stroke={loopColor}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
          <path
            d={`M ${cx + 1.2} ${cy - 9} L ${cx + 3} ${cy - 7} L ${cx + 4.8} ${cy - 9}`}
            fill="none"
            stroke={loopColor}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }
  };

  return (
    <svg className="w-[58px] h-[66px] shrink-0 pointer-events-none select-none" viewBox="0 0 68 76">
      {alg === 0 && (
        // ALG 0: 1 -> 2 -> 3 -> 4 -> ↓ (OP1にFB)
        <g>
          <line x1={34} y1={17} x2={34} y2={20} stroke={lineColor} strokeWidth={1.5} />
          <line x1={34} y1={34} x2={34} y2={37} stroke={lineColor} strokeWidth={1.5} />
          <line x1={34} y1={51} x2={34} y2={54} stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(34, 68, 74)}
          {renderFeedbackLoop(34, 10, 'right')}
          {renderBox(1, 34, 10, false)}
          {renderBox(2, 34, 27, false)}
          {renderBox(3, 34, 44, false)}
          {renderBox(4, 34, 61, true)}
        </g>
      )}

      {alg === 1 && (
        // ALG 1: (1 + 2) -> 3 -> 4 -> ↓ (OP1にFB)
        <g>
          <line x1={21} y1={17} x2={21} y2={23} stroke={lineColor} strokeWidth={1.5} />
          <line x1={47} y1={17} x2={47} y2={23} stroke={lineColor} strokeWidth={1.5} />
          <line x1={21} y1={23} x2={47} y2={23} stroke={lineColor} strokeWidth={1.5} />
          <line x1={34} y1={23} x2={34} y2={26} stroke={lineColor} strokeWidth={1.5} />
          <line x1={34} y1={40} x2={34} y2={49} stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(34, 63, 71)}
          {renderFeedbackLoop(21, 10, 'left')}
          {renderBox(1, 21, 10, false)}
          {renderBox(2, 47, 10, false)}
          {renderBox(3, 34, 33, false)}
          {renderBox(4, 34, 56, true)}
        </g>
      )}

      {alg === 2 && (
        // ALG 2: 右に 2 -> 3、左に 1、合流して 4 -> ↓ (OP1にFB)
        <g>
          <line x1={47} y1={17} x2={47} y2={26} stroke={lineColor} strokeWidth={1.5} />
          <line x1={21} y1={40} x2={21} y2={49} stroke={lineColor} strokeWidth={1.5} />
          <path d="M 47 40 L 47 44.5 L 21 44.5" fill="none" stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(21, 63, 71)}
          {renderFeedbackLoop(21, 33, 'left')}
          {renderBox(2, 47, 10, false)}
          {renderBox(1, 21, 33, false)}
          {renderBox(3, 47, 33, false)}
          {renderBox(4, 21, 56, true)}
        </g>
      )}

      {alg === 3 && (
        // ALG 3: 右に 1 -> 2、左に 3、合流して 4 -> ↓ (OP1にFB)
        <g>
          <line x1={47} y1={17} x2={47} y2={26} stroke={lineColor} strokeWidth={1.5} />
          <line x1={21} y1={40} x2={21} y2={49} stroke={lineColor} strokeWidth={1.5} />
          <path d="M 47 40 L 47 44.5 L 21 44.5" fill="none" stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(21, 63, 71)}
          {renderFeedbackLoop(47, 10, 'right')}
          {renderBox(1, 47, 10, false)}
          {renderBox(3, 21, 33, false)}
          {renderBox(2, 47, 33, false)}
          {renderBox(4, 21, 56, true)}
        </g>
      )}

      {alg === 4 && (
        // ALG 4: (1 -> 2 -> ↓) + (3 -> 4 -> ↓) (OP1にFB)
        <g>
          <line x1={21} y1={25} x2={21} y2={45} stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(21, 59, 68)}
          <line x1={47} y1={25} x2={47} y2={45} stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(47, 59, 68)}
          {renderFeedbackLoop(21, 18, 'left')}
          {renderBox(1, 21, 18, false)}
          {renderBox(2, 21, 52, true)}
          {renderBox(3, 47, 18, false)}
          {renderBox(4, 47, 52, true)}
        </g>
      )}

      {alg === 5 && (
        // ALG 5: 1 -> (2 + 3 + 4) -> ↓ ↓ ↓ (OP1にFB)
        <g>
          <line x1={34} y1={25} x2={34} y2={35} stroke={lineColor} strokeWidth={1.5} />
          <line x1={15} y1={35} x2={53} y2={35} stroke={lineColor} strokeWidth={1.5} />
          <line x1={15} y1={35} x2={15} y2={45} stroke={lineColor} strokeWidth={1.5} />
          <line x1={34} y1={35} x2={34} y2={45} stroke={lineColor} strokeWidth={1.5} />
          <line x1={53} y1={35} x2={53} y2={45} stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(15, 59, 68)}
          {renderArrow(34, 59, 68)}
          {renderArrow(53, 59, 68)}
          {renderFeedbackLoop(34, 18, 'right')}
          {renderBox(1, 34, 18, false)}
          {renderBox(2, 15, 52, true)}
          {renderBox(3, 34, 52, true)}
          {renderBox(4, 53, 52, true)}
        </g>
      )}

      {alg === 6 && (
        // ALG 6: (1 -> 2 -> ↓) + (3 -> ↓) + (4 -> ↓) (OP1にFB)
        <g>
          <line x1={15} y1={25} x2={15} y2={45} stroke={lineColor} strokeWidth={1.5} />
          {renderArrow(15, 59, 68)}
          {renderArrow(34, 59, 68)}
          {renderArrow(53, 59, 68)}
          {renderFeedbackLoop(15, 18, 'left')}
          {renderBox(1, 15, 18, false)}
          {renderBox(2, 15, 52, true)}
          {renderBox(3, 34, 52, true)}
          {renderBox(4, 53, 52, true)}
        </g>
      )}

      {alg === 7 && (
        // ALG 7: 1 + 2 + 3 + 4 (すべて並列, OP1にFB)
        <g>
          {renderArrow(10, 41, 52)}
          {renderArrow(26, 41, 52)}
          {renderArrow(42, 41, 52)}
          {renderArrow(58, 41, 52)}
          {renderFeedbackLoop(10, 34, 'top')}
          {renderBox(1, 10, 34, true)}
          {renderBox(2, 26, 34, true)}
          {renderBox(3, 42, 34, true)}
          {renderBox(4, 58, 34, true)}
        </g>
      )}
    </svg>
  );
}

// ==========================================
// アルゴリズム全体のシグナルフロー表示バー (静的インフォメーション表示)
// ==========================================
function AlgFlowBanner({ alg, fb }: { alg: number; fb: number }) {
  const getOpBadge = (opIdx: number) => {
    const isCarrier = isOpCarrier(alg, opIdx);
    const hasFb = opIdx === 0 && fb > 0;
    return (
      <span key={opIdx} className="inline-flex items-center gap-0.5">
        <span className={isCarrier ? 'text-slate-200 font-bold underline decoration-slate-500 underline-offset-2' : 'text-slate-400'}>
          OP{opIdx + 1}
        </span>
        {hasFb && <span className="text-amber-500/90 text-[9px]">⟲{fb}</span>}
        {isCarrier && <span className="text-[9px] text-slate-500 font-normal ml-0.5">(out)</span>}
      </span>
    );
  };

  const arrow = <span className="text-slate-600 font-mono text-[10px]">➜</span>;
  const parallelPlus = <span className="text-slate-600 font-mono text-[10px]">+</span>;
  const dacOut = <span className="text-slate-500 text-[10px] font-mono">OUT</span>;

  return (
    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1 py-1 mb-2 shrink-0 select-none">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-slate-500 font-bold tracking-wider">
          SIGNAL ROUTE:
        </span>

        {/* 各ALG固有のチェーンフロー表示 */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          {alg === 0 && (
            <>
              {getOpBadge(0)} {arrow} {getOpBadge(1)} {arrow} {getOpBadge(2)} {arrow} {getOpBadge(3)} {arrow} {dacOut}
            </>
          )}
          {alg === 1 && (
            <>
              <span className="text-slate-600">(</span>
              {getOpBadge(0)} {parallelPlus} {getOpBadge(1)}
              <span className="text-slate-600">)</span>
              {arrow} {getOpBadge(2)} {arrow} {getOpBadge(3)} {arrow} {dacOut}
            </>
          )}
          {alg === 2 && (
            <>
              <span className="text-slate-600">(</span>
              {getOpBadge(0)} {parallelPlus}
              <span className="text-slate-600">(</span>
              {getOpBadge(1)} {arrow} {getOpBadge(2)}
              <span className="text-slate-600">)</span>
              <span className="text-slate-600">)</span>
              {arrow} {getOpBadge(3)} {arrow} {dacOut}
            </>
          )}
          {alg === 3 && (
            <>
              <span className="text-slate-600">(</span>
              <span className="text-slate-600">(</span>
              {getOpBadge(0)} {arrow} {getOpBadge(1)}
              <span className="text-slate-600">)</span>
              {parallelPlus} {getOpBadge(2)}
              <span className="text-slate-600">)</span>
              {arrow} {getOpBadge(3)} {arrow} {dacOut}
            </>
          )}
          {alg === 4 && (
            <>
              <span className="text-slate-600">(</span>
              {getOpBadge(0)} {arrow} {getOpBadge(1)} {arrow} {dacOut}
              <span className="text-slate-600">)</span>
              {parallelPlus}
              <span className="text-slate-600">(</span>
              {getOpBadge(2)} {arrow} {getOpBadge(3)} {arrow} {dacOut}
              <span className="text-slate-600">)</span>
            </>
          )}
          {alg === 5 && (
            <>
              {getOpBadge(0)} {arrow}
              <span className="text-slate-600">(</span>
              {getOpBadge(1)} {parallelPlus} {getOpBadge(2)} {parallelPlus} {getOpBadge(3)}
              <span className="text-slate-600">)</span>
              {arrow} {dacOut}
            </>
          )}
          {alg === 6 && (
            <>
              <span className="text-slate-600">(</span>
              {getOpBadge(0)} {arrow} {getOpBadge(1)}
              <span className="text-slate-600">)</span>
              {parallelPlus} {getOpBadge(2)} {parallelPlus} {getOpBadge(3)} {arrow} {dacOut}
            </>
          )}
          {alg === 7 && (
            <>
              {getOpBadge(0)} {parallelPlus} {getOpBadge(1)} {parallelPlus} {getOpBadge(2)} {parallelPlus} {getOpBadge(3)} {arrow} {dacOut}
              <span className="text-[9px] text-slate-500 font-mono ml-1">[ALL PARALLEL]</span>
            </>
          )}
        </div>
      </div>

      <div className="text-[9px] text-slate-500 font-mono hidden sm:block">
        ※下線: キャリア出力 (out)
      </div>
    </div>
  );
}

// ==========================================
// オペレータのインタラクティブ・エンベロープCanvasグラフ
// ==========================================
interface EnvelopeCanvasProps {
  ar: number;
  d1r: number;
  d1l: number;
  d2r: number;
  rr: number;
  isCarrier: boolean;
  onChange: (patch: { ar?: number; d1r?: number; d1l?: number; d2r?: number; rr?: number }, mode?: 'absolute' | 'relative') => void;
}

type NodeKey = 'AR' | 'D1' | 'D2' | 'RR';

function OperatorEnvelopeCanvas({ ar, d1r, d1l, d2r, rr, isCarrier: _isCarrier, onChange }: EnvelopeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<NodeKey | null>(null);

  // ドラッグ追跡用 Ref (開始座標と開始時のパラメータ値を保持)
  const dragStateRef = useRef<{
    node: NodeKey;
    startX: number;
    startY: number;
    initialValues: { ar: number; d1r: number; d1l: number; d2r: number; rr: number };
  } | null>(null);

  // パラメータから各ノードの座標 (0〜1正規化比率) を計算
  // X軸: 0〜1.0 (0.0: Attack開始, 0.2: Attack完了, 0.45: D1L完了, 0.70: Key-Off, 1.0: Release完了)
  // AR (0〜31): 大きいほど急激 (X座標が短い)
  const attackWidth = Math.max(0.02, 0.25 * (1 - ar / 31));
  const peakX = attackWidth;
  const peakY = 0.10; // ピークレベル

  // D1R (0〜31): 大きいほど急激
  const decay1Width = Math.max(0.04, 0.28 * (1 - d1r / 31));
  const d1X = Math.min(0.65, peakX + decay1Width);
  // D1L (0〜15): 0が最大レベル(上端)、15が無音(下端)
  const d1Y = 0.14 + (d1l / 15) * 0.72;

  // D2R (0〜31): Key-Off (X=0.72) までの減衰
  const keyOffX = 0.72;
  const d2Drop = (d2r / 31) * (0.90 - d1Y) * 0.8;
  const keyOffY = Math.min(0.90, d1Y + d2Drop);

  // RR (0〜31): Key-Off後の減衰速度
  const releaseWidth = Math.max(0.03, 0.25 * (1 - rr / 31));
  const endX = Math.min(0.98, keyOffX + releaseWidth);
  const endY = 0.90; // 無音レベル

  // ノード種別ごとのカーソル形状
  const getNodeCursor = (node: NodeKey | null): string => {
    switch (node) {
      case 'AR': return 'ew-resize';
      case 'D1': return 'move';
      case 'D2': return 'ns-resize';
      case 'RR': return 'ew-resize';
      default: return 'default';
    }
  };

  // 描画処理
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバス実寸に合わせたクリスプ描画
    const rect = canvas.getBoundingClientRect();
    const w = rect.width ? Math.round(rect.width) : 300;
    const h = rect.height ? Math.round(rect.height) : 96;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    // 背景クリア (Professional Studio ダーク)
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(0, 0, w, h);

    // 控えめな極薄グリッド線 (Linear Style)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 14) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Key-Off 境界線 (控えめな破線)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(keyOffX * w, 0);
    ctx.lineTo(keyOffX * w, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Key-Off テキスト
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText('KEY OFF', keyOffX * w - 18, 10);

    // エンベロープ折れ線 (主張を抑えたクリーンなライトグレー)
    ctx.strokeStyle = '#D4D4D8';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, endY * h);
    ctx.lineTo(peakX * w, peakY * h);
    ctx.lineTo(d1X * w, d1Y * h);
    ctx.lineTo(keyOffX * w, keyOffY * h);
    ctx.lineTo(endX * w, endY * h);
    ctx.stroke();

    // 各制御ノード (通常時は控えめなグレー、操作・ホバー時のみクリアブルー発光)
    const activeDragNode = dragStateRef.current?.node;
    const drawNode = (nx: number, ny: number, label: NodeKey) => {
      const px = nx * w;
      const py = ny * h;
      const isActive = activeDragNode === label || hoveredNode === label;
      const r = isActive ? 5.5 : 4.5;

      // ホバー/ドラッグ中の発光グロー (クリアブルー)
      if (isActive) {
        ctx.strokeStyle = 'rgba(0, 168, 255, 0.45)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(px, py, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 〇の塗りつぶし (アクティブ時クリアブルー、通常時グレー)
      ctx.fillStyle = isActive ? '#00A8FF' : '#71717A';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      // 〇の外枠
      ctx.strokeStyle = isActive ? '#FFFFFF' : '#A1A1AA';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ノード名テキスト
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = isActive ? '#00A8FF' : 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(label, px - 6, py - 8);
    };

    drawNode(peakX, peakY, 'AR');
    drawNode(d1X, d1Y, 'D1');
    drawNode(keyOffX, keyOffY, 'D2');
    drawNode(endX, endY, 'RR');
  }, [peakX, peakY, d1X, d1Y, keyOffX, keyOffY, endX, endY, hoveredNode]);

  // ピクセル距離による当たり判定（約18pxのゆったりした判定領域）
  const getNodeAtPixel = (canvas: HTMLCanvasElement, clientX: number, clientY: number): NodeKey | null => {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const w = canvas.width;
    const h = canvas.height;
    const HIT_RADIUS = 18;

    const distPx = (nx: number, ny: number) => Math.hypot(px - nx * w, py - ny * h);
    if (distPx(peakX, peakY) <= HIT_RADIUS) return 'AR';
    if (distPx(d1X, d1Y) <= HIT_RADIUS) return 'D1';
    if (distPx(keyOffX, keyOffY) <= HIT_RADIUS) return 'D2';
    if (distPx(endX, endY) <= HIT_RADIUS) return 'RR';
    return null;
  };

  // ポインターダウン (ドラッグ開始)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hit = getNodeAtPixel(canvas, e.clientX, e.clientY);
    if (!hit) return;

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);

    dragStateRef.current = {
      node: hit,
      startX: e.clientX,
      startY: e.clientY,
      initialValues: { ar, d1r, d1l, d2r, rr },
    };
    setHoveredNode(hit);
    canvas.style.cursor = getNodeCursor(hit);
  };

  // ポインター移動 (ホバーおよびドラッグ処理)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const drag = dragStateRef.current;
    if (!drag) {
      // ドラッグしていない時はホバー判定
      const hit = getNodeAtPixel(canvas, e.clientX, e.clientY);
      setHoveredNode(hit);
      canvas.style.cursor = getNodeCursor(hit);
      return;
    }

    // ドラッグ中: 開始位置からの総移動量 (dx, dy) を基に、初期値から滑らかに絶対値を計算
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const init = drag.initialValues;

    if (drag.node === 'AR') {
      // AR (0〜31): 左へドラッグで値増加(急峻)、右で減少。約2.5pxで1ステップ
      const stepChange = -Math.round(dx / 2.5);
      const nextAr = Math.max(0, Math.min(31, init.ar + stepChange));
      onChange({ ar: nextAr }, 'relative');
    } else if (drag.node === 'D1') {
      // D1: XでD1R(左で急減衰=大)、YでD1L(下でレベル低下=大)
      const stepR = -Math.round(dx / 2.5);
      const stepL = Math.round(dy / 4.0);
      const nextD1r = Math.max(0, Math.min(31, init.d1r + stepR));
      const nextD1l = Math.max(0, Math.min(15, init.d1l + stepL));
      onChange({ d1r: nextD1r, d1l: nextD1l }, 'relative');
    } else if (drag.node === 'D2') {
      // D2R (0〜31): 下へドラッグで減衰大(大)、上で減衰なし・持続(小)
      const stepD2r = Math.round(dy / 2.5);
      const nextD2r = Math.max(0, Math.min(31, init.d2r + stepD2r));
      onChange({ d2r: nextD2r }, 'relative');
    } else if (drag.node === 'RR') {
      // RR (0〜31): 左へドラッグで急リリース(大)、右で余韻(小)
      const stepRR = -Math.round(dx / 2.5);
      const nextRR = Math.max(0, Math.min(31, init.rr + stepRR));
      onChange({ rr: nextRR }, 'relative');
    }
  };

  // ポインターアップ / キャンセル (ドラッグ終了)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (dragStateRef.current) {
      if (canvas && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      dragStateRef.current = null;
    }

    if (canvas) {
      const hit = getNodeAtPixel(canvas, e.clientX, e.clientY);
      setHoveredNode(hit);
      canvas.style.cursor = getNodeCursor(hit);
    }
  };

  return (
    <div className="relative w-full h-24 rounded border border-slate-800/80 overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        width={300}
        height={96}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full h-full block touch-none select-none"
        title="AR(↔), D1(✥), D2(↕), RR(↔): ノードをドラッグしてエンベロープ形状を直感調整"
      />
    </div>
  );
}

// ==========================================
// 押しやすいカスタム上下ボタン付き数値スピン入力コンポーネント
// ==========================================
// 押しやすい独立上下スピンボタン付き数値入力コンポーネント (Linear Style)
// ==========================================
interface SpinInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number, mode?: 'relative' | 'absolute') => void;
}

function SpinInput({ label, value, min, max, onChange }: SpinInputProps) {
  const handleStep = (delta: number) => {
    const next = Math.max(min, Math.min(max, value + delta));
    onChange(next, 'relative');
  };

  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      <span className="text-zinc-500 text-[10px] mb-1 font-medium select-none">
        {label}
      </span>
      <div 
        className="w-full flex items-stretch h-7 rounded bg-[#222222] border border-[#3C3C3C] overflow-hidden focus-within:border-[#00A8FF] transition-colors shadow-inner"
      >
        {/* 数値テキストボックス (直接入力時は absolute モード) */}
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => {
            const v = e.target.value === '' ? min : Number(e.target.value);
            onChange(Math.max(min, Math.min(max, v)), 'absolute');
          }}
          className="w-full bg-transparent text-center font-mono font-semibold text-xs text-zinc-100 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none px-1"
        />
        {/* 上下スピンボタン */}
        <div className="flex flex-col w-4.5 border-l border-[#383838] shrink-0 select-none bg-[#1E1E1E]">
          <button
            type="button"
            onClick={() => handleStep(1)}
            disabled={value >= max}
            className="flex-1 flex items-center justify-center hover:bg-[#333333] text-zinc-400 hover:text-zinc-200 disabled:opacity-20 transition-colors cursor-pointer border-b border-[#383838]"
            title="増加 (+1)"
          >
            <ChevronUp className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => handleStep(-1)}
            disabled={value <= min}
            className="flex-1 flex items-center justify-center hover:bg-[#333333] text-zinc-400 hover:text-zinc-200 disabled:opacity-20 transition-colors cursor-pointer"
            title="減少 (-1)"
          >
            <ChevronDown className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 単一オペレータ・エディタパネル (Bento Grid Card)
// ==========================================
interface OperatorPanelProps {
  opIdx: number;
  params: OperatorParams;
  isCarrier: boolean;
  isMuted: boolean;
  isSolo: boolean;
  isSelected: boolean;
  onSelect: (isMulti: boolean) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onChange: (patch: Partial<OperatorParams>, mode?: 'relative' | 'absolute') => void;
  fb: number;
  targets: number[];
  sources: number[];
}

function OperatorPanel({
  opIdx,
  params,
  isCarrier,
  isMuted,
  isSolo,
  isSelected,
  onSelect,
  onToggleMute,
  onToggleSolo,
  onCopy,
  onPaste,
  canPaste,
  onChange,
  fb,
  targets,
  sources,
}: OperatorPanelProps) {
  // パネルの空き領域クリックで選択 (通常クリック: 単一選択 / Shift, Ctrl押下: 複数選択)
  const handlePanelClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('canvas')
    ) {
      return;
    }
    const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
    onSelect(isMulti);
  };

  return (
    <div
      onClick={handlePanelClick}
      className={`rounded-lg border flex flex-col justify-between p-3.5 transition-all text-xs font-mono relative cursor-pointer select-none ${
        isSelected
          ? 'bg-[#181d2a] border-cyan-400 ring-1 ring-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
          : isCarrier
          ? 'bg-[#2D2D2D] border-[#484848] hover:border-[#606060]'
          : 'bg-[#2D2D2D] border-[#3C3C3C] hover:border-[#555555]'
      } ${isMuted ? 'opacity-40' : ''}`}
    >
      {/* オペレータヘッダー */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#3C3C3C] mb-2.5">
        <div className="flex items-center gap-2">
          {/* 選択チェック / トグルボタン */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
              onSelect(isMulti);
            }}
            className={`text-[9px] px-2 py-0.5 rounded font-semibold tracking-wide border transition-all flex items-center gap-1 cursor-pointer ${
              isSelected
                ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                : 'bg-zinc-800/80 text-zinc-400 border-white/10 hover:text-zinc-200 hover:bg-zinc-700'
            }`}
            title={isSelected ? "Click to deselect | Shift/Ctrl + Click: Multi-select" : "Click to select | Shift/Ctrl + Click: Multi-select"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-cyan-400 animate-pulse' : 'bg-zinc-500'}`} />
            <span>{isSelected ? 'SELECTED' : 'SELECT'}</span>
          </button>

          <span className={`font-semibold text-xs tracking-wide ${isSelected ? 'text-cyan-200 font-bold' : 'text-zinc-100'}`}>
            {OP_NAMES[opIdx]}
          </span>
          {/* キャリア / モジュレータ 役割バッジ */}
          <span
            className={`text-[9px] px-2 py-0.5 rounded-full font-medium tracking-wide ${
              isCarrier
                ? 'bg-[#3A3A3A] text-zinc-100'
                : 'bg-[#222222] text-zinc-400'
            }`}
          >
            {isCarrier ? 'CARRIER [OUT]' : 'MODULATOR'}
          </span>
        </div>

        {/* コントロールボタン群 (Mute, Solo, Copy, Paste) */}
        <div className="flex items-center gap-1.5">
          {/* Mute トグル (アクティブ時のみ赤点灯) */}
          <button
            onClick={onToggleMute}
            className={`w-6 h-6 rounded text-xs font-bold border transition-colors cursor-pointer flex items-center justify-center ${
              isMuted
                ? 'bg-[#3A3A3A] text-red-400 border-red-500/60 shadow-xs'
                : 'bg-[#383838] text-zinc-400 border-[#484848] hover:text-zinc-200 hover:bg-[#444444]'
            }`}
            title="Mute this operator in preview"
          >
            M
          </button>

          {/* Solo トグル (アクティブ時のみクリアブルー点灯) */}
          <button
            onClick={onToggleSolo}
            className={`w-6 h-6 rounded text-xs font-bold border transition-colors cursor-pointer flex items-center justify-center ${
              isSolo
                ? 'bg-[#00A8FF]/20 text-[#00A8FF] border-[#00A8FF] shadow-xs font-bold'
                : 'bg-[#383838] text-zinc-400 border-[#484848] hover:text-zinc-200 hover:bg-[#444444]'
            }`}
            title="Solo this operator in preview"
          >
            S
          </button>

          {/* コピー */}
          <button
            onClick={onCopy}
            className="px-2 h-6 rounded text-xs bg-[#383838] text-zinc-300 border border-[#484848] hover:text-white hover:bg-[#444444] transition-colors cursor-pointer flex items-center gap-1"
            title="Copy this operator parameters"
          >
            <Copy className="w-3 h-3 text-zinc-400" />
            <span className="text-[10px]">COPY</span>
          </button>

          {/* ペースト */}
          <button
            onClick={onPaste}
            disabled={!canPaste}
            className={`px-2 h-6 rounded text-xs border transition-colors flex items-center gap-1 ${
              canPaste
                ? 'bg-[#383838] text-[#00A8FF] border-[#00A8FF]/50 hover:bg-[#444444] cursor-pointer'
                : 'bg-[#222222] text-zinc-600 border-[#333333] cursor-not-allowed'
            }`}
            title="Paste copied parameters"
          >
            <ClipboardPaste className="w-3 h-3" />
            <span className="text-[10px]">PASTE</span>
          </button>
        </div>
      </div>

      {/* 配線I/Oステータス表示ストリップ (入力元 ➜ 出力先) */}
      <div className="flex items-center justify-between text-[10px] px-2 py-1 bg-[#222222] rounded border border-[#383838] mb-2.5 font-mono text-zinc-400">
        <div className="flex items-center gap-1">
          <span className="text-zinc-500 font-medium">IN:</span>
          {opIdx === 0 ? (
            fb > 0 ? (
              <span className="text-amber-400/90 font-semibold">⟲FB[{fb}]</span>
            ) : (
              <span className="text-zinc-400">PURE SINE</span>
            )
          ) : sources.length > 0 ? (
            <span className="text-zinc-200 font-medium flex items-center gap-0.5">
              <span>⚡</span> {sources.map(s => `OP${s + 1}`).join(' + ')}
            </span>
          ) : (
            <span className="text-zinc-400">PURE SINE</span>
          )}
        </div>

        <div className="text-zinc-600">➜</div>

        <div className="flex items-center gap-1">
          <span className="text-zinc-500 font-medium">OUT:</span>
          {isCarrier ? (
            <span className="text-zinc-200 font-medium flex items-center gap-1">
              <span>🔊</span> DAC AUDIO
              {targets.length > 0 && (
                <span className="text-zinc-400 text-[9px]">
                  (+OP{targets.map(t => t + 1).join(',')})
                </span>
              )}
            </span>
          ) : targets.length > 0 ? (
            <span className="text-zinc-300 truncate" title={`Modulates OP ${targets.map(t => t + 1).join(', OP ')}`}>
              MOD ➜ OP{targets.map(t => t + 1).join(', OP')}
            </span>
          ) : (
            <span className="text-zinc-600">-</span>
          )}
        </div>
      </div>

      {/* 1. ピッチ系 & 出力レベル (TL, MUL, DT1, DT2) */}
      <div className="grid grid-cols-4 gap-2 mb-2.5 bg-[#222222] p-2.5 rounded border border-[#383838]">
        {/* TL (Total Level 0〜127) */}
        <div className="flex flex-col justify-between">
          <div className="flex justify-between text-zinc-400 text-[10px] mb-1 select-none">
            <span className="text-zinc-500">TL:</span>
            <span className={params.tl === 0 ? 'text-[#00A8FF] font-semibold' : 'text-zinc-200'}>
              {params.tl}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={127}
            value={params.tl}
            onChange={e => onChange({ tl: Number(e.target.value) }, 'relative')}
            className="w-full accent-[#00A8FF] h-1.5 bg-[#181818] rounded cursor-pointer my-auto"
            title="Total Level (0=Max, 127=Mute)"
          />
        </div>

        {/* MUL (0〜15) */}
        <div className="flex flex-col">
          <span className="text-zinc-500 text-[10px] mb-1 select-none">MUL:</span>
          <select
            value={params.mul}
            onChange={e => onChange({ mul: Number(e.target.value) }, 'absolute')}
            className="h-7 bg-[#1A1A1A] text-zinc-200 border border-[#383838] hover:border-[#484848] focus:border-[#00A8FF] rounded px-2 text-xs font-mono cursor-pointer"
          >
            {[...Array(16)].map((_, i) => (
              <option key={i} value={i}>{i === 0 ? '0.5' : i}</option>
            ))}
          </select>
        </div>

        {/* DT1 (0〜7) */}
        <div className="flex flex-col">
          <span className="text-zinc-500 text-[10px] mb-1 select-none">DT1:</span>
          <select
            value={params.dt1}
            onChange={e => onChange({ dt1: Number(e.target.value) }, 'absolute')}
            className="h-7 bg-[#1A1A1A] text-zinc-300 border border-[#383838] hover:border-[#484848] focus:border-[#00A8FF] rounded px-2 text-xs font-mono cursor-pointer"
          >
            {[...Array(8)].map((_, i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>

        {/* DT2 (0〜3) */}
        <div className="flex flex-col">
          <span className="text-zinc-500 text-[10px] mb-1 select-none">DT2:</span>
          <select
            value={params.dt2}
            onChange={e => onChange({ dt2: Number(e.target.value) }, 'absolute')}
            className="h-7 bg-[#1A1A1A] text-zinc-300 border border-[#383838] hover:border-[#484848] focus:border-[#00A8FF] rounded px-2 text-xs font-mono cursor-pointer"
          >
            {[...Array(4)].map((_, i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 2. インタラクティブ Canvas 折れ線エンベロープ表示 */}
      <div className="mb-2.5">
        <OperatorEnvelopeCanvas
          ar={params.ar}
          d1r={params.d1r}
          d1l={params.d1l}
          d2r={params.d2r}
          rr={params.rr}
          isCarrier={isCarrier}
          onChange={(patch, mode) => onChange(patch, mode || 'relative')}
        />
      </div>

      {/* 3. エンベロープ数値スピンボックス (AR, D1R, D1L, D2R, RR) */}
      <div className="grid grid-cols-5 gap-2 bg-[#222222] p-2.5 rounded border border-[#383838]">
        <SpinInput
          label="AR"
          value={params.ar}
          min={0}
          max={31}
          onChange={(ar, mode) => onChange({ ar }, mode)}
        />
        <SpinInput
          label="D1R"
          value={params.d1r}
          min={0}
          max={31}
          onChange={(d1r, mode) => onChange({ d1r }, mode)}
        />
        <SpinInput
          label="D1L"
          value={params.d1l}
          min={0}
          max={15}
          onChange={(d1l, mode) => onChange({ d1l }, mode)}
        />
        <SpinInput
          label="D2R"
          value={params.d2r}
          min={0}
          max={31}
          onChange={(d2r, mode) => onChange({ d2r }, mode)}
        />
        <SpinInput
          label="RR"
          value={params.rr}
          min={0}
          max={31}
          onChange={(rr, mode) => onChange({ rr }, mode)}
        />
      </div>
    </div>
  );
}

// ==========================================
// メインコンポーネント: FmToneEditor
// ==========================================
export interface FmToneEditorProps {
  onChangeToneData?: (data: FmToneData) => void;
  /** MML右クリックメニューから「編集」または「新規」で指定されたID。変化したらエディタのIDを更新する。 */
  loadToneId?: number | null;
  /** 「MMLに反映」ボタン押下時に呼ばれるコールバック。生成されたMMLスニペットとIDを渡す。 */
  onApplyToMml?: (mmlSnippet: string, id: number) => void;
}

export function FmToneEditor({ onChangeToneData, loadToneId, onApplyToMml }: FmToneEditorProps = {}) {
  // 現在編集中の音色データ
  const [toneData, setToneData] = useState<FmToneData>(PRESET_TONES[0]);

  // 音色データ変更時に外部通知
  useEffect(() => {
    onChangeToneData?.(toneData);
  }, [toneData, onChangeToneData]);

  // loadToneId の変化を監視: 右クリックメニューからIDが指定されたらエディタのIDを更新
  useEffect(() => {
    if (loadToneId == null) return;
    setToneData(prev => ({ ...prev, id: loadToneId }));
  }, [loadToneId]);

  // 各OPのミュート・ソロ状態 (試聴プレビュー用)
  const [opMute, setOpMute] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);
  const [opSolo, setOpSolo] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);

  // 各OPの選択状態 (OP1〜OP4) - 通常クリック: 単一選択 / ShiftまたはCtrlキー: 複数選択
  const [selectedOps, setSelectedOps] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);

  const handleSelectOp = (opIdx: number, isMulti: boolean) => {
    setSelectedOps(prev => {
      const next = [...prev] as [boolean, boolean, boolean, boolean];
      if (isMulti) {
        // Shift または Ctrl キー押下: 複数選択（トグル）
        next[opIdx] = !next[opIdx];
      } else {
        // 通常クリック:
        // すでに選択されているOPをクリックした場合は選択解除
        if (prev[opIdx]) {
          next[opIdx] = false;
        } else {
          // 未選択のOPをクリックした場合は、そのOPのみ選択し他の全OPを解除
          for (let i = 0; i < 4; i++) {
            next[i] = i === opIdx;
          }
        }
      }
      return next;
    });
  };

  const selectAllOps = () => {
    setSelectedOps([true, true, true, true]);
  };

  const clearSelectOps = () => {
    setSelectedOps([false, false, false, false]);
  };

  // クリップボード (オペレータ単位コピー＆ペースト用)
  const [copiedOpParams, setCopiedOpParams] = useState<OperatorParams | null>(null);

  // Web Audio 試聴ステート
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNodesRef = useRef<{ stop: () => void } | null>(null);

  // アルゴリズム変更
  const setAlg = (alg: number) => {
    setToneData(prev => ({ ...prev, alg }));
  };

  // フィードバック変更
  const setFb = (fb: number) => {
    setToneData(prev => ({ ...prev, fb }));
  };

  // プリセット適用
  const handleApplyPreset = (preset: FmToneData) => {
    setToneData(JSON.parse(JSON.stringify(preset)));
  };

  // 各パラメータの有効範囲定義 (クランプ用)
  const PARAM_LIMITS: Record<keyof OperatorParams, { min: number; max: number }> = {
    tl: { min: 0, max: 127 },
    ar: { min: 0, max: 31 },
    d1r: { min: 0, max: 31 },
    d1l: { min: 0, max: 15 },
    d2r: { min: 0, max: 31 },
    rr: { min: 0, max: 31 },
    mul: { min: 0, max: 15 },
    dt1: { min: 0, max: 7 },
    dt2: { min: 0, max: 3 },
    ks: { min: 0, max: 3 },
    ame: { min: 0, max: 1 },
  };

  // オペレータパラメータの部分更新
  // mode === 'absolute': 直接入力やプリセット等。指定された新しい値そのものを適用
  // mode === 'relative': 上下ボタンやドラッグ等。操作元OPの差分(delta)を他の選択中OPへ相対的に適用
  const updateOperator = (
    opIdx: number, 
    patch: Partial<OperatorParams>, 
    mode: 'relative' | 'absolute' = 'relative'
  ) => {
    setToneData(prev => {
      const nextOps = [...prev.ops] as [OperatorParams, OperatorParams, OperatorParams, OperatorParams];
      const isMultiSelected = selectedOps[opIdx] && selectedOps.filter(Boolean).length > 1;

      if (!isMultiSelected) {
        // 単独OPまたは未選択OPの操作: そのOPのみ直接更新
        nextOps[opIdx] = { ...nextOps[opIdx], ...patch };
      } else if (mode === 'absolute') {
        // 直接入力 (absolute): 選択中の全OPに対して指定された新しい値を一括適用！
        selectedOps.forEach((isSelected, idx) => {
          if (isSelected) {
            nextOps[idx] = { ...nextOps[idx], ...patch };
          }
        });
      } else {
        // 上下ボタンやドラッグ (relative): 操作元OPを基準に差分(delta)を算出し、他の選択中OPへ相対的に適用
        const deltas: Partial<Record<keyof OperatorParams, number>> = {};
        (Object.keys(patch) as Array<keyof OperatorParams>).forEach(key => {
          const oldVal = prev.ops[opIdx][key];
          const newVal = patch[key];
          if (typeof oldVal === 'number' && typeof newVal === 'number') {
            deltas[key] = newVal - oldVal;
          }
        });

        selectedOps.forEach((isSelected, idx) => {
          if (!isSelected) return;
          if (idx === opIdx) {
            // 操作元OP: 指定された新しい値を適用
            nextOps[idx] = { ...nextOps[idx], ...patch };
          } else {
            // 影響先OP: 操作元との差分を加算し、許容範囲でクランプ
            const updatedOther = { ...nextOps[idx] };
            (Object.keys(patch) as Array<keyof OperatorParams>).forEach(key => {
              const delta = deltas[key];
              if (delta !== undefined && typeof updatedOther[key] === 'number') {
                const limits = PARAM_LIMITS[key];
                const currentVal = prev.ops[idx][key] as number;
                const nextVal = limits 
                  ? Math.max(limits.min, Math.min(limits.max, currentVal + delta))
                  : currentVal + delta;
                (updatedOther as Record<keyof OperatorParams, unknown>)[key] = nextVal;
              } else if (typeof patch[key] === 'boolean') {
                (updatedOther as Record<keyof OperatorParams, unknown>)[key] = patch[key];
              }
            });
            nextOps[idx] = updatedOther;
          }
        });
      }
      return { ...prev, ops: nextOps };
    });
  };

  // オペレータパラメータのコピー
  const handleCopyOp = (opIdx: number) => {
    setCopiedOpParams(JSON.parse(JSON.stringify(toneData.ops[opIdx])));
  };

  // オペレータパラメータの貼り付け
  const handlePasteOp = (opIdx: number) => {
    if (!copiedOpParams) return;
    updateOperator(opIdx, JSON.parse(JSON.stringify(copiedOpParams)));
  };

  // Mute トグル
  const toggleMute = (opIdx: number) => {
    setOpMute(prev => {
      const next = [...prev] as [boolean, boolean, boolean, boolean];
      next[opIdx] = !next[opIdx];
      return next;
    });
  };

  // Solo トグル
  const toggleSolo = (opIdx: number) => {
    setOpSolo(prev => {
      const next = [...prev] as [boolean, boolean, boolean, boolean];
      next[opIdx] = !next[opIdx];
      return next;
    });
  };

  // Web Audio 試聴プレビュー停止
  const stopAudio = useCallback(() => {
    if (activeNodesRef.current) {
      activeNodesRef.current.stop();
      activeNodesRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, [stopAudio]);

  // Web Audio 試聴プレビュー開始 (4-Operator FM 合成)
  const playPreviewTone = () => {
    stopAudio();

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = audioCtxRef.current || new AudioContextClass();
    audioCtxRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const baseFreq = 440; // A4

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.connect(ctx.destination);

    // 4つのオシレーターとゲインを作成
    const oscs: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    // Soloが有効なオペレータが存在するかチェック
    const hasSolo = opSolo.some(s => s);

    for (let i = 0; i < 4; i++) {
      const op = toneData.ops[i];
      const isMuted = opMute[i] || (hasSolo && !opSolo[i]);

      const osc = ctx.createOscillator();
      const mult = op.mul === 0 ? 0.5 : op.mul;
      const detuneCents = (op.dt1 - 3) * 6 + op.dt2 * 30;
      osc.frequency.setValueAtTime(baseFreq * mult, now);
      osc.detune.setValueAtTime(detuneCents, now);

      const gain = ctx.createGain();
      // TL (0=Max, 127=Mute)
      const maxVol = isMuted ? 0 : Math.max(0, (127 - op.tl) / 127);

      // 簡単なADSRエンベロープ適用
      const attackTime = Math.max(0.01, 0.4 * (1 - op.ar / 31));
      const decayTime = Math.max(0.02, 0.6 * (1 - op.d1r / 31));
      const sustainLevel = Math.max(0.01, maxVol * (1 - op.d1l / 15));

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(maxVol, now + attackTime);
      gain.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);

      osc.connect(gain);
      osc.start(now);

      oscs.push(osc);
      gains.push(gain);
    }

    // アルゴリズムに応じた正確なルーティング接続
    for (let i = 0; i < 4; i++) {
      const isCarrier = isOpCarrier(toneData.alg, i);
      if (isCarrier) {
        gains[i].connect(masterGain);
      }
      const targets = OP_MODULATION_TARGETS[toneData.alg]?.[i] || [];
      for (const targetIdx of targets) {
        const modScale = ctx.createGain();
        modScale.gain.setValueAtTime(baseFreq * 2.5, now);
        gains[i].connect(modScale);
        modScale.connect(oscs[targetIdx].frequency);
      }
    }

    setIsPlaying(true);
    activeNodesRef.current = {
      stop: () => {
        const stopTime = ctx.currentTime;
        masterGain.gain.linearRampToValueAtTime(0.0001, stopTime + 0.1);
        setTimeout(() => {
          oscs.forEach(o => {
            try { o.stop(); o.disconnect(); } catch { /* ignore */ }
          });
          masterGain.disconnect();
        }, 150);
      }
    };
  };

  // MMLスニペット生成 (mml_reference.md 4.3 の @N = { } 46 パラメータ書式に準拠)
  const generateMmlSnippet = (): string => {
    const id = toneData.id;
    const { alg, fb, ops } = toneData;
    const opLines = ops.map((op, i) => {
      const carrier = isOpCarrier(alg, i) ? ' ; Carrier' : '';
      return `  ${op.ar}, ${op.d1r}, ${op.d2r}, ${op.rr}, ${op.d1l}, ${op.tl}, ${op.ks}, ${op.mul}, ${op.dt1}, ${op.dt2}, ${op.ame ? 1 : 0}${carrier}`;
    });
    return [
      `@${id} = {`,
      `  /* ${toneData.name} */`,
      `  /* ALG=${alg}, FB=${fb} */`,
      `  ${alg}, ${fb},`,
      `  /* OP1: AR, D1R, D2R, RR, D1L, TL, KS, MUL, DT1, DT2, AME */`,
      opLines[0] + ',',
      `  /* OP2 */`,
      opLines[1] + ',',
      `  /* OP3 */`,
      opLines[2] + ',',
      `  /* OP4 (Carrier) */`,
      opLines[3],
      '}',
    ].join('\n');
  };

  // 「MMLに反映」ボタン処理
  const handleApplyToMml = () => {
    const snippet = generateMmlSnippet();
    onApplyToMml?.(snippet, toneData.id);
  };

  return (
    <div className="flex flex-col h-full bg-[#090a0f] p-3.5 overflow-y-auto font-mono text-zinc-300 gap-3">
      {/* 1. Bento Card: ヘッダー・プリセット・試聴 (Linear Transport Style) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#12131a] p-3 rounded-lg border border-white/[0.08] shrink-0 shadow-xs">
        <div className="flex items-center gap-2">
          <AudioWaveform className="w-4 h-4 text-zinc-400" />
          <h2 className="text-xs font-semibold text-zinc-200 tracking-wide">
            YM2151 (OPM) TONE EDITOR
          </h2>
          <span className="text-[10px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-800 border border-white/10 font-medium">
            4-OPERATOR FM
          </span>
        </div>

        {/* プリセット選択 & 試聴ボタン */}
        <div className="flex items-center gap-3">
          {/* 音色番号 (@ID) 指定 */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500 text-[10px] font-medium">ID:</span>
            <div className="flex items-center">
              <span className="text-cyan-400 font-bold text-xs mr-0.5">@</span>
              <input
                type="number"
                min={0}
                max={255}
                value={toneData.id}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setToneData(prev => ({ ...prev, id: isNaN(val) ? 0 : Math.max(0, Math.min(255, val)) }));
                }}
                className="w-11 h-6 px-1 rounded bg-[#0c0d12] border border-white/10 text-cyan-300 text-xs font-bold focus:outline-none focus:border-cyan-400"
                title="FM音色番号 (@0〜@255)"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500 text-[10px] font-medium">PRESET:</span>
            <div className="flex gap-1">
              {PRESET_TONES.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleApplyPreset(p)}
                  className={`px-2.5 h-6 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                    toneData.name === p.name
                      ? 'bg-zinc-700 text-white border-white/20 shadow-xs'
                      : 'bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-white/[0.06]'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* プレビュー試聴ボタン & MMLに反映ボタン */}
          <div className="flex items-center gap-2">
            {!isPlaying ? (
              <button
                onClick={playPreviewTone}
                className="h-6 px-3 rounded bg-[#00A8FF]/20 hover:bg-[#00A8FF]/30 text-[#00A8FF] border border-[#00A8FF]/60 font-medium transition-colors flex items-center gap-1.5 text-xs cursor-pointer shadow-xs"
                title="Play 4-Op FM Tone Preview"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>TEST NOTE</span>
              </button>
            ) : (
              <button
                onClick={stopAudio}
                className="h-6 px-2.5 rounded bg-red-950/80 text-red-300 border border-red-500 hover:bg-red-900 transition-colors flex items-center gap-1 text-xs font-medium shadow-xs cursor-pointer"
                title="Stop Preview"
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
                title={`@${toneData.id} の MML定義をカーソル位置に挿入`}
              >
                <span>▶ MMLに反映</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Bento Card: アルゴリズム (ALG 0〜7) & フィードバック (FB 0〜7) */}
      <div className="bg-[#12131a] p-3 rounded-lg border border-white/[0.08] shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        {/* アルゴリズム 0〜7 選択トグルボタン */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400">ALGORITHM (ALG):</span>
            <span className="text-[10px] text-zinc-500">
              [ALG {toneData.alg}] {toneData.alg === 7 ? 'All Parallel' : toneData.alg === 0 ? 'Full Serial' : 'Branch/Cascade'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(algNum => {
              const active = toneData.alg === algNum;
              return (
                <button
                  key={algNum}
                  onClick={() => setAlg(algNum)}
                  className={`flex flex-col items-center justify-between p-1 rounded-md border transition-all cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[#181d2a] border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.25)] ring-1 ring-cyan-400/40'
                      : 'bg-[#0c0d12] border-white/[0.06] opacity-70 hover:opacity-100 hover:border-white/20 hover:bg-zinc-900/60'
                  }`}
                  title={`Select Algorithm ${algNum}`}
                >
                  <span
                    className={`text-xs font-mono font-bold mb-0.5 px-1.5 py-0.2 rounded transition-colors ${
                      active
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50'
                        : 'text-zinc-400'
                    }`}
                  >
                    {algNum}
                  </span>
                  <AlgDiagramIcon alg={algNum} active={active} />
                </button>
              );
            })}
          </div>
        </div>

        {/* フィードバック (FB: 0〜7) */}
        <div className="flex flex-col gap-1.5 bg-[#0c0d12] p-2.5 rounded border border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-zinc-400 font-medium">FEEDBACK (FB):</span>
            <span className="text-cyan-300 font-semibold px-1.5 py-0.2 rounded bg-zinc-900 border border-white/10">
              {toneData.fb}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={7}
              value={toneData.fb}
              onChange={e => setFb(Number(e.target.value))}
              className="accent-cyan-400 h-1.5 bg-zinc-800 rounded cursor-pointer w-28"
              title="Feedback level on OP1 (0=None, 7=Max)"
            />
            <div className="flex gap-0.5">
              {[0, 1, 2, 3, 4, 5, 6, 7].map(v => (
                <button
                  key={v}
                  onClick={() => setFb(v)}
                  className={`w-4 h-4 rounded text-[8px] font-bold border transition-colors ${
                    toneData.fb === v
                      ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                      : 'bg-zinc-900 text-zinc-500 border-white/[0.04] hover:text-zinc-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. アルゴリズム接続構造 (シグナルフロー表示バー) */}
      <AlgFlowBanner alg={toneData.alg} fb={toneData.fb} />

      {/* 4. オペレータ編集部: OP1〜OP4 (2x2 Bento Grid + Multi-OP Selection) */}
      <div className="flex flex-col gap-2 flex-1">
        {/* マルチOP編集コントロールバー */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-[#12131a] border border-white/[0.08] text-[11px] shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium">MULTI-OP EDIT:</span>
            {selectedOps.filter(Boolean).length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 font-semibold text-[10px] flex items-center gap-1.5 shadow-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  {selectedOps.filter(Boolean).length} OPs SELECTED (LINKED)
                </span>
                <span className="text-zinc-400 text-[10px] hidden sm:inline">
                  ※数値直接入力: その値に一括変化 / 上下ボタン・グラフドラッグ: 相対変化
                </span>
              </div>
            ) : (
              <span className="text-zinc-500 text-[10px]">
                クリック: 選択/解除 / Shift・Ctrl + クリック: 複数選択
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={selectAllOps}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/10 text-[10px] transition-colors cursor-pointer"
              title="Select all 4 operators"
            >
              SELECT ALL
            </button>
            <button
              type="button"
              onClick={clearSelectOps}
              disabled={selectedOps.filter(Boolean).length === 0}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white disabled:opacity-30 border border-white/10 text-[10px] transition-colors cursor-pointer"
              title="Clear operator selection"
            >
              CLEAR
            </button>
          </div>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
          {[0, 1, 2, 3].map(opIdx => (
            <OperatorPanel
              key={opIdx}
              opIdx={opIdx}
              params={toneData.ops[opIdx]}
              isCarrier={isOpCarrier(toneData.alg, opIdx)}
              isMuted={opMute[opIdx]}
              isSolo={opSolo[opIdx]}
              isSelected={selectedOps[opIdx]}
              onSelect={isMulti => handleSelectOp(opIdx, isMulti)}
              onToggleMute={() => toggleMute(opIdx)}
              onToggleSolo={() => toggleSolo(opIdx)}
              onCopy={() => handleCopyOp(opIdx)}
              onPaste={() => handlePasteOp(opIdx)}
              canPaste={copiedOpParams !== null}
              onChange={(patch, mode) => updateOperator(opIdx, patch, mode)}
              fb={toneData.fb}
              targets={OP_MODULATION_TARGETS[toneData.alg]?.[opIdx] || []}
              sources={getOpSources(toneData.alg, opIdx)}
            />
          ))}
        </div>
      </div>

      {/* 5. Bento Card: MML エクスポートプレビュー */}
      <div className="p-3 bg-[#12131a] rounded-lg border border-white/[0.08] flex flex-col gap-2 shrink-0 shadow-xs">
        <div className="flex justify-between items-center text-[10px] font-medium text-zinc-400">
          <span className="flex items-center gap-1.5 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
            GENERATED FM TONE MML
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

