/**
 * Intake delivery block — Pickup | Hand delivery | Ship FedEx + zone quote.
 * SPEC delivery-scheduling-zones Part 7 / 9. Address autocomplete via /api/places.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import AddressAutocomplete from "./AddressAutocomplete";

export type DeliverySelection = {
  delivery_method: "Pickup" | "Hand Delivery" | "Ship (FedEx)";
  delivery_scheduled: boolean;
  delivery_requested_date?: string;
  delivery_time_window?: string;
  delivery_address?: string;
  delivery_apt?: string;
  delivery_city?: string;
  delivery_state?: string;
  delivery_zip?: string;
  delivery_notes?: string;
  delivery_fee?: number;
  delivery_fee_override?: boolean;
  delivery_fee_override_reason?: string;
  /** resolved server-side; UI may stash for display */
  _zone?: string | null;
  _zone_name?: string | null;
  _fee?: number;
  _status?: "in_zone" | "out_of_zone" | "invalid" | "idle";
};

const WINDOWS = ["Morning (9–12)", "Afternoon (12–4)", "Evening (4–7)", "Anytime"] as const;

type Props = {
  value: DeliverySelection;
  onChange: (v: DeliverySelection) => void;
  dueDate?: string;
  freeCustom?: boolean;
  canOverrideFee?: boolean;
  className?: string;
};

export default function DeliveryBlock({
  value,
  onChange,
  dueDate,
  freeCustom,
  canOverrideFee,
  className,
}: Props) {
  const [resolving, setResolving] = useState(false);

  const set = (patch: Partial<DeliverySelection>) => onChange({ ...value, ...patch });

  // Resolve zone when ZIP changes
  useEffect(() => {
    if (value.delivery_method !== "Hand Delivery") return;
    const zip = (value.delivery_zip || "").replace(/\D/g, "").slice(0, 5);
    if (zip.length !== 5) {
      if (value._status !== "idle") set({ _status: "idle", _zone: null, _zone_name: null, _fee: 0 });
      return;
    }
    let cancelled = false;
    setResolving(true);
    (async () => {
      try {
        const res = await api.raw(
          `/api/delivery-zones/resolve?zip=${encodeURIComponent(zip)}&origin=NYC`,
        );
        const json = (await res.json()) as {
          data?: {
            status: string;
            zone?: string;
            zone_name?: string;
            fee?: number;
          };
        };
        if (cancelled) return;
        const d = json.data;
        if (!d) return;
        if (d.status === "in_zone") {
          set({
            _status: "in_zone",
            _zone: d.zone,
            _zone_name: d.zone_name,
            _fee: freeCustom ? 0 : Number(d.fee) || 0,
            delivery_fee: freeCustom || value.delivery_fee_override ? value.delivery_fee : Number(d.fee) || 0,
            delivery_scheduled: true,
          });
        } else if (d.status === "out_of_zone") {
          set({
            _status: "out_of_zone",
            _zone: null,
            _zone_name: null,
            _fee: 0,
            delivery_method: "Ship (FedEx)",
            delivery_scheduled: true,
          });
        } else {
          set({ _status: "invalid", _zone: null, _zone_name: null, _fee: 0 });
        }
      } catch {
        if (!cancelled) set({ _status: "idle" });
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.delivery_zip, value.delivery_method, freeCustom]);

  const methods = useMemo(
    () =>
      [
        { id: "Pickup" as const, label: "Pickup at shop" },
        { id: "Hand Delivery" as const, label: "Hand delivery" },
        { id: "Ship (FedEx)" as const, label: "Ship — FedEx" },
      ] as const,
    [],
  );

  const showForm = value.delivery_method !== "Pickup";
  const minDate = new Date().toISOString().slice(0, 10);

  return (
    <div className={cn("rounded-2xl border border-brass/25 bg-forest-deep/40 p-4 space-y-3", className)}>
      <div className="caps text-brass-light text-[10px] tracking-[0.18em]">Delivery</div>

      <div className="space-y-2">
        {methods.map((m) => {
          const on = value.delivery_method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                set({
                  delivery_method: m.id,
                  delivery_scheduled: m.id !== "Pickup",
                  ...(m.id === "Pickup"
                    ? {
                        _status: "idle",
                        _zone: null,
                        _fee: 0,
                        delivery_fee: 0,
                      }
                    : {}),
                })
              }
              className={cn(
                "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                on ? "border-brass bg-brass/15 text-cream" : "border-white/10 text-cream-dim hover:border-brass/40",
              )}
            >
              <span
                className={cn(
                  "w-4 h-4 rounded-full border-2 grid place-items-center",
                  on ? "border-brass" : "border-cream-dim/40",
                )}
              >
                {on ? <span className="w-2 h-2 rounded-full bg-brass" /> : null}
              </span>
              <span className="text-sm font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>

      {showForm && (
        <div className="space-y-3 pt-1 border-t border-white/10">
          <div className="grid grid-cols-1 gap-2">
            <label className="block">
              <span className="caps text-[9px] text-cream-dim">Street address</span>
              <AddressAutocomplete
                value={value.delivery_address || ""}
                onChange={(street) => set({ delivery_address: street, delivery_scheduled: true })}
                onPick={(addr) =>
                  set({
                    delivery_address: addr.street,
                    delivery_city: addr.city || value.delivery_city || "New York",
                    delivery_state: addr.state || value.delivery_state || "NY",
                    delivery_zip: addr.zip
                      ? addr.zip.replace(/\D/g, "").slice(0, 5)
                      : value.delivery_zip,
                    delivery_scheduled: true,
                  })
                }
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block col-span-1">
                <span className="caps text-[9px] text-cream-dim">Apt</span>
                <input
                  className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
                  value={value.delivery_apt || ""}
                  onChange={(e) => set({ delivery_apt: e.target.value })}
                />
              </label>
              <label className="block col-span-2">
                <span className="caps text-[9px] text-cream-dim">ZIP</span>
                <input
                  className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream tracking-wider"
                  value={value.delivery_zip || ""}
                  onChange={(e) =>
                    set({
                      delivery_zip: e.target.value.replace(/\D/g, "").slice(0, 5),
                      delivery_city: value.delivery_city || "New York",
                      delivery_state: value.delivery_state || "NY",
                    })
                  }
                  inputMode="numeric"
                  placeholder="10065"
                />
              </label>
            </div>
          </div>

          {/* Zone card / FedEx / free custom */}
          {value.delivery_method === "Hand Delivery" && (
            <div
              className={cn(
                "rounded-xl border px-3 py-3",
                freeCustom
                  ? "border-brass/50 bg-brass/10"
                  : value._status === "in_zone"
                    ? "border-brass/40 bg-forest/60"
                    : value._status === "invalid"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-white/10 bg-black/20",
              )}
            >
              {resolving ? (
                <p className="text-xs text-cream-dim">Looking up zone…</p>
              ) : freeCustom && value._status === "in_zone" ? (
                <>
                  <p className="text-[10px] caps text-brass-light tracking-wider">
                    {value._zone} · {value._zone_name}
                  </p>
                  <p className="display text-xl text-brass mt-1">Included — no charge</p>
                  <p className="text-[11px] text-cream-dim mt-0.5">Zone stored for cost tracking</p>
                </>
              ) : value._status === "in_zone" ? (
                <>
                  <p className="text-[10px] caps text-brass-light tracking-wider">
                    {value._zone} · {value._zone_name}
                  </p>
                  <p className="display text-2xl text-cream mt-1">
                    ${Number(value.delivery_fee_override ? value.delivery_fee : value._fee || 0).toFixed(0)}
                  </p>
                </>
              ) : value._status === "invalid" ? (
                <p className="text-xs text-amber-200">Enter a valid 5-digit ZIP</p>
              ) : (
                <p className="text-xs text-cream-dim">Enter ZIP for zone quote</p>
              )}
            </div>
          )}

          {value.delivery_method === "Ship (FedEx)" && (
            <div className="rounded-xl border border-white/15 bg-black/25 px-3 py-3 space-y-2">
              <p className="text-sm text-cream font-medium">Ship — FedEx</p>
              <p className="text-[11px] text-cream-dim">
                {value._status === "out_of_zone"
                  ? "ZIP is outside Manhattan hand-delivery zones. Enter the fee quoted to the client."
                  : "Manual rate for this ticket (live FedEx rates = phase 2)."}
              </p>
              {!freeCustom && (
                <label className="block">
                  <span className="caps text-[9px] text-cream-dim">Shipping fee $</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
                    value={value.delivery_fee ?? ""}
                    onChange={(e) =>
                      set({
                        delivery_fee: e.target.value === "" ? 0 : Number(e.target.value),
                        delivery_fee_override: true,
                      })
                    }
                  />
                </label>
              )}
              {freeCustom && (
                <p className="display text-lg text-brass">Included — no charge</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="caps text-[9px] text-cream-dim">Date</span>
              <input
                type="date"
                min={minDate}
                className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
                value={value.delivery_requested_date || ""}
                onChange={(e) => set({ delivery_requested_date: e.target.value })}
              />
              {dueDate &&
                value.delivery_requested_date &&
                value.delivery_requested_date < dueDate && (
                  <p className="text-[10px] text-amber-300/90 mt-1">Before due date — ok if intentional</p>
                )}
            </label>
            <label className="block">
              <span className="caps text-[9px] text-cream-dim">Window</span>
              <select
                className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
                value={value.delivery_time_window || "Anytime"}
                onChange={(e) => set({ delivery_time_window: e.target.value })}
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="caps text-[9px] text-cream-dim">Notes (doorman, buzzer…)</span>
            <input
              className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
              value={value.delivery_notes || ""}
              onChange={(e) => set({ delivery_notes: e.target.value })}
            />
          </label>

          {canOverrideFee && value.delivery_method === "Hand Delivery" && value._status === "in_zone" && !freeCustom && (
            <div className="rounded-lg border border-white/10 p-2 space-y-2">
              <label className="flex items-center gap-2 text-xs text-cream-dim">
                <input
                  type="checkbox"
                  checked={Boolean(value.delivery_fee_override)}
                  onChange={(e) =>
                    set({
                      delivery_fee_override: e.target.checked,
                      delivery_fee: e.target.checked ? value.delivery_fee ?? value._fee : value._fee,
                    })
                  }
                />
                Manager override fee
              </label>
              {value.delivery_fee_override && (
                <>
                  <input
                    type="number"
                    className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
                    value={value.delivery_fee ?? 0}
                    onChange={(e) => set({ delivery_fee: Number(e.target.value) || 0 })}
                  />
                  <input
                    className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
                    placeholder="Override reason (required)"
                    value={value.delivery_fee_override_reason || ""}
                    onChange={(e) => set({ delivery_fee_override_reason: e.target.value })}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const emptyDelivery = (): DeliverySelection => ({
  delivery_method: "Pickup",
  delivery_scheduled: false,
  delivery_time_window: "Anytime",
  delivery_city: "New York",
  delivery_state: "NY",
  _status: "idle",
  _fee: 0,
});
