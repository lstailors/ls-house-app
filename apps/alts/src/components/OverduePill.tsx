import { cn } from "@ls/design/utils";
import { daysLate, isTerminalStatus } from "@alts/lib/ticketDisplay";

/** Red overdue pill — use on every operational list. */
export function OverduePill({
  due,
  status,
  className,
}: {
  due?: string | null;
  status?: string | null;
  className?: string;
}) {
  if (isTerminalStatus(status)) return null;
  const n = daysLate(due || undefined);
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "badge-late inline-flex items-center rounded-full border border-signal-rose/50 bg-signal-rose/15",
        "px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-signal-rose",
        className,
      )}
    >
      OVERDUE · {n}d
    </span>
  );
}
