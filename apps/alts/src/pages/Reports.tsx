import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@ls/design";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { TailorTallyStrip } from "@alts/components/TailorTallyStrip";
import StatusBadge from "@alts/components/StatusBadge";
import { STATUS_TONES, toneFor, type StatusTone } from "@alts/lib/statusTone";
import { useActiveLocation } from "@alts/lib/locationContext";
import { useAltsMetrics } from "@alts/lib/useAltsMetrics";
import { useMe } from "@ls/auth";
import { useKioskMode } from "@alts/lib/kiosk";
import NotFound from "@alts/pages/NotFound";
import "@alts/styles/alts-pos.css";

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
  aging?: { overdue: number; dueToday: number; dueWeek: number; later: number };
  overdueTickets?: Array<{ name: string; customer: string; due: string; stage: string }>;
  throughput?: Array<{ date: string; count: number }>;
};

type View = "snapshot" | "nyc" | "hou" | "throughput" | "aging" | "qc";

type QcRow = { id: string; qcResult?: string | null; result?: string | null };

const TAB_VIEWS: Array<{ slug: string; view: View; label: string }> = [
  { slug: "snapshot", view: "snapshot", label: "Snapshot" },
  { slug: "nyc", view: "nyc", label: "NYC" },
  { slug: "houston", view: "hou", label: "Houston" },
  { slug: "throughput", view: "throughput", label: "Throughput" },
  { slug: "aging", view: "aging", label: "Aging" },
  { slug: "qc-rates", view: "qc", label: "QC rates" },
];

const SLUG_TO_VIEW: Record<string, View> = {
  snapshot: "snapshot",
  nyc: "nyc",
  houston: "hou",
  hou: "hou",
  throughput: "throughput",
  aging: "aging",
  "qc-rates": "qc",
  qc: "qc",
};

function viewFromSlug(slug?: string): View | null {
  if (!slug) return "snapshot";
  return SLUG_TO_VIEW[slug] ?? null;
}

function reportsHref(slug: string, kiosk: boolean) {
  const path = slug === "snapshot" ? "/reports" : `/reports/${slug}`;
  return kiosk ? `${path}?kiosk=1` : path;
}

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function locCode(raw: string) {
  const u = String(raw).toUpperCase();
  if (u === "HOU" || u === "HOUSTON" || u === "TX") return "HOU";
  if (u === "NYC" || u === "NY" || u === "NEW YORK") return "NYC";
  return u || "";
}

function stageTone(stage: string): StatusTone {
  if (/ready|picked/i.test(stage)) return "pickup";
  if (/progress/i.test(stage)) return "shop";
  if (/received/i.test(stage)) return "shop";
  return toneFor(stage);
}

function priorityTone(p: string): StatusTone {
  if (/urgent/i.test(p)) return "tasks";
  if (/high/i.test(p)) return "qc";
  if (/medium/i.test(p)) return "shop";
  return "neutral";
}

function SnapshotBody({
  data,
  isLoading,
  loc,
  openHd,
  deliveriesQueued,
  openAlts,
}: {
  data?: FloorReports;
  isLoading: boolean;
  loc: string;
  openHd?: number;
  deliveriesQueued?: number;
  openAlts?: number;
}) {
  const maxPipe = Math.max(...(data?.pipeline?.map((p) => p.count) ?? [1]), 1);
  const maxTailor = Math.max(...(data?.tailorWorkload?.map((t) => t.count) ?? [1]), 1);

  return (
    <>
      <SectionHeader
        eyebrow="Floor · Reports"
        title={
          <>
            Location <span className="text-brass-shimmer">snapshot</span>
          </>
        }
        description={`${data?.location || loc || "ALL"} · refreshes every 60s · landscape tablet`}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: "Open alts", v: openAlts ?? data?.snapshot.openAlts ?? "—" },
          { label: "Alts today", v: data?.snapshot.altsToday ?? "—" },
          { label: "Rev today", v: data ? money(data.snapshot.revenueToday) : "—" },
          { label: "Rev 7d", v: data ? money(data.snapshot.revenueWeek) : "—" },
          { label: "Open HD", v: openHd ?? data?.snapshot.openHd ?? "—" },
          { label: "Deliveries", v: deliveriesQueued ?? data?.snapshot.deliveriesQueued ?? "—" },
        ].map((c) => (
          <div key={c.label} className="glass-panel rounded-xl p-4 border border-brass/15">
            <div className="ui-label mb-1">{c.label}</div>
            <div className="kpi-number text-2xl text-cream">{isLoading ? "…" : c.v}</div>
          </div>
        ))}
      </div>

      <TailorTallyStrip />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Alteration Pipeline</div>
          <div className="space-y-3">
            {(data?.pipeline ?? []).map((p) => {
              const pct = Math.round((p.count / maxPipe) * 100);
              const tone = stageTone(p.stage);
              return (
                <div key={p.stage}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-cream">{p.stage}</span>
                    <span className="font-semibold" style={{ color: STATUS_TONES[tone].fg }}>
                      {p.count}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-forest-highlight/50 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: STATUS_TONES[tone].bar }}
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

        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Open work by tailor</div>
          <div className="space-y-2">
            {(data?.tailorWorkload ?? []).slice(0, 10).map((t) => {
              const pct = Math.round((t.count / maxTailor) * 100);
              const un = t.tailor === "Unassigned";
              const tone: StatusTone = un ? "tasks" : "shop";
              return (
                <div key={t.tailor}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={cn(un ? "font-semibold" : "text-cream")} style={{ color: un ? STATUS_TONES.tasks.fg : undefined }}>
                      {t.tailor}
                    </span>
                    <span className="tabular-nums">{t.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-forest-highlight/50 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: STATUS_TONES[tone].bar }}
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
        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Ticket Priority</div>
          <div className="space-y-2">
            {(data?.ticketPriority ?? []).map((p) => (
              <div key={p.priority} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-cream-muted">
                  <StatusBadge status={p.priority} tone={priorityTone(p.priority)} size="sm" />
                </span>
                <span className="kpi-number text-xl">{p.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-brass/15">
          <div className="ui-label mb-4">Deliveries</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Queued", v: data?.deliveryStatus.queued ?? 0, tone: "shop" as StatusTone },
              { label: "Out", v: data?.deliveryStatus.outForDelivery ?? 0, tone: "qc" as StatusTone },
              { label: "Delivered", v: data?.deliveryStatus.delivered ?? 0, tone: "pickup" as StatusTone },
              { label: "On hold", v: data?.deliveryStatus.failed ?? 0, tone: "tasks" as StatusTone },
            ].map((x) => (
              <div key={x.label} className="rounded-xl bg-forest-highlight/30 p-3 text-center">
                <div className="kpi-number text-2xl" style={{ color: STATUS_TONES[x.tone].fg }}>
                  {x.v}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-cream-dim mt-1">{x.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-brass/15 lg:col-span-1">
          <div className="ui-label mb-4">Recent Activity</div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(data?.recentActivity ?? []).map((a) => (
              <div key={a.name} className="text-xs border-b border-brass/10 pb-2">
                <div className="flex justify-between gap-2">
                  <span className="text-cream truncate">{a.customer || a.name}</span>
                  <span className="text-brass-light shrink-0">{money(a.total)}</span>
                </div>
                <div className="text-cream-dim mt-0.5 flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{a.name}</span>
                  <StatusBadge status={a.stage} size="sm" />
                  <span>{a.date}</span>
                </div>
              </div>
            ))}
            {data && data.recentActivity.length === 0 ? (
              <div className="text-sm text-cream-muted">No recent tickets.</div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function useFloor(loc: string) {
  return useQuery({
    queryKey: ["floor-reports", loc],
    queryFn: () =>
      api.get<FloorReports>(
        `/api/dashboard/floor-reports${loc ? `?location=${encodeURIComponent(loc)}` : ""}`,
      ),
    refetchInterval: 60_000,
  });
}

export default function Reports() {
  const { data: me } = useMe();
  const { activeLocationId } = useActiveLocation();
  const rawLoc = activeLocationId || me?.locationId || "";
  const loc = locCode(rawLoc);
  const { tab } = useParams<{ tab?: string }>();
  const kiosk = useKioskMode();
  const view = viewFromSlug(tab);

  const metrics = useAltsMetrics();
  const reportLoc = view === "nyc" ? "NYC" : view === "hou" ? "HOU" : loc;
  const floor = useFloor(reportLoc);

  const qcOpen = useQuery({
    queryKey: ["floor-qc-open"],
    enabled: view === "qc",
    queryFn: () => api.get<QcRow[]>("/api/qc?tab=open"),
  });
  const qcPass = useQuery({
    queryKey: ["floor-qc-pass"],
    enabled: view === "qc",
    queryFn: () => api.get<QcRow[]>("/api/qc?tab=passed"),
  });
  const qcFail = useQuery({
    queryKey: ["floor-qc-fail"],
    enabled: view === "qc",
    queryFn: () => api.get<QcRow[]>("/api/qc?tab=failed"),
  });
  const qcWait = useQuery({
    queryKey: ["floor-qc-wait"],
    enabled: view === "qc",
    queryFn: () => api.get<QcRow[]>("/api/qc?tab=waiting"),
  });

  const data = floor.data;
  const aging = data?.aging;
  const maxThru = Math.max(...(data?.throughput?.map((d) => d.count) ?? [1]), 1);
  const passN = metrics.data?.qc.passed ?? qcPass.data?.length ?? 0;
  const failN = metrics.data?.qc.failed ?? qcFail.data?.length ?? 0;
  const openN = metrics.data?.qc.open ?? qcOpen.data?.length ?? 0;
  const waitN = metrics.data?.qc.waiting ?? qcWait.data?.length ?? 0;
  const decided = passN + failN;
  const passRate = decided ? Math.round((passN / decided) * 100) : 0;

  if (!view) return <NotFound />;

  return (
    <div className="alts-root space-y-6 animate-fade-up">
      <div className="flex flex-wrap gap-2">
        {TAB_VIEWS.map((t) => (
          <Link
            key={t.slug}
            to={reportsHref(t.slug, kiosk)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              view === t.view ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {(view === "snapshot" || view === "nyc" || view === "hou") && (
        <SnapshotBody
          data={data}
          isLoading={floor.isLoading}
          loc={reportLoc}
          openHd={metrics.data?.hd_tickets_open}
          openAlts={view === "snapshot" ? metrics.data?.open_alterations : undefined}
          deliveriesQueued={
            view === "snapshot" && metrics.data
              ? metrics.data.deliveries.queued + metrics.data.deliveries.out
              : undefined
          }
        />
      )}

      {view === "throughput" && (
        <>
          <SectionHeader
            eyebrow="Floor · Throughput"
            title={
              <>
                Tickets <span className="text-brass-shimmer">this week</span>
              </>
            }
            description={`${data?.location || reportLoc || "ALL"} · intake by day`}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Alts today", v: data?.snapshot.altsToday ?? "—" },
              { label: "Open alts", v: data?.snapshot.openAlts ?? "—" },
              { label: "Rev 7d", v: data ? money(data.snapshot.revenueWeek) : "—" },
              { label: "Deliveries out", v: data?.snapshot.deliveriesQueued ?? "—" },
            ].map((c) => (
              <div key={c.label} className="glass-panel rounded-xl p-4 border border-brass/15">
                <div className="ui-label mb-1">{c.label}</div>
                <div className="kpi-number text-2xl text-cream">{floor.isLoading ? "…" : c.v}</div>
              </div>
            ))}
          </div>
          <div className="glass-panel rounded-2xl p-5 border border-brass/15">
            <div className="ui-label mb-4">Intake by day</div>
            <div className="space-y-3">
              {(data?.throughput ?? []).map((d) => {
                const pct = Math.round((d.count / maxThru) * 100);
                return (
                  <div key={d.date}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-cream">{d.date}</span>
                      <span className="tabular-nums">{d.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-forest-highlight/50 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: STATUS_TONES.shop.bar }}
                      />
                    </div>
                  </div>
                );
              })}
              {!data?.throughput?.length && !floor.isLoading && (
                <div className="text-sm text-cream-muted">No intake this week.</div>
              )}
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-5 border border-brass/15">
            <div className="ui-label mb-4">Pipeline</div>
            <div className="flex flex-wrap gap-2">
              {(data?.pipeline ?? []).map((p) => (
                <div key={p.stage} className="rounded-xl border border-brass/20 px-4 py-3 min-w-[120px]">
                  <StatusBadge status={p.stage} tone={stageTone(p.stage)} />
                  <div className="kpi-number text-3xl mt-2">{p.count}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {view === "aging" && (
        <>
          <SectionHeader
            eyebrow="Floor · Aging"
            title={
              <>
                Open tickets <span className="text-brass-shimmer">by due date</span>
              </>
            }
            description={`${data?.location || reportLoc || "ALL"} · overdue first`}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Overdue", v: aging?.overdue ?? 0, tone: "tasks" as StatusTone },
              { label: "Due today", v: aging?.dueToday ?? 0, tone: "qc" as StatusTone },
              { label: "This week", v: aging?.dueWeek ?? 0, tone: "shop" as StatusTone },
              { label: "Later", v: aging?.later ?? 0, tone: "neutral" as StatusTone },
            ].map((c) => (
              <div key={c.label} className="glass-panel rounded-xl p-4 border border-brass/15">
                <StatusBadge status={c.label} tone={c.tone} size="sm" />
                <div className="kpi-number text-3xl mt-2" style={{ color: STATUS_TONES[c.tone].fg }}>
                  {floor.isLoading ? "…" : c.v}
                </div>
              </div>
            ))}
          </div>
          <div className="glass-panel rounded-2xl p-5 border border-brass/15">
            <div className="ui-label mb-4">Overdue tickets</div>
            <div className="space-y-2">
              {(data?.overdueTickets ?? []).map((t) => (
                <Link
                  key={t.name}
                  to={`/orders/alterations/${encodeURIComponent(t.name)}`}
                  className="flex items-center gap-3 py-2 border-b border-brass/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-brass-light">{t.name}</div>
                    <div className="display text-xl leading-none mt-0.5 truncate">{t.customer || "Client"}</div>
                  </div>
                  <StatusBadge status={t.stage} size="sm" />
                  <span className="text-sm tabular-nums text-cream-dim shrink-0">{t.due}</span>
                </Link>
              ))}
              {!data?.overdueTickets?.length && !floor.isLoading && (
                <div className="text-sm text-cream-muted">Nothing overdue.</div>
              )}
            </div>
          </div>
        </>
      )}

      {view === "qc" && (
        <>
          <SectionHeader
            eyebrow="Floor · QC"
            title={
              <>
                Pass <span className="text-brass-shimmer">rates</span>
              </>
            }
            description="Store QC on MTM makes · house COUNTs"
          />
          {qcPass.isError || qcFail.isError ? (
            <div className="glass-panel rounded-2xl p-5 border border-brass/15 text-sm text-cream-dim">
              QC rates are available to tailors. Open QC from the home tiles if this is your station.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Waiting", v: waitN, tone: "qc" as StatusTone },
                  { label: "Open", v: openN, tone: "shop" as StatusTone },
                  { label: "Passed", v: passN, tone: "pickup" as StatusTone },
                  { label: "Failed", v: failN, tone: "tasks" as StatusTone },
                ].map((c) => (
                  <div key={c.label} className="glass-panel rounded-xl p-4 border border-brass/15">
                    <StatusBadge status={c.label} tone={c.tone} size="sm" />
                    <div className="kpi-number text-3xl mt-2">{c.v}</div>
                  </div>
                ))}
              </div>
              <div className="glass-panel rounded-2xl p-5 border border-brass/15">
                <div className="ui-label mb-2">Pass rate</div>
                <div className="kpi-number text-5xl" style={{ color: STATUS_TONES.pickup.fg }}>
                  {decided ? `${passRate}%` : "—"}
                </div>
                <p className="text-sm text-cream-dim mt-2">
                  {decided ? `${passN} passed · ${failN} failed` : "No finished inspections yet."}
                </p>
                <div className="h-3 rounded-full bg-forest-highlight/50 overflow-hidden mt-4 flex">
                  <div
                    className="h-full"
                    style={{ width: `${passRate}%`, background: STATUS_TONES.pickup.bar }}
                  />
                  <div
                    className="h-full"
                    style={{ width: `${decided ? 100 - passRate : 0}%`, background: STATUS_TONES.tasks.bar }}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
