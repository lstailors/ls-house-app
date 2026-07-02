import { useMemo } from "react";
import type { YZOrder } from "@/lib/types";
import { KANBAN_STATUSES, statusMeta, byShipDate } from "@/lib/shopFloor";
import { KanbanCard } from "./KanbanCard";

interface Props {
  orders: YZOrder[];
  onSelect: (order: YZOrder) => void;
}

export function KanbanBoard({ orders, onSelect }: Props) {
  const columns = useMemo(() => {
    return KANBAN_STATUSES.map((status) => ({
      status,
      meta: statusMeta(status),
      items: orders
        .filter((o) => o.production_status === status)
        .sort(byShipDate),
    }));
  }, [orders]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col.status}
          className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-brass/12 bg-forest-deep/30"
        >
          {/* Column header */}
          <div className="flex items-center justify-between gap-2 border-b border-brass/12 px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: col.meta.color }}
              />
              <span className="text-sm font-semibold uppercase tracking-widerer text-cream-muted">
                {col.meta.label}
              </span>
            </div>
            <span className="rounded-full bg-brass/10 px-2.5 py-0.5 text-xs font-semibold text-brass-light">
              {col.items.length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-2.5">
            {col.items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-10 text-center text-xs text-cream-dim">
                No orders
              </div>
            ) : (
              col.items.map((order) => (
                <KanbanCard
                  key={order.name}
                  order={order}
                  onClick={() => onSelect(order)}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
