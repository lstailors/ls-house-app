import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ExternalLink, Truck } from "lucide-react";
import type { YZOrder } from "@/lib/types";
import {
  byShipDate,
  formatFullDate,
  shipTone,
  shipToneClass,
  trackingLink,
  ALL_STATUSES,
} from "@/lib/shopFloor";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";

type SortKey = "order_no" | "ship_date_planned";
type SortDir = "asc" | "desc";

interface Props {
  orders: YZOrder[];
  onSelect: (order: YZOrder) => void;
}

export function TableView({ orders, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("ship_date_planned");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? orders
        : orders.filter((o) => o.production_status === statusFilter),
    [orders, statusFilter],
  );

  const sorted = useMemo(() => {
    const rows = [...filtered];
    if (sortKey === "ship_date_planned") {
      rows.sort(byShipDate);
    } else {
      rows.sort((a, b) => a.order_no.localeCompare(b.order_no));
    }
    if (sortDir === "desc") rows.reverse();
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return null;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {["all", ...ALL_STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              statusFilter === s
                ? "border-brass/40 bg-brass/20 font-medium text-brass-light"
                : "border-brass/15 text-cream-dim hover:border-brass/30 hover:text-cream",
            )}
          >
            {s === "all" ? "All" : s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-brass/12">
        <table className="w-full min-w-[980px] text-base">
          <thead>
            <tr className="border-b border-brass/12 bg-forest-deep/40 text-left">
              <th className="px-3.5 py-3.5">
                <button
                  onClick={() => toggleSort("order_no")}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widerer text-cream-dim transition-colors hover:text-cream"
                >
                  Order No <SortIcon col="order_no" />
                </button>
              </th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Customer</th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Garment</th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Fabric No</th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Process</th>
              <th className="px-3.5 py-3.5 text-right text-xs font-semibold uppercase tracking-widerer text-cream-dim">Pcs</th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Placed</th>
              <th className="px-3.5 py-3.5">
                <button
                  onClick={() => toggleSort("ship_date_planned")}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widerer text-cream-dim transition-colors hover:text-cream"
                >
                  Ship Date <SortIcon col="ship_date_planned" />
                </button>
              </th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Status</th>
              <th className="px-3.5 py-3.5 text-xs font-semibold uppercase tracking-widerer text-cream-dim">Tracking</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => {
              const tone = shipTone(order);
              const track = trackingLink(order.tracking_no);
              return (
                <tr
                  key={order.name}
                  onClick={() => onSelect(order)}
                  className="cursor-pointer border-b border-brass/8 transition-colors last:border-0 hover:bg-brass/5"
                >
                  <td className="px-3.5 py-3.5">
                    <span className="font-mono text-sm font-semibold text-brass-light">
                      {order.order_no}
                    </span>
                  </td>
                  <td className="px-3.5 py-3.5 text-cream">
                    {order.customer_name ?? "—"}
                  </td>
                  <td className="px-3.5 py-3.5 text-cream-muted">
                    {order.garment_summary ?? "—"}
                  </td>
                  <td className="px-3.5 py-3.5 text-cream-muted">
                    {order.fabric_number ?? "—"}
                  </td>
                  <td className="px-3.5 py-3.5 text-cream-muted">
                    {order.process_category ?? "—"}
                  </td>
                  <td className="px-3.5 py-3.5 text-right text-cream-muted">
                    {order.total_pieces || "—"}
                  </td>
                  <td className="px-3.5 py-3.5 text-cream-dim">
                    {formatFullDate(order.date_placed)}
                  </td>
                  <td className={cn("px-3.5 py-3.5 font-medium", shipToneClass(tone))}>
                    {formatFullDate(order.ship_date_planned, "No date")}
                  </td>
                  <td className="px-3.5 py-3.5">
                    <StatusBadge status={order.production_status} size="sm" />
                  </td>
                  <td className="px-3.5 py-3.5">
                    {track ? (
                      <a
                        href={track.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-sm text-signal-emerald hover:underline"
                      >
                        <Truck className="h-3 w-3" />
                        {track.carrier}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="text-cream-dim">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
