/**
 * CycleTimeMiniChart — Marco's TileOS widget.
 * Shows weekly avg transit days NYC vs HOU as a compact sparkline-style
 * line chart that lives inside the Marco AgentStatusCard.
 */

import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Package, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@ls/design/utils";
import { useLogisticsCycleTimes, useLogisticsSummary } from "@/lib/queries";

// ─── palette ──────────────────────────────────────────────────────────────────

const NYC_COLOR  = "#B08D57";   // brass
const HOU_COLOR  = "#4FBF8E";   // emerald

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-forest-raised/95 backdrop-blur-sm border border-brass/30 rounded-lg px-2.5 py-2 text-[9px] text-cream shadow-glass">
      <p className="text-cream-dim mb-1 font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-cream-muted">{p.name}:</span>
          <span style={{ color: p.color }} className="font-semibold">{p.value}d</span>
        </p>
      ))}
    </div>
  );
}

// ─── TrendBadge ───────────────────────────────────────────────────────────────

function TrendBadge({ value, label, color }: { value: number | null; label: string; color: string }) {
  if (value === null) return null;
  const up   = value > 0.5;
  const down = value < -0.5;
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] font-mono" style={{ color }}>{label}</span>
      {up   && <TrendingUp   className="h-2.5 w-2.5 text-signal-rose" />}
      {down && <TrendingDown className="h-2.5 w-2.5 text-signal-emerald" />}
      {!up && !down && <Minus className="h-2.5 w-2.5 text-cream-dim" />}
      <span className={cn("text-[8px] font-mono",
        up   ? "text-signal-rose"
        : down ? "text-signal-emerald"
        : "text-cream-dim",
      )}>
        {value > 0 ? "+" : ""}{value}d
      </span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CycleTimeMiniChart() {
  const { data: ct, isLoading: ctLoading } = useLogisticsCycleTimes();
  const { data: ls } = useLogisticsSummary();

  const summary  = ct?.summary;
  const hasHou   = summary?.has_hou_data;

  // Build recharts data array
  const chartData = (ct?.weeks ?? []).map((week: string, i: number) => ({
    week,
    NYC:  ct?.nyc?.[i] ?? null,
    HOU:  ct?.hou?.[i] ?? null,
  }));

  const nycAvg = summary?.nyc_avg;
  const houAvg = summary?.hou_avg;

  return (
    <div className="mt-3 pt-3 border-t border-brass/10 space-y-2">
      {/* Row 1 — KPI badges */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Package className="h-2.5 w-2.5 text-brass-light" />
          <span className="text-[9px] text-cream-dim">Cycle times</span>
        </div>
        <div className="flex items-center gap-3">
          {nycAvg !== null && nycAvg !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-mono" style={{ color: NYC_COLOR }}>NYC</span>
              <span className="text-[10px] font-semibold text-cream">{nycAvg}d</span>
            </div>
          )}
          {hasHou && houAvg !== null && houAvg !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-mono" style={{ color: HOU_COLOR }}>HOU</span>
              <span className="text-[10px] font-semibold text-cream">{houAvg}d</span>
            </div>
          )}
        </div>
      </div>

      {/* Row 2 — sparkline chart */}
      {ctLoading ? (
        <div className="h-16 rounded animate-pulse bg-cream/5" />
      ) : chartData.length < 2 ? (
        <div className="h-16 flex items-center justify-center text-[9px] text-cream-dim/60 border border-dashed border-brass/10 rounded-lg">
          Collecting data…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={56}>
          <LineChart data={chartData} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 2" stroke="rgba(176,141,87,0.07)" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 7, fill: "#6B6558" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 7, fill: "#6B6558" }}
              axisLine={false}
              tickLine={false}
              domain={["auto", "auto"]}
            />
            <Tooltip content={<ChartTip />} />
            <Line
              type="monotone"
              dataKey="NYC"
              stroke={NYC_COLOR}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: NYC_COLOR }}
              connectNulls={false}
            />
            {hasHou && (
              <Line
                type="monotone"
                dataKey="HOU"
                stroke={HOU_COLOR}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: HOU_COLOR }}
                connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Row 3 — trend deltas */}
      {summary && (
        <div className="flex items-center justify-between">
          <TrendBadge value={summary.nyc_trend} label="NYC" color={NYC_COLOR} />
          {hasHou && <TrendBadge value={summary.hou_trend} label="HOU" color={HOU_COLOR} />}
        </div>
      )}

      {/* Row 4 — live status pills */}
      {ls && (
        <div className="flex items-center gap-2 flex-wrap">
          {ls.in_transit > 0 && (
            <span className="flex items-center gap-0.5 text-[7px] px-1.5 py-0.5 rounded-full bg-brass/10 text-brass-light border border-brass/15">
              <Clock className="h-2 w-2" />
              {ls.in_transit} in transit
            </span>
          )}
          {ls.exceptions > 0 && (
            <span className="flex items-center gap-0.5 text-[7px] px-1.5 py-0.5 rounded-full bg-signal-rose/10 text-signal-rose border border-signal-rose/20">
              <AlertTriangle className="h-2 w-2" />
              {ls.exceptions} exception{ls.exceptions !== 1 ? "s" : ""}
            </span>
          )}
          {ls.in_customs > 0 && (
            <span className="flex items-center gap-0.5 text-[7px] px-1.5 py-0.5 rounded-full bg-signal-amber/10 text-signal-amber border border-signal-amber/20">
              <Package className="h-2 w-2" />
              {ls.in_customs} customs
            </span>
          )}
        </div>
      )}
    </div>
  );
}
