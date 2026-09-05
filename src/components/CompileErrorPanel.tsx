import { AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronRight, XCircle } from 'lucide-react';

export interface CompileErrorItem {
  id: string;
  severity: 'error' | 'warning' | 'info';
  track?: string;
  line: number;
  column: number;
  message: string;
  sourceFile: string;
}

interface CompileErrorPanelProps {
  errors: CompileErrorItem[];
  onSelectError?: (error: CompileErrorItem) => void;
  onClearErrors?: () => void;
  height?: number;
  embedded?: boolean;
}

export function CompileErrorPanel({ errors, onSelectError, onClearErrors, height, embedded = false }: CompileErrorPanelProps) {
  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warningCount = errors.filter(e => e.severity === 'warning').length;

  return (
    <div 
      style={height !== undefined ? { height: `${height}px` } : undefined} 
      className={`bg-[#1A1A1A] flex flex-col font-mono text-xs select-none overflow-hidden ${
        embedded ? 'h-full w-full' : 'border-t border-[#3C3C3C] shrink-0'
      }`}
    >
      {/* パネルヘッダー (埋め込み時は非表示) */}
      {!embedded && (
        <div className="h-7 px-3 bg-[#242424] border-b border-[#3C3C3C] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-200 text-[11px] tracking-wider flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-zinc-400" />
              <span>PROBLEMS / COMPILE ERRORS</span>
            </span>

            <div className="flex items-center gap-1 ml-1.5">
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium flex items-center gap-1 ${
                errorCount > 0 ? 'bg-red-950/80 text-red-300 border border-red-700/60' : 'bg-[#2E2E2E] text-zinc-500'
              }`}>
                <XCircle className="w-3 h-3 text-red-400" />
                <span>{errorCount} Error{errorCount !== 1 ? 's' : ''}</span>
              </span>

              {warningCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-950/80 text-amber-300 border border-amber-700/60 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span>{warningCount} Warning{warningCount !== 1 ? 's' : ''}</span>
                </span>
              )}
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex items-center gap-1.5">
            {errors.length > 0 && onClearErrors && (
              <button
                onClick={onClearErrors}
                className="h-5 px-2 rounded bg-[#333333] hover:bg-[#3E3E3E] text-zinc-400 hover:text-zinc-200 text-[10px] font-mono border border-[#484848] transition-colors cursor-pointer"
              >
                CLEAR
              </button>
            )}
          </div>
        </div>
      )}

      {/* エラーリストまたは空状態 */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#2B2B2B]">
        {errors.length === 0 ? (
          <div className="h-full flex items-center justify-center p-3 text-zinc-500 text-[11px] gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500/80" />
            <span>No compile errors or warnings detected. Syntax is clean.</span>
          </div>
        ) : (
          errors.map((item) => {
            const isError = item.severity === 'error';
            const isWarning = item.severity === 'warning';
            return (
              <div
                key={item.id}
                onClick={() => onSelectError?.(item)}
                className="px-3 py-1.5 hover:bg-[#252525] flex items-center justify-between text-[11px] cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {/* アイコン */}
                  {isError && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  {isWarning && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  {!isError && !isWarning && <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />}

                  {/* トラック名 */}
                  {item.track && (
                    <span className="px-1.5 py-0.2 rounded bg-[#2D2D2D] text-zinc-300 border border-[#404040] text-[10px] font-bold shrink-0">
                      {item.track}
                    </span>
                  )}

                  {/* エラーメッセージ */}
                  <span className={`truncate ${isError ? 'text-red-200 font-medium' : 'text-zinc-300'}`}>
                    {item.message}
                  </span>
                </div>

                {/* ファイル位置情報 */}
                <div className="flex items-center gap-2 shrink-0 ml-3 text-[10px] text-zinc-500 group-hover:text-zinc-400">
                  <span>{item.sourceFile}</span>
                  <span className="px-1 py-0.2 rounded bg-[#252525] border border-[#3A3A3A] font-mono text-zinc-400">
                    Ln {item.line}, Col {item.column}
                  </span>
                  <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
