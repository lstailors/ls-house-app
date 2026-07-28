import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import { piecesFromSoDetail, writeSoCart, type SoPiece } from "@alts/lib/soCart";
import { REDO_DISPLAY } from "@alts/lib/billingLabels";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
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
  const [cartPieces, setCartPieces] = useState<SoPiece[]>([]);

  const search = useQuery({
    queryKey: ["so-search-kind", q],
    enabled: kind === "on_order" && q.trim().length >= 2,
    queryFn: async () => {
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

  const soDetail = useQuery({
    queryKey: ["so-detail-kind", selectedSo?.id],
    enabled: kind === "on_order" && !!selectedSo?.id,
    queryFn: async () => {
      const d = await api.get<any>(`/api/intake-alterations/sales-orders/${encodeURIComponent(selectedSo!.id)}`);
      return d;
    },
  });

  useEffect(() => {
    if (!selectedSo?.id) {
      setCartPieces([]);
      return;
    }
    if (!soDetail.data?.items) return;
    setCartPieces(piecesFromSoDetail(soDetail.data.items || []));
  }, [selectedSo?.id, soDetail.data]);

  const hits = useMemo(() => {
    if (q.trim().length >= 2) return search.data ?? [];
    return recent.data ?? [];
  }, [q, search.data, recent.data]);

  const selectedCount = cartPieces.filter((p) => p.selected).length;

  const pickSo = (so: SoHit) => {
    setSelectedSo(so);
    setCartPieces([]);
  };

  const togglePiece = (id: string) => {
    setCartPieces((prev) => prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  };

  const selectAll = (on: boolean) => {
    setCartPieces((prev) => prev.map((p) => ({ ...p, selected: on })));
  };

  const continueWalkIn = () => nav("/intake/alterations?kind=walk_in");
  const continueRedo = () => nav("/intake/alterations?kind=redo");
  const continueOnOrder = () => {
    if (!selectedSo || selectedCount === 0) return;
    const d = soDetail.data;
    writeSoCart({
      so: selectedSo.id,
      customerId: selectedSo.customerId || d?.customer,
      customerName: selectedSo.customerName || d?.customer_name || selectedSo.title,
      customerPhone: d?.customer_phone || "",
      customerEmail: d?.customer_email || "",
      pieces: cartPieces,
    });
    const p = new URLSearchParams({
      kind: "on_order",
      so: selectedSo.id,
    });
    const cid = selectedSo.customerId || d?.customer;
    const cname = selectedSo.customerName || d?.customer_name || selectedSo.title;
    if (cid) p.set("customer", cid);
    if (cname) p.set("customerName", cname);
    nav(`/intake/alterations?${p.toString()}`);
  };

  return (
    <div className="alts-root flex flex-col min-h-dvh">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-brass/20 bg-black/20">
        <Link
          to="/"
          className="w-11 h-11 rounded-xl border border-brass/25 bg-black/20 grid place-items-center text-cream-dim hover:text-cream"
        >
          ←
        </Link>
        <h1 className="display text-[23px]">New ticket</h1>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-2 text-[12px] font-semibold tracking-widest uppercase text-cream-dim">
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

      <div className="flex-1 grid lg:grid-cols-[360px_1fr] min-h-0">
        {/* left — kind choice */}
        <aside className="border-r border-brass/15 p-5 flex flex-col overflow-y-auto">
          <h2 className="display text-[27px] leading-tight">What kind of ticket?</h2>
          <p className="text-[12px] text-[var(--cd)] mt-2 mb-5 leading-relaxed">
            This decides whether anyone gets charged. Pick before you touch a garment.
          </p>

          <button
            type="button"
            onClick={() => {
              setKind("walk_in");
              setSelectedSo(null);
              setCartPieces([]);
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
            <p className="text-[12px] text-[var(--cd)] mt-2 leading-relaxed">
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
            <p className="text-[12px] text-[var(--cd)] mt-2 leading-relaxed">
              Adjustments to something we made. Pull the order — pieces land in the cart on the right.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                Valued · no SI
              </span>
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                Order cart
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setKind("redo");
              setSelectedSo(null);
              setCartPieces([]);
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
              <span className="display text-[22px] flex-1">{REDO_DISPLAY.kindTitle}</span>
              <span className="text-brass/70">→</span>
            </div>
            <p className="text-xs text-[var(--cd)] mt-2 leading-relaxed">
              {REDO_DISPLAY.kindBody}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">{REDO_DISPLAY.kindChip}</span>
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">No invoice</span>
            </div>
          </button>

          <div className="mt-auto pt-4">
            <div className="rounded-xl border border-brass/20 bg-brass/10 px-4 py-3 text-[12px] leading-relaxed text-cream-muted">
              <div className="caps text-brass-light mb-1">Why this is step one</div>
              Billing intent is the one thing that cannot be fixed cleanly afterwards. Choosing up front costs one tap.
            </div>
          </div>
        </aside>

        {/* right — action panel */}
        <main className="overflow-hidden min-w-0 flex flex-col bg-black/15">
          {kind === "walk_in" && (
            <div className="max-w-xl mx-auto pt-8 text-center p-5">
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
            <div className="max-w-xl mx-auto pt-8 text-center p-5">
              <h2 className="display text-3xl mb-2">{REDO_DISPLAY.kindTitle}</h2>
              <p className="text-sm text-cream-dim mb-8">
                {REDO_DISPLAY.kindBody} ERP tag stays non-billable — no client invoice, no AR.
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
            <div className="flex-1 grid lg:grid-cols-[1fr_340px] min-h-0">
              {/* SO search list */}
              <div className="overflow-y-auto p-5 min-w-0 border-r border-brass/10">
                <h2 className="display text-[27px] leading-tight">Pull the custom order</h2>
                <p className="text-[12px] text-[var(--cd)] mt-2 mb-4">
                  Find the order — garments load into the <b className="text-[var(--vi,#9B8BC4)]">cart on the right</b>. Toggle
                  what needs adjusting.
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
                <p className="text-[12px] text-[var(--cd)] mb-4 pl-1">
                  Open <b className="text-brass-light font-semibold">Sales Orders</b> · try{" "}
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
                        onClick={() => pickSo(so)}
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
                          <div className="flex flex-wrap gap-2 mt-1 text-[12px] text-[var(--cd)] items-center">
                            <span className="font-mono text-[var(--vi,#9B8BC4)]">{so.id}</span>
                            {so.meta && (
                              <span className="px-2 py-0.5 rounded-md border border-[rgba(155,139,196,0.45)] text-[var(--vi,#9B8BC4)] text-[12px] font-bold tracking-wider uppercase">
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
              </div>

              {/* RIGHT CART */}
              <aside className="flex flex-col min-h-0 bg-black/30 border-l border-[rgba(155,139,196,0.2)]">
                <div className="px-4 py-3.5 border-b border-brass/15">
                  <div className="caps text-[var(--vi,#9B8BC4)] mb-1">Order cart</div>
                  {selectedSo ? (
                    <>
                      <div className="font-semibold text-[14px] truncate">{selectedSo.customerName || selectedSo.title}</div>
                      <div className="font-mono text-[12px] text-[var(--vi,#9B8BC4)] mt-0.5">{selectedSo.id}</div>
                    </>
                  ) : (
                    <p className="text-[12px] text-cream-dim">Select an order — pieces appear here.</p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {soDetail.isFetching && selectedSo && (
                    <p className="text-cream-dim text-sm p-3 animate-pulse">Loading order lines…</p>
                  )}
                  {soDetail.isError && (
                    <QueryErrorPanel
                      compact
                      title="Could not load order items"
                      message="Try again or continue and add garments manually."
                      onRetry={() => soDetail.refetch()}
                    />
                  )}
                  {!selectedSo && (
                    <div className="rounded-2xl border border-dashed border-brass/25 p-6 text-center text-[12px] text-cream-dim">
                      Cart is empty
                      <div className="text-[12px] mt-2 opacity-70">Like checkout — pick the order, then the pieces to alter</div>
                    </div>
                  )}
                  {cartPieces.length > 0 && (
                    <div className="flex gap-2 mb-2">
                      <button type="button" className="text-[12px] font-bold tracking-widest uppercase text-brass-light" onClick={() => selectAll(true)}>
                        All
                      </button>
                      <button type="button" className="text-[12px] font-bold tracking-widest uppercase text-cream-dim" onClick={() => selectAll(false)}>
                        None
                      </button>
                      <span className="ml-auto text-[12px] text-cream-dim">
                        {selectedCount}/{cartPieces.length} pieces
                      </span>
                    </div>
                  )}
                  {cartPieces.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePiece(p.id)}
                      className={cn(
                        "w-full text-left rounded-xl border px-3 py-3 flex gap-3 transition-all",
                        p.selected
                          ? "border-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.14)]"
                          : "border-brass/15 bg-black/20 opacity-55",
                      )}
                    >
                      <span
                        className={cn(
                          "w-6 h-6 rounded-md border grid place-items-center text-[12px] font-bold shrink-0 mt-0.5",
                          p.selected ? "bg-[var(--vi,#9B8BC4)] text-[#120E1C] border-transparent" : "border-brass/40 text-transparent",
                        )}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-bold tracking-widest uppercase text-[var(--vi,#9B8BC4)]">
                          {p.garmentType}
                        </span>
                        <span className="block text-[13px] font-semibold leading-snug">{p.label}</span>
                        {p.description ? (
                          <span className="block text-[12px] text-cream-dim mt-1 line-clamp-2">{p.description}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                  {selectedSo && !soDetail.isFetching && cartPieces.length === 0 && !soDetail.isError && (
                    <p className="text-cream-dim text-sm p-3">No line items on this order — add garments on the next screen.</p>
                  )}
                </div>

                <div className="p-3 border-t border-brass/15">
                  <button
                    type="button"
                    disabled={!selectedSo || selectedCount === 0}
                    onClick={continueOnOrder}
                    className="w-full min-h-[72px] rounded-[17px] border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1"
                    style={{
                      background: "linear-gradient(135deg,#A797CE,#7D6DA8)",
                      color: "#120E1C",
                      boxShadow: "0 12px 30px rgba(155,139,196,.3), inset 0 1px 0 rgba(255,255,255,.28)",
                    }}
                  >
                    <span className="text-[12.5px] font-bold tracking-[0.12em] uppercase">
                      {!selectedSo
                        ? "Select an order"
                        : selectedCount === 0
                          ? "Select pieces"
                          : `Continue · ${selectedCount} piece${selectedCount === 1 ? "" : "s"}`}
                    </span>
                    {selectedSo && selectedCount > 0 && (
                      <span className="text-[12px] tracking-[0.14em] uppercase opacity-75">NON-BILLABLE · FULL PRICES KEPT</span>
                    )}
                  </button>
                </div>
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
