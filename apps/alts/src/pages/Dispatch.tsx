import { useMemo, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type Ticket = {
  name: string;
  customer_name?: string;
  customer_mobile?: string;
  customer_phone?: string;
  workflow_state?: string;
  ticket_total?: number;
  payment_status?: string;
  billing_status?: string;
  sales_invoice?: string;
  delivery_method?: string;
  garments?: Array<{ garment_id?: string; garment_type?: string; color?: string; garment_total?: number }>;
};

type Method = "Pickup" | "Hand Delivery" | "Courier";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function Dispatch() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const preselect = params.get("ticket");

  const [selected, setSelected] = useState<string | null>(preselect);
  const [method, setMethod] = useState<Method>("Pickup");
  const [addr1, setAddr1] = useState("");
  const [city, setCity] = useState("New York");
  const [state, setState] = useState("NY");
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

  const t = detail.data;
  const total = Number(t?.ticket_total) || 0;
  const unpaid =
    t &&
    t.payment_status !== "Paid" &&
    t.payment_status !== "N/A" &&
    total > 0 &&
    t.billing_status !== "Warranty" &&
    t.billing_status !== "Included in Custom Order";

  const list = ready.data ?? [];

  const setDelivery = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a ticket");
      // Prefer intake status path for delivery_method when present on detail PATCH
      try {
        await api.patch(`/api/alterations/${encodeURIComponent(selected)}`, {
          deliveryMethod: method,
        });
      } catch {
        // non-fatal — method still used for local UX + delivery create
      }
      if (method !== "Pickup") {
        await api.post("/api/deliveries", {
          alteration_ticket: selected,
          customer_name: t?.customer_name,
          customer_phone: t?.customer_mobile || t?.customer_phone,
          method,
          address: addr1 || undefined,
          city: city || undefined,
          apt: undefined,
          notify_phone: t?.customer_mobile || t?.customer_phone,
          garment_summary: (t?.garments ?? []).map((g) => g.garment_type).filter(Boolean).join(", "),
          garment_count: t?.garments?.length ?? 0,
          location: "NYC",
          notes: note || undefined,
        }).catch(async () => {
          // alternate payload shape
          await api.post("/api/deliveries", {
            sales_order: null,
            alteration_ticket: selected,
            customer_name: t?.customer_name,
            method,
            address: [addr1, city, state, zip].filter(Boolean).join(", "),
          });
        });
      }
      return true;
    },
    onSuccess: () => toast.success(method === "Pickup" ? "Marked for counter pickup" : `${method} queued`),
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
      return json;
    },
    onSuccess: () => {
      toast.success("Pay link sent / created");
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
        },
        {
          id: "Hand Delivery" as const,
          title: "Hand delivery",
          sub: "Marco / house driver. Address required.",
          pod: "POD on delivery — never charges",
        },
        {
          id: "Courier" as const,
          title: "Courier",
          sub: "Third-party courier. Track + notify.",
          pod: "POD if available",
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

      <div className="flex-1 grid lg:grid-cols-[1fr_400px] min-h-0">
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
                  {ways.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setMethod(w.id)}
                      className={cn(
                        "text-left rounded-[18px] p-4 border transition-all",
                        method === w.id
                          ? "border-brass bg-gradient-to-br from-brass/20 to-brass/5 ring-1 ring-brass/30"
                          : "border-brass/20 bg-black/20 hover:border-brass/45",
                      )}
                    >
                      <div className="display text-[21px] mb-1">{w.title}</div>
                      <p className="text-[12px] text-[var(--cd)] leading-relaxed">{w.sub}</p>
                      <div className="mt-3 pt-2 border-t border-brass/15 text-[12px] font-bold tracking-wider uppercase text-brass/70">
                        {w.pod}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {method !== "Pickup" && (
                <div className="card-glass overflow-hidden">
                  <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center">
                    <h3 className="display text-lg flex-1">Delivery address</h3>
                  </div>
                  <div className="p-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                    <label className="block sm:col-span-3">
                      <span className="caps mb-1.5 block">Street</span>
                      <input
                        value={addr1}
                        onChange={(e) => setAddr1(e.target.value)}
                        className="w-full h-12 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream outline-none focus:border-brass"
                        placeholder="Street + apt"
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

              {unpaid && (
                <div className="space-y-2 mb-4">
                  <div className="caps text-signal-amber">Charge at Ready</div>
                  <button type="button" onClick={() => payLink.mutate()} className="btn-brass w-full h-12 text-[12px]">
                    {payLink.isPending ? "…" : "Send pay link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => nav(`/orders/alterations/${selected}`)}
                    className="btn-ghost w-full h-11 text-[12px]"
                  >
                    Terminal / full ticket
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
