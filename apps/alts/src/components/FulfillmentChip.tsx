import { computeFulfillment, fulfillmentChipClass, type FulfillmentInput } from "@alts/lib/fulfillment";
import { cn } from "@ls/design/utils";

type Props = {
  ticket?: FulfillmentInput | null;
  className?: string;
  /** show shop · detail under chip */
  showDetail?: boolean;
  compact?: boolean;
};

export function FulfillmentChip({ ticket, className, showDetail = true, compact }: Props) {
  if (!ticket) return null;
  const f = computeFulfillment(ticket);
  return (
    <div className={cn("min-w-0", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-bold tracking-wide uppercase",
          compact ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
          fulfillmentChipClass(f.tone),
        )}
        title={f.detail ? `${f.label} · ${f.detail}` : f.label}
      >
        <span className="opacity-80">{f.shop}</span>
        <span className="opacity-40">·</span>
        <span>{f.label}</span>
      </span>
      {showDetail && f.detail && !compact && (
        <div className="text-[11px] text-cream-dim mt-1 truncate">{f.detail}</div>
      )}
    </div>
  );
}

export default FulfillmentChip;
