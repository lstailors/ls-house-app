import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import "@alts/styles/alts-pos.css";

type Tab = "waiting" | "open" | "passed" | "failed";

type QcRow = {
  id: string;
  mtmproOrder?: string | null;
  salesOrder?: string | null;
  customerName?: string | null;
  garmentSummary?: string | null;
  orderStatus?: string | null;
  result?: string | null;
  inspectionId?: string | null;
  factory?: string | null;
  needBy?: string | null;
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
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function QcGlass() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("waiting");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["alts-qc", tab],
    queryFn: () => api.get<QcRow[]>(`/api/qc?tab=${tab}`),
    refetchInterval: 45_000,
  });

  const start = useMutation({
    mutationFn: (row: QcRow) =>
      api.post<{ id: string; name?: string }>("/api/qc", {
        mtmproOrder: row.mtmproOrder || undefined,
        salesOrder: row.salesOrder || undefined,
      }),
    onSuccess: (data) => {
      const id = data.id || data.name;
      if (!id) {
        toast.error("QC opened, but ERPNext did not return a name");
        return;
      }
      nav(`/qc/${encodeURIComponent(id)}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not start QC"),
  });

  const rows = list.data ?? [];
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.customerName, r.mtmproOrder, r.salesOrder, r.garmentSummary, r.id, r.inspectionId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, needle]);

  const live = syncLabel(list.dataUpdatedAt, list.isFetching);

  const openRow = (row: QcRow) => {
    const existing = row.inspectionId || (tab !== "waiting" ? row.id : null);
    if (existing) {
      nav(`/qc/${encodeURIComponent(existing)}`);
      return;
    }
    start.mutate(row);
  };

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[28px] leading-none">Quality Control</div>
          <div className="caps mt-1">MTM only · after the garment is in store</div>
        </div>
        <div className="flex-1" />
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
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            {tab === k && <span className="og-count">{shown.length}</span>}
          </button>
        ))}
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
            title="Could not load QC"
            message={list.error instanceof Error ? list.error.message : "Retry — an empty rack is not the same as an outage."}
            onRetry={() => list.refetch()}
          />
        )}

        {shown.map((row) => (
          <button
            key={`${row.id}-${row.mtmproOrder || ""}`}
            type="button"
            disabled={start.isPending}
            onClick={() => openRow(row)}
            className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3"
          >
            <span className="sf-avatar" aria-hidden>
              {clientInitials(row.customerName || "QC")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="chip">{row.orderStatus || row.result || "Quality Control"}</span>
                {row.needBy && <span className="font-mono text-xs text-brass-light">{day(row.needBy)}</span>}
              </div>
              <div className="display text-[22px] leading-none mt-1 truncate">
                {row.customerName || "Client"}
              </div>
              <div className="text-xs text-cream-dim mt-1 truncate">
                {[row.mtmproOrder, row.salesOrder, row.garmentSummary, row.factory]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="text-cream-dim">→</div>
          </button>
        ))}

        {!list.isLoading && !shown.length && !list.isError && (
          <div className="sf-empty">
            {tab === "waiting" ? "Nothing waiting for QC." : "No inspections in this list."}
          </div>
        )}
      </div>
    </div>
  );
}
