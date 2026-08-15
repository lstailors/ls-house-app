import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { localFirstQc } from "@alts/offline/localFirst";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import StatusBadge from "@alts/components/StatusBadge";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import { AltsSearchField } from "@alts/components/AltsSearchField";
import { ListSkeleton } from "@alts/components/skeletons";
import { withShowTest } from "@alts/lib/showTestData";
import "@alts/styles/alts-pos.css";

type Tab = "waiting" | "open" | "passed" | "failed";

type QcRow = {
  id: string;
  name?: string | null;
  inspectionId?: string | null;
  orderName?: string | null;
  salesOrder?: string | null;
  customOrder?: string | null;
  customerName?: string | null;
  garmentSummary?: string | null;
  orderStatus?: string | null;
  qcResult?: string | null;
  result?: string | null;
  dateReceived?: string | null;
  scanUrl?: string;
};

const TABS: Array<[Tab, string]> = [
  ["waiting", "Waiting"],
  ["open", "Open"],
  ["passed", "Passed"],
  ["failed", "Failed"],
];

function day(iso?: string | null) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (d.getTime() > today.getTime()) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function QcGlass() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("waiting");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["alts-qc", tab],
    queryFn: () =>
      localFirstQc(() => api.get<QcRow[]>(withShowTest(`/api/qc?tab=${tab}`))),
    refetchInterval: 45_000,
  });
  const rates = useQuery({
    queryKey: ["alts-qc-rates"],
    enabled: tab === "waiting",
    queryFn: () => api.get<{ passedThisWeek: number }>("/api/qc/rates"),
    staleTime: 60_000,
  });

  const rows = list.data ?? [];
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.customerName, r.customOrder, r.salesOrder, r.garmentSummary, r.id, r.inspectionId, r.orderStatus]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, needle]);

  const live = syncLabel(list.dataUpdatedAt, list.isFetching);

  const openRow = (row: QcRow) => {
    const target = row.inspectionId || row.orderName || row.customOrder || row.name || row.id;
    if (!target) return;
    nav(`/qc/${encodeURIComponent(target)}`);
  };

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[28px] leading-none">Quality Control</div>
          <div className="caps mt-1">Store QC · waiting · pass · fail</div>
        </div>
        <div className="flex-1" />
        <Link
          to="/settings"
          className="h-11 px-3 rounded-full border border-brass/30 text-[11px] font-bold uppercase tracking-widest inline-flex items-center"
        >
          Settings
        </Link>
        <div className={cn("sf-live", list.isFetching && "is-sync", list.isError && "is-down")}>
          <span className="dot" />
          {list.isError ? "ERPNext down" : live}
        </div>
      </header>

      <div className="px-4 sm:px-5 pt-3 flex flex-wrap gap-2">
        {TABS.map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border min-h-[44px]",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            {tab === k ? <span className="og-count">{shown.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="px-4 sm:px-5 pt-3">
        <AltsSearchField value={q} onChange={setQ} scope="QC" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-2 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {list.isError && (
          <QueryErrorPanel
            title="Could not load orders"
            message={list.error instanceof Error ? list.error.message : "Retry — an empty rack is not the same as an outage."}
            onRetry={() => list.refetch()}
          />
        )}

        {shown.map((row) => (
          <button
            key={row.inspectionId || row.id}
            type="button"
            onClick={() => openRow(row)}
            className="og-row sf-card card-glass px-4 py-3.5 w-full text-left flex items-center gap-3"
          >
            <span className="sf-avatar" aria-hidden>
              {clientInitials(row.customerName || "QC")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge
                  status={row.qcResult || row.result || "Pending"}
                  tone={
                    tab === "waiting"
                      ? "qc"
                      : tab === "open"
                        ? "shop"
                        : tab === "passed"
                          ? "pickup"
                          : "tasks"
                  }
                />
                {day(row.dateReceived) ? (
                  <span className="font-mono text-xs text-brass-light">{day(row.dateReceived)}</span>
                ) : null}
              </div>
              <div className="display text-[22px] leading-none mt-1 truncate">
                {row.customerName || "Client"}
              </div>
              <div className="text-xs text-cream-dim mt-1 truncate">
                {[row.inspectionId || row.id, row.salesOrder, row.garmentSummary]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="text-cream-dim">→</div>
          </button>
        ))}

        {list.isLoading && <ListSkeleton rows={6} />}
        {!list.isLoading && !shown.length && !list.isError && (
          <div className="sf-empty">
            {tab === "waiting"
              ? `All caught up — ${rates.data?.passedThisWeek ?? 0} passed this week`
              : "No inspections in this list."}
          </div>
        )}
      </div>
    </div>
  );
}
