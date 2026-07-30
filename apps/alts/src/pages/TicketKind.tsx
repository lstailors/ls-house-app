import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import {
  mergeSoPieces,
  piecesFromSoDetail,
  writeSoCart,
  type SoPiece,
} from "@alts/lib/soCart";
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
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function mapSoRow(r: any): SoHit {
  return {
    id: r.name || r.id,
    title: r.customer_name || r.customerName || r.name,
    subtitle: [r.make_type || r.makeType, r.item_summary || r.status].filter(Boolean).join(" · "),
    meta: r.status || r.delivery_status,
    amount: Number(r.grand_total ?? r.grandTotal ?? 0) || undefined,
    customerId: r.customer || r.customer_id,
    customerName: r.customer_name || r.customerName,
  };
}

export default function TicketKind() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>("walk_in");
  const [q, setQ] = useState("");
  /** Multi-select sales orders (same customer preferred). */
  const [selectedSos, setSelectedSos] = useState<SoHit[]>([]);
  const [cartPieces, setCartPieces] = useState<SoPiece[]>([]);
  const [loadingSoIds, setLoadingSoIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ["so-search-kind", q],
    enabled: kind === "on_order" && q.trim().length >= 2,
    queryFn: async () => {
      try {
        const rows = await api.get<any[]>(
          `/api/intake-alterations/sales-orders/search?q=${encodeURIComponent(q.trim())}`,
        );
        if (Array.isArray(rows) && rows.length) return rows.map(mapSoRow);
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
        if (Array.isArray(rows)) return rows.map(mapSoRow);
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

  const selectedIds = useMemo(() => new Set(selectedSos.map((s) => s.id)), [selectedSos]);
  const primarySo = selectedSos[0] ?? null;
  const selectedCount = cartPieces.filter((p) => p.selected).length;

  /** Customer key for "all orders for this client" */
  const customerKey = (so: SoHit) =>
    (so.customerId || so.customerName || so.title || "").trim().toLowerCase();

  const loadSoPieces = async (so: SoHit): Promise<SoPiece[]> => {
    const d = await api.get<any>(`/api/intake-alterations/sales-orders/${encodeURIComponent(so.id)}`);
    return piecesFromSoDetail(d?.items || [], so.id);
  };

  const toggleSo = async (so: SoHit) => {
    setLoadError(null);
    const already = selectedIds.has(so.id);

    if (already) {
      // Deselect this SO — drop its pieces
      setSelectedSos((prev) => prev.filter((s) => s.id !== so.id));
      setCartPieces((prev) => prev.filter((p) => p.soId !== so.id));
      return;
    }

    // If switching to a different customer, replace cart
    const primary = selectedSos[0];
    const sameCustomer =
      !primary ||
      (!!primary.customerId && !!so.customerId && primary.customerId === so.customerId) ||
      customerKey(primary) === customerKey(so);

    setLoadingSoIds((ids) => [...ids, so.id]);
    try {
      const pieces = await loadSoPieces(so);
      if (!sameCustomer) {
        setSelectedSos([so]);
        setCartPieces(pieces);
      } else {
        setSelectedSos((prev) => [...prev, so]);
        setCartPieces((prev) => mergeSoPieces(prev, pieces));
      }
    } catch (e: any) {
      setLoadError(e?.message || `Could not load ${so.id}`);
    } finally {
      setLoadingSoIds((ids) => ids.filter((id) => id !== so.id));
    }
  };

  /** Select every hit that belongs to this customer (from current result list). */
  const selectAllForCustomer = async (anchor: SoHit) => {
    setLoadError(null);
    const key = customerKey(anchor);
    const cid = anchor.customerId;
    const group = hits.filter(
      (h) => (cid && h.customerId === cid) || customerKey(h) === key,
    );
    if (!group.length) return;

    setLoadingSoIds(group.map((g) => g.id));
    try {
      const loaded = await Promise.all(
        group.map(async (so) => ({ so, pieces: await loadSoPieces(so) })),
      );
      setSelectedSos(loaded.map((x) => x.so));
      setCartPieces(mergeSoPieces(...loaded.map((x) => x.pieces)));
    } catch (e: any) {
      setLoadError(e?.message || "Could not load all orders for this client");
    } finally {
      setLoadingSoIds([]);
    }
  };

  const togglePiece = (id: string) => {
    setCartPieces((prev) => prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  };

  const removePiece = (id: string) => {
    setCartPieces((prev) => prev.filter((p) => p.id !== id));
  };

  const selectAll = (on: boolean) => {
    setCartPieces((prev) => prev.map((p) => ({ ...p, selected: on })));
  };

  const continueWalkIn = () => nav("/intake/alterations?kind=walk_in");
  const continueRedo = () => nav("/intake/alterations?kind=redo");

  const continueOnOrder = async () => {
    if (!primarySo || selectedCount === 0) return;
    // Refresh phone/email from primary SO if available
    let phone = "";
    let email = "";
    let customerId = primarySo.customerId;
    let customerName = primarySo.customerName || primarySo.title;
    try {
      const d = await api.get<any>(
        `/api/intake-alterations/sales-orders/${encodeURIComponent(primarySo.id)}`,
      );
      phone = d?.customer_phone || "";
      email = d?.customer_email || "";
      customerId = customerId || d?.customer;
      customerName = customerName || d?.customer_name || primarySo.title;
    } catch {
      /* optional */
    }

    const sos = selectedSos.map((s) => s.id);
    writeSoCart({
      so: primarySo.id,
      sos,
      customerId,
      customerName,
      customerPhone: phone,
      customerEmail: email,
      pieces: cartPieces,
    });
    const p = new URLSearchParams({
      kind: "on_order",
      so: primarySo.id,
    });
    if (sos.length > 1) p.set("sos", sos.join(","));
    if (customerId) p.set("customer", customerId);
    if (customerName) p.set("customerName", customerName);
    nav(`/intake/alterations?${p.toString()}`);
  };

  // Group cart pieces by SO for display
  const piecesBySo = useMemo(() => {
    const map = new Map<string, SoPiece[]>();
    for (const p of cartPieces) {
      const k = p.soId || primarySo?.id || "order";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  }, [cartPieces, primarySo?.id]);

  const sameCustomerHits = useMemo(() => {
    if (!primarySo) return [] as SoHit[];
    const key = customerKey(primarySo);
    const cid = primarySo.customerId;
    return hits.filter(
      (h) => (cid && h.customerId === cid) || customerKey(h) === key,
    );
  }, [hits, primarySo]);

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
            <span className="w-[26px] h-[26px] rounded-full bg-brass text-forest-deep grid place-items-center font-bold">
              1
            </span>
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
        <aside className="border-r border-brass/15 p-5 flex flex-col overflow-y-auto">
          <h2 className="display text-[27px] leading-tight">What kind of ticket?</h2>
          <p className="text-[12px] text-[var(--cd)] mt-2 mb-5 leading-relaxed">
            This decides whether anyone gets charged. Pick before you touch a garment.
          </p>

          <button
            type="button"
            onClick={() => {
              setKind("walk_in");
              setSelectedSos([]);
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
              <span
                className={cn(
                  "text-xl",
                  kind === "on_order" ? "text-[var(--vi,#9B8BC4)]" : "text-brass-light",
                )}
              >
                ★
              </span>
              <span className="display text-[22px] flex-1">Custom order work</span>
              <span
                className={cn(kind === "on_order" ? "text-[var(--vi,#9B8BC4)]" : "text-brass/70")}
              >
                →
              </span>
            </div>
            <p className="text-[12px] text-[var(--cd)] mt-2 leading-relaxed">
              Adjustments to something we made. Pull one or more orders — pieces land in the cart on
              the right.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                Valued · no SI
              </span>
              <span className="chip border-[rgba(155,139,196,0.5)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.12)]">
                Multi-order cart
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setKind("redo");
              setSelectedSos([]);
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
            <p className="text-xs text-[var(--cd)] mt-2 leading-relaxed">{REDO_DISPLAY.kindBody}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">
                {REDO_DISPLAY.kindChip}
              </span>
              <span className="chip border-signal-emerald/40 text-signal-emerald bg-signal-emerald/10">
                No invoice
              </span>
            </div>
          </button>

          <div className="mt-auto pt-4">
            <div className="rounded-xl border border-brass/20 bg-brass/10 px-4 py-3 text-[12px] leading-relaxed text-cream-muted">
              <div className="caps text-brass-light mb-1">Why this is step one</div>
              Billing intent is the one thing that cannot be fixed cleanly afterwards. Choosing up
              front costs one tap.
            </div>
          </div>
        </aside>

        <main className="overflow-hidden min-w-0 flex flex-col bg-black/15">
          {kind === "walk_in" && (
            <div className="max-w-xl mx-auto pt-8 text-center p-5">
              <h2 className="display text-3xl mb-2">Walk-in alteration</h2>
              <p className="text-sm text-cream-dim mb-8">
                Client garments, normal pricing. Invoice will be created when the ticket is
                submitted.
              </p>
              <button
                type="button"
                onClick={continueWalkIn}
                className="btn-brass h-16 px-10 text-[12px] w-full max-w-md"
              >
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
              <div className="overflow-y-auto p-5 min-w-0 border-r border-brass/10">
                <h2 className="display text-[27px] leading-tight">Pull the custom order</h2>
                <p className="text-[12px] text-[var(--cd)] mt-2 mb-4">
                  Tap orders to <b className="text-[var(--vi,#9B8BC4)]">multi-select</b> — pieces from
                  every selected order merge into the cart. Same client preferred.
                </p>

                <div className="relative mb-2">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brass/70 text-lg">
                    ⌕
                  </span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Client name, order number, or fabric"
                    className="w-full h-[70px] rounded-2xl bg-black/35 border border-brass/30 pl-14 pr-5 text-lg text-cream outline-none focus:border-[rgba(155,139,196,0.7)] focus:shadow-[0_0_0_3px_rgba(155,139,196,0.16)] placeholder:text-[var(--cd)]"
                    autoFocus
                  />
                </div>
                <p className="text-[12px] text-[var(--cd)] mb-3 pl-1">
                  Open <b className="text-brass-light font-semibold">Sales Orders</b> · try{" "}
                  <b className="text-brass-light">SO-00472</b>, a last name, or fabric
                </p>

                {primarySo && sameCustomerHits.length > 1 && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => selectAllForCustomer(primarySo)}
                      disabled={loadingSoIds.length > 0}
                      className="h-10 px-4 rounded-full border border-[rgba(155,139,196,0.5)] bg-[rgba(155,139,196,0.15)] text-[11px] font-bold tracking-widest uppercase text-[var(--vi,#9B8BC4)] hover:bg-[rgba(155,139,196,0.25)] disabled:opacity-50"
                    >
                      Select all {sameCustomerHits.length} orders ·{" "}
                      {primarySo.customerName || primarySo.title}
                    </button>
                    {selectedSos.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSos([]);
                          setCartPieces([]);
                        }}
                        className="h-10 px-3 rounded-full border border-brass/25 text-[11px] font-bold tracking-widest uppercase text-cream-dim"
                      >
                        Clear cart
                      </button>
                    )}
                  </div>
                )}

                <div className="caps mb-3">
                  {q.trim().length >= 2
                    ? search.isFetching
                      ? "Searching…"
                      : `${hits.length} result${hits.length === 1 ? "" : "s"}`
                    : "Recent open orders"}
                  {selectedSos.length > 0 && (
                    <span className="ml-2 normal-case tracking-normal text-[var(--vi,#9B8BC4)]">
                      · {selectedSos.length} selected
                    </span>
                  )}
                </div>

                <div className="space-y-2.5">
                  {hits.map((so) => {
                    const on = selectedIds.has(so.id);
                    const loading = loadingSoIds.includes(so.id);
                    return (
                      <button
                        key={so.id}
                        type="button"
                        onClick={() => toggleSo(so)}
                        disabled={loading}
                        className={cn(
                          "w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all",
                          on
                            ? "border-[var(--vi,#9B8BC4)] bg-gradient-to-br from-[rgba(155,139,196,0.19)] to-[rgba(155,139,196,0.04)] ring-1 ring-[rgba(155,139,196,0.3)]"
                            : "border-brass/20 bg-black/20 hover:border-[rgba(155,139,196,0.45)]",
                          loading && "opacity-70",
                        )}
                      >
                        <span
                          className={cn(
                            "w-7 h-7 rounded-md border grid place-items-center text-[12px] font-bold shrink-0",
                            on
                              ? "bg-[var(--vi,#9B8BC4)] text-[#120E1C] border-transparent"
                              : "border-brass/40 text-transparent",
                          )}
                        >
                          {loading ? "…" : "✓"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[15px] truncate">
                            {so.customerName || so.title}
                            {so.subtitle ? (
                              <span className="text-cream-dim font-normal"> · {so.subtitle}</span>
                            ) : null}
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
                          {on && (
                            <div className="text-[10px] font-bold tracking-widest uppercase text-[var(--vi,#9B8BC4)] mt-0.5">
                              In cart
                            </div>
                          )}
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
                  {primarySo ? (
                    <>
                      <div className="font-semibold text-[14px] truncate">
                        {primarySo.customerName || primarySo.title}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--vi,#9B8BC4)] mt-0.5 leading-relaxed">
                        {selectedSos.length === 1
                          ? primarySo.id
                          : `${selectedSos.length} orders · ${selectedSos.map((s) => s.id.replace(/^LSTNY-/, "")).join(" · ")}`}
                      </div>
                    </>
                  ) : (
                    <p className="text-[12px] text-cream-dim">
                      Select one or more orders — pieces appear here.
                    </p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {loadingSoIds.length > 0 && (
                    <p className="text-cream-dim text-sm p-3 animate-pulse">Loading order lines…</p>
                  )}
                  {loadError && (
                    <QueryErrorPanel
                      compact
                      title="Could not load order items"
                      message={loadError}
                      onRetry={() => setLoadError(null)}
                    />
                  )}
                  {!primarySo && (
                    <div className="rounded-2xl border border-dashed border-brass/25 p-6 text-center text-[12px] text-cream-dim">
                      Cart is empty
                      <div className="text-[12px] mt-2 opacity-70">
                        Multi-select orders for the same client, then toggle pieces
                      </div>
                    </div>
                  )}
                  {cartPieces.length > 0 && (
                    <div className="flex gap-2 mb-2 items-center">
                      <button
                        type="button"
                        className="text-[12px] font-bold tracking-widest uppercase text-brass-light"
                        onClick={() => selectAll(true)}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="text-[12px] font-bold tracking-widest uppercase text-cream-dim"
                        onClick={() => selectAll(false)}
                      >
                        None
                      </button>
                      <span className="ml-auto text-[12px] text-cream-dim">
                        {selectedCount}/{cartPieces.length} pieces
                      </span>
                    </div>
                  )}

                  {Array.from(piecesBySo.entries()).map(([soId, pieces]) => (
                    <div key={soId} className="space-y-2">
                      {selectedSos.length > 1 && (
                        <div className="text-[10px] font-bold tracking-widest uppercase text-[var(--vi,#9B8BC4)] px-1 pt-1">
                          {soId}
                        </div>
                      )}
                      {pieces.map((p) => (
                        <div
                          key={p.id}
                          className={cn(
                            "relative w-full rounded-xl border flex transition-all",
                            p.selected
                              ? "border-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.14)]"
                              : "border-brass/15 bg-black/20 opacity-55",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => togglePiece(p.id)}
                            className="flex-1 text-left px-3 py-3 pr-10 flex gap-3"
                          >
                            <span
                              className={cn(
                                "w-6 h-6 rounded-md border grid place-items-center text-[12px] font-bold shrink-0 mt-0.5",
                                p.selected
                                  ? "bg-[var(--vi,#9B8BC4)] text-[#120E1C] border-transparent"
                                  : "border-brass/40 text-transparent",
                              )}
                            >
                              ✓
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12px] font-bold tracking-widest uppercase text-[var(--vi,#9B8BC4)]">
                                {p.garmentType}
                              </span>
                              <span className="block text-[13px] font-semibold leading-snug">
                                {p.label}
                              </span>
                              {p.description ? (
                                <span className="block text-[12px] text-cream-dim mt-1 line-clamp-2">
                                  {p.description}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removePiece(p.id)}
                            className="absolute top-2 right-2 w-7 h-7 rounded-lg border border-white/10 bg-black/40 text-cream-dim hover:text-[var(--ro,#D97B6C)] hover:border-[rgba(217,123,108,0.45)] grid place-items-center text-xs"
                            aria-label={`Remove ${p.label}`}
                            title="Remove from cart"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}

                  {primarySo &&
                    loadingSoIds.length === 0 &&
                    cartPieces.length === 0 &&
                    !loadError && (
                      <p className="text-cream-dim text-sm p-3">
                        No line items on selected orders — add garments on the next screen.
                      </p>
                    )}
                </div>

                <div className="p-3 border-t border-brass/15">
                  <button
                    type="button"
                    disabled={!primarySo || selectedCount === 0 || loadingSoIds.length > 0}
                    onClick={() => void continueOnOrder()}
                    className="w-full min-h-[72px] rounded-[17px] border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1"
                    style={{
                      background: "linear-gradient(135deg,#A797CE,#7D6DA8)",
                      color: "#120E1C",
                      boxShadow:
                        "0 12px 30px rgba(155,139,196,.3), inset 0 1px 0 rgba(255,255,255,.28)",
                    }}
                  >
                    <span className="text-[12.5px] font-bold tracking-[0.12em] uppercase">
                      {!primarySo
                        ? "Select an order"
                        : selectedCount === 0
                          ? "Select pieces"
                          : `Continue · ${selectedCount} piece${selectedCount === 1 ? "" : "s"}${
                              selectedSos.length > 1 ? ` · ${selectedSos.length} orders` : ""
                            }`}
                    </span>
                    {primarySo && selectedCount > 0 && (
                      <span className="text-[12px] tracking-[0.14em] uppercase opacity-75">
                        NON-BILLABLE · FULL PRICES KEPT
                      </span>
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
