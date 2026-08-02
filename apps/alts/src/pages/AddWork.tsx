/**
 * SPEC 014 — Add work to a live alteration ticket.
 * Mock: ~/ls-design/alts-pos/014-add-work
 * Writes via PATCH /api/alterations/:id/full — same ticket number; finished lines locked.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";

type Preset = {
  id: string;
  preset_name: string;
  price: number;
  est_minutes?: number | null;
  garment_types?: string[];
};

type TicketLine = {
  name?: string;
  garment_ref: string;
  description: string;
  price: number;
  preset?: string | null;
  line_status?: string | null;
  line_notes?: string | null;
  estimated_minutes?: number | null;
  client_line_key?: string | null;
};

type TicketGarment = {
  name?: string;
  garment_id: string;
  garment_type: string;
  garment_description?: string;
  color?: string;
  fabric_notes?: string;
  garment_status?: string;
};

type TicketDoc = {
  name: string;
  customer_name?: string;
  workflow_state?: string;
  due_date?: string;
  ticket_total?: number;
  sales_invoice?: string | null;
  billing_status?: string;
  garments?: TicketGarment[];
  lines?: TicketLine[];
};

function isDone(status?: string | null) {
  const s = (status || "").toLowerCase();
  return s === "done" || s === "ready" || s === "complete" || s === "completed";
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

function addDays(iso: string | undefined, days: number): string {
  const base = iso ? new Date(iso + "T12:00:00") : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function fmtShort(iso?: string) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function AddWork() {
  const { ticketName = "" } = useParams<{ ticketName: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [garmentId, setGarmentId] = useState<string | null>(null);
  const [pendingAdds, setPendingAdds] = useState<
    Array<{ key: string; description: string; price: number; preset?: string | null; minutes?: number }>
  >([]);
  const [customDesc, setCustomDesc] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [pushDue, setPushDue] = useState(false);
  const [notify, setNotify] = useState<"sms" | "told">("told");
  const [busy, setBusy] = useState(false);

  const ticketQ = useQuery({
    queryKey: ["ticket", ticketName],
    queryFn: () => api.get<TicketDoc>(`/api/intake-alterations/tickets/${encodeURIComponent(ticketName)}`),
    enabled: !!ticketName,
  });

  const presetsQ = useQuery({
    queryKey: ["presets", "NYC"],
    queryFn: () => api.get<Preset[]>("/api/intake-alterations/presets?origin=NYC"),
  });

  const ticket = ticketQ.data;
  const garments = ticket?.garments ?? [];
  const lines = ticket?.lines ?? [];
  const blocked =
    ticket?.workflow_state === "Cancelled" || ticket?.workflow_state === "Picked Up";

  const selected = garments.find((g) => g.garment_id === garmentId) ?? null;
  const garmentLines = useMemo(
    () => lines.filter((l) => l.garment_ref === garmentId),
    [lines, garmentId],
  );
  const locked = garmentLines.filter((l) => isDone(l.line_status));
  const openLines = garmentLines.filter((l) => !isDone(l.line_status));

  const originalTotal = Number(ticket?.ticket_total) || lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
  const addedNow = pendingAdds.reduce((s, a) => s + a.price, 0);
  const newTotal = originalTotal + addedNow;
  const newDue = pushDue ? addDays(ticket?.due_date, 3) : ticket?.due_date;

  const presetsForGarment = useMemo(() => {
    const list = presetsQ.data ?? [];
    if (!selected) return list;
    const gt = (selected.garment_type || "").toLowerCase();
    return list.filter((p) => {
      const types = (p.garment_types ?? []).map((t) => t.toLowerCase());
      if (!types.length || types.includes("all")) return true;
      return types.some((t) => t === gt || gt.includes(t) || t.includes(gt));
    });
  }, [presetsQ.data, selected]);

  function addPreset(p: Preset) {
    const price = Number(p.price) || 0;
    if (price <= 0) {
      toast.error("Preset has no price");
      return;
    }
    setPendingAdds((prev) => {
      const exists = prev.find((x) => x.preset === p.id || x.description === p.preset_name);
      if (exists) return prev.filter((x) => x.key !== exists.key);
      return [
        ...prev,
        {
          key: `p-${p.id}-${Date.now()}`,
          description: p.preset_name,
          price,
          preset: p.id,
          minutes: p.est_minutes ?? 15,
        },
      ];
    });
  }

  function addCustom() {
    const desc = customDesc.trim();
    const price = Number(customPrice);
    if (!desc) {
      toast.error("Describe the custom line");
      return;
    }
    if (!(price > 0)) {
      toast.error("Custom line needs a price > $0 (free work = Re-do ticket)");
      return;
    }
    setPendingAdds((prev) => [
      ...prev,
      { key: `c-${Date.now()}`, description: desc, price, preset: null, minutes: 15 },
    ]);
    setCustomDesc("");
    setCustomPrice("");
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!ticket || !selected || !garmentId) throw new Error("Pick a garment");
      if (!pendingAdds.length) throw new Error("Add at least one line");
      if (blocked) throw new Error(`Ticket is ${ticket.workflow_state} — reopen before adding work`);

      const garmentsOut = garments.map((g) => ({
        garment_id: g.garment_id,
        garment_type: g.garment_type,
        garment_description: g.garment_description || g.garment_type,
        color: g.color || "",
        fabric_notes: g.fabric_notes || "",
        garment_status: g.garment_status,
      }));

      const linesOut = [
        ...lines.map((l) => ({
          name: l.name,
          garment_ref: l.garment_ref,
          description: l.description,
          price: Number(l.price) || 0,
          preset: l.preset ?? null,
          line_notes: l.line_notes ?? null,
          estimated_minutes: l.estimated_minutes ?? 15,
          line_status: l.line_status ?? "Pending",
          client_line_key: l.client_line_key ?? null,
        })),
        ...pendingAdds.map((a) => ({
          garment_ref: garmentId,
          description: a.description,
          price: a.price,
          preset: a.preset ?? null,
          estimated_minutes: a.minutes ?? 15,
          line_status: "Pending",
          client_line_key: a.key,
        })),
      ];

      const res = await api.raw(`/api/alterations/${encodeURIComponent(ticket.name)}/full`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garments: garmentsOut, lines: linesOut }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error?.message || body?.error || "Could not update ticket");
      }

      if (pushDue && newDue && newDue !== ticket.due_date) {
        await api
          .patch(`/api/intake-alterations/tickets/${encodeURIComponent(ticket.name)}/due-date`, {
            due_date: newDue,
          })
          .catch(() => {
            toast.error("Lines saved but due date update failed");
          });
      }

      if (notify === "sms") {
        const msg = `Hi — we added work on your L&S ticket ${ticket.name}: ${pendingAdds
          .map((a) => a.description)
          .join(", ")}. New total ${money(newTotal)}${
          pushDue && newDue ? ` · new due ${fmtShort(newDue)}` : ""
        }.`;
        await api
          .post(`/api/intake-alterations/tickets/${encodeURIComponent(ticket.name)}/sms`, {
            message: msg,
          })
          .catch(() => {
            throw new Error("Work saved but SMS failed — tell the client manually");
          });
      }

      return body;
    },
    onSuccess: async () => {
      toast.success(
        `Added ${pendingAdds.length} line${pendingAdds.length === 1 ? "" : "s"} · ${money(addedNow)}`,
      );
      await qc.invalidateQueries({ queryKey: ["ticket", ticketName] });
      await qc.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
      nav(`/orders/alterations/${encodeURIComponent(ticketName)}`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  if (ticketQ.isError) {
    return (
      <div className="alts-root min-h-dvh p-5">
        <QueryErrorPanel title="Could not load ticket" onRetry={() => ticketQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="alts-root min-h-dvh flex flex-col bg-forest-deep text-cream">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 shrink-0">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="h-11 w-11 rounded-full border border-brass/25 flex items-center justify-center text-cream-dim hover:text-cream"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-xl leading-none">Add work</div>
          <div className="caps truncate mt-1">
            {ticket?.workflow_state || "…"} · {ticketName}
            {ticket?.customer_name ? ` · ${ticket.customer_name}` : ""}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5 pb-40">
        {ticketQ.isLoading && (
          <div className="flex items-center gap-2 text-cream-dim text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading ticket…
          </div>
        )}

        {blocked && (
          <div className="card-glass border border-signal-amber/40 p-4 text-sm text-signal-amber">
            Ticket is {ticket?.workflow_state}. Reopen before adding work.
          </div>
        )}

        {/* Garment picker */}
        <section>
          <div className="caps mb-2">Which garment is the new work on?</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {garments.map((g) => {
              const count = lines.filter((l) => l.garment_ref === g.garment_id).length;
              const active = garmentId === g.garment_id;
              return (
                <button
                  key={g.garment_id}
                  type="button"
                  onClick={() => setGarmentId(g.garment_id)}
                  className={cn(
                    "text-left card-glass p-3.5 min-h-11 border transition-colors",
                    active ? "border-brass ring-1 ring-brass/40" : "border-brass/20",
                  )}
                >
                  <div className="font-semibold truncate">
                    {g.color ? `${g.color} ` : ""}
                    {g.garment_description || g.garment_type}
                  </div>
                  <div className="text-[12px] text-cream-dim mt-1 flex gap-2 flex-wrap">
                    <span className="font-mono text-brass-light">{g.garment_id}</span>
                    <span>· {count} line{count === 1 ? "" : "s"}</span>
                    {g.garment_status && <span className="chip">{g.garment_status}</span>}
                  </div>
                </button>
              );
            })}
            {!garments.length && !ticketQ.isLoading && (
              <p className="text-cream-dim text-sm italic">No garments on this ticket.</p>
            )}
          </div>
        </section>

        {selected && (
          <>
            {/* Existing lines */}
            <section className="card-glass p-4 space-y-3">
              <div className="caps">
                {selected.garment_description || selected.garment_type} · work list
              </div>
              {locked.map((l) => (
                <div
                  key={l.name || l.description}
                  className="flex items-center gap-2 opacity-60 border-b border-brass/10 pb-2"
                >
                  <Lock size={14} className="text-cream-dim shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{l.description}</div>
                    <div className="text-[12px] text-cream-dim">Finished · locked</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{money(Number(l.price))}</div>
                </div>
              ))}
              {openLines.map((l) => (
                <div
                  key={l.name || l.description}
                  className="flex items-center gap-2 border-b border-brass/10 pb-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{l.description}</div>
                    <div className="text-[12px] text-cream-dim">{l.line_status || "Open"}</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{money(Number(l.price))}</div>
                </div>
              ))}
              {pendingAdds.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setPendingAdds((p) => p.filter((x) => x.key !== a.key))}
                  className="w-full flex items-center gap-2 border border-brass/40 bg-brass/10 rounded-xl px-3 py-2.5 text-left min-h-11"
                >
                  <span className="chip bg-brass/20 text-brass">New</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{a.description}</div>
                    <div className="text-[12px] text-cream-dim">Added · tap to remove</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-brass">
                    {money(a.price)}
                  </div>
                </button>
              ))}
              {!locked.length && !openLines.length && !pendingAdds.length && (
                <p className="text-cream-dim text-sm italic">No lines yet on this garment.</p>
              )}
            </section>

            {/* Presets */}
            <section>
              <div className="caps mb-2">Add to this garment</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {presetsForGarment.slice(0, 24).map((p) => {
                  const on = pendingAdds.some(
                    (a) => a.preset === p.id || a.description === p.preset_name,
                  );
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addPreset(p)}
                      className={cn(
                        "text-left rounded-xl border px-3 py-3 min-h-11 transition-colors",
                        on
                          ? "border-brass bg-brass/15"
                          : "border-brass/25 bg-black/25 hover:border-brass/40",
                      )}
                    >
                      <div className="text-sm font-semibold truncate">{p.preset_name}</div>
                      <div className="text-[12px] text-brass-light mt-0.5">{money(Number(p.price))}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 card-glass p-3 space-y-2">
                <div className="caps">Custom line</div>
                <input
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  placeholder="Describe work"
                  className="w-full h-11 rounded-xl bg-black/30 border border-brass/25 px-3 text-sm text-cream outline-none"
                />
                <div className="flex gap-2">
                  <input
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="Price"
                    className="w-28 h-11 rounded-xl bg-black/30 border border-brass/25 px-3 text-sm text-cream outline-none"
                  />
                  <button
                    type="button"
                    onClick={addCustom}
                    className="btn-ghost h-11 px-4 text-[12px] inline-flex items-center gap-1"
                  >
                    <Plus size={14} /> Add custom
                  </button>
                </div>
              </div>
            </section>

            {/* Totals + due + notify */}
            <section className="card-glass p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-cream-dim">Original work</span>
                <span className="tabular-nums">{money(originalTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-cream-dim">
                  Added now · {pendingAdds.length} line{pendingAdds.length === 1 ? "" : "s"}
                </span>
                <span className="tabular-nums text-brass">+{money(addedNow)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold border-t border-brass/15 pt-3">
                <span>New total at pickup</span>
                <span className="tabular-nums">{money(newTotal)}</span>
              </div>
              {ticket?.sales_invoice && (
                <div className="text-[12px] text-cream-dim">
                  {ticket.sales_invoice} will be amended (not replaced). No tax — service.
                </div>
              )}

              <label className="flex items-start gap-3 min-h-11 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pushDue}
                  onChange={(e) => setPushDue(e.target.checked)}
                  className="mt-1 accent-[var(--brass,#B08D57)]"
                />
                <span className="text-sm">
                  Push due date
                  <span className="block text-[12px] text-cream-dim mt-0.5">
                    {fmtShort(ticket?.due_date)} → {fmtShort(newDue)} (scope change buffer)
                  </span>
                </span>
              </label>

              <div className="caps pt-1">Tell the client?</div>
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["sms", "SMS the change"],
                    ["told", "Already told them"],
                  ] as const
                ).map(([k, lab]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNotify(k)}
                    className={cn(
                      "h-11 rounded-xl border text-sm font-semibold text-left px-4",
                      notify === k
                        ? "border-brass bg-brass/15 text-cream"
                        : "border-brass/25 text-cream-dim",
                    )}
                  >
                    {lab}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 inset-x-0 border-t border-brass/20 bg-forest-deep/95 backdrop-blur-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-2">
          <Link
            to={`/orders/alterations/${encodeURIComponent(ticketName)}`}
            className="btn-ghost h-12 px-4 text-[12px] inline-flex items-center justify-center"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={
              busy ||
              save.isPending ||
              !selected ||
              !pendingAdds.length ||
              blocked ||
              ticketQ.isLoading
            }
            onClick={() => void withBusy(async () => { await save.mutateAsync(); })}
            className="btn-brass flex-1 h-12 text-[12px] disabled:opacity-40"
          >
            {save.isPending || busy
              ? "Saving…"
              : `Add line & update ticket · +${money(addedNow)}${
                  pushDue && newDue ? ` · NEW DUE ${fmtShort(newDue).toUpperCase()}` : ""
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
