import { Truck, Flame, Sparkles, AlertTriangle } from "lucide-react";
import type { YZOrder } from "@ls/types";
import {
  formatShipDate,
  shipTone,
  shipToneClass,
  isRush,
  attentionTone,
  attentionLabel,
  ATTENTION_COLOR,
} from "@/lib/shopFloor";
import { cn } from "@ls/design/utils";

interface Props {
  order: YZOrder;
  onClick: () => void;
}

// ── Shipment status chip ─────────────────────────────────────────────────────
// Color-coded chip showing the real-time status from LSH Logistics Tracker.
// Maps each tracker status to a brand-palette tint.

interface ShipmentChipMeta {
  label: string;
  bg: string;        // Tailwind/inline bg
  text: string;      // Tailwind/inline text color
  border: string;    // Tailwind/inline border
}

const SHIPMENT_CHIP: Record<string, ShipmentChipMeta> = {
  "Label Created": {
    label: "Label",
    bg: "rgba(241,233,214,0.07)",
    text: "rgba(241,233,214,0.55)",
    border: "rgba(241,233,214,0.15)",
  },
  "In Transit": {
    label: "In Transit",
    bg: "rgba(76,175,80,0.12)",
    text: "#7FD98A",
    border: "rgba(76,175,80,0.30)",
  },
  "Customs": {
    label: "Customs",
    bg: "rgba(255,152,0,0.13)",
    text: "#FFB74D",
    border: "rgba(255,152,0,0.32)",
  },
  "Out for Delivery": {
    label: "Out for Delivery",
    bg: "rgba(76,175,80,0.18)",
    text: "#5EC98B",
    border: "rgba(76,175,80,0.40)",
  },
  "Delivered": {
    label: "Delivered",
    bg: "rgba(93,202,165,0.12)",
    text: "#7FD4B5",
    border: "rgba(93,202,165,0.28)",
  },
  "Exception": {
    label: "Exception",
    bg: "rgba(239,68,68,0.14)",
    text: "#F87171",
    border: "rgba(239,68,68,0.35)",
  },
  "Lost-Claim": {
    label: "Lost",
    bg: "rgba(239,68,68,0.20)",
    text: "#EF4444",
    border: "rgba(239,68,68,0.45)",
  },
};

function shipmentChipMeta(status: string): ShipmentChipMeta {
  return (
    SHIPMENT_CHIP[status] ?? {
      label: status,
      bg: "rgba(241,233,214,0.07)",
      text: "rgba(241,233,214,0.55)",
      border: "rgba(241,233,214,0.15)",
    }
  );
}

function ShipmentChip({ status, eta }: { status: string; eta?: string | null }) {
  const meta = shipmentChipMeta(status);
  const etaLabel =
    eta && status !== "Delivered"
      ? " · " +
        new Date(eta + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.04em",
        padding: "2px 8px",
        borderRadius: 20,
        background: meta.bg,
        color: meta.text,
        border: `0.5px solid ${meta.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <Truck
        style={{ width: 10, height: 10, flexShrink: 0, color: meta.text }}
        aria-hidden
      />
      {meta.label}
      {etaLabel}
    </span>
  );
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

      {/* Shipment status chip — shown when a tracker row is linked */}
      {order.shipment_status ? (
        <div className="mt-2">
          <ShipmentChip status={order.shipment_status} eta={order.shipment_eta} />
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
