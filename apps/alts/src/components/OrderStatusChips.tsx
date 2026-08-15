import { cn } from "@ls/design/utils";
import { MTM_STATUSES } from "@alts/lib/mtmStatus";
import StatusBadge from "@alts/components/StatusBadge";

export type OrderStatusChipsVariant = "legend" | "grid" | "badge";

type Props = {
  current?: string | null;
  /** legend = wrapped filter chips; grid = full pipeline (detail); badge = current stage only */
  variant?: OrderStatusChipsVariant;
  /** Legend filter. Clicking the active chip again clears it when `allowClear` is true. */
  onSelect?: (status: string) => void;
  allowClear?: boolean;
  /** Detail-page status write. */
  onChange?: (status: string) => void;
  disabled?: boolean;
  pending?: string | null;
  className?: string;
};

const CHIP =
  "shrink-0 min-w-max rounded-full border font-bold tracking-[0.08em] uppercase whitespace-nowrap transition-colors h-11 min-h-[44px] px-3 text-[10px]";

/** Mini current-stage chip + thin pipeline progress. Used on QC list cards. */
export function OrderStageBadge({
  current,
  className,
}: {
  current?: string | null;
  className?: string;
}) {
  const idx = MTM_STATUSES.findIndex((s) => s.key === current);
  const known = idx >= 0;
  const pct = known ? Math.round(((idx + 1) / MTM_STATUSES.length) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <StatusBadge status={current || "—"} size="sm" />
      <div
        className="h-1.5 w-16 shrink-0 rounded-full bg-brass/15 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={known ? `Stage ${idx + 1} of ${MTM_STATUSES.length}` : "Stage unknown"}
      >
        <div className="h-full rounded-full bg-brass/75" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Shared MTM pipeline chips. Always wrap + shrink-0 so labels never collide
 * at 1280–2600px. Full rail belongs on the detail page; list cards use `badge`.
 */
export default function OrderStatusChips({
  current,
  variant = "grid",
  onSelect,
  allowClear,
  onChange,
  disabled,
  pending,
  className,
}: Props) {
  if (variant === "badge") {
    return <OrderStageBadge current={current} className={className} />;
  }

  const editable = variant === "grid" && Boolean(onChange) && !disabled;
  const selectable = variant === "legend" && Boolean(onSelect);

  return (
    <div
      className={cn("flex flex-wrap gap-1.5", className)}
      role={editable || selectable ? "listbox" : "list"}
      aria-label="Order status"
    >
      {MTM_STATUSES.map((s) => {
        const on = s.key === current;
        const busy = pending === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role={editable || selectable ? "option" : undefined}
            aria-selected={editable || selectable ? on : undefined}
            disabled={(editable && busy) || (!editable && !selectable)}
            onClick={(e) => {
              e.stopPropagation();
              if (selectable) {
                if (on && allowClear) onSelect?.("");
                else onSelect?.(s.key);
                return;
              }
              if (editable && !on) onChange?.(s.key);
            }}
            className={cn(
              CHIP,
              on
                ? "bg-brass/22 border-brass text-brass-light"
                : "border-brass/22 bg-black/25 text-cream-dim hover:border-brass/45 hover:text-cream",
              !editable && !selectable && "opacity-80",
            )}
          >
            {busy ? "…" : s.key}
          </button>
        );
      })}
    </div>
  );
}
