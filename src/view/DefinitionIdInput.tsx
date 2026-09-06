/**
 * エディタヘッダー共通の ID 数値入力 & MML 定義状態バッジ。
 * FM TONE / VOL ENV / PITCH ENV の各エディタで共有する UI 部品。
 * - 数値入力: 0〜maxId の有効な数値が入力されるたびに onChange を発火する (空欄・中間入力中は変化なし)
 * - バッジ:   MML への定義有無 (DEFINED = 定義済み / UNDEFINED = 未定義) を表示する
 */
export interface DefinitionIdInputProps {
  /** ID プレフィックス表示 (例: '@VE', '@PE', '@') */
  prefix: string;
  /** 現在の ID */
  value: number;
  /** MML に該当 ID の定義が存在するか (true = 定義済み) */
  isDefined: boolean;
  /** ID が変更されたときに呼ばれるコールバック */
  onChange: (id: number) => void;
  /** ID の最大値 (既定 255) */
  maxId?: number;
  /** 入力欄のテキスト色クラス (エディタのテーマに合わせて調整) */
  accentClassName?: string;
  /** バッジの補足説明 (title 属性)。未指定時は状態に応じた既定文言を表示 */
  badgeTitle?: string;
}

export function DefinitionIdInput({
  prefix,
  value,
  isDefined,
  onChange,
  maxId = 255,
  accentClassName = 'text-cyan-300',
  badgeTitle,
}: DefinitionIdInputProps) {
  // 空欄や中途半端な入力中は前値を保持し、有効な数値のときのみ確定する
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(0, Math.min(maxId, parsed));
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  const defaultBadgeTitle = isDefined
    ? 'MML に定義済み (反映時は定義を置き換え)'
    : 'MML に未定義 (反映時は最後の定義の後に新規挿入)';

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-zinc-500 text-[10px] font-medium">ID:</span>
      <div className="flex items-center">
        <span className={`font-bold text-xs mr-0.5 ${accentClassName}`}>{prefix}</span>
        <input
          type="number"
          min={0}
          max={maxId}
          value={value}
          onChange={handleChange}
          className={`w-12 h-6 px-1 rounded bg-[#0c0d12] border border-white/10 text-xs font-bold focus:outline-none focus:border-cyan-400 ${accentClassName}`}
          title={`${prefix}0〜${prefix}${maxId} の ID を数値入力`}
        />
      </div>
      <span
        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 tracking-wide ${
          isDefined
            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-600/50'
            : 'bg-zinc-900 text-zinc-500 border-white/10'
        }`}
        title={badgeTitle ?? defaultBadgeTitle}
      >
        {isDefined ? 'DEFINED' : 'UNDEFINED'}
      </span>
    </div>
  );
}
