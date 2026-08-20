import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Crown,
  Download,
  Radio,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";
import { api } from "@ls/api-client";
import { GlassCard, SectionHeader } from "@ls/design";
import { formatUSD } from "@ls/design/format";
import { cn } from "@ls/design/utils";
import { useMe } from "@ls/auth";

type RangeKey = "today" | "7d" | "30d" | "90d" | "ytd";

type OwnerPayload = {
  generatedAt: string;
  range: { key: RangeKey; start: string; end: string; label: string };
  kpis: Record<
    string,
    { value: number; deltaPct: number; sparkline: number[]; href?: string }
  >;
  alerts: Array<{
    id: string;
    tone: "critical" | "warning";
    label: string;
    value: string;
    href?: string;
  }>;
  revenueTrend: Array<{ month: string; billed: number; collected: number; count: number }>;
  arAging: Array<{ bucket: string; amount: number; count: number }>;
  revenueByLocation: Array<{ location: string; amount: number }>;
  paymentMethodMix: Array<{ method: string; amount: number }>;
  topCustomers: Array<{
    customer: string;
    name: string;
    billed: number;
    outstanding: number;
    invoices: number;
  }>;
  alterationPipeline: Array<{ stage: string; count: number }>;
  openAlterations: number;
  ticketPriority: Array<{ priority: string; count: number }>;
  agentWorkload: Array<{ agent: string; count: number }>;
  deliveryStatus: {
    queued: number;
    outForDelivery: number;
    delivered: number;
    failed: number;
  };
  outstandingByCustomer: Array<{
    customer: string;
    name: string;
    outstanding: number;
    invoices: number;
    oldest: string;
    oldestDays: number;
  }>;
  liveFeed: Array<{
    name: string;
    customer: string;
    amount: number;
    outstanding: number;
    status: string;
    tone: "paid" | "open" | "overdue";
    postingDate: string;
    location: string;
  }>;
  placeholders: Record<string, { available: boolean; reason: string }>;
};

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
];

const AGING_COLORS: Record<string, string> = {
  "0-30": "#34d399",
  "31-60": "#B08D57",
  "61-90": "#f59e0b",
  "90+": "#f43f5e",
};

const PRI_COLORS: Record<string, string> = {
  Urgent: "#f43f5e",
  High: "#f59e0b",
  Medium: "#B08D57",
  Low: "#8A8474",
};

const PIPE_COLORS: Record<string, string> = {
  Received: "#60a5fa",
  "In Progress": "#f59e0b",
  Ready: "#34d399",
  "Picked Up": "#8A8474",
};

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-forest-raised/95 backdrop-blur-sm border border-brass/30 rounded-xl px-3 py-2 text-xs text-cream shadow-glass">
      {label && <p className="text-cream-dim mb-1 font-medium">{label}</p>}
      {payload.map((p: any, i: number) => {
        const name = String(p.name ?? "");
        const isMoney = /billed|collected|revenue|amount/i.test(name);
        const display =
          typeof p.value === "number"
            ? isMoney
              ? formatUSD(p.value)
              : p.value.toLocaleString("en-US")
            : p.value;
        return (
          <p key={i} className="flex gap-2">
            <span className="text-cream-muted">{name}</span>
            <span style={{ color: p.color }} className="font-semibold tabular-nums">
              {display}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function Sparkline({ values, tone = "brass" }: { values: number[]; tone?: "brass" | "emerald" | "rose" }) {
  const w = 72;
  const h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const pts = values
    .map((v, i) => {
      const x = values.length <= 1 ? w / 2 : (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const stroke =
    tone === "emerald" ? "#34d399" : tone === "rose" ? "#f43f5e" : "#B08D57";
  return (
    <svg width={w} height={h} className="opacity-90">
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function KpiTile({
  label,
  value,
  delta,
  spark,
  href,
  format = "usd",
}: {
  label: string;
  value: number;
  delta: number;
  spark: number[];
  href?: string;
  format?: "usd" | "pct" | "int";
}) {
  const navigate = useNavigate();
  const up = delta >= 0;
  const display =
    format === "pct"
      ? `${value}%`
      : format === "int"
        ? value.toLocaleString("en-US")
        : formatUSD(value, { compact: true });
  return (
    <button
      type="button"
      onClick={() => href && navigate(href)}
      className="glass-panel rounded-2xl p-4 text-left border border-brass/15 hover:border-brass/40 transition-all group w-full"
    >
      <div className="ui-label mb-2">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="font-display italic text-3xl text-cream leading-none group-hover:text-brass-light transition-colors">
            {display}
          </div>
          <div
            className={cn(
              "mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
              up ? "text-signal-emerald bg-signal-emerald/10" : "text-signal-rose bg-signal-rose/10",
            )}
          >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {up ? "+" : ""}
            {delta}%
          </div>
        </div>
        <Sparkline values={spark?.length ? spark : [0]} tone={up ? "emerald" : "rose"} />
      </div>
    </button>
  );
}

function Placeholder({ title, reason }: { title: string; reason: string }) {
  return (
    <GlassCard variant="strong" className="p-6 opacity-80">
      <div className="ui-label mb-2">{title}</div>
      <div className="text-sm text-cream-muted italic">Coming soon — {reason}</div>
    </GlassCard>
  );
}

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [range, setRange] = useState<RangeKey>("30d");

  const { data, isLoading, isFetching, error, dataUpdatedAt } = useQuery({
    queryKey: ["owner-dashboard", range],
    queryFn: () => api.get<OwnerPayload>(`/api/dashboard/owner?range=${range}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const maxLoc = useMemo(
    () => Math.max(...(data?.revenueByLocation?.map((l) => l.amount) ?? [1]), 1),
    [data],
  );
  const maxOut = useMemo(
    () => Math.max(...(data?.outstandingByCustomer?.map((c) => c.outstanding) ?? [1]), 1),
    [data],
  );
  const maxPipe = useMemo(
    () => Math.max(...(data?.alterationPipeline?.map((p) => p.count) ?? [1]), 1),
    [data],
  );
  const maxAgent = useMemo(
    () => Math.max(...(data?.agentWorkload?.map((a) => a.count) ?? [1]), 1),
    [data],
  );

  if (me && me.role !== "super_admin") {
    return (
      <div className="p-8">
        <SectionHeader eyebrow="Owner" title="Restricted" description="Super admin only." />
      </div>
    );
  }

  const k = data?.kpis;

  return (
    <div className="space-y-6 animate-fade-up pb-10">
      {/* Top bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <img src="/ls-logo-seal.png" alt="L&S" className="h-10 w-10 rounded-full border border-brass/30" />
          <div>
            <div className="display-heading text-2xl text-cream leading-tight">
              Owner <span className="text-brass-shimmer italic font-display">Dashboard</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-cream-muted mt-0.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-signal-emerald/30 bg-signal-emerald/10 text-signal-emerald">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-emerald animate-pulse" />
                Live ERPNext
              </span>
              {dataUpdatedAt ? (
                <span>Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
              ) : null}
              {isFetching ? <span className="text-brass-light">refreshing…</span> : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-full border border-brass/20 bg-forest-raised/50 p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  "px-3 py-1.5 text-[11px] uppercase tracking-widest rounded-full transition-colors",
                  range === r.key
                    ? "bg-brass/25 text-brass-light"
                    : "text-cream-muted hover:text-cream",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="h-9 w-9 rounded-full border border-brass/25 flex items-center justify-center text-cream-muted hover:text-brass-light hover:border-brass/50 transition-colors"
            title="Export PDF (coming soon)"
            onClick={() => window.print()}
          >
            <Download className="h-4 w-4" />
          </button>
          <div className="h-9 w-9 rounded-full border border-brass/30 bg-brass/10 flex items-center justify-center text-xs text-brass-light font-semibold">
            {(me?.name || me?.email || "C").slice(0, 1).toUpperCase()}
          </div>
        </div>
      </div>

      {error ? (
        <div className="glass-panel border border-signal-rose/40 text-signal-rose text-sm p-4 rounded-xl">
          Failed to load owner dashboard. {(error as Error).message}
        </div>
      ) : null}

      {/* Alert strip */}
      {data?.alerts?.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {data.alerts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => a.href && navigate(a.href)}
              className={cn(
                "shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-full border text-xs",
                a.tone === "critical"
                  ? "border-signal-rose/40 bg-signal-rose/10 text-signal-rose"
                  : "border-signal-amber/40 bg-signal-amber/10 text-signal-amber",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="uppercase tracking-wider opacity-80">{a.label}</span>
              <span className="font-semibold">{a.value}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <KpiTile
          label="Revenue"
          value={k?.revenue.value ?? 0}
          delta={k?.revenue.deltaPct ?? 0}
          spark={k?.revenue.sparkline ?? []}
          href={k?.revenue.href}
        />
        <KpiTile
          label="Outstanding A/R"
          value={k?.arOutstanding.value ?? 0}
          delta={k?.arOutstanding.deltaPct ?? 0}
          spark={k?.arOutstanding.sparkline ?? []}
          href={k?.arOutstanding.href}
        />
        <KpiTile
          label="Open Tickets"
          value={k?.openTickets.value ?? 0}
          delta={k?.openTickets.deltaPct ?? 0}
          spark={k?.openTickets.sparkline ?? []}
          href={k?.openTickets.href}
          format="int"
        />
        <KpiTile
          label="Avg Ticket"
          value={k?.avgTicket.value ?? 0}
          delta={k?.avgTicket.deltaPct ?? 0}
          spark={k?.avgTicket.sparkline ?? []}
          href={k?.avgTicket.href}
        />
        <KpiTile
          label="Collection Rate"
          value={k?.collectionRate.value ?? 0}
          delta={k?.collectionRate.deltaPct ?? 0}
          spark={k?.collectionRate.sparkline ?? []}
          href={k?.collectionRate.href}
          format="pct"
        />
      </div>

      {isLoading && !data ? (
        <div className="text-center text-cream-muted py-16 text-sm">Loading owner metrics…</div>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Revenue trend */}
            <GlassCard variant="strong" className="p-6 xl:col-span-2">
              <div className="ui-label mb-4">Revenue Trend · Billed vs Collected</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.revenueTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="billedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#B08D57" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#B08D57" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(176,141,87,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#8A8474" }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#8A8474" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                    width={40}
                  />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="billed" name="Billed" stroke="#B08D57" fill="url(#billedGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="collected" name="Collected" stroke="#34d399" fill="url(#collGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </GlassCard>

            {/* A/R Aging */}
            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-4">A/R Aging</div>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={140} height={140}>
                  <PieChart>
                    <Pie
                      data={data.arAging.filter((b) => b.amount > 0)}
                      dataKey="amount"
                      nameKey="bucket"
                      innerRadius={42}
                      outerRadius={62}
                      paddingAngle={2}
                    >
                      {data.arAging.map((b) => (
                        <Cell key={b.bucket} fill={AGING_COLORS[b.bucket] ?? "#B08D57"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatUSD(v)}
                      contentStyle={{
                        background: "rgba(15,26,16,.95)",
                        border: "1px solid rgba(176,141,87,.3)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {data.arAging.map((b) => (
                    <div key={b.bucket} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: AGING_COLORS[b.bucket] }} />
                        <span className="text-cream-muted">{b.bucket}d</span>
                        <span className="text-cream-dim">· {b.count}</span>
                      </div>
                      <span className="tabular-nums text-cream">{formatUSD(b.amount, { compact: true })}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Revenue by location */}
            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-4">Revenue by Location</div>
              <div className="space-y-3">
                {data.revenueByLocation.map((l) => {
                  const pct = Math.round((l.amount / maxLoc) * 100);
                  return (
                    <div key={l.location}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-cream">{l.location}</span>
                        <span className="text-brass-light tabular-nums">{formatUSD(l.amount, { compact: true })}</span>
                      </div>
                      <div className="h-2 rounded-full bg-forest-highlight/50 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brass/40 to-brass"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* Payment mix */}
            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-1">Payment Method Mix</div>
              {!data.placeholders.paymentMethodMix?.available ? (
                <div className="text-sm text-cream-muted italic mt-3">
                  {data.placeholders.paymentMethodMix?.reason ?? "Partial data"}
                </div>
              ) : (
                <div className="space-y-3 mt-3">
                  {data.paymentMethodMix.map((m) => {
                    const total = data.paymentMethodMix.reduce((s, x) => s + x.amount, 0) || 1;
                    const pct = Math.round((m.amount / total) * 100);
                    return (
                      <div key={m.method}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-cream">{m.method || "Other"}</span>
                          <span className="text-cream-muted">{pct}% · {formatUSD(m.amount, { compact: true })}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-forest-highlight/50 overflow-hidden">
                          <div className="h-full rounded-full bg-brass/70" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-cream-dim pt-1">Alts Square tags only · SI Payment Entry later</p>
                </div>
              )}
            </GlassCard>

            {/* Ticket priority */}
            <GlassCard variant="strong" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="ui-label">Ticket Priority</div>
                <button type="button" onClick={() => navigate("/admin/helpdesk")} className="text-xs text-brass-light">
                  Helpdesk →
                </button>
              </div>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={data.ticketPriority.filter((p) => p.count > 0)}
                      dataKey="count"
                      nameKey="priority"
                      innerRadius={36}
                      outerRadius={54}
                    >
                      {data.ticketPriority.map((p) => (
                        <Cell key={p.priority} fill={PRI_COLORS[p.priority] ?? "#B08D57"} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 flex-1">
                  {data.ticketPriority.map((p) => (
                    <div key={p.priority} className="flex justify-between text-xs">
                      <span className="flex items-center gap-2 text-cream-muted">
                        <span className="h-2 w-2 rounded-full" style={{ background: PRI_COLORS[p.priority] }} />
                        {p.priority}
                      </span>
                      <span className="tabular-nums text-cream font-semibold">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Top customers */}
            <GlassCard variant="strong" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="ui-label flex items-center gap-2">
                  <Crown className="h-3.5 w-3.5 text-brass-light" />
                  Top Customers · 90d billed
                </div>
              </div>
              <div className="space-y-2">
                {data.topCustomers.slice(0, 10).map((c, i) => {
                  const max = data.topCustomers[0]?.billed || 1;
                  const pct = Math.round((c.billed / max) * 100);
                  return (
                    <button
                      key={c.customer + c.name}
                      type="button"
                      onClick={() => navigate(`/admin/customers`)}
                      className="w-full text-left group flex items-center gap-3 py-1.5 hover:bg-brass/5 rounded-lg px-1"
                    >
                      <span className="text-[10px] w-4 text-right text-cream-dim">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-2 mb-1">
                          <span className="text-xs text-cream truncate">{c.name}</span>
                          <span className="text-xs text-brass-light tabular-nums shrink-0">
                            {formatUSD(c.billed, { compact: true })}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-brass/10 overflow-hidden">
                          <div className="h-full rounded-full bg-brass/70" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>

            {/* Outstanding by customer */}
            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-4">Outstanding by Customer</div>
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {data.outstandingByCustomer.map((c) => {
                  const pct = Math.round((c.outstanding / maxOut) * 100);
                  const ageColor =
                    c.oldestDays > 90
                      ? "text-signal-rose"
                      : c.oldestDays > 30
                        ? "text-signal-amber"
                        : "text-cream-dim";
                  const ageBadge =
                    c.oldestDays > 90
                      ? `${c.oldestDays}d ⚠`
                      : c.oldestDays > 30
                        ? `${c.oldestDays}d ·`
                        : null;
                  return (
                    <button
                      key={c.customer + c.name}
                      type="button"
                      onClick={() => navigate("/admin/invoices")}
                      className="w-full text-left py-1.5 px-1 rounded-lg hover:bg-brass/5"
                    >
                      <div className="flex justify-between text-xs mb-1 gap-2">
                        <span className="text-cream truncate">{c.name}</span>
                        <span className="text-signal-amber tabular-nums shrink-0">
                          {formatUSD(c.outstanding, { compact: true })}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-forest-highlight/50 overflow-hidden">
                        <div className="h-full rounded-full bg-signal-amber/70" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[10px] text-cream-dim mt-0.5 flex items-center gap-1">
                        <span>{c.invoices} inv · oldest {c.oldest}</span>
                        {ageBadge && (
                          <span className={cn("font-semibold", ageColor)}>{ageBadge}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Alteration pipeline */}
            <GlassCard variant="strong" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="ui-label">Alteration Pipeline</div>
                <button type="button" onClick={() => navigate("/admin/orders/alterations")} className="text-xs text-brass-light">
                  View →
                </button>
              </div>
              <div className="space-y-3">
                {data.alterationPipeline.map((p) => {
                  const pct = Math.round((p.count / maxPipe) * 100);
                  return (
                    <div key={p.stage}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-cream">{p.stage}</span>
                        <span className="font-semibold" style={{ color: PIPE_COLORS[p.stage] }}>
                          {p.count}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-forest-highlight/50 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: PIPE_COLORS[p.stage] ?? "#B08D57" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* Agent workload */}
            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-4">Agent Workload</div>
              {data.agentWorkload.length === 0 ? (
                <div className="text-sm text-cream-muted">No open tickets.</div>
              ) : (
                <div className="space-y-2">
                  {data.agentWorkload.slice(0, 8).map((a) => {
                    const pct = Math.round((a.count / maxAgent) * 100);
                    const un = a.agent === "Unassigned";
                    return (
                      <div key={a.agent}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className={cn(un ? "text-signal-rose font-semibold" : "text-cream")}>{a.agent}</span>
                          <span className="tabular-nums">{a.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-forest-highlight/50 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", un ? "bg-signal-rose/80" : "bg-brass/70")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            {/* Delivery status */}
            <GlassCard variant="strong" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="ui-label flex items-center gap-2">
                  <Truck className="h-3.5 w-3.5 text-brass-light" />
                  Delivery Status
                </div>
                <button type="button" onClick={() => navigate("/deliveries")} className="text-xs text-brass-light">
                  View →
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Queued", v: data.deliveryStatus.queued, c: "text-cream" },
                  { label: "Out", v: data.deliveryStatus.outForDelivery, c: "text-signal-amber" },
                  { label: "Delivered", v: data.deliveryStatus.delivered, c: "text-signal-emerald" },
                ].map((x) => (
                  <div key={x.label} className="glass-panel p-3 rounded-xl text-center">
                    <div className={cn("kpi-number text-2xl", x.c)}>{x.v}</div>
                    <div className="text-[10px] uppercase tracking-wider text-cream-dim mt-1">{x.label}</div>
                  </div>
                ))}
              </div>
              {data.deliveryStatus.failed > 0 ? (
                <div className="mt-3 text-xs text-signal-rose flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {data.deliveryStatus.failed} failed delivery
                  {data.deliveryStatus.failed === 1 ? "" : "ies"}
                </div>
              ) : null}
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Live feed */}
            <GlassCard variant="strong" className="p-6 xl:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="ui-label flex items-center gap-2">
                  <Radio className="h-3.5 w-3.5 text-brass-light" />
                  Live Feed · Invoices
                  <span className="inline-flex items-center gap-1 text-[10px] text-signal-emerald normal-case tracking-normal">
                    <Activity className="h-3 w-3" /> 60s
                  </span>
                </div>
                <button type="button" onClick={() => navigate("/admin/invoices")} className="text-xs text-brass-light">
                  All invoices →
                </button>
              </div>
              <div className="divide-y divide-brass/10">
                {data.liveFeed.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    onClick={() => navigate(`/admin/invoices/${row.name}`)}
                    className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-brass/5 px-1 rounded-lg"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        row.tone === "paid" && "bg-signal-emerald",
                        row.tone === "open" && "bg-signal-amber",
                        row.tone === "overdue" && "bg-signal-rose",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <span className="text-sm text-cream truncate">{row.customer}</span>
                        <span className="text-sm tabular-nums text-cream shrink-0">{formatUSD(row.amount)}</span>
                      </div>
                      <div className="text-[11px] text-cream-dim flex gap-2">
                        <span>{row.name}</span>
                        <span>·</span>
                        <span>{row.postingDate}</span>
                        <span>·</span>
                        <span>{row.status}</span>
                        <span>·</span>
                        <span>{row.location}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </GlassCard>

            <div className="space-y-4">
              <Placeholder
                title="Today's Appointments"
                reason={data.placeholders.appointments?.reason ?? "pending"}
              />
              <Placeholder
                title="Lead Conversion"
                reason={data.placeholders.leadConversion?.reason ?? "pending"}
              />
              <Placeholder
                title="Retention & LTV"
                reason={data.placeholders.retentionLtv?.reason ?? "pending"}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
