import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { YZOrder } from "@ls/types";
import { statusMeta, isRush, todayStr, byShipDate } from "@/lib/shopFloor";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";

interface Props {
  orders: YZOrder[];
  onSelect: (order: YZOrder) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function CalendarView({ orders, onSelect }: Props) {
  // Group plotted orders by ship date.
  const byDate = useMemo(() => {
    const map = new Map<string, YZOrder[]>();
    for (const o of orders) {
      if (!o.ship_date_planned) continue;
      const list = map.get(o.ship_date_planned) ?? [];
      list.push(o);
      map.set(o.ship_date_planned, list);
    }
    for (const list of map.values()) list.sort(byShipDate);
    return map;
  }, [orders]);

  // Default month: current month, or the nearest month that actually has orders.
  const initial = useMemo(() => {
    const now = new Date();
    const curKey = ymKey(now.getFullYear(), now.getMonth());
    const hasCurrent = orders.some((o) => o.ship_date_planned?.startsWith(curKey));
    if (hasCurrent || orders.length === 0) {
      return { year: now.getFullYear(), month: now.getMonth() };
    }
    // pick the order whose ship date is closest to today
    const today = todayStr();
    let best: string | null = null;
    let bestDist = Infinity;
    for (const o of orders) {
      const s = o.ship_date_planned;
      if (!s) continue;
      const dist = Math.abs(
        (new Date(s).getTime() - new Date(today).getTime()) / 86_400_000,
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    if (best) {
      const [y, m] = best.split("-").map(Number);
      return { year: y, month: m - 1 };
    }
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [orders]);

  const [cursor, setCursor] = useState(initial);

  const goPrev = () =>
    setCursor((c) =>
      c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 },
    );
  const goNext = () =>
    setCursor((c) =>
      c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 },
    );
  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
  };

  // Build the calendar grid (leading blanks + days of month).
  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const arr: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < startDay; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      arr.push({ date, day: d });
    }
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [cursor]);

  const today = todayStr();

  return (
    <div className="rounded-2xl border border-brass/12 bg-forest-deep/30 p-3 sm:p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-2xl italic text-cream">
          {MONTH_NAMES[cursor.month]}{" "}
          <span className="text-cream-muted">{cursor.year}</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToday}
            className="border border-brass/20 text-cream-dim hover:text-cream"
          >
            Today
          </Button>
          <button
            onClick={goPrev}
            className="rounded-md border border-brass/20 p-1.5 text-cream-dim transition-colors hover:text-cream"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goNext}
            className="rounded-md border border-brass/20 p-1.5 text-cream-dim transition-colors hover:text-cream"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div className="mb-1 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 py-1 text-center text-[10px] font-medium uppercase tracking-widerer text-cream-dim">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} className="min-h-[108px] rounded-lg" />;
          const dayOrders = byDate.get(cell.date) ?? [];
          const hasRush = dayOrders.some(isRush);
          const isToday = cell.date === today;
          return (
            <div
              key={cell.date}
              className={cn(
                "flex min-h-[108px] flex-col rounded-lg border bg-forest-raised/30 p-1.5",
                isToday ? "border-brass/50" : "border-brass/10",
                hasRush && "border-l-2 border-l-[#FF9800]",
              )}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "text-sm font-semibold",
                    isToday ? "text-brass-light" : "text-cream-muted",
                  )}
                >
                  {cell.day}
                </span>
                {dayOrders.length > 0 ? (
                  <span className="text-[11px] text-cream-dim">{dayOrders.length}</span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1 overflow-hidden">
                {dayOrders.slice(0, 3).map((o) => {
                  const meta = statusMeta(o.production_status);
                  return (
                    <button
                      key={o.name}
                      type="button"
                      onClick={() => onSelect(o)}
                      className="group flex items-start gap-1 rounded border border-brass/10 bg-forest-deep/50 px-1 py-0.5 text-left transition-colors hover:border-brass/30"
                    >
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: meta.color,
                          boxShadow: `0 0 5px 1px ${meta.color}`,
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-mono font-semibold text-brass-light/90">
                          {o.order_no}
                        </span>
                        <span className="block truncate text-[11px] text-cream-muted">
                          {o.customer_name ?? o.garment_summary ?? ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {dayOrders.length > 3 ? (
                  <span className="px-1 text-[11px] text-cream-dim">
                    +{dayOrders.length - 3} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
