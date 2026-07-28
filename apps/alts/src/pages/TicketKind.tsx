import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type Kind = "walk_in" | "on_order" | "redo";

type SoHit = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  amount?: number;
  customerId?: string;
  customerName?: string;
};

function money(n?: number) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function TicketKind() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>("walk_in");
  const [q, setQ] = useState("");
  const [selectedSo, setSelectedSo] = useState<SoHit | null>(null);

  const search = useQuery({
    queryKey: ["so-search-kind", q],
    enabled: kind === "on_order" && q.trim().length >= 2,
    queryFn: async () => {
      // Prefer FOH intake search when live; fall back to universal search.
      try {
        const rows = await api.get<any[]>(
          `/api/intake-alterations/sales-orders/search?q=${encodeURIComponent(q.trim())}`,
        );
        if (Array.isArray(rows) && rows.length) {
          return rows.map(
            (r): SoHit => ({
              id: r.name || r.id,
              title: r.customer_name || r.customerName || r.name,
              subtitle: [r.make_type || r.makeType, r.item_summary || r.status].filter(Boolean).join(" · "),
              meta: r.status || r.delivery_status,
              amount: Number(r.grand_total ?? r.grandTotal ?? 0) || undefined,
              customerId: r.customer || r.customer_id,
              customerName: r.customer_name || r.customerName,
            }),
          );
        }
      } catch {
        /* fall through */
      }

      const res = await api.get<{ results?: any[] } | any[]>(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const results = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data?.results ?? [];
      return (results as any[])
        .filter((r) => r.type === "sales_order" || String(r.id || r.title || "").includes("SO-"))
        .map(
          (r): SoHit => ({
            id: r.id || r.title,
            title: r.subtitle || r.title,
            subtitle: r.title,
            meta: r.meta,
            amount: r.amount,
            customerName: r.subtitle,
          }),
        );
    },
  });

  const recent = useQuery({
    queryKey: ["so-recent-fitting"],
    enabled: kind === "on_order",
    queryFn: async () => {
      try {
        const rows = await api.get<any[]>(`/api/intake-alterations/sales-orders/search?q=&limit=8`);
        if (Array.isArray(rows)) {
          return rows.map(
            (r): SoHit => ({
              id: r.name || r.id,
              title: r.customer_name || r.name,
              subtitle: [r.make_type, r.status].filter(Boolean).join(" · "),
              meta: r.status,
              amount: Number(r.grand_total) || undefined,
              customerId: r.customer,
              customerName: r.customer_name,
            }),
          );
        }
      } catch {
        /* optional */
      }
      return [] as SoHit[];
    },
  });

  const hits = useMemo(() => {
    if (q.trim().length >= 2) return search.data ?? [];
    return recent.data ?? [];
  }, [q, search.data, recent.data]);

  const continueWalkIn = () => nav("/intake/alterations?kind=walk_in");
  const continueRedo = () => nav("/intake/alterations?kind=redo");
  const continueOnOrder = () => {
    if (!selectedSo) return;
    const p = new URLSearchParams({
      kind: "on_order",
      so: selectedSo.id,
    });
    if (selectedSo.customerId) p.set("customer", selectedSo.customerId);
    if (selectedSo.customerName) p.set("customerName", selectedSo.customerName);
    nav(`/intake/alterations?${p.toString()}`);
  };

  return (
    <div className="alts-root flex flex-col min-h-screen">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-brass/20 bg-black/20">
        <Link
          to="/"
          className="w-11 h-11 rounded-xl border border-brass/25 bg-black/20 grid place-items-center text-cream-dim hover:text-cream"
        >
          ←
        </Link>
        <h1 className="display text-[23px]">New ticket</h1>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase text-cream-dim">
          <span className="flex items-center gap-2 text-cream">
            <span className="w-[26px] h-[26px] rounded-full bg-brass text-forest-deep grid place-items-center font-bold">1</span>
            Kind
          </span>
          <span className="w-6 h-px bg-brass/30" />
          <span className="opacity-50">Garments</span>
          <span className="w-6 h-px bg-brass/30" />
          <span className="opacity-50">Work</span>
          <span className="w-6 h-px bg-brass/30" />
          <span className="opacity-50">Review</span>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-[400px_1fr] min-h-0">
        {/* left — kind choice */}
        <aside className="border-r border-brass/15 p-5 flex flex-col overflow-y-auto">
          <h2 className="display text-[27px] leading-tight">What kind of ticket?</h2>
          <p className="text-[11.5px] text-[var(--cd)] mt-2 mb-5 leading-relaxed">
            This decides whether anyone gets charged. Pick before you touch a garment.
          </p>

          <button
            type="button"
            onClick={() => {
              setKind("walk_in");
              setSelectedSo(null);
            }}
            className={cn(
              "w-full text-left rounded-[18px] p-[18px] mb-3 border transition-all",
              kind === "walk_in"
                ? "border-brass bg-gradient-to-br from-brass/20 to-brass/5"
                : "border-brass/25 bg-black/20 hover:border-brass/45",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-brass-light text-xl">◎</span>
              <span className="display text-[22px] flex-1">Walk-in alteration</span>
              <span className="text-brass/70">→</span>
            </div>
            <p className="text-[11px] text-[var(--cd)] mt-2 leading-relaxed">
              Client brings in their own garments. Normal pricing, client pays.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip">Billable</span>
              <span className="chip">Invoice created</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setKind("on_order")}
            className={cn(
              "w-full text-left rounded-[18px] p-[18px] mb-3 border transition-all",
              kind === "on_order"
                ? "border-[rgba(155,139,196,0.55)] bg-gradient-to-br from-[rgba(155,139,196,0.2)] to-[rgba(155,139,196,0.04)]"
                : "border-brass/25 bg-black/20 hover:border-[rgba(155,139,196,0.45)]",
            )}
          >
            <div className="flex items-center gap-3">
              <span className={cn("text-xl", kind === "on_order" ? "text-[var(--vi,#9B8BC4)]" : "text-brass-light")}>★</span>
              <span className="display text-[22px] flex-1">Custom order work</span>
              <span className={cn(kind === "on_order" ? "text-[var(--vi,#9B8BC4)]" : "text-brass/70")}>→</span>
            </div>
            <p className="text-[11px] text-[var(--cd)] mt-2 leading-relaxed">
              Adjustments to something we made. Fitting changes on an MTM or bespoke order — work lands on order cost.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                Client pays $0
              </span>
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                Goes to order cost
              </span>
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                No invoice
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setKind("redo");
              setSelectedSo(null);
            }}
            className={cn(
              "w-full text-left rounded-[18px] p-[18px] mb-3 border transition-all",
              kind === "redo"
                ? "border-signal-emerald/50 bg-gradient-to-br from-signal-emerald/15 to-transparent"
                : "border-brass/25 bg-black/20 hover:border-signal-emerald/40",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-signal-emerald text-xl">✓</span>
              <span className="display text-[22px] flex-1">Re-do</span>
              <span className="text-brass/70">→</span>
            </div>
            <p className="text-[11px] text-[var(--cd)] mt-2 leading-relaxed">
              Warranty / re-do — a fix on work we already did. Our cost to put right; client never charged twice.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">Client pays $0</span>
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">Warranty · Re-do</span>
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">No invoice</span>
            </div>
          </button>

          <div className="mt-auto pt-4">
            <div className="rounded-xl border border-brass/20 bg-brass/10 px-4 py-3 text-[10px] leading-relaxed text-cream-muted">
              <div className="caps text-brass-light mb-1">Why this is step one</div>
              Billing intent is the one thing that cannot be fixed cleanly afterwards. Choosing up front costs one tap.
            </div>
          </div>
        </aside>

        {/* right — action panel */}
        <main className="overflow-y-auto p-5 bg-black/15 min-w-0">
          {kind === "walk_in" && (
            <div className="max-w-xl mx-auto pt-8 text-center">
              <h2 className="display text-3xl mb-2">Walk-in alteration</h2>
              <p className="text-sm text-cream-dim mb-8">
                Client garments, normal pricing. Invoice will be created when the ticket is submitted.
              </p>
              <button type="button" onClick={continueWalkIn} className="btn-brass h-16 px-10 text-[12px] w-full max-w-md">
                Continue to client & garments
              </button>
            </div>
          )}

          {kind === "redo" && (
            <div className="max-w-xl mx-auto pt-8 text-center">
              <h2 className="display text-3xl mb-2">Re-do</h2>
              <p className="text-sm text-cream-dim mb-8">
                Warranty / re-do — full shop prices stay on the ticket for tailor stats & internal value.
                Tagged <b className="text-cream">Warranty</b> in ERPNext: no client invoice, no AR.
              </p>
              <button
                type="button"
                onClick={continueRedo}
                className="w-full max-w-md h-16 rounded-2xl font-bold tracking-widest uppercase text-sm bg-signal-emerald text-forest-deep"
              >
                Continue re-do ticket
              </button>
            </div>
          )}

          {kind === "on_order" && (
            <div className="max-w-3xl mx-auto">
              <h2 className="display text-[27px] leading-tight">Pull the custom order</h2>
              <p className="text-[11.5px] text-[var(--cd)] mt-2 mb-4">
                Find the order this work belongs to. The ticket links to it so cost lands in the right place.
              </p>

              <div className="relative mb-2">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brass/70 text-lg">⌕</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Client name, order number, or fabric"
                  className="w-full h-[70px] rounded-2xl bg-black/35 border border-brass/30 pl-14 pr-5 text-lg text-cream outline-none focus:border-[rgba(155,139,196,0.7)] focus:shadow-[0_0_0_3px_rgba(155,139,196,0.16)] placeholder:text-[var(--cd)]"
                  autoFocus
                />
              </div>
              <p className="text-[10.5px] text-[var(--cd)] mb-4 pl-1">
                Searches open <b className="text-brass-light font-semibold">Sales Orders</b> · try{" "}
                <b className="text-brass-light">SO-00472</b>, a last name, or fabric
              </p>

              <div className="caps mb-3">
                {q.trim().length >= 2
                  ? search.isFetching
                    ? "Searching…"
                    : `${hits.length} result${hits.length === 1 ? "" : "s"}`
                  : "Recent open orders"}
              </div>

              <div className="space-y-2.5">
                {hits.map((so) => {
                  const on = selectedSo?.id === so.id;
                  return (
                    <button
                      key={so.id}
                      type="button"
                      onClick={() => setSelectedSo(so)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all",
                        on
                          ? "border-[var(--vi,#9B8BC4)] bg-gradient-to-br from-[rgba(155,139,196,0.19)] to-[rgba(155,139,196,0.04)] ring-1 ring-[rgba(155,139,196,0.3)]"
                          : "border-brass/20 bg-black/20 hover:border-[rgba(155,139,196,0.45)]",
                      )}
                    >
                      <div className="w-9 h-11 rounded-lg border border-brass/25 grid place-items-center text-brass-light shrink-0 text-lg">
                        ♠
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[15px] truncate">
                          {so.customerName || so.title}
                          {so.subtitle ? <span className="text-cream-dim font-normal"> · {so.subtitle}</span> : null}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-[var(--cd)] items-center">
                          <span className="font-mono text-[var(--vi,#9B8BC4)]">{so.id}</span>
                          {so.meta && (
                            <span className="px-2 py-0.5 rounded-md border border-[rgba(155,139,196,0.45)] text-[var(--vi,#9B8BC4)] text-[8.5px] font-bold tracking-wider uppercase">
                              {so.meta}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="display text-xl">{money(so.amount)}</div>
                      </div>
                    </button>
                  );
                })}
                {!hits.length && !search.isFetching && q.trim().length >= 2 && (
                  <p className="text-cream-dim text-sm italic p-4">No open sales orders match.</p>
                )}
              </div>

              <button
                type="button"
                disabled={!selectedSo}
                onClick={continueOnOrder}
                className="mt-5 w-full min-h-[80px] rounded-[17px] border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5"
                style={{
                  background: "linear-gradient(135deg,#A797CE,#7D6DA8)",
                  color: "#120E1C",
                  boxShadow: "0 12px 30px rgba(155,139,196,.3), inset 0 1px 0 rgba(255,255,255,.28)",
                }}
              >
                <span className="text-[13.5px] font-bold tracking-[0.12em] uppercase">
                  {selectedSo ? `Continue with ${selectedSo.id.replace(/^.*SO-/, "SO-")}` : "Select an order"}
                </span>
                {selectedSo && (
                  <span className="text-[9px] tracking-[0.14em] uppercase opacity-75">
                    {(selectedSo.customerName || selectedSo.title || "").toUpperCase()} · NON-BILLABLE TICKET
                  </span>
                )}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
