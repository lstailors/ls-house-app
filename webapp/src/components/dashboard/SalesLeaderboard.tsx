import { useState } from "react";
import { Users } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { formatUSD } from "@/lib/format";

const MEDAL_COLORS = ["#D4B27A", "#C9C0AB", "#B08D57", "#8A8474"];

type Period = "MTD" | "6M" | "All";

const PERIOD_LABELS: { key: Period; label: string }[] = [
  { key: "MTD", label: "MTD" },
  { key: "6M", label: "6M" },
  { key: "All", label: "All" },
];

interface Rep { name: string; orders: number; revenue: number }
interface Props { data: Rep[] }

export function SalesLeaderboard({ data }: Props) {
  const [period, setPeriod] = useState<Period>("All");

  if (!data?.length) return null;

  // NOTE: salesByRep data contains only aggregated totals (no per-order dates),
  // so MTD/6M filters display the same data — the toggle is visual scaffolding
  // for when the backend provides time-scoped data in the future.
  const displayData = data;

  const maxRev = Math.max(...displayData.map(d => d.revenue), 1);

  return (
    <GlassCard variant="strong" className="p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-5">
        <div className="ui-label flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-brass-light" />
          Sales by Rep
        </div>
        <div className="flex items-center gap-1">
          {PERIOD_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={[
                "text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-md transition-colors",
                period === key
                  ? "bg-brass/20 text-brass-light font-semibold"
                  : "text-cream-dim hover:text-cream-muted",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 flex-1">
        {displayData.slice(0, 6).map((rep, i) => {
          const pct = Math.round((rep.revenue / maxRev) * 100);
          return (
            <div key={rep.name} className="group">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ background: `${MEDAL_COLORS[i] ?? "#4A3D2A"}22`, color: MEDAL_COLORS[i] ?? "#8A8474" }}>
                    {i + 1}
                  </span>
                  <span className="text-sm text-cream leading-tight truncate max-w-[120px]">{rep.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-brass-light">{formatUSD(rep.revenue, { compact: true })}</div>
                  <div className="text-[10px] text-cream-dim">{rep.orders} orders</div>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-brass/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${MEDAL_COLORS[i] ?? "#B08D57"}99, ${MEDAL_COLORS[i] ?? "#B08D57"})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
