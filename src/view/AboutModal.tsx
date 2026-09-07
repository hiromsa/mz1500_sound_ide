import { useEffect } from 'react';
import { 
  X, 
  Heart, 
  ExternalLink, 
  Cpu, 
  Radio, 
  BookOpen, 
  Award,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import mz1500Logo from '../assets/mz1500logo.svg';
import { 
  APP_FULL_DISPLAY_VERSION,
  APP_COMMIT_HASH,
  APP_NAME, 
  APP_DESCRIPTION, 
  APP_COPYRIGHT, 
  APP_LICENSE, 
  RESPECT_ITEMS, 
  type RespectItem 
} from '../config/version';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  // ESCキーで閉じる
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getRoleIcon = (role: string) => {
    if (role.includes('Z80')) return <Cpu className="w-3.5 h-3.5 text-[#00A8FF]" />;
    if (role.includes('FM') || role.includes('ハード')) return <Radio className="w-3.5 h-3.5 text-amber-400" />;
    return <BookOpen className="w-3.5 h-3.5 text-emerald-400" />;
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 select-none font-mono animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-[#181920] border border-white/10 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-zinc-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] bg-[#12131A]/90">
          <div className="flex items-center gap-3">
            <img 
              src={mz1500Logo} 
              alt="MZ-1500" 
              className="h-6 w-auto object-contain filter drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]" 
            />
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-zinc-100 tracking-wide">Sound IDE</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00A8FF]/20 text-[#00A8FF] border border-[#00A8FF]/40 font-bold" title={`Commit Hash: ${APP_COMMIT_HASH}`}>
                {APP_FULL_DISPLAY_VERSION}
              </span>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors cursor-pointer"
            title="閉じる (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* モーダルコンテンツ (スクロール可能) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          {/* アプリケーション概要バナー */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-[#1c1d28] to-[#14151e] border border-white/[0.07] flex flex-col gap-2">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold text-xs">
              <Sparkles className="w-4 h-4 text-[#00A8FF]" />
              <span>{APP_NAME}</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
              {APP_DESCRIPTION}
            </p>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-1.5 font-bold text-zinc-300">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{APP_COPYRIGHT}</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-white/5 text-[10px]">
                {APP_LICENSE}
              </span>
            </div>
          </div>

          {/* リスペクト・クレジットセクション */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                <Heart className="w-3.5 h-3.5 text-red-400 fill-red-400/30" />
                <span>SPECIAL THANKS & RESPECTS</span>
              </div>
              <span className="text-[10px] text-zinc-500">技術リファレンス・協賛・謝辞</span>
            </div>

            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              本 IDE およびサウンドドライバの開発にあたり、下記の素晴らしい開発者様・クリエイター様のオープンソース成果物、実機ハードウェアのご提供、およびWebサイトの貴重な技術資料を大いに参考にさせていただきました。心より敬意と感謝を表します。
            </p>

            <div className="grid grid-cols-1 gap-2.5">
              {RESPECT_ITEMS.map((item: RespectItem) => (
                <div 
                  key={item.name}
                  className="p-3 rounded-lg bg-[#20222e]/60 hover:bg-[#20222e] border border-white/[0.07] hover:border-[#00A8FF]/40 transition-all flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <div className="flex items-center gap-2">
                      {getRoleIcon(item.role)}
                      <span className="font-bold text-zinc-100 text-xs">{item.name}</span>
                      <span className="text-[10px] text-zinc-400 px-1.5 py-0.2 rounded bg-white/[0.05] border border-white/[0.06]">
                        {item.role}
                      </span>
                    </div>

                    {item.highlight && (
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded font-semibold bg-[#00A8FF]/15 text-[#00A8FF] border border-[#00A8FF]/30">
                        {item.highlight}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                    {item.description}
                  </p>

                  <div className="pt-1 flex items-center">
                    <a 
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10.5px] text-[#00A8FF] hover:text-[#55c8ff] hover:underline transition-colors"
                      title={`${item.name} のサイトを開く`}
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>{item.urlLabel ?? item.url}</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* MZ-1500 & コミュニティへの謝辞 */}
          <div className="p-3 rounded-lg bg-[#14151d] border border-white/[0.05] text-[10.5px] text-zinc-400 font-sans leading-relaxed space-y-1">
            <div className="font-bold text-zinc-300 font-mono text-[11px] flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span>HARDWARE & COMMUNITY</span>
            </div>
            <div>
              SHARP MZ-1500 (1984)、Texas Instruments SN76489 (DCSG)、Yamaha YM2151 (OPM)、そしてMZシリーズをはじめとする8bitレトロPC文化を愛し継承し続けるすべてのコミュニティの皆様に感謝いたします。
            </div>
          </div>
        </div>

        {/* モーダルフッター */}
        <div className="px-5 py-3 border-t border-white/[0.08] bg-[#12131A] flex items-center justify-between text-[11px] text-zinc-400">
          <span>MZ-1500 Sound IDE — {APP_COPYRIGHT}</span>
          <button
            onClick={onClose}
            className="px-4 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 transition-colors cursor-pointer text-xs font-semibold"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
