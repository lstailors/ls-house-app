import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown, ExternalLink, Truck } from "lucide-react";
import type { YZOrder } from "@/lib/types";
import {
  formatFullDate,
  shipTone,
  shipToneClass,
  trackingLink,
  ALL_STATUSES,
} from "@/lib/shopFloor";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";

// Every column is sortable. Keys map to a comparable value via getVal().
type SortKey =
  | "order_no"
  | "customer_name"
  | "garment_summary"
  | "fabric_number"
  | "process_category"
  | "total_pieces"
  | "date_placed"
  | "ship_date_planned"
  | "production_status"
  | "tracking_no";
type SortDir = "asc" | "desc";

interface Props {
  orders: YZOrder[];
  onSelect: (order: YZOrder) => void;
}

const STATUS_RANK: Record<string, number> = Object.fromEntries(
  ALL_STATUSES.map((s, i) => [s, i]),
);

// Returns the comparable value for a column — string | number | null.
// null/empty always sorts last regardless of direction.
function getVal(o: YZOrder, key: SortKey): string | number | null {
  switch (key) {
    case "total_pieces":
      return o.total_pieces;
    case "production_status":
      return STATUS_RANK[o.production_status] ?? 99;
    case "tracking_no":
      return trackingLink(o.tracking_no)?.carrier ?? null;
    default:
      return (o[key] as string | null) || null;
  }
}

interface Column {
  key: SortKey;
  label: string;
  align?: "right";
}

const COLUMNS: Column[] = [
  { key: "order_no", label: "Order No" },
  { key: "customer_name", label: "Customer" },
  { key: "garment_summary", label: "Garment" },
  { key: "fabric_number", label: "Fabric No" },
  { key: "process_category", label: "Process" },
  { key: "total_pieces", label: "Pcs", align: "right" },
  { key: "date_placed", label: "Placed" },
  { key: "ship_date_planned", label: "Ship Date" },
  { key: "production_status", label: "Status" },
  { key: "tracking_no", label: "Tracking" },
];

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
    const mult = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = getVal(a, sortKey);
      const bv = getVal(b, sortKey);
      // Empty values always sink to the bottom, in both directions.
      if (av === null && bv === null) return a.order_no.localeCompare(b.order_no);
      if (av === null) return 1;
      if (bv === null) return -1;
      let base =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      if (base === 0) base = a.order_no.localeCompare(b.order_no);
      return base * mult;
    });
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
    if (col !== sortKey) {
      return <ChevronsUpDown className="h-3 w-3 opacity-30 group-hover:opacity-60" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 text-brass-light" />
    ) : (
      <ArrowDown className="h-3 w-3 text-brass-light" />
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
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn("px-3.5 py-3.5", col.align === "right" && "text-right")}
                >
                  <button
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "group inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widerer transition-colors hover:text-cream",
                      sortKey === col.key ? "text-brass-light" : "text-cream-dim",
                      col.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {col.label} <SortIcon col={col.key} />
                  </button>
                </th>
              ))}
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
                    <StatusBadge status={order.production_status} />
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
                        <Truck className="h-3.5 w-3.5" />
                        {track.carrier}
                        <ExternalLink className="h-3 w-3" />
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
