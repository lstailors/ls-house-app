import { useEffect, useMemo, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import BoardStatusCard, { type BoardDelivery } from "@alts/components/BoardStatusCard";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { StatusPill } from "@ls/design";
import { ChargeCardOnFileButton } from "@alts/components/payments/ChargeCardOnFileButton";
import { ChargeTerminalButton } from "@alts/components/payments/ChargeTerminalButton";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import AddressAutocomplete from "@alts/components/intake/AddressAutocomplete";

type Ticket = {
  name: string;
  customer?: string;
  customer_name?: string;
  customer_mobile?: string;
  customer_phone?: string;
  workflow_state?: string;
  ticket_total?: number;
  payment_status?: string;
  billing_status?: string;
  sales_invoice?: string;
  delivery_method?: string;
  origin_location?: string;
  garments?: Array<{ garment_id?: string; garment_type?: string; color?: string; garment_total?: number }>;
};

type Method = "Pickup" | "Hand Delivery" | "Courier";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function asMethod(v?: string | null): Method {
  if (v === "Hand Delivery" || v === "Courier" || v === "Pickup") return v;
  return "Pickup";
}

function methodLabel(m?: string | null): string {
  if (m === "Pickup") return "Counter pickup";
  if (m === "Hand Delivery") return "Hand delivery";
  if (m === "Courier") return "Ship direct";
  return "Not set";
}

/** SPEC 043 §1a row caps */
function methodLabelCaps(m?: string | null): string {
  if (m === "Pickup") return "COUNTER PICKUP";
  if (m === "Hand Delivery") return "HAND DELIVERY";
  if (m === "Courier") return "COURIER";
  return "NOT SET";
}

function fmtShort(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function boardWindow(d: BoardDelivery): string {
  if (d.deliveredAt) return fmtShort(d.deliveredAt);
  if (d.dispatchedAt) return fmtShort(d.dispatchedAt);
  if (d.scheduledAt) return fmtShort(d.scheduledAt);
  return "—";
}

export default function Dispatch() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const preselect = params.get("ticket");

  const [selected, setSelected] = useState<string | null>(preselect);
  const [method, setMethod] = useState<Method>("Pickup");
  const [addr1, setAddr1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [note, setNote] = useState("");

  const ready = useQuery({
    queryKey: ["dispatch-ready"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?status=Ready&limit=100"),
    refetchInterval: 30_000,
  });

  const detail = useQuery({
    queryKey: ["dispatch-ticket", selected],
    enabled: !!selected,
    queryFn: () => api.get<Ticket>(`/api/intake-alterations/tickets/${selected}`),
  });

  // Prefill city/state for NYC store deliveries
  useEffect(() => {
    if (!detail.data?.name) return;
    setCity((c) => c || "New York");
    setState((s) => s || "NY");
  }, [detail.data?.name]);

  const board = useQuery({
    queryKey: ["dispatch-board", selected],
    enabled: !!selected,
    queryFn: async () => {
      // api.get unwraps { data: T }
      const rows = await api.get<BoardDelivery[]>(
        `/api/deliveries?alterationTicket=${encodeURIComponent(selected!)}`,
      );
      return (Array.isArray(rows) ? rows : [])[0] ?? null;
    },
    refetchInterval: 30_000,
  });

  /** SPEC 043 1a — board status pills on ready rows (one list fetch, map by ticket). */
  const boardIndex = useQuery({
    queryKey: ["dispatch-board-index"],
    queryFn: async () => {
      const rows = await api.get<Array<BoardDelivery & { alterationTicket?: string | null }>>(
        "/api/deliveries",
      );
      const map = new Map<string, BoardDelivery & { alterationTicket?: string | null }>();
      for (const r of Array.isArray(rows) ? rows : []) {
        const k = r.alterationTicket;
        if (k && !map.has(k)) map.set(k, r);
      }
      return map;
    },
    refetchInterval: 30_000,
  });

  const t = detail.data;
  const boardDoc = board.data ?? null;
  const storedMethod = asMethod(t?.delivery_method);
  const total = Number(t?.ticket_total) || 0;
  const unpaid =
    t &&
    t.payment_status !== "Paid" &&
    t.payment_status !== "N/A" &&
    total > 0 &&
    t.billing_status !== "Warranty" &&
    t.billing_status !== "Included in Custom Order";

  const list = ready.data ?? [];

  // HER-75 P0: seed method from the ticket record on select — never hard-default Pickup
  useEffect(() => {
    if (!t) return;
    setMethod(asMethod(t.delivery_method));
  }, [t?.name, t?.delivery_method]);

  const setDelivery = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a ticket");
      if (boardDoc && method !== "Pickup") {
        throw new Error("Delivery already on the board for this ticket");
      }

      // Write method on the ticket (staff-owned axis). Surface failures — do not swallow.
      await api.patch(`/api/alterations/${encodeURIComponent(selected)}`, {
        deliveryMethod: method,
      });

      if (method !== "Pickup") {
        const originLoc = "NYC";
        // from-order is the path that already writes lsh_alteration_ticket (join key).
        // POST / now also accepts the key, but from-order matches alts' payload shape.
        await api.post("/api/deliveries/from-order", {
          alteration_ticket: selected,
          customer_erp_name: t?.customer,
          customer_name: t?.customer_name,
          customer_phone: t?.customer_mobile || t?.customer_phone,
          notify_phone: t?.customer_mobile || t?.customer_phone,
          method,
          address: addr1 || undefined,
          city: city || undefined,
          state: state || undefined,
          // zip is not on from-order schema fields beyond notes — fold into notes if present
          garment_summary: (t?.garments ?? []).map((g) => g.garment_type).filter(Boolean).join(", "),
          garment_count: t?.garments?.length ?? 0,
          location: originLoc,
          notes: [note, zip ? `ZIP ${zip}` : ""].filter(Boolean).join(" · ") || undefined,
        });
      }
      return true;
    },
    onSuccess: () => {
      toast.success(method === "Pickup" ? "Marked for counter pickup" : `${methodLabel(method)} queued`);
      qc.invalidateQueries({ queryKey: ["dispatch-ticket", selected] });
      qc.invalidateQueries({ queryKey: ["dispatch-board", selected] });
      qc.invalidateQueries({ queryKey: ["dispatch-board-index"] });
      qc.invalidateQueries({ queryKey: ["dispatch-ready"] });
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not set delivery"),
  });

  const payLink = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No ticket");
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: t?.sales_invoice || selected }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "Pay link failed");
      return json as { url?: string; payment_url?: string; data?: { url?: string } };
    },
    onSuccess: async (json) => {
      const url =
        json?.url ||
        json?.payment_url ||
        json?.data?.url ||
        (typeof json === "object" && json && "link" in json ? String((json as any).link) : "");
      if (url && typeof url === "string" && url.startsWith("http")) {
        try {
          await navigator.clipboard?.writeText(url);
          toast.success("Pay link created — copied to clipboard", { description: url });
        } catch {
          toast.success("Pay link created", { description: url });
        }
      } else {
        toast.success("Pay link created");
      }
      qc.invalidateQueries({ queryKey: ["dispatch-ticket", selected] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const notifyReady = useMutation({
    mutationFn: () => api.post(`/api/intake-alterations/tickets/${selected}/notify-ready`, {}),
    onSuccess: () => toast.success("Ready SMS/MMS sent"),
    onError: (e: Error) => toast.error(e.message || "Notify failed"),
  });

  const releasePickup = useMutation({
    mutationFn: () =>
      api.patch(`/api/intake-alterations/tickets/${selected}/status`, { status: "Picked Up" }),
    onSuccess: () => {
      toast.success("Released · Picked Up");
      qc.invalidateQueries({ queryKey: ["dispatch-ready"] });
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ways = useMemo(
    () =>
      [
        {
          id: "Pickup" as const,
          title: "Counter pickup",
          sub: "Client comes in. Confirm identity, then release.",
          pod: "No POD",
          icon: (
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M16 3a3.2 3.2 0 0 0-3.2 3.2c0 1.6 1.3 2.3 2.3 2.8L5.5 15.5A2 2 0 0 0 4.6 17v1.9c0 .7.6 1.3 1.3 1.3h20.2c.7 0 1.3-.6 1.3-1.3V17a2 2 0 0 0-.9-1.6l-9.6-6.4c1-.5 2.3-1.2 2.3-2.8A3.2 3.2 0 0 0 16 3z" />
              <path d="M9 24h14M9 28h9" opacity=".65" />
            </svg>
          ),
        },
        {
          id: "Hand Delivery" as const,
          title: "Hand delivery",
          sub: "Marco / house driver. Address required.",
          pod: "POD on delivery — never charges",
          icon: (
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.5 20.5V9.5A1.6 1.6 0 0 1 4.1 8h11.3a1.6 1.6 0 0 1 1.6 1.5v11" />
              <path d="M17 12.5h5.4l4.1 4.3v3.7" />
              <circle cx="8" cy="23" r="2.6" />
              <circle cx="22" cy="23" r="2.6" />
              <path d="M10.6 23h8.8M2.5 20.5h2.9M24.6 20.5h2.4" />
            </svg>
          ),
        },
        {
          id: "Courier" as const,
          // Display copy only — stored value stays "Courier" (Lucia / HER-75).
          title: "Ship direct",
          sub: "Third-party courier. Tracked, client notified.",
          pod: "POD if carrier provides",
          icon: (
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 10.6 16 4.5l12 6.1v10.8L16 27.5 4 21.4z" />
              <path d="M4 10.6 16 16.7l12-6.1M16 16.7v10.8" opacity=".7" />
              <path d="M10 7.5 22 13.6" opacity=".45" />
            </svg>
          ),
        },
      ] as const,
    [],
  );

  return (
    <div className="alts-root flex flex-col min-h-dvh">
      {ready.isError && (
        <QueryErrorPanel
          title="Could not load"
          onRetry={() => ready.refetch()}
          className="mx-4 mt-3"
        />
      )}
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-brass/20 bg-black/20">
        <Link
          to={selected ? `/orders/alterations/${selected}` : "/"}
          className="w-11 h-11 rounded-xl border border-brass/25 grid place-items-center text-cream-dim"
        >
          ←
        </Link>
        <h1 className="display text-[23px]">Charge & dispatch</h1>
        {selected && (
          <span className="font-mono text-[12px] text-brass-light px-3 py-2 rounded-lg border border-brass/25 bg-brass/10">
            {selected}
          </span>
        )}
        <div className="flex-1" />
        <span className="hidden sm:flex items-center gap-2 text-[12px] font-bold tracking-widest uppercase text-signal-emerald px-3 py-2 rounded-full border border-signal-emerald/40 bg-signal-emerald/10">
          Ready queue · {list.length}
        </span>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_400px] min-h-0 phone-stack">
        <main className="overflow-y-auto p-5 space-y-5">
          <div>
            <div className="caps mb-3">Ready tickets</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {list.map((row) => {
                const u =
                  row.payment_status !== "Paid" &&
                  row.payment_status !== "N/A" &&
                  (Number(row.ticket_total) || 0) > 0;
                return (
                  <button
                    key={row.name}
                    type="button"
                    onClick={() => setSelected(row.name)}
                    className={cn(
                      "text-left card-glass p-3.5",
                      selected === row.name && "border-brass ring-1 ring-brass/40",
                      u && "border-l-2 border-l-signal-amber",
                    )}
                  >
                    <div className="font-mono text-[12px] text-brass-light">{row.name}</div>
                    <div className="font-semibold mt-0.5">{row.customer_name}</div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className={u ? "text-signal-amber" : "text-signal-emerald"}>
                        {row.payment_status || "—"}
                      </span>
                      <span className="text-brass-light">{money(Number(row.ticket_total) || 0)}</span>
                    </div>
                    {/* HER-75 / SPEC 043 1a — method + board status pill */}
                    <div
                      className="mt-[9px] pt-[9px] flex items-center gap-[7px] flex-wrap"
                      style={{ borderTop: "1px solid rgba(176,141,87,.14)" }}
                    >
                      <span className="text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--cd)]">
                        {methodLabelCaps(row.delivery_method)}
                      </span>
                      {boardIndex.data?.get(row.name) ? (
                        <StatusPill status={boardIndex.data.get(row.name)!.status} className="ml-auto" />
                      ) : row.delivery_method === "Pickup" || !row.delivery_method ? (
                        <span className="pill pill-muted ml-auto">
                          <span className="h-1.5 w-1.5 rounded-full bg-cream-dim" />
                          {row.delivery_method === "Pickup" ? "At counter" : "No dispatch"}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {!list.length && !ready.isLoading && !ready.isError && (
                <p className="text-cream-dim text-sm col-span-2 italic">No Ready tickets</p>
              )}
              {ready.isError && (
                <div className="col-span-2">
                  <QueryErrorPanel
                    compact
                    title="Could not load dispatch queue"
                    onRetry={() => ready.refetch()}
                  />
                </div>
              )}
            </div>
          </div>

          {selected && t && (
            <>
              <div>
                <div className="caps mb-3">How it goes out</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {ways.map((w) => {
                    const isCurrent = storedMethod === w.id;
                    const isSelected = method === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setMethod(w.id)}
                        className={cn(
                          "relative text-left rounded-[18px] p-4 border transition-all min-h-[150px] flex flex-col",
                          isSelected
                            ? "border-brass bg-gradient-to-br from-brass/20 to-brass/5 ring-1 ring-brass/30"
                            : "border-brass/20 bg-black/20 hover:border-brass/45",
                        )}
                      >
                        {isCurrent && (
                          <span
                            className="absolute top-3.5 right-3.5 text-[12px] font-bold tracking-[0.1em] uppercase px-2 py-0.5 rounded-full z-[1]"
                            style={{
                              color: "var(--violet, #9B8BC4)",
                              border: "1px solid rgba(155,139,196,.4)",
                              background: "rgba(155,139,196,.12)",
                            }}
                          >
                            Current
                          </span>
                        )}
                        {isSelected && (
                          <span className="absolute top-3.5 left-3.5 w-[22px] h-[22px] rounded-full bg-brass text-forest-deep text-[12px] grid place-items-center font-bold z-[1]">
                            ✓
                          </span>
                        )}
                        {/* 30px stroked icons hold the top band — no selection mt shift (Lucia render check) */}
                        <span
                          className={cn(
                            "block mb-2.5 transition-colors",
                            isSelected ? "text-brass-light opacity-100" : "text-brass-light opacity-90",
                          )}
                          style={isSelected ? { color: "var(--brass-glow, #E3C48F)" } : undefined}
                        >
                          {w.icon}
                        </span>
                        <div className="display text-[21px] mb-1">{w.title}</div>
                        <p className="text-[12px] text-[var(--cd)] leading-relaxed flex-1">{w.sub}</p>
                        <div className="mt-3 pt-2 border-t border-brass/15 text-[12px] font-bold tracking-wider uppercase text-brass/70">
                          {w.pod}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SPEC 043 1b/1c — full board card or honest empty states */}
              {boardDoc ? (
                <BoardStatusCard board={boardDoc} />
              ) : method === "Pickup" && storedMethod === "Pickup" ? (
                <div className="card-glass px-[18px] py-[22px] text-center">
                  <BrandSeal to={null} className="mx-auto mb-3 opacity-80" />
                  <span className="pill pill-muted">At counter</span>
                  <p className="text-[12px] text-[var(--cd)] leading-relaxed mt-3 max-w-md mx-auto">
                    Pickup does not create a board record. Release at the counter — no POD, no driver.
                  </p>
                </div>
              ) : (
                <div className="card-glass px-[18px] py-[22px] text-center">
                  <BrandSeal to={null} className="mx-auto mb-3 opacity-80" />
                  <span className="pill pill-muted">No dispatch</span>
                  <p className="text-[12px] text-[var(--cd)] leading-relaxed mt-3 max-w-md mx-auto">
                    No board record yet. Choose a method above, then queue it — a silent write failure
                    looks the same as never queued.
                  </p>
                </div>
              )}

              {method !== "Pickup" && (
                <div className="card-glass overflow-hidden">
                  <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center">
                    <h3 className="display text-lg flex-1">Delivery address</h3>
                  </div>
                  <div className="p-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                    <label className="block sm:col-span-3">
                      <span className="caps mb-1.5 block">Street</span>
                      <AddressAutocomplete
                        value={addr1}
                        onChange={setAddr1}
                        onPick={(pick) => {
                          setAddr1(pick.street);
                          if (pick.city) setCity(pick.city);
                          if (pick.state) setState(pick.state);
                          if (pick.zip) setZip(pick.zip);
                        }}
                        placeholder="Start typing a street…"
                        inputClassName="w-full h-12 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream outline-none focus:border-brass placeholder:text-cream-dim"
                      />
                    </label>
                    <label className="block">
                      <span className="caps mb-1.5 block">City</span>
                      <input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full h-12 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="caps mb-1.5 block">State</span>
                      <input
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="w-full h-12 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="caps mb-1.5 block">ZIP</span>
                      <input
                        value={zip}
                        onChange={(e) => setZip(e.target.value)}
                        className="w-full h-12 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream outline-none"
                      />
                    </label>
                    <label className="block sm:col-span-3">
                      <span className="caps mb-1.5 block">Driver note</span>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        className="w-full rounded-xl bg-black/35 border border-brass/25 px-3 py-2 text-cream outline-none resize-none"
                        placeholder="Doorman, gate code, leave with EA…"
                      />
                    </label>
                  </div>
                </div>
              )}

              <div>
                <div className="caps mb-2">Garments · {t.garments?.length ?? 0}</div>
                <div className="flex flex-wrap gap-2">
                  {(t.garments ?? []).map((g, i) => (
                    <div key={i} className="card-glass px-3 py-2 text-sm flex items-center gap-2">
                      <span className="w-4 h-4 rounded bg-signal-emerald/90 text-forest-deep text-[12px] grid place-items-center">
                        ✓
                      </span>
                      <span className="font-mono text-[12px] text-brass-light">{g.garment_id || `G${i + 1}`}</span>
                      <span>
                        {g.garment_type}
                        {g.color ? ` · ${g.color}` : ""}
                      </span>
                    </div>
                  ))}
                  {!t.garments?.length && <p className="text-cream-dim text-sm">Open full ticket for lines</p>}
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="border-l border-brass/15 bg-black/25 p-5 overflow-y-auto flex flex-col">
          {!selected && (
            <p className="text-cream-dim text-sm m-auto text-center">Select a Ready ticket to charge & dispatch.</p>
          )}
          {selected && t && (
            <>
              <div className="caps">Client</div>
              <div className="display text-3xl leading-none mt-1">{t.customer_name}</div>
              <div className="text-xs text-cream-dim mt-2">{t.customer_mobile || t.customer_phone || "No phone"}</div>

              <div className="my-5 h-px bg-brass/15" />

              <div className="caps">Ticket total</div>
              <div className="display text-4xl text-brass-light my-1">{money(total)}</div>
              <div className="text-xs text-cream-dim mb-1">
                {t.payment_status === "Paid" ? "Paid in full" : unpaid ? "Collect before / at release" : t.payment_status}
              </div>
              <p className="text-[12px] text-cream-dim mb-4">No tax · service</p>

              {boardDoc && (
                <>
                  <div className="my-2 h-px bg-brass/15" />
                  <div className="caps mb-2">On the board</div>
                  <div className="flex items-center gap-2 mb-1">
                    <StatusPill status={boardDoc.status} />
                  </div>
                  <div className="text-[12px] text-[var(--cm)] mb-2">
                    {(boardDoc.courierName || boardDoc.driver?.name || "Unassigned") +
                      " · " +
                      boardWindow(boardDoc)}
                  </div>
                  <a
                    href={`https://app.lstailors.com/deliveries/${encodeURIComponent(boardDoc.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost w-full min-h-11 h-11 text-[12px] mb-4 inline-flex items-center justify-center"
                  >
                    Open on dispatch board →
                  </a>
                </>
              )}

              {unpaid && (
                <div className="space-y-2 mb-4">
                  <div className="caps text-signal-amber">Charge at Ready</div>
                  <ChargeCardOnFileButton
                    fullWidth
                    ticketId={selected!}
                    amountDisplay={money(Number(t.ticket_total) || 0)}
                    customerLabel={t.customer_name}
                    onSuccess={() => {
                      toast.success("Card on file charged — refreshing…");
                      qc.invalidateQueries({ queryKey: ["dispatch-ticket", selected] });
                      qc.invalidateQueries({ queryKey: ["dispatch-ready"] });
                    }}
                    onRefresh={() => {
                      qc.invalidateQueries({ queryKey: ["dispatch-ticket", selected] });
                      qc.invalidateQueries({ queryKey: ["dispatch-ready"] });
                    }}
                    onError={(msg) => toast.error(msg)}
                  />
                  <ChargeTerminalButton
                    invoiceId={t.sales_invoice || selected!}
                    ticketId={selected!}
                    amountCents={Math.round((Number(t.ticket_total) || 0) * 100)}
                    amountDisplay={money(Number(t.ticket_total) || 0)}
                    onSuccess={() => {
                      toast.success("Payment captured — refreshing…");
                      qc.invalidateQueries({ queryKey: ["dispatch-ticket", selected] });
                      qc.invalidateQueries({ queryKey: ["dispatch-ready"] });
                    }}
                    onError={(msg) => toast.error(msg)}
                  />
                  <button type="button" onClick={() => payLink.mutate()} className="btn-brass w-full h-12 text-[12px]">
                    {payLink.isPending ? "…" : "Create pay link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => nav(`/orders/alterations/${selected}`)}
                    className="btn-ghost w-full h-11 text-[12px]"
                  >
                    Open full ticket
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => notifyReady.mutate()}
                disabled={notifyReady.isPending}
                className="btn-ghost w-full h-12 text-[12px] mb-2"
              >
                {notifyReady.isPending ? "…" : "SMS ready + e-ticket"}
              </button>

              <button
                type="button"
                onClick={() => setDelivery.mutate()}
                disabled={setDelivery.isPending || (method !== "Pickup" && !addr1.trim())}
                className="btn-brass w-full h-14 text-[12px] mb-2 disabled:opacity-40"
              >
                {setDelivery.isPending
                  ? "…"
                  : method === "Pickup"
                    ? "Confirm counter pickup"
                    : method === "Courier"
                      ? "Queue ship direct"
                      : `Queue ${method.toLowerCase()}`}
              </button>

              {method === "Pickup" && (
                <button
                  type="button"
                  onClick={() => {
                    if (unpaid) {
                      const ok = window.confirm("Release unpaid? Unpaid SMS may send.");
                      if (!ok) return;
                    }
                    releasePickup.mutate();
                  }}
                  disabled={releasePickup.isPending}
                  className={cn(
                    "w-full h-14 rounded-2xl font-bold tracking-widest uppercase text-sm",
                    // C: emerald when paid, amber when unpaid — never red
                    unpaid ? "bg-signal-amber/90 text-forest-deep" : "bg-signal-emerald text-forest-deep",
                  )}
                >
                  {releasePickup.isPending ? "…" : unpaid ? "Release unpaid" : "Release · Picked Up"}
                </button>
              )}

              <p className="text-[12px] text-cream-dim mt-4 text-center leading-relaxed">
                POD never charges. Money is card-on-file · Terminal · pay link only.
              </p>

              <button
                type="button"
                onClick={() => nav(`/orders/alterations/${selected}`)}
                className="mt-auto pt-6 text-[12px] font-bold tracking-widest uppercase text-brass-light"
              >
                Open full ticket →
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
