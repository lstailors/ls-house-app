import { api, ApiError } from "@/lib/api";
import {
  TrendingUp,
  TrendingDown,
  Receipt,
  Wallet,
  Coins,
  BadgeDollarSign,
  AlertCircle,
  BarChart3,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { useState } from "react";
import { useFinancials } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinData {
  revenue: number;
  revenueMTD: number;
  revenueLastMonth: number;
  revenueChange: number;
  salesOrderCount: number;
  avgOrderValue: number;
  depositsPendingTotal: number;
  depositsPendingCount: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  trend: Array<{ month: string; revenue: number; orders: number }>;
  pipeline: Array<{ stage: string; label: string; count: number; value: number }>;
  topGarments: Array<{ type: string; units: number; revenue: number; avgPrice: number }>;
  arOutstanding: number;
  invoiceCount: number;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel px-3 py-2 text-xs border border-brass/20">
      <div className="text-cream-dim mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex gap-2 items-center">
          <span style={{ color: p.color }}>{p.name === "revenue" ? "Revenue" : "Orders"}</span>
          <span className="text-cream font-mono tabular-nums">
            {p.name === "revenue" ? formatUSD(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Pipeline row ─────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  quote: "bg-brass/70",
  deposit_paid: "bg-signal-amber",
  in_production: "bg-signal-amber/80",
  ready: "bg-signal-emerald",
  delivered: "bg-cream-dim/40",
};

const STAGE_BAR_COLORS: Record<string, string> = {
  quote: "bg-brass/40",
  deposit_paid: "bg-signal-amber/50",
  in_production: "bg-signal-amber/40",
  ready: "bg-signal-emerald/50",
  delivered: "bg-cream-dim/20",
};

function PipelineRow({
  stage,
  label,
  count,
  value,
  total,
}: {
  stage: string;
  label: string;
  count: number;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const dotColor = STAGE_COLORS[stage] ?? "bg-cream-dim/40";
  const barColor = STAGE_BAR_COLORS[stage] ?? "bg-cream-dim/20";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-sm flex-shrink-0", dotColor)} />
          <span className="text-sm text-cream-muted">{label}</span>
        </div>
        <div className="flex items-center gap-3 text-right">
          <span className="text-xs text-cream-dim">{formatUSD(value, { compact: true })}</span>
          <span className="font-mono text-sm text-cream tabular-nums w-6 text-right">{count}</span>
        </div>
      </div>
      <div className="h-1 rounded-full bg-forest-raised/60 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Garment row ──────────────────────────────────────────────────────────────

function GarmentRow({
  type,
  units,
  revenue,
  avgPrice,
  maxUnits,
}: {
  type: string;
  units: number;
  revenue: number;
  avgPrice: number;
  maxUnits: number;
}) {
  const pct = maxUnits > 0 ? Math.round((units / maxUnits) * 100) : 0;
  return (
    <tr className="border-b border-brass/8 last:border-0 hover:bg-brass/5 transition-colors">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-cream">{type}</span>
        </div>
        <div className="mt-1 h-0.5 rounded-full bg-forest-raised/60 overflow-hidden w-24">
          <div
            className="h-full rounded-full bg-brass/50 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-cream pr-4">{units}</td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-signal-emerald pr-4">
        {formatUSD(revenue, { compact: true })}
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-cream-muted">
        {formatUSD(avgPrice)}
      </td>
    </tr>
  );
}

// ─── PIN gate ─────────────────────────────────────────────────────────────────

function FinancialsGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // Use the api helper rather than a relative fetch: it attaches the Bearer
      // token and honours VITE_BACKEND_URL, so this keeps working if the app is
      // ever served from a host that doesn't proxy /api itself.
      await api.post("/api/financials/unlock", { pin });
      sessionStorage.setItem("fin_unlocked", "1");
      onUnlock();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Incorrect code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div className="glass-panel-strong rounded-2xl p-10 w-full max-w-xs text-center space-y-6">
        <div className="w-14 h-14 rounded-full bg-brass/10 border border-brass/30 flex items-center justify-center mx-auto">
          <span className="text-2xl">🔒</span>
        </div>
        <div>
          <div className="font-display italic text-xl text-cream mb-1">Financials</div>
          <div className="text-xs text-cream-muted">Enter the access code to continue</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            maxLength={10}
            placeholder="• • • • • •"
            value={pin}
            onChange={e => { setPin(e.target.value); setError(""); }}
            className="w-full text-center text-lg tracking-widest h-12 rounded-lg bg-forest-raised/40 border border-brass/25 text-cream focus:outline-none focus:border-brass/60 placeholder:text-cream-dim"
            autoFocus
          />
          {error && <div className="text-xs text-signal-rose">{error}</div>}
          <button
            type="submit"
            disabled={loading || !pin}
            className="w-full h-11 btn-brass rounded-lg text-sm font-medium disabled:opacity-40"
          >
            {loading ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Financials() {
  const { data: me } = useMe();
  const canSee = me?.role === "super_admin" || me?.role === "store_manager";
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("fin_unlocked") === "1");

  const { data: rawFin, isLoading } = useFinancials();

  if (!canSee && !unlocked) return <FinancialsGate onUnlock={() => setUnlocked(true)} />;
  const fin = rawFin as unknown as FinData | undefined;

  const totalPipeline = fin ? fin.pipeline.reduce((s, p) => s + p.count, 0) : 0;
  const maxGarmentUnits = fin ? Math.max(...fin.topGarments.map((g) => g.units), 1) : 1;

  const changePct = fin?.revenueChange ?? 0;
  const changePositive = changePct >= 0;

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="House · Financials"
        title={
          <>
            The <span className="text-brass-shimmer">books</span>, at a glance.
          </>
        }
        description="Revenue, pipeline, COGS, and gross profit — the numbers that keep the cutters paid."
      />

      {/* Time period selector (UI only) */}
      <div className="flex gap-1.5">
        {["MTD", "3M", "6M", "YTD", "All"].map((label, i) => (
          <button
            key={label}
            className={cn(
              "px-3 py-1 rounded text-xs ui-label transition-colors",
              i === 0
                ? "bg-brass/20 text-brass-shimmer border border-brass/30"
                : "text-cream-dim hover:text-cream-muted border border-transparent hover:border-brass/20",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading || !fin ? (
        <div className="text-cream-muted text-sm py-12 text-center">Loading financials…</div>
      ) : (
        <>
          {/* SECTION 1: Revenue KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {/* Revenue MTD — hero tile */}
            <GlassCard variant="strong" className="p-5 md:p-6 relative overflow-hidden col-span-2 md:col-span-1">
              <div className="absolute inset-0 bg-gradient-to-br from-brass/10 via-transparent to-transparent pointer-events-none" />
              <div className="relative">
                <div className="ui-label mb-2 flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3 text-brass-light" /> Revenue MTD
                </div>
                <div className="font-display italic text-4xl md:text-5xl text-brass-shimmer leading-none">
                  {formatUSD(fin.revenueMTD, { compact: true })}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  {changePositive ? (
                    <TrendingUp className="h-3 w-3 text-signal-emerald" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-signal-rose" />
                  )}
                  <span
                    className={cn(
                      "text-xs font-mono",
                      changePositive ? "text-signal-emerald" : "text-signal-rose",
                    )}
                  >
                    {changePositive ? "+" : ""}
                    {changePct}% vs last month
                  </span>
                </div>
              </div>
            </GlassCard>

            <KpiCard
              label="Total Revenue"
              value={
                <span className="font-display italic text-3xl text-cream leading-none">
                  {formatUSD(fin.revenue, { compact: true })}
                </span>
              }
              hint={`${fin.salesOrderCount} orders`}
              icon={<BarChart3 className="h-4 w-4" />}
            />

            <KpiCard
              label="Avg Order Value"
              value={
                <span className="font-display italic text-3xl text-signal-emerald leading-none">
                  {formatUSD(fin.avgOrderValue, { compact: true })}
                </span>
              }
              hint="Per custom order"
              accent="emerald"
              icon={<BadgeDollarSign className="h-4 w-4" />}
            />

            <KpiCard
              label="Gross Profit"
              value={
                <span className="font-display italic text-3xl text-signal-emerald leading-none">
                  {formatUSD(fin.grossProfit, { compact: true })}
                </span>
              }
              hint={`${fin.marginPct}% margin`}
              accent="emerald"
              icon={<Coins className="h-4 w-4" />}
            />

            <KpiCard
              label="Deposits Pending"
              value={
                <span className="font-display italic text-3xl text-signal-amber leading-none">
                  {formatUSD(fin.depositsPendingTotal, { compact: true })}
                </span>
              }
              hint={`${fin.depositsPendingCount} commissions awaiting`}
              accent="amber"
              icon={<Wallet className="h-4 w-4" />}
            />

            <KpiCard
              label="AR Outstanding"
              value={
                <span
                  className={cn(
                    "font-display italic text-3xl leading-none",
                    fin.arOutstanding > 0 ? "text-signal-rose" : "text-cream-dim",
                  )}
                >
                  {formatUSD(fin.arOutstanding, { compact: true })}
                </span>
              }
              hint={fin.invoiceCount > 0 ? `${fin.invoiceCount} open invoice${fin.invoiceCount === 1 ? "" : "s"}` : "No open invoices"}
              accent={fin.arOutstanding > 0 ? "rose" : "default"}
              icon={<AlertCircle className="h-4 w-4" />}
            />
          </div>

          {/* SECTION 2: Revenue Trend */}
          <GlassCard variant="strong" className="p-5 md:p-6">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <div className="ui-label">Revenue Trend</div>
                <div className="text-xs text-cream-dim mt-0.5">last 6 months</div>
              </div>
              <div className="text-xs text-cream-dim font-mono">
                {fin.trend.length > 0 ? fin.trend[0].month : ""} – {fin.trend.length > 0 ? fin.trend[fin.trend.length - 1].month : ""}
              </div>
            </div>
            <div className="h-48 md:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={fin.trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="brassGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#B08D57" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#B08D57" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(176,141,87,0.08)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "#8A7A5C" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#8A7A5C" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatUSD(v, { compact: true })}
                    width={55}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#C4A265"
                    strokeWidth={2}
                    fill="url(#brassGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: "#C4A265", stroke: "#1A2E22" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          {/* SECTION 3: Pipeline + Order Activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pipeline */}
            <GlassCard variant="strong" className="p-5 md:p-6">
              <div className="ui-label mb-4">Custom Orders Pipeline</div>
              <div className="space-y-3.5">
                {fin.pipeline.length === 0 ? (
                  <div className="text-cream-dim text-sm py-4">No orders found.</div>
                ) : (
                  fin.pipeline.map((p) => (
                    <PipelineRow
                      key={p.stage}
                      stage={p.stage}
                      label={p.label}
                      count={p.count}
                      value={p.value}
                      total={totalPipeline}
                    />
                  ))
                )}
              </div>
              {fin.pipeline.length > 0 ? (
                <div className="mt-4 pt-3 border-t border-brass/10 flex justify-between text-xs text-cream-dim">
                  <span>Total orders</span>
                  <span className="font-mono text-cream tabular-nums">{totalPipeline}</span>
                </div>
              ) : null}
            </GlassCard>

            {/* Order Activity */}
            <GlassCard variant="strong" className="p-5 md:p-6">
              <div className="flex items-baseline justify-between mb-4">
                <div className="ui-label">Order Activity</div>
              </div>
              {/* Mini stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="glass-panel p-3 text-center">
                  <div className="font-display italic text-2xl text-brass-shimmer leading-none">
                    {fin.trend.length > 0 ? fin.trend[fin.trend.length - 1].orders : 0}
                  </div>
                  <div className="text-[10px] text-cream-dim mt-1">This Month</div>
                </div>
                <div className="glass-panel p-3 text-center">
                  <div className="font-display italic text-2xl text-cream leading-none">
                    {fin.trend.length > 1 ? fin.trend[fin.trend.length - 2].orders : 0}
                  </div>
                  <div className="text-[10px] text-cream-dim mt-1">Last Month</div>
                </div>
                <div className="glass-panel p-3 text-center">
                  <div
                    className={cn(
                      "font-display italic text-2xl leading-none",
                      changePositive ? "text-signal-emerald" : "text-signal-rose",
                    )}
                  >
                    {changePositive ? "+" : ""}
                    {changePct}%
                  </div>
                  <div className="text-[10px] text-cream-dim mt-1">Change</div>
                </div>
              </div>
              {/* Mini bar chart */}
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fin.trend} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barSize={14}>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "#8A7A5C" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="glass-panel px-2 py-1.5 text-xs border border-brass/20">
                            <div className="text-cream-dim">{label}</div>
                            <div className="text-cream font-mono">{payload[0]?.value} orders</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="orders" fill="#B08D57" radius={[2, 2, 0, 0]} opacity={0.75} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>
          </div>

          {/* SECTION 4: Top Garments */}
          <GlassCard variant="strong" className="p-5 md:p-6">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <div className="ui-label">Top Garments</div>
                <div className="text-xs text-cream-dim mt-0.5">by units</div>
              </div>
            </div>
            {fin.topGarments.length === 0 ? (
              <div className="text-cream-dim text-sm py-4">No garment data yet.</div>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-left min-w-[400px]">
                  <thead>
                    <tr className="border-b border-brass/15">
                      <th className="pb-2 text-[10px] uppercase tracking-widest text-cream-dim font-normal pr-3">
                        Garment
                      </th>
                      <th className="pb-2 text-[10px] uppercase tracking-widest text-cream-dim font-normal text-right pr-4">
                        Units
                      </th>
                      <th className="pb-2 text-[10px] uppercase tracking-widest text-cream-dim font-normal text-right pr-4">
                        Revenue
                      </th>
                      <th className="pb-2 text-[10px] uppercase tracking-widest text-cream-dim font-normal text-right">
                        Avg Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fin.topGarments.slice(0, 6).map((g) => (
                      <GarmentRow
                        key={g.type}
                        type={g.type}
                        units={g.units}
                        revenue={g.revenue}
                        avgPrice={g.avgPrice}
                        maxUnits={maxGarmentUnits}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-5 pt-4 border-t border-brass/10 text-[11px] text-cream-dim italic">
              Figures are real-time from operations data. Authoritative books sync from ERPNext nightly.
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}
