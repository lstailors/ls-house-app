import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  due_date?: string;
  ticket_total?: number;
  payment_status?: string;
  garments?: Array<{ name?: string; garment_id?: string; garment_type?: string; color?: string; garment_total?: number }>;
  lines?: Array<{ description?: string; price?: number; garment?: string }>;
  sales_invoice?: string;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function PickupCounter() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmWho, setConfirmWho] = useState(true);

  const ready = useQuery({
    queryKey: ["pickup-ready"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?status=Ready&limit=100"),
    refetchInterval: 30_000,
  });

  const detail = useQuery({
    queryKey: ["pickup-ticket", selected],
    enabled: !!selected,
    queryFn: () => api.get<Ticket>(`/api/intake-alterations/tickets/${selected}`),
  });

  const list = ready.data ?? [];
  const t = detail.data;
  const unpaid =
    t &&
    t.payment_status !== "Paid" &&
    t.payment_status !== "N/A" &&
    (Number(t.ticket_total) || 0) > 0;

  const release = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No ticket");
      if (!confirmWho) throw new Error("Confirm who’s collecting");
      return api.patch<{ unpaid_release_sms?: { sent?: boolean; reason?: string } }>(
        `/api/intake-alterations/tickets/${selected}/status`,
        { status: "Picked Up" },
      );
    },
    onSuccess: (data) => {
      toast.success("Released — Picked Up");
      if (data?.unpaid_release_sms?.sent) toast.success("Unpaid balance SMS sent");
      qc.invalidateQueries({ queryKey: ["pickup-ready"] });
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
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
      if (!res.ok) throw new Error(json?.error?.message || "Link failed");
      return json;
    },
    onSuccess: () => toast.success("Payment link created"),
    onError: (e: Error) => toast.error(e.message),
  });

  const smsUnpaid = useMutation({
    mutationFn: () => api.post(`/api/intake-alterations/tickets/${selected}/notify-unpaid-release`, {}),
    onSuccess: () => toast.success("Unpaid SMS sent"),
    onError: () => toast.error("SMS failed"),
  });

  const total = Number(t?.ticket_total) || 0;

  return (
    <div className="alts-root flex flex-col min-h-screen">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to="/" className="text-cream-dim hover:text-cream p-2">
          ←
        </Link>
        <h1 className="display text-2xl">Pickup</h1>
        <div className="flex-1" />
        <Link
          to="/scanner"
          className="flex items-center gap-2 h-11 px-4 rounded-full border border-brass/30 text-sm font-semibold text-brass-light hover:border-brass/50"
        >
          ⌗ Scan next ticket
        </Link>
      </header>

      <div className="flex-1 grid lg:grid-cols-[340px_1fr] min-h-0">
        {/* queue */}
        <aside className="border-r border-brass/15 overflow-y-auto p-3 space-y-2">
          <div className="caps px-2 py-2">Ready · {list.length}</div>
          {list.map((row) => (
            <button
              key={row.name}
              type="button"
              onClick={() => {
                setSelected(row.name);
                setConfirmWho(true);
              }}
              className={cn(
                "w-full text-left card-glass p-3",
                selected === row.name && "border-brass ring-1 ring-brass/40",
              )}
            >
              <div className="text-[11px] font-mono text-brass-light">{row.name}</div>
              <div className="font-semibold mt-0.5">{row.customer_name}</div>
              <div className="flex justify-between text-xs text-cream-dim mt-1">
                <span>{row.payment_status || "—"}</span>
                <span className="text-brass-light">{money(Number(row.ticket_total) || 0)}</span>
              </div>
            </button>
          ))}
          {!list.length && !ready.isLoading && (
            <p className="text-cream-dim text-sm p-4 italic">No Ready tickets</p>
          )}
        </aside>

        {/* detail */}
        <main className="overflow-y-auto p-5">
          {!selected && (
            <div className="h-full grid place-items-center text-cream-dim">
              <div className="text-center">
                <div className="display text-3xl mb-2">Select a Ready ticket</div>
                <p className="text-sm">Or scan a tag from the header.</p>
              </div>
            </div>
          )}
          {selected && t && (
            <div className="grid lg:grid-cols-[1fr_320px] gap-6 max-w-5xl">
              <div>
                <div className="flex items-start gap-3 mb-5">
                  <div className="w-14 h-14 rounded-full bg-forest-raised border border-brass/30 grid place-items-center font-bold text-brass-light text-lg">
                    {(t.customer_name || "??").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="display text-3xl leading-none">{t.customer_name}</div>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs items-center">
                      <span className="font-mono text-brass-light">{t.name}</span>
                      <span className="chip">Ready</span>
                      <span className="text-cream-dim">{t.customer_mobile || t.customer_phone}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setConfirmWho((v) => !v)}
                  className="w-full card-glass p-4 flex items-center gap-3 mb-5 text-left"
                >
                  <span className="text-2xl opacity-80">👤</span>
                  <span className="flex-1">
                    <span className="block font-semibold">Confirm who’s collecting</span>
                    <span className="text-xs text-cream-dim">
                      {t.customer_name}, or an authorised name. Ask before releasing.
                    </span>
                  </span>
                  <span
                    className={cn(
                      "w-8 h-8 rounded-full border-2 grid place-items-center",
                      confirmWho ? "bg-signal-emerald border-signal-emerald text-forest-deep" : "border-brass/40",
                    )}
                  >
                    {confirmWho ? "✓" : ""}
                  </span>
                </button>

                <div className="caps mb-2">
                  {t.garments?.length ?? 0} garments
                </div>
                <div className="space-y-3">
                  {(t.garments ?? []).map((g, i) => (
                    <div key={g.name || i} className="card-glass p-4">
                      <div className="flex items-center gap-2">
                        <span className="chip">{g.garment_id || `G${i + 1}`}</span>
                        <span className="font-semibold">
                          {g.garment_type}
                          {g.color ? ` · ${g.color}` : ""}
                        </span>
                        <span className="ml-auto text-brass-light">{money(Number(g.garment_total) || 0)}</span>
                      </div>
                    </div>
                  ))}
                  {!t.garments?.length && (
                    <p className="text-cream-dim text-sm">Open full ticket for garment lines.</p>
                  )}
                </div>
              </div>

              <aside className="card-glass p-5 h-fit sticky top-4">
                <div className="caps">Ticket total</div>
                <div className="display text-4xl text-brass-light my-2">{money(total)}</div>
                <div className="text-xs text-cream-dim mb-4">
                  {t.payment_status === "Paid" ? "Paid in full" : unpaid ? "Collect at pickup" : t.payment_status}
                  {t.sales_invoice ? ` · ${t.sales_invoice}` : ""}
                </div>
                <p className="text-[11px] text-cream-dim mb-4">No tax — alterations are a service</p>

                {unpaid && (
                  <div className="space-y-2 mb-4">
                    <div className="caps text-signal-amber">Charge at Ready / pickup</div>
                    <button
                      type="button"
                      onClick={() => payLink.mutate()}
                      className="btn-brass w-full h-12 text-[11px]"
                    >
                      Send pay link
                    </button>
                    <button
                      type="button"
                      onClick={() => nav(`/orders/alterations/${selected}`)}
                      className="btn-ghost w-full h-12 text-[11px]"
                    >
                      Terminal / full ticket
                    </button>
                    <button
                      type="button"
                      onClick={() => smsUnpaid.mutate()}
                      className="btn-ghost w-full h-11 text-[10px] text-signal-amber border-signal-amber/30"
                    >
                      SMS unpaid balance
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={release.isPending || !confirmWho}
                  onClick={() => {
                    if (unpaid) {
                      const ok = window.confirm(
                        "Release without payment?\n\nClient can take garments. Unpaid SMS will send if balance remains.",
                      );
                      if (!ok) return;
                    }
                    release.mutate();
                  }}
                  className={cn(
                    "w-full h-14 rounded-2xl font-bold tracking-widest uppercase text-sm",
                    unpaid
                      ? "bg-signal-amber/90 text-forest-deep"
                      : "bg-signal-emerald text-forest-deep",
                    "disabled:opacity-40",
                  )}
                >
                  {release.isPending ? "…" : unpaid ? "Release unpaid" : "Release · Picked Up"}
                </button>
                <p className="text-[10px] text-cream-dim mt-3 text-center">
                  POD is separate — charge is never on proof of delivery.
                </p>
              </aside>
            </div>
          )}
          {selected && detail.isLoading && <div className="text-cream-dim">Loading ticket…</div>}
        </main>
      </div>
    </div>
  );
}
