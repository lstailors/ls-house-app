import { Users, Building2, UserCircle2, Sparkles, Scissors, Truck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { useAdminOverview } from "@/lib/queries";

export default function AdminOverview() {
  const { data, isLoading } = useAdminOverview();

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Admin · Overview"
        title={
          <>
            The <span className="text-brass-shimmer">house</span>, in numbers.
          </>
        }
        description="Total reach across every location and every garment ever made."
      />

      {isLoading || !data ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <OverviewCard
              icon={Users}
              label="Users"
              value={data.totalUsers}
              to="/admin/users"
              accent="brass"
            />
            <OverviewCard
              icon={Building2}
              label="Locations"
              value={data.totalLocations}
              to="/admin/locations"
              accent="brass"
            />
            <OverviewCard
              icon={UserCircle2}
              label="Customers"
              value={data.totalCustomers}
              accent="emerald"
            />
            <OverviewCard
              icon={Sparkles}
              label="Custom Orders"
              value={data.totalCustomOrders}
              to="/orders/custom"
              accent="brass"
            />
            <OverviewCard
              icon={Scissors}
              label="Alterations"
              value={data.totalAlterations}
              to="/orders/alterations"
              accent="emerald"
            />
            <OverviewCard
              icon={Truck}
              label="Deliveries"
              value={data.totalDeliveries}
              to="/deliveries"
              accent="amber"
            />
          </div>

          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-3">House Notes</div>
            <div className="display-heading text-cream text-2xl mb-2 leading-snug">
              "A great suit is a quiet promise — kept across years, kept across cities."
            </div>
            <div className="text-xs text-cream-dim italic">
              — L&amp;S House, est. 1976
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  to,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  to?: string;
  accent: "brass" | "emerald" | "amber";
}) {
  const accentColor =
    accent === "brass"
      ? "text-brass-light"
      : accent === "emerald"
        ? "text-signal-emerald"
        : "text-signal-amber";

  const inner = (
    <GlassCard variant="strong" hover className="p-6 group transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className={`h-10 w-10 rounded-full border border-brass/25 bg-brass/10 flex items-center justify-center ${accentColor}`}>
          <Icon className="h-4 w-4" />
        </div>
        {to ? (
          <ArrowRight className="h-4 w-4 text-cream-dim group-hover:text-brass-light group-hover:translate-x-0.5 transition-all" />
        ) : null}
      </div>
      <div className="ui-label mb-1">{label}</div>
      <div className="font-display italic text-5xl text-cream leading-none">{value}</div>
    </GlassCard>
  );

  return to ? <Link to={to}>{inner}</Link> : inner;
}
