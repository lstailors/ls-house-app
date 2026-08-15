import { cn } from "@ls/design/utils";
import { MTM_STATUSES } from "@alts/lib/mtmStatus";

type Props = {
  current?: string | null;
  onChange?: (status: string) => void;
  disabled?: boolean;
  pending?: string | null;
  /** denser chips for list rows */
  compact?: boolean;
};

export default function MtmStatusRail({
  current,
  onChange,
  disabled,
  pending,
  compact,
}: Props) {
  const editable = Boolean(onChange) && !disabled;
  return (
    <div
      className={cn(
        "flex gap-1.5",
        compact ? "overflow-x-auto pb-0.5 -mx-0.5 px-0.5" : "flex-wrap",
      )}
      role="listbox"
      aria-label="Order status"
    >
      {MTM_STATUSES.map((s) => {
        const on = s.key === current;
        const busy = pending === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role="option"
            aria-selected={on}
            disabled={!editable || busy}
            onClick={(e) => {
              e.stopPropagation();
              if (!on) onChange?.(s.key);
            }}
            className={cn(
              "rounded-full border font-bold tracking-[0.08em] uppercase whitespace-nowrap transition-colors",
              compact
                ? "h-11 min-h-[44px] px-2.5 text-[9px]"
                : "h-11 min-h-[44px] px-3 text-[10px]",
              on
                ? "bg-brass/22 border-brass text-brass-light"
                : "border-brass/22 bg-black/25 text-cream-dim hover:border-brass/45 hover:text-cream",
              !editable && "opacity-80",
            )}
          >
            {busy ? "…" : s.key}
          </button>
        );
      })}
    </div>
  );
}
