import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import StatusBadge from "@alts/components/StatusBadge";
import OrderStatusChips from "@alts/components/OrderStatusChips";
import TimedSpinner from "@alts/components/TimedSpinner";
import { type MtmStatusKey } from "@alts/lib/mtmStatus";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import { useAltsMetrics } from "@alts/lib/useAltsMetrics";
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
  const [pipeline, setPipeline] = useState<MtmStatusKey | "">("");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["alts-qc", tab, pipeline],
    queryFn: () =>
      pipeline
        ? api.get<QcRow[]>(`/api/qc/orders?status=${encodeURIComponent(pipeline)}`)
        : api.get<QcRow[]>(`/api/qc?tab=${tab}`),
    refetchInterval: 45_000,
  });
  const metrics = useAltsMetrics();
  const qcCounts = {
    waiting: metrics.data?.qc.waiting ?? 0,
    open: metrics.data?.qc.open ?? 0,
    passed: metrics.data?.qc.passed ?? 0,
    failed: metrics.data?.qc.failed ?? 0,
  };

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
          <div className="caps mt-1">MTM pipeline · every live status</div>
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
            onClick={() => {
              setPipeline("");
              setTab(k);
            }}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border min-h-[44px]",
              !pipeline && tab === k
                ? "bg-brass/20 border-brass text-cream"
                : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            <span className="og-count">{qcCounts[k]}</span>
          </button>
        ))}
      </div>

      <div className="px-4 sm:px-5 pt-3">
        <div className="caps text-brass-light mb-2">Live order status</div>
        <OrderStatusChips
          variant="legend"
          current={pipeline || null}
          allowClear
          onSelect={(status) => setPipeline((status || "") as MtmStatusKey | "")}
        />
      </div>

      <div className="px-4 sm:px-5 pt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Client, MTMPro, sales order…"
          className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-[15px] text-cream outline-none focus:border-brass"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-2 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {list.isError && (
          <QueryErrorPanel
            title="Could not load orders"
            message={list.error instanceof Error ? list.error.message : "Retry — an empty rack is not the same as an outage."}
            onRetry={() => list.refetch()}
          />
        )}

        {list.isLoading && !shown.length && !list.isError && (
          <TimedSpinner label="Loading inspections…" onRetry={() => void list.refetch()} />
        )}

        {shown.map((row) => {
          return (
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
                    status={row.qcResult || row.result || "Quality Control"}
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
              <OrderStatusChips variant="badge" current={row.orderStatus} className="shrink-0" />
              <div className="text-cream-dim shrink-0">→</div>
            </button>
          );
        })}

        {!list.isLoading && !shown.length && !list.isError && (
          <div className="sf-empty">
            {pipeline
              ? `No MTM orders in ${pipeline}.`
              : tab === "waiting"
                ? "Nothing waiting for QC."
                : "No inspections in this list."}
          </div>
        )}
      </div>
    </div>
  );
}
