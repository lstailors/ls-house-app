import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";

type InvoiceRow = {
  id: string;
  erpnextId?: string;
  customer?: { id: string; name: string } | null;
  customerName?: string | null;
  status: string;
  kind?: "alteration" | "custom" | "other";
  type?: string;
  grandTotal: number;
  total?: number;
  outstandingAmount: number;
  postingDate?: string | null;
  dueDate?: string | null;
  alterationTicketRef?: string | null;
  salesOrder?: string | null;
};

type Summary = {
  paid: number;
  outstanding: number;
  openCount: number;
  count: number;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusClass(st: string) {
  const s = st.toLowerCase();
  if (s === "paid") return "text-signal-green border-signal-green/30 bg-signal-green/10";
  if (s === "overdue") return "text-signal-rose border-signal-rose/30 bg-signal-rose/10";
  if (s === "partly_paid") return "text-signal-amber border-signal-amber/30 bg-signal-amber/10";
  if (s === "unpaid") return "text-brass-light border-brass/30 bg-brass/10";
  return "text-cream-dim border-brass/15 bg-black/20";
}

export default function Invoices() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"open" | "all" | "custom" | "alteration" | "paid">("open");

  const query = useQuery({
    queryKey: ["alts-invoices", tab, q],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "300");
      if (tab === "open") params.set("status", "open");
      else if (tab === "paid") params.set("status", "paid");
      else params.set("status", "all");
      if (tab === "custom") params.set("kind", "custom");
      if (tab === "alteration") params.set("kind", "alteration");
      if (q.trim().length >= 2) params.set("q", q.trim());

      const res = await api.raw(`/api/invoices?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Invoices failed (${res.status})`);
      const rows: InvoiceRow[] = Array.isArray(json?.data) ? json.data : [];
      const summary: Summary = json?.summary ?? {
        paid: 0,
        outstanding: 0,
        openCount: rows.filter((r) => r.outstandingAmount > 0.005).length,
        count: rows.length,
      };
      return { rows, summary };
    },
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    let list = query.data?.rows ?? [];
    // Client refine for short q while typing (server needs 2+)
    if (q.trim() && q.trim().length < 2) {
      const s = q.toLowerCase();
      list = list.filter(
        (i) =>
          i.id.toLowerCase().includes(s) ||
          (i.customerName ?? i.customer?.name ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [query.data, q]);

  const summary = query.data?.summary;

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: "open", label: "Open" },
    { key: "custom", label: "Custom" },
    { key: "alteration", label: "Alts" },
    { key: "paid", label: "Paid" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20 shrink-0">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-xl">Invoices</div>
          <div className="caps text-[10px] text-cream-dim">
            All SI · custom + alterations · charge & close
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => query.refetch()}
          className="text-[10px] uppercase tracking-widest text-brass-light font-bold px-3 py-2 rounded-lg border border-brass/25"
        >
          Refresh
        </button>
      </header>

      <div className="px-5 pt-4 space-y-3 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-brass/15 bg-black/25 px-3 py-3">
            <div className="ui-label text-[9px] text-cream-muted mb-1">Open AR</div>
            <div className="font-display italic text-2xl text-signal-rose leading-none">
              {money(summary?.outstanding ?? 0)}
            </div>
            <div className="text-[10px] text-cream-dim mt-1">
              {summary?.openCount ?? 0} open invoice{(summary?.openCount ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
          <div className="rounded-xl border border-brass/15 bg-black/25 px-3 py-3">
            <div className="ui-label text-[9px] text-cream-muted mb-1">Showing</div>
            <div className="font-display italic text-2xl text-brass-shimmer leading-none">
              {rows.length}
            </div>
            <div className="text-[10px] text-cream-dim mt-1">
              {tab === "open" ? "collectable" : tab === "custom" ? "custom-made" : "filtered"}
            </div>
          </div>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search invoice #, client, ticket, SO…"
          className="w-full h-12 rounded-xl bg-forest-deep border border-brass/25 px-4 text-cream text-sm placeholder:text-cream-dim/60 focus:border-brass/50 focus:outline-none"
          autoCapitalize="off"
          autoCorrect="off"
        />

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest border transition-colors",
                tab === t.key
                  ? "bg-brass/20 border-brass/50 text-brass-light"
                  : "border-brass/15 text-cream-dim hover:border-brass/30",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3 pb-8">
        {query.isError ? (
          <QueryErrorPanel
            title="Could not load invoices"
            message={(query.error as Error)?.message}
            onRetry={() => query.refetch()}
          />
        ) : query.isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-brass/5 border border-brass/10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-cream-muted text-sm">No invoices match.</p>
            <p className="text-cream-dim text-xs mt-1">
              Try All, or search by client name / SI number.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((inv) => {
              const name = inv.customerName ?? inv.customer?.name ?? "—";
              const out = Number(inv.outstandingAmount ?? 0);
              const total = Number(inv.grandTotal ?? inv.total ?? 0);
              const kind = inv.kind ?? (inv.alterationTicketRef ? "alteration" : "custom");
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => nav(`/invoices/${encodeURIComponent(inv.id)}`)}
                  className="w-full text-left rounded-xl border border-brass/15 bg-black/25 hover:border-brass/40 px-4 py-3.5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-cream">{inv.id}</span>
                        <span
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border",
                            kind === "alteration"
                              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                              : "border-brass/30 text-brass-light bg-brass/10",
                          )}
                        >
                          {kind === "alteration" ? "Alts" : "Custom"}
                        </span>
                        <span
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border",
                            statusClass(inv.status),
                          )}
                        >
                          {inv.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="text-cream text-sm mt-1 truncate">{name}</div>
                      <div className="text-[10px] text-cream-dim mt-0.5">
                        {inv.postingDate
                          ? new Date(inv.postingDate + "T12:00:00").toLocaleDateString()
                          : "—"}
                        {inv.alterationTicketRef ? ` · ${inv.alterationTicketRef}` : ""}
                        {inv.salesOrder && !inv.alterationTicketRef ? ` · ${inv.salesOrder}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {out > 0.005 ? (
                        <>
                          <div className="font-display italic text-lg text-signal-rose leading-none">
                            {money(out)}
                          </div>
                          <div className="text-[10px] text-cream-dim mt-1">due</div>
                        </>
                      ) : (
                        <>
                          <div className="font-display italic text-lg text-signal-green leading-none">
                            {money(total)}
                          </div>
                          <div className="text-[10px] text-cream-dim mt-1">paid</div>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
