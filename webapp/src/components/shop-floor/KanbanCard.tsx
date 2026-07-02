import { Truck, Flame, Sparkles, AlertTriangle } from "lucide-react";
import type { YZOrder } from "@/lib/types";
import {
  formatShipDate,
  shipTone,
  shipToneClass,
  isRush,
  attentionTone,
  attentionLabel,
  ATTENTION_COLOR,
} from "@/lib/shopFloor";
import { cn } from "@/lib/utils";

interface Props {
  order: YZOrder;
  onClick: () => void;
}

export function KanbanCard({ order, onClick }: Props) {
  const tone = shipTone(order);
  const rush = isRush(order);
  const attn = attentionTone(order);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-xl border bg-forest-raised/40 p-3 text-left transition-all hover:bg-forest-raised/60",
        attn === "high"
          ? "border-l-2 border-l-[#FF5722] border-y-brass/12 border-r-brass/12 hover:border-brass/30"
          : attn === "medium"
            ? "border-l-2 border-l-[#FF9800] border-y-brass/12 border-r-brass/12 hover:border-brass/30"
            : "border-brass/12 hover:border-brass/30",
      )}
    >
      {/* Top row: order no + indicators */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm font-semibold tracking-tight text-brass-light">
          {order.order_no}
        </span>
        <div className="flex items-center gap-1.5 pt-0.5">
          {attn !== "none" ? (
            <span title={attentionLabel(order.attention)} className="flex items-center">
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: ATTENTION_COLOR[attn] }} />
            </span>
          ) : null}
          {order.embroidery_name ? (
            <Sparkles className="h-3.5 w-3.5 text-brass-light/70" aria-label="Embroidery" />
          ) : null}
          {order.tracking_no ? (
            <Truck className="h-3.5 w-3.5 text-signal-emerald/80" aria-label="Tracking" />
          ) : null}
          {rush ? (
            <span className="flex items-center gap-0.5 rounded-full bg-[#FF5722]/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#FF8A65]">
              <Flame className="h-3 w-3" />
              Rush
            </span>
          ) : null}
        </div>
      </div>

      {/* Customer */}
      <div className="mt-1.5 truncate text-lg font-semibold leading-tight text-cream">
        {order.customer_name ?? "Unnamed customer"}
      </div>

      {/* Garment summary */}
      {order.garment_summary ? (
        <div className="mt-1 truncate text-sm text-cream-muted">
          {order.garment_summary}
        </div>
      ) : null}

      {/* Fabric */}
      {order.fabric_number ? (
        <div className="mt-1 truncate text-xs text-cream-dim">
          Fabric {order.fabric_number}
        </div>
      ) : null}

      {/* Footer: badges + ship date */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {order.process_category ? (
            <span className="rounded-md border border-brass/15 bg-forest-deep/50 px-2 py-0.5 text-[11px] uppercase tracking-wide text-cream-muted">
              {order.process_category}
            </span>
          ) : null}
          {order.total_pieces > 0 ? (
            <span className="rounded-md border border-brass/15 bg-forest-deep/50 px-2 py-0.5 text-[11px] tracking-wide text-cream-muted">
              {order.total_pieces} pc{order.total_pieces !== 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
        <span className={cn("text-sm font-semibold whitespace-nowrap", shipToneClass(tone))}>
          {order.ship_date_planned ? formatShipDate(order.ship_date_planned) : "No date"}
        </span>
      </div>
    </button>
  );
}
