import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-forest-raised/95 backdrop-blur-sm border border-brass/30 rounded-xl px-4 py-3 text-xs text-cream shadow-glass">
      {label && <p className="text-cream-dim mb-2 font-medium">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-cream-muted">{p.name}:</span>
          <span style={{ color: p.color }} className="font-semibold">
            {p.name === "Revenue" ? formatUSD(p.value) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
};

interface Props {
  trend: Array<{ month: string; revenue: number; orders: number }>;
  revenueMTD: number;
  revenueChange: number;
  avgOrderValue: number;
  salesOrderCount: number;
}

export function RevenueTrend({ trend, revenueMTD, revenueChange, avgOrderValue, salesOrderCount }: Props) {
  const navigate = useNavigate();
  const up = revenueChange >= 0;

  return (
    <GlassCard variant="strong" className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="ui-label mb-1">Revenue Trend</div>
          <div className="flex items-baseline gap-3">
            <span className="font-display italic text-3xl text-signal-emerald leading-none">
              {formatUSD(revenueMTD, { compact: true })}
            </span>
            <span className="text-sm text-cream-muted">this month</span>
            <span className={cn("flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
              up ? "text-signal-emerald bg-signal-emerald/10" : "text-signal-rose bg-signal-rose/10")}>
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {up ? "+" : ""}{revenueChange}%
            </span>
          </div>
        </div>
        <button
          onClick={() => navigate("/financials")}
          className="text-xs text-brass-light hover:text-brass transition-colors"
        >
          Full report →
        </button>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B08D57" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#B08D57" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(176,141,87,0.08)" />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#8A8474" }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="rev" orientation="left" tick={{ fontSize: 10, fill: "#8A8474" }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `$${Math.round(v / 1000)}k`} width={36} />
          <YAxis yAxisId="ord" orientation="right" tick={{ fontSize: 10, fill: "#8A8474" }} axisLine={false} tickLine={false} width={24} />
          <Tooltip content={<ChartTip />} />
          <Area yAxisId="rev" type="monotone" dataKey="revenue" name="Revenue" fill="url(#revGrad)"
            stroke="#D4B27A" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#D4B27A" }} />
          <Bar yAxisId="ord" dataKey="orders" name="Orders" fill="rgba(79,191,142,0.35)"
            radius={[3, 3, 0, 0]} maxBarSize={16} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Mini stat strip */}
      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-brass/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brass/10 border border-brass/20 flex items-center justify-center shrink-0">
            <DollarSign className="h-3.5 w-3.5 text-brass-light" />
          </div>
          <div>
            <div className="text-[10px] text-cream-muted uppercase tracking-wide">Avg Order</div>
            <div className="text-sm font-semibold text-cream">{formatUSD(avgOrderValue)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-signal-emerald/10 border border-signal-emerald/20 flex items-center justify-center shrink-0">
            <TrendingUp className="h-3.5 w-3.5 text-signal-emerald" />
          </div>
          <div>
            <div className="text-[10px] text-cream-muted uppercase tracking-wide">Total Orders</div>
            <div className="text-sm font-semibold text-cream">{salesOrderCount}</div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
