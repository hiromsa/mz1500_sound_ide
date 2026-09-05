import { Music, Cpu, FileText, CheckCircle2 } from 'lucide-react';

export interface SongMetadata {
  title: string;
  composer: string;
  octaveDirection: 'NORMAL' | 'REVERSE';
  enableYM2151: boolean;
}

interface SongSetupPanelProps {
  metadata: SongMetadata;
  onChangeMetadata: (newMetadata: SongMetadata) => void;
}

export function SongSetupPanel({ metadata, onChangeMetadata }: SongSetupPanelProps) {
  const updateField = <K extends keyof SongMetadata>(key: K, value: SongMetadata[K]) => {
    onChangeMetadata({
      ...metadata,
      [key]: value
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#1E1E1E] p-5 overflow-y-auto font-mono text-xs select-none text-zinc-300">
      {/* 画面ヘッダー */}
      <div className="flex justify-between items-center mb-5 pb-2.5 border-b border-[#3C3C3C]">
        <h2 className="text-xs font-bold text-zinc-100 tracking-wider flex items-center gap-2">
          <Music className="w-3.5 h-3.5 text-[#00A8FF]" />
          SONG SETUP & HEADER DIRECTIVES
        </h2>
        <span className="px-2 py-0.5 rounded-full bg-[#3A3A3A] text-zinc-200 text-[10px] font-medium">
          SONG PROPS
        </span>
      </div>

      <div className="flex flex-col gap-6 max-w-xl">
        {/* セクション 1: 楽曲メタデータ (#TITLE, #COMPOSER) */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-300 tracking-wider mb-2 flex items-center gap-1.5 border-b border-[#3C3C3C] pb-1">
            <FileText className="w-3.5 h-3.5 text-zinc-400" /> SONG METADATA (#TITLE / #COMPOSER)
          </div>

          <div className="p-4 rounded-lg border border-[#3C3C3C] bg-[#2D2D2D] flex flex-col gap-3.5">
            {/* #TITLE */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
                <span>#TITLE (SONG TITLE):</span>
              </label>
              <input
                type="text"
                value={metadata.title}
                onChange={e => updateField('title', e.target.value)}
                placeholder="Theme of MZ"
                className="w-full bg-[#1E1E1E] border border-[#3C3C3C] focus:border-[#00A8FF] rounded px-2.5 py-1.5 text-zinc-100 text-xs font-mono focus:outline-none transition-colors"
              />
            </div>

            {/* #COMPOSER */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
                <span>#COMPOSER (COMPOSER / ARRANGER):</span>
              </label>
              <input
                type="text"
                value={metadata.composer}
                onChange={e => updateField('composer', e.target.value)}
                placeholder="User"
                className="w-full bg-[#1E1E1E] border border-[#3C3C3C] focus:border-[#00A8FF] rounded px-2.5 py-1.5 text-zinc-100 text-xs font-mono focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        {/* セクション 2: ハードウェア音源構成 (#OPM ON/OFF) */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-300 tracking-wider mb-2 flex items-center gap-1.5 border-b border-[#3C3C3C] pb-1">
            <Cpu className="w-3.5 h-3.5 text-zinc-400" /> SOUND CHIPS FOR THIS SONG (#OPM)
          </div>

          <div className="flex flex-col gap-3">
            {/* FM音源ボード (YM2151) 設定カード */}
            <div className="p-4 rounded-lg border border-[#3C3C3C] bg-[#2D2D2D] transition-all">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-zinc-100">
                      ACZ-8BS1MZ (YM2151 FM Sound Board)
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium ${
                      metadata.enableYM2151
                        ? 'bg-[#3A3A3A] text-zinc-100'
                        : 'bg-[#222222] text-zinc-500'
                    }`}>
                      {metadata.enableYM2151 ? '#OPM ON' : '#OPM OFF'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    この楽曲で拡張FM音源ボード（4オペレータFM 8ch: F1～F8）を使用するかを指定します。OFF時は実機標準（DCSG×2 + BEEP）の9ch構成となります。
                  </p>
                </div>

                {/* ハードウェアトグルスイッチ (ON時クリアブルー点灯) */}
                <button
                  onClick={() => updateField('enableYM2151', !metadata.enableYM2151)}
                  className={`w-13 h-6.5 rounded-full p-0.5 transition-colors relative shrink-0 border cursor-pointer ${
                    metadata.enableYM2151
                      ? 'bg-[#00A8FF]/20 border-[#00A8FF]/60'
                      : 'bg-[#222222] border-[#3C3C3C]'
                  }`}
                  title={metadata.enableYM2151 ? 'Set #OPM OFF' : 'Set #OPM ON'}
                >
                  <div className={`w-5 h-5 rounded-full transition-transform duration-200 flex items-center justify-center text-[8px] font-bold ${
                    metadata.enableYM2151
                      ? 'translate-x-6.5 bg-[#00A8FF] text-slate-950 shadow-[0_0_8px_rgba(0,168,255,0.6)]'
                      : 'translate-x-0 bg-zinc-600 text-zinc-300'
                  }`}>
                    {metadata.enableYM2151 ? 'ON' : 'OFF'}
                  </div>
                </button>
              </div>

              {/* 補足注記 */}
              <div className="text-[10px] text-zinc-500 pt-2 border-t border-[#383838] flex items-center gap-2">
                <span className="text-zinc-400">TRACKS:</span>
                <span className={metadata.enableYM2151 ? 'text-zinc-200 font-medium' : 'line-through text-zinc-600'}>
                  F1, F2, F3, F4, F5, F6, F7, F8 (8ch)
                </span>
                {!metadata.enableYM2151 && (
                  <span className="text-zinc-500 ml-auto">※コンパイル・トラックモニタから除外</span>
                )}
              </div>
            </div>

            {/* 標準搭載音源 (DCSG & BEEP) インフォカード */}
            <div className="p-3 rounded-lg border border-[#3C3C3C] bg-[#222222] text-zinc-400">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-300">
                    DCSG (SN76489 × 2) & BEEP
                  </span>
                  <span className="px-2 py-0.2 rounded-full text-[9px] font-medium bg-[#333333] text-zinc-300">
                    ALWAYS ACTIVE
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-500">
                実機標準音源（P1〜P6 矩形波6ch + N1〜N2 ノイズ2ch + B1 BEEP 1ch = 計9ch）は常時使用可能です。
              </p>
            </div>
          </div>
        </div>

        {/* セクション 3: MML 方言・記法設定 (#OCTAVE) */}
        <div>
          <div className="text-[11px] font-semibold text-zinc-300 tracking-wider mb-2 flex items-center gap-1.5 border-b border-[#3C3C3C] pb-1">
            <span className="text-zinc-400 font-bold">&lt;&gt;</span> MML DIALECT CONVENTIONS (#OCTAVE)
          </div>

          <div className="p-4 rounded-lg border border-[#3C3C3C] bg-[#2D2D2D] flex flex-col gap-3">
            <div>
              <span className="text-xs font-semibold text-zinc-100">
                #OCTAVE DIRECTION
              </span>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                MML中のオクターブ変更記号（&lt; と &gt;）の動作規則を選択します。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              {/* NORMAL */}
              <button
                type="button"
                onClick={() => updateField('octaveDirection', 'NORMAL')}
                className={`p-3 rounded border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                  metadata.octaveDirection === 'NORMAL'
                    ? 'bg-[#1E293B] border-[#00A8FF] shadow-[0_0_8px_rgba(0,168,255,0.2)]'
                    : 'bg-[#222222] border-[#383838] hover:border-[#484848] text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold font-mono ${metadata.octaveDirection === 'NORMAL' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                    NORMAL (デフォルト)
                  </span>
                  {metadata.octaveDirection === 'NORMAL' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00A8FF]" />
                  )}
                </div>
                <div className="text-[10px] font-mono text-zinc-400">
                  <span className="text-cyan-300 font-bold">&lt;</span> : 1オクターブ下げる<br/>
                  <span className="text-cyan-300 font-bold">&gt;</span> : 1オクターブ上げる
                </div>
              </button>

              {/* REVERSE */}
              <button
                type="button"
                onClick={() => updateField('octaveDirection', 'REVERSE')}
                className={`p-3 rounded border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                  metadata.octaveDirection === 'REVERSE'
                    ? 'bg-[#1E293B] border-[#00A8FF] shadow-[0_0_8px_rgba(0,168,255,0.2)]'
                    : 'bg-[#222222] border-[#383838] hover:border-[#484848] text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold font-mono ${metadata.octaveDirection === 'REVERSE' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                    REVERSE (逆向き)
                  </span>
                  {metadata.octaveDirection === 'REVERSE' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00A8FF]" />
                  )}
                </div>
                <div className="text-[10px] font-mono text-zinc-400">
                  <span className="text-cyan-300 font-bold">&lt;</span> : 1オクターブ上げる<br/>
                  <span className="text-cyan-300 font-bold">&gt;</span> : 1オクターブ下げる
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* セクション 4: MML ヘッダー出力プレビュー */}
        <div className="p-3.5 rounded-lg border border-[#3C3C3C] bg-[#161616] text-zinc-400 flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold text-zinc-400 flex items-center justify-between">
            <span>SYNCHRONIZED MML DIRECTIVES</span>
            <span className="text-[#00A8FF] text-[9px]">LIVE SYNCED WITH ACTIVE MML</span>
          </div>
          <div className="bg-[#0e0e0e] p-2.5 rounded border border-[#2a2a2a] text-cyan-300 font-mono text-[11px] leading-relaxed select-all">
            {metadata.title && <div>#TITLE &quot;{metadata.title}&quot;</div>}
            {metadata.composer && <div>#COMPOSER &quot;{metadata.composer}&quot;</div>}
            <div>#OCTAVE {metadata.octaveDirection}</div>
            <div>#OPM {metadata.enableYM2151 ? 'ON' : 'OFF'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
