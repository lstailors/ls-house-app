import { useNavigate } from "react-router-dom";
import { Wallet, Scissors, Truck, ShoppingBag, CheckCircle2, Sparkles, AlertTriangle, Hammer } from "lucide-react";
import { useMe } from "@/lib/session";
import { useDashboardKpis, useMaestroApprovalCount, useMaestroBrief } from "@/lib/queries";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { KpiCard } from "@/components/glass/KpiCard";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { formatUSD, statusToLabel } from "@/lib/format";

function MaestroBriefCard() {
  const navigate = useNavigate();
  const { data: count = 0 } = useMaestroApprovalCount();
  const { data: brief } = useMaestroBrief();
  return (
    <GlassCard hover className="p-5 cursor-pointer" onClick={() => navigate("/mission-control")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="ui-label mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-brass-light" /> Maestro Brief
          </div>
          <div className="text-sm text-cream-muted line-clamp-2 leading-relaxed">
            {brief?.brief ? String(brief.brief).slice(0, 140) + (brief.brief.length > 140 ? "…" : "") : "No brief yet — Maestro will post daily."}
          </div>
        </div>
        {count > 0 ? (
          <div className="shrink-0 flex flex-col items-center">
            <div className="kpi-number text-signal-amber">{count}</div>
            <div className="ui-label text-[9px] text-signal-amber/80">pending</div>
          </div>
        ) : null}
      </div>
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

  // super_admin / store_manager
  const stages = kpis?.ordersByStage ?? {};
  return (
    <div className="space-y-8 animate-fade-up">
      <SectionHeader
        eyebrow={`${greeting()}, ${firstName}`}
        title={<span className="text-brass-shimmer">The atelier is open.</span>}
        description="Operations overview across intake, production, and delivery."
      />

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Revenue (MTD)"
          value={isLoading ? "—" : formatUSD(kpis?.revenue ?? 0, { compact: true })}
          icon={<Wallet className="h-4 w-4" />}
          accent="emerald"
        />
        <KpiCard
          label="Deposits Pending"
          value={isLoading ? "—" : formatUSD(kpis?.depositsPending ?? 0, { compact: true })}
          icon={<Sparkles className="h-4 w-4" />}
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

      {(me?.role === "super_admin" || me?.role === "store_manager") ? (
        <MaestroBriefCard />
      ) : null}

      {/* Custom Orders Pipeline */}
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
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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

      {/* Secondary row */}
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

      {/* Super admin watchlist */}
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
