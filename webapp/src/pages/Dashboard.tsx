import { useNavigate } from "react-router-dom";
import { Wallet, Scissors, Truck, ShoppingBag, CheckCircle2, Sparkles, AlertTriangle, Hammer, Coffee, Square, MessageSquare, Clock, Zap, TrendingUp, TrendingDown, Receipt } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useMe } from "@/lib/session";
import { useDashboardKpis, useMaestroApprovalCount, useDailyEspresso, useFinancials } from "@/lib/queries";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { KpiCard } from "@/components/glass/KpiCard";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { formatUSD, statusToLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

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
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return isoStr;
  }
}

function formatDateLabel(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
  } catch {
    return isoStr;
  }
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
  const todayLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const brief = espresso?.brief ?? null;
  const weather = espresso?.weather ?? null;
  const apptToday: any[] = espresso?.appointments?.today ?? [];
  const apptTomorrow: any[] = espresso?.appointments?.tomorrow ?? [];
  const approvals = espresso?.approvals ?? { total: 0, urgent: [] };
  const tasks: any[] = espresso?.tasks ?? [];
  const revenue = espresso?.revenue ?? { today: 0, sevenDay: 0, ar: 0, draftInvoices: 0 };
  const news: any[] = espresso?.news ?? [];

  return (
    <GlassCard variant="strong" className="p-6 space-y-5">
      {/* Header */}
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

      {/* Brief */}
      <div>
        <div className="ui-label mb-2">Maestro Brief</div>
        {brief?.body ? (
          <div className="max-h-40 overflow-y-auto text-sm text-cream-muted italic leading-relaxed pr-1">
            {brief.body}
          </div>
        ) : (
          <div className="text-sm text-cream-muted italic leading-relaxed">
            Espresso is brewing — first brief posts at 8:30 AM.
          </div>
        )}
      </div>

      <div className="border-t border-brass/10" />

      {/* Calendar + Approvals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Calendar */}
        <div>
          <div className="ui-label mb-2">Today's Calendar</div>
          {apptToday.length === 0 ? (
            <div className="text-sm text-cream-muted">Floor is clear today.</div>
          ) : (
            <div className="space-y-1">
              {apptToday.map((a: any, i: number) => (
                <div key={i} className="text-sm text-cream leading-snug">
                  <span className="text-brass-light">{formatApptTime(a.start_time)}</span>
                  <span className="text-cream-muted"> — </span>
                  <span>{a.event_type ?? "Appointment"}</span>
                </div>
              ))}
            </div>
          )}
          {apptTomorrow.length > 0 && (
            <div className="mt-3">
              <div className="ui-label mb-1 text-[9px]">Tomorrow</div>
              <div className="space-y-1">
                {apptTomorrow.map((a: any, i: number) => (
                  <div key={i} className="text-sm text-cream-muted leading-snug">
                    <span className="text-brass-light/70">{formatApptTime(a.start_time)}</span>
                    <span> — </span>
                    <span>{a.event_type ?? "Appointment"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Approvals */}
        <div>
          <div className="ui-label mb-2">Approvals</div>
          <div className={`kpi-number text-4xl mb-2 ${approvals.total > 0 ? "text-signal-amber" : "text-cream"}`}>
            {approvals.total}
          </div>
          {approvals.urgent.length > 0 && (
            <div className="space-y-1 mb-2">
              {approvals.urgent.slice(0, 3).map((a: any) => (
                <div key={a.id} className="text-xs text-cream-muted leading-snug truncate">
                  · {a.title}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => navigate("/mission-control?tab=approvals")}
            className="text-xs text-brass-light hover:text-brass transition-colors"
          >
            Review →
          </button>
        </div>
      </div>

      <div className="border-t border-brass/10" />

      {/* Tasks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="ui-label">Open Tasks</div>
          {tasks.length > 0 && (
            <button
              onClick={() => navigate("/mission-control")}
              className="text-xs text-brass-light hover:text-brass transition-colors"
            >
              View all →
            </button>
          )}
        </div>
        {tasks.length === 0 ? (
          <div className="text-sm text-cream-muted">No open tasks.</div>
        ) : (
          <div className="space-y-1.5">
            {tasks.slice(0, 6).map((t: any) => (
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
        )}
      </div>

      <div className="border-t border-brass/10" />

      {/* Revenue strip */}
      <div>
        <div className="ui-label mb-2">Revenue</div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="text-sm">
            <span className="text-cream-muted">Today </span>
            <span className="text-cream font-medium">{formatUSD(revenue.today)}</span>
          </div>
          <div className="text-cream-muted/40 text-xs">|</div>
          <div className="text-sm">
            <span className="text-cream-muted">7-Day </span>
            <span className="text-cream font-medium">{formatUSD(revenue.sevenDay)}</span>
          </div>
          <div className="text-cream-muted/40 text-xs">|</div>
          <div className="text-sm">
            <span className="text-cream-muted">AR </span>
            <span className="text-cream font-medium">{formatUSD(revenue.ar)}</span>
          </div>
          {revenue.draftInvoices > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-signal-amber/15 text-signal-amber border border-signal-amber/20">
              {revenue.draftInvoices} draft invoice{revenue.draftInvoices !== 1 ? "s" : ""} pending
            </span>
          )}
        </div>
      </div>

      {/* News */}
      {news.length > 0 ? (
        <>
          <div className="border-t border-brass/10" />
          <div>
            <div className="ui-label mb-2">📰 Business</div>
            <div className="space-y-1.5">
              {news.slice(0, 4).map((item: any, i: number) => (
                <a
                  key={i}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-cream-muted hover:text-cream transition-colors leading-snug"
                >
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

const STAGE_ACCENT: Record<string, "default" | "emerald" | "amber" | "rose"> = {
  quote: "default",
  deposit_paid: "amber",
  in_production: "amber",
  ready: "emerald",
  delivered: "emerald",
  cancelled: "rose",
};

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

  if (me?.role === "driver") {
    return (
      <div className="space-y-8 animate-fade-up">
        <SectionHeader
          eyebrow={`${greeting()}, ${firstName}`}
          title="Your deliveries"
          description="Today's route and delivery status."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            label="Deliveries Today"
            value={isLoading ? "—" : (kpis?.myDeliveriesToday ?? 0)}
            icon={<Truck className="h-4 w-4" />}
            accent="amber"
          />
          <KpiCard
            label="Completed"
            value={isLoading ? "—" : (kpis?.myDeliveriesCompletedToday ?? 0)}
            icon={<CheckCircle2 className="h-4 w-4" />}
            accent="emerald"
          />
          <KpiCard
            label="Remaining"
            value={isLoading ? "—" : Math.max(0, (kpis?.myDeliveriesToday ?? 0) - (kpis?.myDeliveriesCompletedToday ?? 0))}
            icon={<Truck className="h-4 w-4" />}
          />
        </div>
        <div className="flex">
          <Button className="btn-brass" onClick={() => navigate("/deliveries")}>
            Open Route
          </Button>
        </div>
      </div>
    );
  }

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
          <KpiCard
            label="Today's Intake"
            value={isLoading ? "—" : (kpis?.todayIntakeCount ?? 0)}
            icon={<ShoppingBag className="h-4 w-4" />}
          />
          <KpiCard
            label="Deposits Pending"
            value={isLoading ? "—" : formatUSD(kpis?.depositsPending ?? 0, { compact: true })}
            icon={<Wallet className="h-4 w-4" />}
            accent="amber"
          />
          <KpiCard
            label="Alterations Open"
            value={isLoading ? "—" : (kpis?.openAlterations ?? 0)}
            icon={<Scissors className="h-4 w-4" />}
          />
          <KpiCard
            label="In Production"
            value={isLoading ? "—" : (kpis?.customInProduction ?? 0)}
            icon={<Hammer className="h-4 w-4" />}
            accent="amber"
          />
        </div>

        <GlassCard variant="strong" className="p-6">
          <div className="ui-label mb-4">My pipeline by stage</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {PIPELINE_STAGES.map((stage) => (
              <div
                key={stage}
                className="flex flex-col items-center gap-1 p-3 rounded-lg border border-brass/15 bg-brass/5"
              >
                <div className="kpi-number text-2xl">{myStages[stage] ?? 0}</div>
                <div className="ui-label text-[9px]">{statusToLabel(stage)}</div>
              </div>
            ))}
          </div>
        </GlassCard>

        <div className="flex gap-3">
          <Button className="btn-brass" onClick={() => navigate("/intake/custom")}>
            New Custom Order
          </Button>
          <Button variant="outline" className="border-brass/30 text-cream hover:bg-brass/10" onClick={() => navigate("/intake/alterations")}>
            New Alteration
          </Button>
        </div>
      </div>
    );
  }

  const { data: fin } = useFinancials();

  // super_admin / store_manager
  const stages = kpis?.ordersByStage ?? {};
  const altOverdue = kpis?.altOverdue ?? 0;
  const altRush = kpis?.altRush ?? 0;
  const altReady = kpis?.altReady ?? 0;
  const garmentsProd = kpis?.garmentsProd ?? 0;
  const unansweredSms = kpis?.unansweredSms ?? 0;

  const altStatusData = [
    { name: "Received", value: kpis?.altByStatus?.received ?? 0, color: "#60a5fa" },
    { name: "In Progress", value: kpis?.altByStatus?.inProgress ?? 0, color: "#f59e0b" },
    { name: "Ready", value: kpis?.altByStatus?.ready ?? 0, color: "#34d399" },
  ];

  const pipelineData = PIPELINE_STAGES.map(s => ({ stage: statusToLabel(s), count: stages[s] ?? 0 }));

  const prodStages = ["Ordered", "Pattern Draft", "Cutting", "Sewing", "Basting", "First Fitting", "Alterations", "Second Fitting", "Final QC"];
  const garmentData = prodStages.map(s => ({ stage: s.replace(" ", "\n"), count: kpis?.garmentsByStage?.[s] ?? 0 }));

  return (
    <div className="space-y-8 animate-fade-up">
      {/* 1. Header */}
      <SectionHeader
        eyebrow={`${greeting()}, ${firstName}`}
        title={<span className="text-brass-shimmer">The atelier is open.</span>}
        description="Operations overview across intake, production, and delivery."
      />

      {/* 2. Top KPI strip — 7 tiles */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        {/* Revenue MTD — with trend vs last month */}
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
                {fin.revenueChange >= 0
                  ? <TrendingUp className="h-3 w-3" />
                  : <TrendingDown className="h-3 w-3" />}
                {fin.revenueChange >= 0 ? "+" : ""}{fin?.revenueChange ?? 0}% vs last mo
              </div>
            )}
          </GlassCard>
        </div>

        <KpiCard
          label="Deposits Pending"
          value={isLoading ? "—" : formatUSD(kpis?.depositsPendingAmount ?? kpis?.depositsPending ?? 0, { compact: true })}
          icon={<Sparkles className="h-4 w-4" />}
          accent="amber"
        />
        <KpiCard
          label="AR Outstanding"
          value={isLoading ? "—" : formatUSD((fin as any)?.arOutstanding ?? 0, { compact: true })}
          icon={<Receipt className="h-4 w-4" />}
          accent={(fin as any)?.arOutstanding > 0 ? "rose" : undefined}
        />
        <KpiCard
          label="Alterations Open"
          value={isLoading ? "—" : (kpis?.openAlterations ?? 0)}
          icon={<Scissors className="h-4 w-4" />}
        />
        <KpiCard
          label="Ready for Pickup"
          value={isLoading ? "—" : altReady}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="emerald"
        />
        <KpiCard
          label="In Production"
          value={isLoading ? "—" : garmentsProd}
          icon={<Hammer className="h-4 w-4" />}
          accent="amber"
        />
        <KpiCard
          label="Deliveries Due"
          value={isLoading ? "—" : (kpis?.deliveriesDue ?? 0)}
          icon={<Truck className="h-4 w-4" />}
        />
      </div>

      {/* 3. Daily Espresso */}
      <DailyEspresso />

      {/* 4. Alterations section */}
      <GlassCard variant="strong" className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="ui-label">Alterations</div>
          <button
            onClick={() => navigate("/alterations")}
            className="text-xs text-brass-light hover:text-brass transition-colors"
          >
            View all →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
          <div>
            {/* Mini stat cards */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className={cn("rounded-xl p-4 border text-center", altOverdue > 0 ? "bg-red-900/20 border-red-500/30" : "bg-forest-raised border-brass/15")}>
                <Clock className={cn("h-3.5 w-3.5 mx-auto mb-1", altOverdue > 0 ? "text-red-400" : "text-cream-muted")} />
                <div className="kpi-number text-2xl">{altOverdue}</div>
                <div className="ui-label text-[9px] mt-1">Overdue</div>
              </div>
              <div className={cn("rounded-xl p-4 border text-center", altRush > 0 ? "bg-amber-900/20 border-amber-500/30" : "bg-forest-raised border-brass/15")}>
                <Zap className={cn("h-3.5 w-3.5 mx-auto mb-1", altRush > 0 ? "text-signal-amber" : "text-cream-muted")} />
                <div className="kpi-number text-2xl">{altRush}</div>
                <div className="ui-label text-[9px] mt-1">Rush</div>
              </div>
              <div className="rounded-xl p-4 border text-center bg-emerald-900/20 border-emerald-500/30">
                <CheckCircle2 className="h-3.5 w-3.5 mx-auto mb-1 text-emerald-400" />
                <div className="kpi-number text-2xl">{altReady}</div>
                <div className="ui-label text-[9px] mt-1">Ready</div>
              </div>
            </div>
          </div>

          {/* Donut chart */}
          <div>
            <div className="ui-label mb-2 text-[9px]">Status Breakdown</div>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={altStatusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {altStatusData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 mt-1 justify-center">
              {altStatusData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-[10px] text-cream-muted">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.color }} />
                  {d.name}: {d.value}
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* 5. Custom Orders section */}
      <GlassCard variant="strong" className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="ui-label">Custom Orders Pipeline</div>
          <button
            onClick={() => navigate("/orders/custom")}
            className="text-xs text-brass-light hover:text-brass transition-colors"
          >
            View all →
          </button>
        </div>

        {/* Horizontal bar chart */}
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={pipelineData} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 10, fill: "#9a8a70" }} />
            <YAxis type="category" dataKey="stage" width={80} tick={{ fontSize: 10, fill: "#9a8a70" }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="count" name="Orders" fill="#c9a96e" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Stage mini tiles */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mt-4">
          {PIPELINE_STAGES.map((stage) => (
            <div
              key={stage}
              className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-brass/15 bg-brass/5 hover:bg-brass/10 transition-colors cursor-pointer"
              onClick={() => navigate("/orders/custom")}
            >
              <div className="kpi-number text-2xl">{stages[stage] ?? 0}</div>
              <div className="ui-label text-[9px] text-center leading-tight">{statusToLabel(stage)}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* 6. Production Floor section */}
      <GlassCard variant="strong" className="p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="ui-label">Production Floor</div>
        </div>
        <div className="flex items-baseline gap-2 mb-4">
          <div className="kpi-number text-4xl">{isLoading ? "—" : garmentsProd}</div>
          <div className="text-sm text-cream-muted">garments in production</div>
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={garmentData}>
            <XAxis dataKey="stage" tick={{ fontSize: 9, fill: "#9a8a70" }} />
            <YAxis tick={{ fontSize: 9, fill: "#9a8a70" }} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="count" name="Garments" fill="#c9a96e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* 7. Communications section */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <MessageSquare className="h-5 w-5 text-brass-light" />
              {unansweredSms > 0 ? (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              ) : null}
            </div>
            <div>
              <div className="ui-label mb-0.5">Communications</div>
              <div className="flex items-baseline gap-1.5">
                <span className={cn("kpi-number text-3xl", unansweredSms > 0 ? "text-red-400" : "text-cream")}>
                  {isLoading ? "—" : unansweredSms}
                </span>
                <span className="text-sm text-cream-muted">unanswered thread{unansweredSms !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate("/comms")}
            className="text-xs text-brass-light hover:text-brass transition-colors"
          >
            Open inbox →
          </button>
        </div>
      </GlassCard>

      {/* 8. Logistics & Intake */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Logistics */}
        <GlassCard className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="ui-label mb-1">Logistics</div>
              <div className="kpi-number text-4xl">{isLoading ? "—" : (kpis?.deliveriesDue ?? 0)}</div>
              <div className="text-sm text-cream-muted mt-1">deliveries scheduled</div>
            </div>
            <Truck className="h-5 w-5 text-brass-light/60 mt-1" />
          </div>
          <div className="mt-4">
            <button
              onClick={() => navigate("/deliveries")}
              className="text-xs text-brass-light hover:text-brass transition-colors"
            >
              Open dispatch board →
            </button>
          </div>
        </GlassCard>

        {/* Today's intake */}
        <GlassCard className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="ui-label mb-1">Today's Intake</div>
              <div className="kpi-number text-4xl">{isLoading ? "—" : (kpis?.todayIntakeCount ?? 0)}</div>
              <div className="text-sm text-cream-muted mt-1">orders created today</div>
            </div>
            <ShoppingBag className="h-5 w-5 text-brass-light/60 mt-1" />
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => navigate("/intake/custom")}
              className="text-xs text-brass-light hover:text-brass transition-colors"
            >
              New custom →
            </button>
            <button
              onClick={() => navigate("/intake/alterations")}
              className="text-xs text-cream-muted hover:text-cream transition-colors"
            >
              New alteration →
            </button>
          </div>
        </GlassCard>
      </div>

      {/* 9. Location Watchlist */}
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
