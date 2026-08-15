import { cn } from "@ls/design/utils";
import { formatMoney } from "@alts/lib/money";

function money(n?: number | string | null) {
  return formatMoney(n);
}

type Props = {
  lineCount: number;
  workTotal: number;
  itemsTotal: number;
  showBreak?: boolean;
  summary: string;
  onOpen: () => void;
  className?: string;
};

/** SPEC 057b — phone sticky cart dock (opens cart bottom sheet). Hidden ≥768. */
export default function TicketCartDock({
  lineCount,
  workTotal,
  itemsTotal,
  showBreak = false,
  summary,
  onOpen,
  className,
}: Props) {
  const total = workTotal + itemsTotal;
  return (
    <div
      className={cn(
        "md:hidden absolute inset-x-0 bottom-0 z-[35] pointer-events-none",
        "px-3 pt-3 pb-[calc(10px+env(safe-area-inset-bottom,0px))]",
        "bg-gradient-to-b from-transparent via-black/55 to-black/85",
        "border-t border-brass/20",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "pointer-events-auto w-full h-[54px] rounded-2xl border border-brass/40",
          "bg-[linear-gradient(135deg,rgba(176,141,87,0.28),rgba(176,141,87,0.12))]",
          "flex items-center gap-3 px-3.5 text-left active:scale-[0.99]",
        )}
        aria-label="Open ticket cart"
      >
        <span className="w-[34px] h-[34px] rounded-[10px] bg-brass text-forest-deep grid place-items-center font-bold text-[13px] flex-none">
          {lineCount}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-bold tracking-[0.12em] uppercase text-brass-light">
            Ticket cart
          </span>
          <span className="block text-[12px] text-cream truncate mt-0.5">
            {lineCount === 0 ? "Nothing yet — tap a tile" : summary}
            {showBreak && lineCount > 0
              ? ` · W ${money(workTotal)} · I ${money(itemsTotal)}`
              : ""}
          </span>
        </span>
        <span className="display text-[22px] font-semibold text-brass-light flex-none">
          {money(total)}
        </span>
      </button>
    </div>
  );
}
