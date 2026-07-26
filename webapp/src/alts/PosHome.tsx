// Landing screen for the alterations POS.
//
// A counter screen answers three questions, in this order: what do I do next,
// what's going out today, and what's late. Everything here is one tap from a
// standing start — no nested menus, 44px minimum targets.

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Scissors, ScanLine, Users, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useAlterations } from "@/lib/queries";
import { useActiveLocation, locationQueryString } from "@/lib/locationContext";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AlterationKpis {
  active: number;
  dueToday: number;
  overdue: number;
  rush: number;
  unassigned: number;
  readyForPickup: number;
}

function useAlterationKpis() {
  const { activeLocationId } = useActiveLocation();
  return useQuery({
    queryKey: ["alteration-kpis", activeLocationId],
    queryFn: () =>
      api.get<AlterationKpis>(`/api/alterations/kpis${locationQueryString(activeLocationId)}`),
    staleTime: 30_000,
  });
}

const ACTIONS = [
  { to: "/intake/alterations", label: "New Ticket", icon: Scissors, primary: true },
  { to: "/scanner", label: "Scan Tag", icon: ScanLine },
  { to: "/customers", label: "Find Customer", icon: Users },
];

const COUNTERS: Array<{ key: keyof AlterationKpis; label: string; to: string; tone?: string }> = [
  { key: "dueToday", label: "Due today", to: "/orders/alterations?filter=dueToday" },
  { key: "readyForPickup", label: "Ready for pickup", to: "/orders/alterations?filter=readyForPickup" },
  { key: "overdue", label: "Overdue", to: "/orders/alterations?filter=overdue", tone: "text-signal-rose" },
  { key: "rush", label: "Rush", to: "/orders/alterations?filter=rush", tone: "text-signal-amber" },
];

export default function PosHome() {
  const { data: kpis, isLoading: kpisLoading } = useAlterationKpis();
  const { data: alterations, isLoading: listLoading } = useAlterations();

  // Anything not yet handed back, soonest due first — the pile by the counter.
  const openTickets = (alterations ?? [])
    .filter((a) => a.status !== "picked_up" && a.status !== "cancelled")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACTIONS.map(({ to, label, icon: Icon, primary }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex min-h-[88px] items-center gap-3 rounded-lg border px-5 text-lg font-medium transition-colors",
              primary
                ? "border-brass/40 bg-brass/15 text-cream hover:bg-brass/25"
                : "border-brass/20 bg-forest-raised/50 text-cream-muted hover:bg-brass/10 hover:text-cream",
            )}
          >
            <Icon className="h-6 w-6 shrink-0" />
            {label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {COUNTERS.map(({ key, label, to, tone }) => (
          <Link key={key} to={to}>
            <GlassCard className="px-4 py-3 transition-colors hover:bg-brass/5">
              <div className="ui-label text-[9px]">{label}</div>
              <div className={cn("mt-1 text-3xl font-semibold", tone ?? "text-brass-shimmer")}>
                {kpisLoading ? "—" : (kpis?.[key] ?? 0)}
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>

      <GlassCard className="p-0">
        <div className="flex items-center justify-between border-b border-brass/15 px-4 py-3">
          <div className="ui-label text-[10px]">On the rail</div>
          <Link
            to="/orders/alterations"
            className="inline-flex items-center gap-1.5 text-sm text-brass-light hover:text-cream"
          >
            All tickets
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {listLoading ? (
          <div className="px-4 py-8 text-center text-sm text-cream-dim">Loading…</div>
        ) : openTickets.length === 0 ? (
          <EmptyState
            icon={Scissors}
            title="Nothing open"
            description="Every ticket is handed back."
          />
        ) : (
          <ul className="divide-y divide-brass/10">
            {openTickets.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/orders/alterations/${t.id}`}
                  className="flex min-h-[60px] items-center gap-3 px-4 py-3 transition-colors hover:bg-brass/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-cream">
                      {t.customer?.name ?? t.customerId}
                    </div>
                    <div className="text-xs text-cream-dim">
                      {t.items.length} {t.items.length === 1 ? "item" : "items"}
                      {t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}
                    </div>
                  </div>
                  <StatusPill status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
