import { useState, type CSSProperties } from "react";
import { api } from "@ls/api-client";
import type { ParkedCart, CartPayload } from "@/lib/cart/parked";
import type { CustomerInput } from "@/lib/erpnext/customer";

const CREAM = "#F1E9D6", DIM = "rgba(241,233,214,0.5)", BRASS = "#B08D57", PANEL = "#14271C";

interface Snapshot { customer: Partial<CustomerInput>; customerRef?: string | null; cart: CartPayload; }

export function SaveCartControls(props: {
  createdBy: string; location: string; activeCartId?: string;
  snapshot: () => Snapshot; onSaved?: (c: ParkedCart) => void; onResume: (c: ParkedCart) => void; onCommitted: (ticket: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [carts, setCarts] = useState<ParkedCart[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  function handleSave() {
    const snap = props.snapshot();
    void withBusy(async () => {
      try {
        const saved = await api.post<ParkedCart>("/api/carts", {
          id: props.activeCartId,
          createdBy: props.createdBy,
          location: props.location,
          customer: snap.customer,
          customerRef: snap.customerRef,
          cart: snap.cart,
        });
        props.onSaved?.(saved);
        flash("Cart saved");
      } catch (e: any) {
        flash(e?.message ?? "Save failed");
      }
    });
  }

  function openDrawer() {
    setOpen(true);
    void withBusy(async () => {
      try {
        const url = new URL("/api/carts", window.location.origin);
        url.searchParams.set("location", props.location);
        const next = await api.get<ParkedCart[]>(url.pathname + url.search);
        setCarts(next);
      } catch (e: any) {
        flash(e?.message ?? "Could not load saved carts");
      }
    });
  }

  function handleResume(id: string) {
    void withBusy(async () => {
      try {
        const cart = await api.get<ParkedCart>(`/api/carts/${id}`);
        props.onResume(cart);
        setOpen(false);
      } catch (e: any) {
        flash(e?.message ?? "Resume failed");
      }
    });
  }

// HER-62: Checkout/commit removed — no billing_status on commitParkedCart.
  function handleRemove(id: string) {
    void withBusy(async () => {
      try {
        await api.delete(`/api/carts/${id}`);
        setCarts((c) => c.filter((x) => x.id !== id));
      } catch (e: any) {
        flash(e?.message ?? "Remove failed");
      }
    });
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={handleSave} disabled={busy} style={btn}>Save cart</button>
        <button onClick={openDrawer} disabled={busy} style={btnGhost}>Saved carts</button>
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: PANEL, color: CREAM, border: `0.5px solid ${BRASS}55`, borderRadius: 10, padding: "10px 16px", fontSize: 13, zIndex: 60 }}>
          {toast}
        </div>
      )}
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 420, maxWidth: "90vw", background: PANEL, borderLeft: `0.5px solid ${BRASS}40`, padding: 24, overflowY: "auto", color: CREAM }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 18 }}>Saved carts · {props.location}</span>
              <button onClick={() => setOpen(false)} style={{ ...btnGhost, padding: "4px 10px" }}>Close</button>
            </div>
            {carts.length === 0 && <p style={{ color: DIM, fontSize: 14 }}>No parked carts.</p>}
            {carts.map((c) => (
              <div key={c.id} style={{ border: "0.5px solid rgba(241,233,214,0.12)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 15 }}>{c.label ?? "Walk-in"}</div>
                <div style={{ fontSize: 12, color: DIM, marginBottom: 10 }}>
                  {c.cart?.garments?.length ?? 0} garments · {c.cart?.lines?.length ?? 0} alterations · saved {timeAgo(c.updated_at)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleResume(c.id)} disabled={busy} style={{ ...btn, flex: 1 }}>Resume</button>
                  {/* Checkout/commit hidden HER-62 — no billing_status on commitParkedCart */}
                  <button onClick={() => handleRemove(c.id)} disabled={busy} aria-label="Remove" style={{ ...btnGhost, padding: "8px 12px" }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const btn: CSSProperties = { background: BRASS, color: "#0D1A10", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer", minHeight: 44 };
const btnGhost: CSSProperties = { background: "transparent", color: CREAM, border: `0.5px solid ${BRASS}66`, borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer", minHeight: 44 };

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
