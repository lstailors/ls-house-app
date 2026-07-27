import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

const GARMENT_TYPES = [
  "Jacket",
  "Trouser",
  "Shirt",
  "Dress",
  "Coat",
  "Vest",
  "Suit (2pc)",
  "Suit (3pc)",
  "Skirt",
  "Other",
] as const;

type Line = { id: string; description: string; price: number; estMinutes?: number | null; presetId?: string };
type Garment = { ref: string; garmentType: string; color: string; notes: string; lines: Line[] };
type CustomerHit = { id?: string; name: string; phone?: string; email?: string };

type Preset = {
  id: string;
  preset_name: string;
  garment_type?: string;
  garment_types?: string[];
  price: number;
  est_minutes?: number | null;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function IntakeStepped() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0); // 0 customer 1 garments 2 work 3 review
  const [origin, setOrigin] = useState<"NYC" | "HOU">("NYC");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [garments, setGarments] = useState<Garment[]>([]);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [notifyReady, setNotifyReady] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [billing, setBilling] = useState<"billable" | "on_order" | "redo">("billable");

  const search = useQuery({
    queryKey: ["cust-search", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const rows = await api.get<any[]>(`/api/intake-alterations/customers/search?q=${encodeURIComponent(q.trim())}`);
      return (rows ?? []).map((r: any) => ({
        id: r.name ?? r.id,
        name: r.customer_name ?? r.name,
        phone: r.mobile_no ?? r.phone ?? "",
        email: r.email_id ?? r.email ?? "",
      })) as CustomerHit[];
    },
  });

  const presets = useQuery({
    queryKey: ["presets", origin],
    queryFn: () => api.get<Preset[]>(`/api/intake-alterations/presets?origin=${origin}`),
  });

  const total = useMemo(
    () => garments.reduce((s, g) => s + g.lines.reduce((a, l) => a + (Number(l.price) || 0), 0), 0),
    [garments],
  );
  const lineCount = garments.reduce((s, g) => s + g.lines.length, 0);
  const active = garments.find((g) => g.ref === activeRef) ?? garments[0] ?? null;

  const addGarment = (type: string) => {
    const ref = `G${garments.length + 1}`;
    const g: Garment = { ref, garmentType: type, color: "", notes: "", lines: [] };
    setGarments((prev) => [...prev, g]);
    setActiveRef(ref);
    toast.success(`${type} added`);
    if (step < 2) setStep(2);
  };

  const togglePreset = (p: Preset) => {
    if (!active) return;
    setGarments((prev) =>
      prev.map((g) => {
        if (g.ref !== active.ref) return g;
        const exists = g.lines.find((l) => l.presetId === p.id);
        if (exists) return { ...g, lines: g.lines.filter((l) => l.presetId !== p.id) };
        return {
          ...g,
          lines: [
            ...g.lines,
            {
              id: uid(),
              description: p.preset_name,
              price: Number(p.price) || 0,
              estMinutes: p.est_minutes,
              presetId: p.id,
            },
          ],
        };
      }),
    );
  };

  const removeLine = (gRef: string, lineId: string) => {
    setGarments((prev) =>
      prev.map((g) => (g.ref === gRef ? { ...g, lines: g.lines.filter((l) => l.id !== lineId) } : g)),
    );
  };

  const filteredPresets = useMemo(() => {
    const all = presets.data ?? [];
    if (!active) return all;
    return all.filter((p) => {
      const types = p.garment_types ?? (p.garment_type ? [p.garment_type] : ["All"]);
      return types.includes("All") || types.includes(active.garmentType) || !p.garment_type;
    });
  }, [presets.data, active]);

  const create = useMutation({
    mutationFn: async (mode: "submit" | "park_pay_later") => {
      if (!customer && !newName.trim()) throw new Error("Pick or create a customer");
      if (garments.length === 0) throw new Error("Add at least one garment");
      if (lineCount === 0 && billing === "billable") throw new Error("Add work lines");

      const body: any = {
        origin,
        isRush: false,
        paymentMethod: mode === "park_pay_later" || billing !== "billable" ? "on_account" : "on_account",
        deposit: 0,
        garments: garments.map((g) => ({
          ref: g.ref,
          garmentType: g.garmentType,
          description: g.garmentType,
          color: g.color,
          notes: g.notes,
          lines: g.lines.map((l) => ({
            description: l.description,
            price: billing === "redo" ? 0 : l.price,
            estMinutes: l.estMinutes,
          })),
        })),
      };
      if (customer?.id) body.customer = { id: customer.id, name: customer.name };
      else body.newCustomer = { name: newName.trim(), phone: newPhone.trim() };

      // billing flags if backend ignores extra fields, still create ticket
      body.billing_status =
        billing === "on_order" ? "Included in Custom Order" : billing === "redo" ? "Warranty" : "Billable";
      body.included_in_custom = billing === "on_order" ? 1 : 0;

      const res = await api.post<{ ticketName: string }>("/api/intake-alterations/tickets", body);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Ticket ${res.ticketName} created`);
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
      if (notifyReady) {
        /* ready SMS is on status Ready — intake just created */
      }
      nav(`/orders/alterations/${res.ticketName}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const park = useMutation({
    mutationFn: async () => {
      if (!customer && !newName.trim()) throw new Error("Customer required to park");
      return api.post("/api/carts", {
        location: origin,
        label: customer?.name || newName || "Parked cart",
        customer: customer
          ? { name: customer.name, phone: customer.phone || "", email: customer.email || "" }
          : { name: newName, phone: newPhone, email: "" },
        customerRef: customer?.id ?? null,
        cart: {
          origin,
          billing,
          garments,
          notifyReady,
          total,
        },
      });
    },
    onSuccess: () => {
      toast.success("Parked — resume from Parked tray");
      nav("/parked");
    },
    onError: (e: Error) => toast.error(e.message || "Could not park"),
  });

  const steps = ["Customer", "Garments", "Work", "Review"] as const;

  return (
    <div className="alts-root flex flex-col min-h-screen">
      {/* header */}
      <header className="px-5 pt-4 pb-0 border-b border-brass/20">
        <div className="flex items-center gap-3 mb-3">
          <Link to="/" className="seal">
            LS
          </Link>
          <div>
            <div className="display text-lg">Alteration Intake</div>
            <div className="caps">
              {billing === "billable" ? "Client billable" : billing === "on_order" ? "On custom order · COGS" : "Re-do · $0"}
              {" · "}
              draft
            </div>
          </div>
          <div className="flex-1" />
          {(customer || newName) && (
            <div className="hidden md:flex items-center gap-2 rounded-full border border-brass/25 bg-black/25 px-3 py-1.5">
              <span className="w-8 h-8 rounded-full bg-forest-raised border border-brass/30 grid place-items-center text-[11px] font-bold text-brass-light">
                {(customer?.name || newName).slice(0, 2).toUpperCase()}
              </span>
              <span className="text-sm font-semibold">{customer?.name || newName}</span>
            </div>
          )}
          <div className="flex gap-1 rounded-full border border-brass/20 bg-black/30 p-1">
            {(["NYC", "HOU"] as const).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setOrigin(loc)}
                className={cn(
                  "px-3 py-2 rounded-full text-[11px] font-bold tracking-widest uppercase",
                  origin === loc ? "bg-brass text-forest-deep" : "text-cream-dim",
                )}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1 pb-3 overflow-x-auto">
          {steps.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap",
                i === step && "bg-brass/20 text-cream border border-brass/40",
                i < step && "text-signal-emerald",
                i > step && "text-cream-dim",
              )}
            >
              <span
                className={cn(
                  "w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold border",
                  i === step && "border-brass bg-brass text-forest-deep",
                  i < step && "border-signal-emerald bg-signal-emerald/20 text-signal-emerald",
                  i > step && "border-brass/30",
                )}
              >
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* stage */}
      <div className="flex-1 overflow-y-auto px-5 py-5 pb-36">
        {step === 0 && (
          <div className="max-w-2xl mx-auto space-y-5">
            <h2 className="display text-3xl">Who is this for?</h2>
            <p className="text-sm text-cream-dim">Search ERP customers or create new.</p>

            <div className="flex gap-2 flex-wrap">
              {(
                [
                  ["billable", "Billable"],
                  ["on_order", "On custom order"],
                  ["redo", "Re-do"],
                ] as const
              ).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBilling(k)}
                  className={cn(
                    "px-4 py-2.5 rounded-full text-xs font-bold tracking-wide uppercase border",
                    billing === k ? "bg-brass text-forest-deep border-brass" : "border-brass/30 text-cream-dim",
                  )}
                >
                  {lab}
                </button>
              ))}
            </div>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or phone…"
              className="w-full h-14 rounded-2xl bg-black/30 border border-brass/25 px-4 text-cream placeholder:text-cream-dim outline-none focus:border-brass/50"
            />
            <div className="space-y-2">
              {(search.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCustomer(c);
                    setStep(1);
                  }}
                  className="w-full text-left card-glass px-4 py-3.5 flex items-center gap-3"
                >
                  <span className="w-10 h-10 rounded-full bg-forest-raised border border-brass/30 grid place-items-center font-bold text-brass-light text-sm">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="text-xs text-cream-dim">{c.phone || "No phone"}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="pt-4 border-t border-brass/15 space-y-3">
              <div className="caps">Or new customer</div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="w-full h-12 rounded-xl bg-black/30 border border-brass/25 px-4 text-cream outline-none"
              />
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Mobile"
                className="w-full h-12 rounded-xl bg-black/30 border border-brass/25 px-4 text-cream outline-none"
              />
              <button
                type="button"
                disabled={!newName.trim()}
                onClick={() => {
                  setCustomer(null);
                  setStep(1);
                }}
                className="btn-brass h-12 px-6 disabled:opacity-40"
              >
                Continue with new client
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="max-w-3xl mx-auto">
            <h2 className="display text-3xl mb-1">
              What did {(customer?.name || newName || "they").split(" ")[0]} bring in?
            </h2>
            <p className="text-sm text-cream-dim mb-5">Tap each piece. Add multiples by tapping again.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {GARMENT_TYPES.map((t) => {
                const count = garments.filter((g) => g.garmentType === t).length;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addGarment(t)}
                    className="relative card-glass aspect-[3/4] flex flex-col items-center justify-center gap-2 p-3"
                  >
                    {count > 0 && (
                      <span className="absolute top-2 right-2 min-w-[28px] h-7 rounded-full bg-brass text-forest-deep text-sm font-bold grid place-items-center">
                        {count}
                      </span>
                    )}
                    <span className="text-3xl opacity-80">🧥</span>
                    <span className="text-sm font-semibold text-center">{t}</span>
                  </button>
                );
              })}
            </div>
            {garments.length > 0 && (
              <button type="button" onClick={() => setStep(2)} className="btn-brass mt-6 h-14 px-8">
                Price the work →
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="max-w-3xl mx-auto">
            <h2 className="display text-3xl mb-1">What needs doing?</h2>
            <p className="text-sm text-cream-dim mb-4">Presets from ERPNext · prices for {origin}</p>
            <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
              {garments.map((g) => (
                <button
                  key={g.ref}
                  type="button"
                  onClick={() => setActiveRef(g.ref)}
                  className={cn(
                    "min-w-[140px] card-glass p-3 text-left",
                    active?.ref === g.ref && "border-brass ring-1 ring-brass/40",
                  )}
                >
                  <span className="chip mb-2">{g.ref}</span>
                  <div className="font-semibold">{g.garmentType}</div>
                  <div className="text-brass-light text-sm mt-1">
                    {money(g.lines.reduce((s, l) => s + l.price, 0))}
                  </div>
                </button>
              ))}
              <button type="button" onClick={() => setStep(1)} className="min-w-[56px] card-glass grid place-items-center text-2xl text-brass">
                +
              </button>
            </div>
            <div className="space-y-2">
              {filteredPresets.map((p) => {
                const on = !!active?.lines.find((l) => l.presetId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePreset(p)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left",
                      on ? "border-brass bg-brass/15" : "border-brass/20 bg-black/20",
                    )}
                  >
                    <span
                      className={cn(
                        "w-7 h-7 rounded-full border grid place-items-center text-xs font-bold",
                        on ? "bg-brass text-forest-deep border-brass" : "border-brass/40 text-transparent",
                      )}
                    >
                      ✓
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{p.preset_name}</span>
                      <span className="text-xs text-cream-dim">{p.est_minutes ? `${p.est_minutes} min` : "—"}</span>
                    </span>
                    <span className="display text-xl text-brass-light">{money(Number(p.price) || 0)}</span>
                  </button>
                );
              })}
              {!presets.data?.length && !presets.isLoading && (
                <p className="text-cream-dim text-sm">No presets loaded — check API / ERP.</p>
              )}
            </div>
            <button type="button" onClick={() => setStep(3)} className="btn-brass mt-6 h-14 px-8">
              Review →
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="max-w-2xl mx-auto">
            <h2 className="display text-3xl mb-1">
              Read it back to {(customer?.name || newName || "the client").split(" ")[0]}
            </h2>
            <p className="text-sm text-cream-dim mb-5">Confirm before write to ERPNext.</p>
            <div className="card-glass p-4 space-y-3">
              {garments.map((g) => (
                <div key={g.ref}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="chip">{g.ref}</span>
                    <span className="font-semibold">
                      {g.garmentType}
                      {g.color ? ` — ${g.color}` : ""}
                    </span>
                    <span className="ml-auto text-brass-light">
                      {money(g.lines.reduce((s, l) => s + l.price, 0))}
                    </span>
                  </div>
                  {g.lines.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 pl-2 py-1.5 text-sm border-t border-brass/10">
                      <span className="flex-1 text-cream-muted">{l.description}</span>
                      <span className="text-cream">{money(l.price)}</span>
                      <button type="button" className="text-cream-dim px-2" onClick={() => removeLine(g.ref, l.id)}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              {billing !== "billable" && (
                <p className="text-xs text-signal-amber pt-2">
                  {billing === "on_order"
                    ? "On custom order — prices track COGS, no client charge."
                    : "Re-do — $0 to client."}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNotifyReady((v) => !v)}
              className="mt-4 w-full card-glass px-4 py-3.5 flex items-center gap-3 text-left"
            >
              <span className="text-lg">✉</span>
              <span className="flex-1">
                <span className="block font-semibold">Text when ready</span>
                <span className="text-xs text-cream-dim">
                  SMS to {customer?.phone || newPhone || "phone on file"}
                </span>
              </span>
              <span
                className={cn(
                  "w-12 h-7 rounded-full p-1 transition-colors",
                  notifyReady ? "bg-brass" : "bg-white/10",
                )}
              >
                <span
                  className={cn(
                    "block w-5 h-5 rounded-full bg-forest-deep transition-transform",
                    notifyReady && "translate-x-5",
                  )}
                />
              </span>
            </button>
          </div>
        )}
      </div>

      {/* sticky bar */}
      <div className="fixed bottom-0 inset-x-0 border-t border-brass/20 bg-forest-deep/95 backdrop-blur-xl px-4 py-3 flex items-center gap-3 z-40">
        <button type="button" onClick={() => setCartOpen(true)} className="flex items-center gap-3 min-w-0">
          <span className="relative w-11 h-11 rounded-xl border border-brass/30 grid place-items-center text-brass-light">
            👜
            <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] rounded-full bg-brass text-forest-deep text-[11px] font-bold grid place-items-center">
              {lineCount}
            </span>
          </span>
          <span className="text-left">
            <span className="caps block">Ticket total</span>
            <span className="display text-2xl text-brass-light leading-none">{money(total)}</span>
          </span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => park.mutate()}
          disabled={park.isPending}
          className="btn-ghost h-12 px-4 text-[11px] hidden sm:inline-flex items-center"
        >
          Park
        </button>
        <button
          type="button"
          onClick={() => create.mutate("submit")}
          disabled={create.isPending || garments.length === 0}
          className="btn-brass h-12 px-5 text-[11px] disabled:opacity-40"
        >
          {create.isPending ? "Writing…" : billing === "billable" ? "Submit ticket →" : "Submit (no charge) →"}
        </button>
      </div>

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-lg max-h-[70vh] overflow-y-auto rounded-t-3xl border border-brass/25 bg-[#0f2218] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-brass/40 mx-auto mb-4" />
            <div className="flex items-center mb-4">
              <h3 className="display text-2xl">
                Ticket — {garments.length} garments, {lineCount} lines
              </h3>
              <button type="button" className="ml-auto text-cream-dim" onClick={() => setCartOpen(false)}>
                ✕
              </button>
            </div>
            {garments.map((g) => (
              <div key={g.ref} className="mb-3">
                <div className="font-semibold text-sm mb-1">
                  {g.ref} · {g.garmentType}
                </div>
                {g.lines.map((l) => (
                  <div key={l.id} className="flex text-sm text-cream-muted py-1">
                    <span className="flex-1">{l.description}</span>
                    <span>{money(l.price)}</span>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-xs text-cream-dim mt-3">No tax — alterations are a service, not goods.</p>
            <div className="display text-3xl text-brass-light mt-4">{money(total)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
