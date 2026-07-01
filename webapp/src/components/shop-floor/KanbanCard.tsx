import { Truck, Flame, Sparkles } from "lucide-react";
import type { YZOrder } from "@/lib/types";
import {
  formatShipDate,
  shipTone,
  shipToneClass,
  isRush,
} from "@/lib/shopFloor";
import { cn } from "@/lib/utils";

interface Props {
  order: YZOrder;
  onClick: () => void;
}

export function KanbanCard({ order, onClick }: Props) {
  const tone = shipTone(order);
  const rush = isRush(order);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-brass/12 bg-forest-raised/40 p-3 text-left transition-all hover:border-brass/30 hover:bg-forest-raised/60"
    >
      {/* Top row: order no + indicators */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-medium tracking-tight text-brass-light">
          {order.order_no}
        </span>
        <div className="flex items-center gap-1.5 pt-0.5">
          {order.embroidery_name ? (
            <Sparkles className="h-3 w-3 text-brass-light/70" aria-label="Embroidery" />
          ) : null}
          {order.tracking_no ? (
            <Truck className="h-3 w-3 text-signal-emerald/80" aria-label="Tracking" />
          ) : null}
          {rush ? (
            <span className="flex items-center gap-0.5 rounded-full bg-[#FF5722]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#FF8A65]">
              <Flame className="h-2.5 w-2.5" />
              Rush
            </span>
          ) : null}
        </div>
      </div>

      {/* Customer */}
      <div className="mt-1.5 truncate text-sm font-medium text-cream">
        {order.customer_name ?? "Unnamed customer"}
      </div>

      {/* Garment summary */}
      {order.garment_summary ? (
        <div className="mt-0.5 truncate text-xs text-cream-muted">
          {order.garment_summary}
        </div>
      ) : null}

      {/* Fabric */}
      {order.fabric_number ? (
        <div className="mt-1 truncate text-[10px] text-cream-dim">
          Fabric {order.fabric_number}
        </div>
      ) : null}

      {/* Footer: badges + ship date */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {order.process_category ? (
            <span className="rounded-md border border-brass/15 bg-forest-deep/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cream-muted">
              {order.process_category}
            </span>
          ) : null}
          {order.total_pieces > 0 ? (
            <span className="rounded-md border border-brass/15 bg-forest-deep/50 px-1.5 py-0.5 text-[9px] tracking-wide text-cream-muted">
              {order.total_pieces} pc{order.total_pieces !== 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
        <span className={cn("text-[10px] font-medium whitespace-nowrap", shipToneClass(tone))}>
          {order.ship_date_planned ? formatShipDate(order.ship_date_planned) : "No date"}
        </span>
      </div>
    </button>
  );
}
