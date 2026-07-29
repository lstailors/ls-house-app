import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  Wallet, Scissors, Truck, ShoppingBag, CheckCircle2, Sparkles,
  AlertTriangle, Hammer, Coffee, Square, MessageSquare, Clock,
  Zap, TrendingUp, TrendingDown, Receipt, BarChart2, QrCode, ArrowLeftRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useMe } from "@ls/auth";
import { useDashboardKpis, useDailyEspresso, useFinancials, useOpenYZTickets } from "@/lib/queries";
import { SectionHeader } from "@ls/design";
import { KpiCard } from "@ls/design";
import { GlassCard } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { formatUSD, statusToLabel } from "@ls/design/format";
import { cn } from "@ls/design/utils";
import { RevenueTrend } from "@/components/dashboard/RevenueTrend";
import { SalesLeaderboard } from "@/components/dashboard/SalesLeaderboard";
import { TopCustomers } from "@/components/dashboard/TopCustomers";
import { TopGarments } from "@/components/dashboard/TopGarments";
import { AlterationsPipeline } from "@/components/dashboard/AlterationsPipeline";
import { OpenYZTickets } from "@/components/dashboard/OpenYZTickets";
import { TransferModal } from "@/components/alterations/TransferModal";

function weatherEmoji(code: number): string {
  if (code <= 1) return "☀️";
  if (code === 2) return "🌤";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫";
  if (code >= 51 && code <= 67) return "🌧";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦";
  if (code >= 95 && code <= 99) return "⛈";
  return "☀️";
}

function formatApptTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  } catch { return isoStr; }
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-400 bg-red-400/10",
  high: "text-signal-amber bg-signal-amber/10",
  medium: "text-brass-light bg-brass/10",
  low: "text-cream-muted bg-cream-muted/10",
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-forest-raised border border-brass/30 rounded-lg px-3 py-2 text-xs text-cream shadow-lg">
      {label && <p className="text-cream-dim mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

function DailyEspresso() {
  const navigate = useNavigate();
  const { data: espresso } = useDailyEspresso();

  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const brief = espresso?.brief ?? null;
  const weather = espresso?.weather ?? null;
  const apptToday: any[] = espresso?.appointments?.today ?? [];
  const approvals = espresso?.approvals ?? { total: 0, urgent: [] };
  const tasks: any[] = espresso?.tasks ?? [];
  const revenue = espresso?.revenue ?? { today: 0, sevenDay: 0, ar: 0, draftInvoices: 0 };
  const news: any[] = espresso?.news ?? [];

  return (
    <GlassCard variant="strong" className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Coffee className="h-5 w-5 text-brass-light" />
          <div>
            <div className="display-heading text-lg font-semibold text-cream leading-tight">Daily Espresso</div>
            <div className="text-xs text-cream-muted">{todayLabel}</div>
          </div>
        </div>
        {weather ? (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-brass/20 bg-brass/5 text-sm text-cream">
            <span>{weatherEmoji(weather.weathercode)}</span>
            <span className="font-medium">{weather.temp}°F</span>
            <span className="text-cream-muted text-xs">{weather.description}</span>
          </div>
        ) : null}
      </div>

      <div className="border-t border-brass/10" />

      {brief?.body ? (
        <div className="max-h-32 overflow-y-auto text-sm text-cream-muted italic leading-relaxed pr-1">
          {brief.body}
        </div>
      ) : (
        <div className="text-sm text-cream-muted italic">Espresso is brewing — first brief posts at 8:30 AM.</div>
      )}

      <div className="border-t border-brass/10" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Calendar */}
        <div>
          <div className="ui-label mb-2">Today</div>
          {apptToday.length === 0 ? (
            <div className="text-sm text-cream-muted">Floor is clear.</div>
          ) : (
            <div className="space-y-1">
              {apptToday.map((a: any, i: number) => (
                <div key={i} className="text-sm text-cream">
                  <span className="text-brass-light">{formatApptTime(a.start_time)}</span>
                  <span className="text-cream-muted"> — </span>
                  <span>{a.event_type ?? "Appointment"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approvals */}
        <div>
          <div className="ui-label mb-2">Approvals</div>
          <div className={`kpi-number text-4xl mb-1 ${approvals.total > 0 ? "text-signal-amber" : "text-cream"}`}>
            {approvals.total}
          </div>
          <button onClick={() => navigate("/mission-control?tab=approvals")}
            className="text-xs text-brass-light hover:text-brass transition-colors">
            Review →
          </button>
        </div>

        {/* Revenue strip */}
        <div>
          <div className="ui-label mb-2">Revenue Snapshot</div>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-cream-muted">Today</span>
              <span className="text-cream font-medium">{formatUSD(revenue.today)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-cream-muted">7-Day</span>
              <span className="text-cream font-medium">{formatUSD(revenue.sevenDay)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-cream-muted">AR</span>
              <span className="text-cream font-medium">{formatUSD(revenue.ar)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks */}
      {tasks.length > 0 ? (
        <>
          <div className="border-t border-brass/10" />
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="ui-label">Open Tasks</div>
              <button onClick={() => navigate("/mission-control")}
                className="text-xs text-brass-light hover:text-brass transition-colors">
                View all →
              </button>
            </div>
            <div className="space-y-1.5">
              {tasks.slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 text-sm text-cream">
                  <Square className="h-3.5 w-3.5 text-brass/40 shrink-0" />
                  <span className="flex-1 leading-snug truncate">{t.title}</span>
                  {t.priority && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.low}`}>
                      {t.priority}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {news.length > 0 ? (
        <>
          <div className="border-t border-brass/10" />
          <div>
            <div className="ui-label mb-2">📰 Business</div>
            <div className="space-y-1.5">
              {news.slice(0, 3).map((item: any, i: number) => (
                <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                  className="block text-xs text-cream-muted hover:text-cream transition-colors leading-snug">
                  {item.title}
                </a>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </GlassCard>
  );
}

const PIPELINE_STAGES = ["quote", "deposit_paid", "in_production", "ready", "delivered"] as const;

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: kpis, isLoading } = useDashboardKpis();

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const firstName = me?.name?.split(" ")[0] ?? "";

  // ── Driver dashboard ──────────────────────────────────────────────────────
  if (me?.role === "driver") {
    return (
      <div className="space-y-8 animate-fade-up">
        <SectionHeader
          eyebrow={`${greeting()}, ${firstName}`}
          title="Your deliveries"
          description="Today's route and delivery status."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard label="Deliveries Today" value={isLoading ? "—" : (kpis?.myDeliveriesToday ?? 0)} icon={<Truck className="h-4 w-4" />} accent="amber" />
          <KpiCard label="Completed" value={isLoading ? "—" : (kpis?.myDeliveriesCompletedToday ?? 0)} icon={<CheckCircle2 className="h-4 w-4" />} accent="emerald" />
          <KpiCard label="Remaining" value={isLoading ? "—" : Math.max(0, (kpis?.myDeliveriesToday ?? 0) - (kpis?.myDeliveriesCompletedToday ?? 0))} icon={<Truck className="h-4 w-4" />} />
        </div>
        <div className="flex">
          <Button className="btn-brass" onClick={() => navigate("/deliveries")}>Open Route</Button>
        </div>
      </div>
    );
  }

  // ── Salesperson dashboard ─────────────────────────────────────────────────
  if (me?.role === "salesperson") {
    const myStages = kpis?.myCustomOrdersByStage ?? {};
    return (
      <div className="space-y-8 animate-fade-up">
        <SectionHeader
          eyebrow={`${greeting()}, ${firstName}`}
          title={<span className="text-brass-shimmer">The atelier is open.</span>}
          description="Your intake, pipeline, and today's numbers."
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Today's Intake" value={isLoading ? "—" : (kpis?.todayIntakeCount ?? 0)} icon={<ShoppingBag className="h-4 w-4" />} />
          <KpiCard label="Deposits Pending" value={isLoading ? "—" : formatUSD(kpis?.depositsPending ?? 0, { compact: true })} icon={<Wallet className="h-4 w-4" />} accent="amber" />
          <KpiCard label="Alterations Open" value={isLoading ? "—" : (kpis?.openAlterations ?? 0)} icon={<Scissors className="h-4 w-4" />} />
          <KpiCard label="In Production" value={isLoading ? "—" : (kpis?.customInProduction ?? 0)} icon={<Hammer className="h-4 w-4" />} accent="amber" />
        </div>
        <GlassCard variant="strong" className="p-6">
          <div className="ui-label mb-4">My pipeline by stage</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className="flex flex-col items-center gap-1 p-3 rounded-lg border border-brass/15 bg-brass/5">
                <div className="kpi-number text-2xl">{myStages[stage] ?? 0}</div>
                <div className="ui-label text-[9px]">{statusToLabel(stage)}</div>
              </div>
            ))}
          </div>
        </GlassCard>
        <div className="flex gap-3">
          <Button className="btn-brass" onClick={() => navigate("/intake/custom")}>New Custom Order</Button>
          <Button variant="outline" className="border-brass/30 text-cream hover:bg-brass/10" onClick={() => navigate("/intake/alterations")}>New Alteration</Button>
        </div>
      </div>
    );
  }

  // ── Manager / Super Admin dashboard ──────────────────────────────────────
  const [transferOpen, setTransferOpen] = useState(false);
  const { data: fin } = useFinancials();
  const { data: yzTickets } = useOpenYZTickets();

  const stages = kpis?.ordersByStage ?? {};
  const altOverdue = kpis?.altOverdue ?? 0;
  const altRush = kpis?.altRush ?? 0;
  const altReady = kpis?.altReady ?? 0;
  const garmentsProd = kpis?.garmentsProd ?? 0;
  const unansweredSms = kpis?.unansweredSms ?? 0;

  const prodStages = ["Ordered", "Pattern Draft", "Cutting", "Sewing", "Basting", "First Fitting", "Alterations", "Second Fitting", "Final QC"];
  const garmentData = prodStages.map(s => ({ stage: s.replace(" ", "\n"), count: kpis?.garmentsByStage?.[s] ?? 0 }));

  return (
    <div className="space-y-8 animate-fade-up">
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} />

      {/* 1. Header + quick actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader
          eyebrow={`${greeting()}, ${firstName}`}
          title={<span className="text-brass-shimmer">The atelier is open.</span>}
          description="Operations overview across intake, production, and delivery."
        />
        <div className="flex items-center gap-2 flex-wrap shrink-0 pt-1">
          <button
            onClick={() => navigate("/deliveries")}
            className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-3.5 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-400/18 hover:border-cyan-400/55 transition-all"
          >
            <Truck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Deliveries</span>
            <span className="sm:hidden">Route</span>
            {!isLoading && (kpis?.deliveriesDue ?? 0) > 0 ? (
              <span className="ml-0.5 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-cyan-300/90 text-forest-deep text-[10px] font-bold grid place-items-center">
                {kpis?.deliveriesDue}
              </span>
            ) : null}
          </button>
          <button
            onClick={() => navigate("/intake/alterations")}
            className="inline-flex items-center gap-1.5 rounded-full border border-brass/30 bg-brass/8 px-3.5 py-2 text-xs font-medium text-brass-shimmer hover:bg-brass/15 hover:border-brass/50 transition-all"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Alteration</span>
            <span className="sm:hidden">Alteration</span>
          </button>
          <button
            onClick={() => navigate("/scanner")}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/50 transition-all"
          >
            <QrCode className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pickup Checkout</span>
            <span className="sm:hidden">Pickup</span>
          </button>
          <button
            onClick={() => setTransferOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/8 px-3.5 py-2 text-xs font-medium text-blue-300 hover:bg-blue-400/15 hover:border-blue-400/50 transition-all"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Transfer Warehouse</span>
            <span className="sm:hidden">Transfer</span>
          </button>
          <button
            onClick={() => navigate("/dispatch")}
            className="inline-flex items-center gap-1.5 rounded-full border border-brass/30 bg-brass/8 px-3.5 py-2 text-xs font-medium text-brass-shimmer hover:bg-brass/15 hover:border-brass/50 transition-all"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sofia Dispatch</span>
            <span className="sm:hidden">Dispatch</span>
          </button>
        </div>
      </div>

      {/* 2. KPI strip */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        <div className="lg:col-span-1">
          <GlassCard className="p-4 h-full flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1">
              <span className="ui-label text-[9px]">Revenue MTD</span>
              <Wallet className="h-3.5 w-3.5 text-signal-emerald opacity-70" />
            </div>
            <div className="font-display italic text-2xl text-signal-emerald leading-none">
              {isLoading ? "—" : formatUSD(fin?.revenueMTD ?? kpis?.revenueMTD ?? 0, { compact: true })}
            </div>
            {fin?.revenueChange !== undefined && (
              <div className={cn("flex items-center gap-1 text-[10px] mt-1.5 font-medium",
                fin.revenueChange >= 0 ? "text-signal-emerald" : "text-signal-rose")}>
                {fin.revenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {fin.revenueChange >= 0 ? "+" : ""}{fin?.revenueChange ?? 0}% vs last mo
              </div>
            )}
          </GlassCard>
        </div>
        <KpiCard label="Deposits Pending" value={isLoading ? "—" : formatUSD(kpis?.depositsPendingAmount ?? 0, { compact: true })} icon={<Sparkles className="h-4 w-4" />} accent="amber" />
        <KpiCard label="AR Outstanding" value={isLoading ? "—" : formatUSD((fin as any)?.arOutstanding ?? 0, { compact: true })} icon={<Receipt className="h-4 w-4" />} accent={(fin as any)?.arOutstanding > 0 ? "rose" : undefined} />
        <KpiCard label="Alterations Open" value={isLoading ? "—" : (kpis?.openAlterations ?? 0)} icon={<Scissors className="h-4 w-4" />} />
        <KpiCard label="Ready for Pickup" value={isLoading ? "—" : altReady} icon={<CheckCircle2 className="h-4 w-4" />} accent="emerald" />
        <KpiCard label="In Production" value={isLoading ? "—" : garmentsProd} icon={<Hammer className="h-4 w-4" />} accent="amber" />
        <KpiCard label="Deliveries Due" value={isLoading ? "—" : (kpis?.deliveriesDue ?? 0)} icon={<Truck className="h-4 w-4" />} />
      </div>

      {/* 3. Revenue analytics row */}
      {fin?.trend?.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <RevenueTrend
              trend={fin.trend}
              revenueMTD={fin.revenueMTD}
              revenueChange={fin.revenueChange}
              avgOrderValue={fin.avgOrderValue}
              salesOrderCount={fin.salesOrderCount}
            />
          </div>
          <div>
            {(fin as any).salesByRep?.length ? (
              <SalesLeaderboard data={(fin as any).salesByRep} />
            ) : (
              <GlassCard variant="strong" className="p-6 h-full flex items-center justify-center">
                <div className="text-center text-cream-dim">
                  <BarChart2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No rep data yet</p>
                </div>
              </GlassCard>
            )}
          </div>
        </div>
      ) : null}

      {/* 4. Daily Espresso */}
      <DailyEspresso />

      {/* 5. Alterations + Custom Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AlterationsPipeline
          altByStatus={kpis?.altByStatus ?? { received: 0, inProgress: 0, ready: 0 }}
          altOverdue={altOverdue}
          altRush={altRush}
        />

        {/* Custom Orders pipeline */}
        <GlassCard variant="strong" className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="ui-label">Custom Orders Pipeline</div>
            <button onClick={() => navigate("/orders/custom")}
              className="text-xs text-brass-light hover:text-brass transition-colors">
              View all →
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {PIPELINE_STAGES.map((stage) => {
              const count = stages[stage] ?? 0;
              const isActive = ["deposit_paid", "in_production"].includes(stage);
              const isDone = stage === "delivered";
              return (
                <div
                  key={stage}
                  onClick={() => navigate("/orders/custom")}
                  className={cn(
                    "flex flex-col gap-1.5 p-3.5 rounded-xl border cursor-pointer transition-colors",
                    isActive ? "bg-signal-amber/8 border-signal-amber/25 hover:bg-signal-amber/12"
                      : isDone ? "bg-signal-emerald/8 border-signal-emerald/25 hover:bg-signal-emerald/12"
                        : "bg-brass/5 border-brass/15 hover:bg-brass/10",
                  )}
                >
                  <div className={cn("kpi-number text-2xl",
                    isActive ? "text-signal-amber" : isDone ? "text-signal-emerald" : "text-cream")}>
                    {count}
                  </div>
                  <div className="ui-label text-[9px] leading-tight">{statusToLabel(stage)}</div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      {/* 5b. YongZheng helpdesk tickets */}
      <OpenYZTickets data={yzTickets ?? []} />

      {/* 6. Customer intelligence + Top Garments */}
      {((fin as any)?.topCustomers?.length || (fin as any)?.topGarments?.length) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(fin as any).topCustomers?.length ? (
            <TopCustomers data={(fin as any).topCustomers} />
          ) : null}
          {fin?.topGarments?.length ? (
            <TopGarments data={fin.topGarments} />
          ) : null}
        </div>
      ) : null}

      {/* 7. Production Floor */}
      <GlassCard variant="strong" className="p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="ui-label">Production Floor</div>
        </div>
        <div className="flex items-baseline gap-2 mb-4">
          <div className="kpi-number text-4xl">{isLoading ? "—" : garmentsProd}</div>
          <div className="text-sm text-cream-muted">garments in production</div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={garmentData}>
            <XAxis dataKey="stage" tick={{ fontSize: 9, fill: "#9a8a70" }} />
            <YAxis tick={{ fontSize: 9, fill: "#9a8a70" }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="count" name="Garments" fill="#c9a96e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* 8. Communications + Logistics + Intake row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <MessageSquare className="h-4 w-4 text-brass-light" />
                {unansweredSms > 0 ? <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" /> : null}
              </div>
              <div className="ui-label">Communications</div>
            </div>
          </div>
          <div className={cn("kpi-number text-4xl mb-1", unansweredSms > 0 ? "text-red-400" : "text-cream")}>
            {isLoading ? "—" : unansweredSms}
          </div>
          <div className="text-xs text-cream-muted mb-3">unanswered thread{unansweredSms !== 1 ? "s" : ""}</div>
          <button onClick={() => navigate("/comms")}
            className="text-xs text-brass-light hover:text-brass transition-colors">
            Open inbox →
          </button>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="ui-label">Logistics · today</div>
            <Truck className="h-4 w-4 text-brass-light/60" />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <div className="kpi-number text-2xl leading-none">{isLoading ? "—" : (kpis?.deliveriesDue ?? 0)}</div>
              <div className="text-[10px] text-cream-muted mt-1">pending</div>
            </div>
            <div>
              <div className="kpi-number text-2xl leading-none text-amber-300">{isLoading ? "—" : (kpis?.deliveriesOutForDelivery ?? 0)}</div>
              <div className="text-[10px] text-cream-muted mt-1">out now</div>
            </div>
            <div>
              <div className="kpi-number text-2xl leading-none text-emerald-300">{isLoading ? "—" : (kpis?.deliveriesDeliveredToday ?? 0)}</div>
              <div className="text-[10px] text-cream-muted mt-1">delivered</div>
            </div>
          </div>
          <button onClick={() => navigate("/deliveries")}
            className="text-xs text-brass-light hover:text-brass transition-colors">
            Open dispatch board →
          </button>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="ui-label">Today's Intake</div>
            <ShoppingBag className="h-4 w-4 text-brass-light/60" />
          </div>
          <div className="kpi-number text-4xl mb-1">{isLoading ? "—" : (kpis?.todayIntakeCount ?? 0)}</div>
          <div className="text-xs text-cream-muted mb-3">orders created today</div>
          <div className="flex gap-3">
            <button onClick={() => navigate("/intake/custom")}
              className="text-xs text-brass-light hover:text-brass transition-colors">
              New custom →
            </button>
            <button onClick={() => navigate("/intake/alterations")}
              className="text-xs text-cream-muted hover:text-cream transition-colors">
              New alteration →
            </button>
          </div>
        </GlassCard>
      </div>

      {/* 9. Location Watchlist (super_admin only) */}
      {me?.role === "super_admin" && (kpis?.lowActivityLocations?.length ?? 0) > 0 ? (
        <GlassCard className="p-5 border-signal-amber/25">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-signal-amber" />
            <div className="ui-label text-signal-amber">Location Watchlist</div>
          </div>
          <div className="space-y-2">
            {kpis?.lowActivityLocations?.map((loc) => (
              <div key={loc.locationId} className="flex items-center justify-between text-sm">
                <span className="text-cream">{loc.locationName}</span>
                <span className="text-cream-muted">{loc.orders7d} orders in 7 days</span>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
