import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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

type Kind = "walk_in" | "on_order" | "redo" | "parked";

type ParkedHit = {
  id?: string;
  name?: string;
  label?: string;
  customer_label?: string;
  customer_ref?: string | null;
  location?: string;
  garment_count?: number;
  line_count?: number;
  total?: number;
  modified?: string;
  creation?: string;
  updated_at?: string;
  cart?: any;
};

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
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("walk_in");
  const [q, setQ] = useState("");
  /** Multi-select sales orders (same customer preferred). */
  const [selectedSos, setSelectedSos] = useState<SoHit[]>([]);
  const [cartPieces, setCartPieces] = useState<SoPiece[]>([]);
  const [loadingSoIds, setLoadingSoIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parkedQ, setParkedQ] = useState("");

  const parked = useQuery({
    queryKey: ["parked-carts"],
    enabled: kind === "parked",
    queryFn: async () => {
      const rows = await api.get<ParkedHit[]>("/api/carts");
      return rows ?? [];
    },
  });

  const dropParked = useMutation({
    mutationFn: (id: string) => api.delete(`/api/carts/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success("Parked cart removed");
      qc.invalidateQueries({ queryKey: ["parked-carts"] });
    },
    onError: () => toast.error("Could not remove parked cart"),
  });

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

  const parkedList = useMemo(() => {
    const rows = parked.data ?? [];
    const needle = parkedQ.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) => {
      const intake = c.cart?.intake;
      const label = String(c.label || intake?.parkLabel || c.customer_label || "").toLowerCase();
      const note = String(intake?.parkNote || "").toLowerCase();
      const id = String(c.id || c.name || "").toLowerCase();
      const cust = String(c.customer_ref || intake?.customer?.name || "").toLowerCase();
      return (
        label.includes(needle) ||
        note.includes(needle) ||
        id.includes(needle) ||
        cust.includes(needle)
      );
    });
  }, [parked.data, parkedQ]);

  const resumeParked = (id: string) => {
    if (!id) return;
    nav(`/intake/alterations?parked=${encodeURIComponent(id)}`);
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

      <div className="flex-1 grid lg:grid-cols-[360px_1fr] min-h-0 phone-stack">
        <aside className="border-r border-brass/15 p-5 flex flex-col min-h-0 overflow-y-auto overscroll-contain">
          <h2 className="display text-[27px] leading-tight shrink-0">What kind of ticket?</h2>
          <p className="text-[12px] text-[var(--cd)] mt-2 mb-3 leading-relaxed shrink-0">
            This decides whether anyone gets charged. Pick before you touch a garment.
          </p>

          {/* Always-visible retrieve entry — full card further down; this never clips under the fold */}
          <button
            type="button"
            onClick={() => {
              setKind("parked");
              setSelectedSos([]);
              setCartPieces([]);
              setLoadError(null);
            }}
            className={cn(
              "w-full shrink-0 text-left rounded-2xl px-4 py-3 mb-4 border transition-all",
              "border-brass/40 bg-brass/15 hover:bg-brass/25 active:scale-[0.99]",
              kind === "parked" && "ring-1 ring-brass/40 border-brass/60",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-brass-light text-lg">⌁</span>
              <span className="display text-[18px] flex-1 text-cream">Parked tickets</span>
              <span className="text-[11px] font-bold tracking-widest uppercase text-brass-light">
                Retrieve →
              </span>
            </div>
            <p className="text-[11px] text-cream-dim mt-1 pl-8">
              Pull a held cart back · no ticket # burned
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setKind("walk_in");
              setSelectedSos([]);
              setCartPieces([]);
              continueWalkIn();
            }}
            className={cn(
              "tk-kind-card w-full text-left rounded-[18px] p-[18px] mb-3 border transition-all shrink-0",
              "border-brass/25 bg-black/20 hover:border-brass hover:bg-gradient-to-br hover:from-brass/20 hover:to-brass/5 active:scale-[0.99]",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-brass-light text-xl">◎</span>
              <span className="display text-[22px] flex-1">Walk-in</span>
              <span className="text-brass/70">→</span>
            </div>
            <p className="text-[12px] text-[var(--cd)] mt-2 leading-relaxed">
              Counter ticket — alterations, stock or special-order items, or both. Client pays.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip">Billable</span>
              <span className="chip">Invoice created</span>
              <span className="chip">Alts + items</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setKind("on_order")}
            className={cn(
              "tk-kind-card w-full text-left rounded-[18px] p-[18px] mb-3 border transition-all",
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
              continueRedo();
            }}
            className={cn(
              "tk-kind-card w-full text-left rounded-[18px] p-[18px] mb-3 border transition-all",
              "border-brass/25 bg-black/20 hover:border-signal-emerald/50 hover:bg-gradient-to-br hover:from-signal-emerald/15 hover:to-transparent active:scale-[0.99]",
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

          {/* Full parked card kept for parity; primary entry is the compact strip above Walk-in */}
          <button
            type="button"
            onClick={() => {
              setKind("parked");
              setSelectedSos([]);
              setCartPieces([]);
              setLoadError(null);
            }}
            className={cn(
              "tk-kind-card w-full shrink-0 text-left rounded-[18px] p-[18px] mb-3 border transition-all",
              kind === "parked"
                ? "border-brass/55 bg-gradient-to-br from-brass/20 to-brass/5 ring-1 ring-brass/25"
                : "border-brass/25 bg-black/20 hover:border-brass/50 hover:bg-gradient-to-br hover:from-brass/12 hover:to-transparent active:scale-[0.99]",
            )}
          >
            <div className="flex items-center gap-3">
              <span className={cn("text-xl", kind === "parked" ? "text-brass-light" : "text-brass-light/90")}>
                ⌁
              </span>
              <span className="display text-[22px] flex-1">Parked tickets</span>
              <span className={cn(kind === "parked" ? "text-brass-light" : "text-brass/70")}>→</span>
            </div>
            <p className="text-[12px] text-[var(--cd)] mt-2 leading-relaxed">
              Pull a held cart back — no ticket number burned. Resume where you left off and finish the work.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip">Retrieve</span>
              <span className="chip">Resume · no new #</span>
            </div>
          </button>

          {/* No mt-auto — that pinned the footer and clipped Parked on short/iPad viewports */}
          <div className="pt-2 pb-6 shrink-0">
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
              <h2 className="display text-3xl mb-2">Walk-in</h2>
              <p className="text-sm text-cream-dim mb-4">
                Opening client & cart…
              </p>
              <div className="h-10 w-10 mx-auto rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
            </div>
          )}

          {kind === "redo" && (
            <div className="max-w-xl mx-auto pt-8 text-center p-5">
              <h2 className="display text-3xl mb-2">{REDO_DISPLAY.kindTitle}</h2>
              <p className="text-sm text-cream-dim mb-4">Opening client & cart…</p>
              <div className="h-10 w-10 mx-auto rounded-full border-2 border-signal-emerald/40 border-t-signal-emerald animate-spin" />
            </div>
          )}

          {kind === "parked" && (
            <div className="flex-1 overflow-y-auto p-5 min-w-0">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
                <div>
                  <h2 className="display text-[27px] leading-tight">Retrieve parked</h2>
                  <p className="text-[12px] text-[var(--cd)] mt-2 max-w-xl">
                    Held carts with no ticket number. Tap <b className="text-brass-light">Resume</b> to
                    open the full cart and finish.
                  </p>
                </div>
                <Link
                  to="/parked"
                  className="h-10 px-4 rounded-full border border-brass/30 text-[11px] font-bold tracking-widest uppercase text-cream-dim hover:text-cream hover:border-brass/50 inline-flex items-center"
                >
                  Full tray →
                </Link>
              </div>

              <div className="relative mb-4 mt-4 max-w-xl">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brass/70 text-lg">⌕</span>
                <input
                  value={parkedQ}
                  onChange={(e) => setParkedQ(e.target.value)}
                  placeholder="Search label, client, note…"
                  className="w-full h-[56px] rounded-2xl bg-black/35 border border-brass/30 pl-14 pr-5 text-base text-cream outline-none focus:border-brass/60 focus:shadow-[0_0_0_3px_rgba(176,141,87,0.16)] placeholder:text-[var(--cd)]"
                  autoFocus
                />
              </div>

              <div className="caps mb-3">
                {parked.isFetching
                  ? "Loading…"
                  : `${parkedList.length} parked${parkedList.length === 1 ? "" : ""}`}
              </div>

              {parked.isError && (
                <QueryErrorPanel title="Could not load parked carts" onRetry={() => parked.refetch()} />
              )}

              {!parked.isLoading && !parked.isError && parkedList.length === 0 && (
                <div className="card-glass p-8 text-center max-w-lg">
                  <div className="display text-3xl mb-2">Nothing parked</div>
                  <p className="text-cream-dim text-sm mb-4">
                    Park from intake when you need to hold a cart. It shows up here to pull back.
                  </p>
                  <button
                    type="button"
                    onClick={continueWalkIn}
                    className="btn-brass inline-flex h-12 px-6 items-center text-[12px]"
                  >
                    Start walk-in
                  </button>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2 max-w-4xl">
                {parkedList.map((c) => {
                  const id = c.id || c.name || "";
                  const intake = c.cart?.intake;
                  const total =
                    Number(c.total) || Number(intake?.total) || Number(c.cart?.total) || 0;
                  const label =
                    c.label || intake?.parkLabel || c.customer_label || "Parked cart";
                  const gCount =
                    intake?.garments?.length ?? c.garment_count ?? c.cart?.garments?.length ?? 0;
                  const expected = intake?.expectedGarmentCount ?? gCount;
                  const lines = intake?.garments
                    ? intake.garments.reduce(
                        (s: number, g: any) => s + (g.lines?.length || 0),
                        0,
                      )
                    : c.line_count ?? c.cart?.lines?.length ?? "—";
                  const when = c.updated_at || c.modified || c.creation;
                  const billing = intake?.billing as string | undefined;
                  const billingChip =
                    billing === "redo"
                      ? "Re-do"
                      : billing === "on_order"
                        ? "On order"
                        : billing === "billable"
                          ? "Billable"
                          : null;

                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-brass/20 bg-black/25 p-5 flex flex-col hover:border-brass/40 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-lg leading-snug text-cream">{label}</div>
                          <div className="text-[12px] text-cream-dim mt-1">
                            {c.location || "NYC"}
                            {when ? ` · ${new Date(when).toLocaleString()}` : ""}
                          </div>
                        </div>
                        <div className="ml-auto display text-2xl text-brass-light shrink-0">
                          {money(total)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3 text-[12px] text-cream-dim">
                        <span>
                          {gCount}
                          {expected > gCount ? ` of ${expected}` : ""} garments
                        </span>
                        <span>·</span>
                        <span>{lines} lines</span>
                        {billingChip ? (
                          <span className="chip border-brass/30 text-brass-light bg-brass/10">
                            {billingChip}
                          </span>
                        ) : null}
                        {intake?.parkNote ? (
                          <span className="w-full text-cream-muted mt-1">{intake.parkNote}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-5">
                        <button
                          type="button"
                          onClick={() => resumeParked(id)}
                          className="btn-brass flex-1 h-11 text-[12px]"
                        >
                          Resume · work on it
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Remove this parked cart?")) dropParked.mutate(id);
                          }}
                          disabled={dropParked.isPending}
                          className="h-11 px-4 rounded-xl border border-brass/25 text-[12px] font-semibold text-cream-dim hover:text-cream disabled:opacity-50"
                        >
                          Drop
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {kind === "on_order" && (
            <div className="flex-1 grid lg:grid-cols-[1fr_340px] min-h-0 phone-stack">
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
