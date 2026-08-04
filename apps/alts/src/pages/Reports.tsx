import { useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@ls/design";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { TailorTallyStrip } from "@alts/components/TailorTallyStrip";
import { useActiveLocation } from "@alts/lib/locationContext";
import { useMe } from "@ls/auth";

type FloorReports = {
  location: string;
  today: string;
  snapshot: {
    openAlts: number;
    altsToday: number;
    revenueToday: number;
    revenueWeek: number;
    openHd: number;
    deliveriesQueued: number;
  };
  pipeline: Array<{ stage: string; count: number }>;
  tailorWorkload: Array<{ tailor: string; count: number }>;
  ticketPriority: Array<{ priority: string; count: number }>;
  deliveryStatus: {
    queued: number;
    outForDelivery: number;
    delivered: number;
    failed: number;
  };
  recentActivity: Array<{
    name: string;
    customer: string;
    stage: string;
    total: number;
    date: string;
    payment: string;
  }>;
};

const PIPE_COLORS: Record<string, string> = {
  Received: "#60a5fa",
  "In Progress": "#f59e0b",
  Ready: "#34d399",
  "Picked Up": "#8A8474",
};

const PRI_COLORS: Record<string, string> = {
  Urgent: "#f43f5e",
  High: "#f59e0b",
  Medium: "#B08D57",
  Low: "#8A8474",
};

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function Reports() {
  const { data: me } = useMe();
  const { activeLocationId } = useActiveLocation();
  const rawLoc = activeLocationId || me?.locationId || "";
  const loc =
    String(rawLoc).toUpperCase() === "HOU" ||
    String(rawLoc).toUpperCase() === "HOUSTON" ||
    String(rawLoc).toUpperCase() === "TX"
      ? "HOU"
      : String(rawLoc).toUpperCase() === "NYC" ||
          String(rawLoc).toUpperCase() === "NY" ||
          String(rawLoc).toUpperCase() === "NEW YORK"
        ? "NYC"
        : String(rawLoc).toUpperCase() || "";

  const { data, isLoading } = useQuery({
    queryKey: ["floor-reports", loc],
    queryFn: () =>
      api.get<FloorReports>(
        `/api/dashboard/floor-reports${loc ? `?location=${encodeURIComponent(loc)}` : ""}`,
      ),
    refetchInterval: 60_000,
  });

  const maxPipe = Math.max(...(data?.pipeline?.map((p) => p.count) ?? [1]), 1);
  const maxTailor = Math.max(...(data?.tailorWorkload?.map((t) => t.count) ?? [1]), 1);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Floor · Reports"
        title={
          <>
            Location <span className="text-brass-shimmer">snapshot</span>
          </>
        }
        description={`${data?.location || loc || "ALL"} · refreshes every 60s · landscape tablet`}
      />

      {/* Today's snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: "Open alts", v: data?.snapshot.openAlts ?? "—" },
          { label: "Alts today", v: data?.snapshot.altsToday ?? "—" },
          { label: "Rev today", v: data ? money(data.snapshot.revenueToday) : "—" },
          { label: "Rev 7d", v: data ? money(data.snapshot.revenueWeek) : "—" },
          { label: "Open HD", v: data?.snapshot.openHd ?? "—" },
          { label: "Deliveries", v: data?.snapshot.deliveriesQueued ?? "—" },
        ].map((c) => (
          <div key={c.label} className="glass-panel rounded-xl p-4 border border-brass/15">
            <div className="ui-label mb-1">{c.label}</div>
            <div className="kpi-number text-2xl text-cream">{isLoading ? "…" : c.v}</div>
          </div>
        ))}
      </div>

      {/* Tailor tally reuse */}
      <TailorTallyStrip />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline */}
        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Alteration Pipeline</div>
          <div className="space-y-3">
            {(data?.pipeline ?? []).map((p) => {
              const pct = Math.round((p.count / maxPipe) * 100);
              return (
                <div key={p.stage}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-cream">{p.stage}</span>
                    <span className="font-semibold" style={{ color: PIPE_COLORS[p.stage] }}>
                      {p.count}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-forest-highlight/50 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: PIPE_COLORS[p.stage] ?? "#B08D57" }}
                    />
                  </div>
                </div>
              );
            })}
            {!data && !isLoading ? (
              <div className="text-sm text-cream-muted">No pipeline data.</div>
            ) : null}
          </div>
        </div>

        {/* Tailor workload open tickets */}
        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Open work by tailor</div>
          <div className="space-y-2">
            {(data?.tailorWorkload ?? []).slice(0, 10).map((t) => {
              const pct = Math.round((t.count / maxTailor) * 100);
              const un = t.tailor === "Unassigned";
              return (
                <div key={t.tailor}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={cn(un ? "text-signal-rose font-semibold" : "text-cream")}>
                      {t.tailor}
                    </span>
                    <span className="tabular-nums">{t.count}</span>
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
            {data && data.tailorWorkload.length === 0 ? (
              <div className="text-sm text-cream-muted">No open assigned work.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ticket priority */}
        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Ticket Priority</div>
          <div className="space-y-2">
            {(data?.ticketPriority ?? []).map((p) => (
              <div key={p.priority} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-cream-muted">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: PRI_COLORS[p.priority] ?? "#B08D57" }}
                  />
                  {p.priority}
                </span>
                <span className="kpi-number text-xl">{p.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery */}
        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Deliveries</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Queued", v: data?.deliveryStatus.queued ?? 0 },
              { label: "Out", v: data?.deliveryStatus.outForDelivery ?? 0 },
              { label: "Delivered", v: data?.deliveryStatus.delivered ?? 0 },
              { label: "Failed", v: data?.deliveryStatus.failed ?? 0, danger: true },
            ].map((x) => (
              <div key={x.label} className="rounded-xl bg-forest-highlight/30 p-3 text-center">
                <div
                  className={cn(
                    "kpi-number text-2xl",
                    x.danger && Number(x.v) > 0 ? "text-signal-rose" : "text-cream",
                  )}
                >
                  {x.v}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-cream-dim mt-1">{x.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="glass-panel rounded-2xl p-5 border border-brass/15 lg:col-span-1">
          <div className="ui-label mb-4">Recent Activity</div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(data?.recentActivity ?? []).map((a) => (
              <div key={a.name} className="text-xs border-b border-brass/10 pb-2">
                <div className="flex justify-between gap-2">
                  <span className="text-cream truncate">{a.customer || a.name}</span>
                  <span className="text-brass-light shrink-0">{money(a.total)}</span>
                </div>
                <div className="text-cream-dim mt-0.5">
                  {a.name} · {a.stage} · {a.date}
                </div>
              </div>
            ))}
            {data && data.recentActivity.length === 0 ? (
              <div className="text-sm text-cream-muted">No recent tickets.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
