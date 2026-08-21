/**
 * Parked cart hold slip — 80mm thermal / browser print.
 * Not a real ticket (no ALT- number). Resume from Parked tray to finish.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Zap } from "lucide-react";
import { toast } from "sonner";
import { api } from "@ls/api-client";

type ParkedDoc = {
  id: string;
  location?: string;
  label?: string | null;
  customer_ref?: string | null;
  customer_snapshot?: {
    fullName?: string;
    name?: string;
    phone?: string;
    email?: string;
  };
  cart?: {
    total?: number;
    intake?: {
      parkLabel?: string;
      parkNote?: string;
      billing?: string;
      promiseDate?: string;
      promiseTime?: string;
      endCustomer?: string;
      garments?: Array<{
        ref?: string;
        garmentType?: string;
        color?: string;
        notes?: string;
        lines?: Array<{ description?: string; price?: number }>;
      }>;
      sellItems?: Array<{
        item_name?: string;
        qty?: number;
        rate?: number;
      }>;
    };
    garments?: Array<{ garmentId?: string; garmentType?: string; color?: string; total?: number }>;
    lines?: Array<{ garmentRef?: string; description?: string; price?: number }>;
  };
  updated_at?: string;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtWhen(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Cormorant+Garamond:ital,wght@0,600;1,600&display=swap');
* { box-sizing: border-box; }
body { margin: 0; }
@media print {
  @page { size: 80mm auto; margin: 0; }
  html, body { background: #fff !important; margin: 0 !important; }
  .no-print { display: none !important; }
  .stage { padding: 0 !important; background: #fff !important; }
  .paper {
    width: 80mm !important;
    max-width: none !important;
    box-shadow: none !important;
    margin: 0 auto !important;
  }
}
.paper {
  background: #fff;
  color: #000;
  font-family: Montserrat, system-ui, sans-serif;
  padding: 18px 16px 22px;
  width: 340px;
  -webkit-font-smoothing: antialiased;
}
`;

export default function ParkedCartPrint() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [printing, setPrinting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["parked-print", id],
    queryFn: () => api.get<ParkedDoc>(`/api/carts/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });

  const printEpson = async () => {
    if (!id || printing) return;
    setPrinting(true);
    try {
      // Same pattern as ThermalTicketPrint — /api/print/* returns { ok }, not { data }.
      const res = await api.raw("/api/print/parked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart_id: id }),
      });
      const result = await res.json().catch(() => ({}));
      if (!result.ok) throw new Error(result.error ?? "Print failed");
      toast.success("Hold slip sent to Epson");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Epson print failed");
    } finally {
      setPrinting(false);
    }
  };

  const view = useMemo(() => {
    if (!data) return null;
    const snap = data.customer_snapshot || {};
    const intake = data.cart?.intake;
    const customer =
      snap.fullName ||
      snap.name ||
      data.label ||
      intake?.parkLabel ||
      "Walk-in";
    const phone = snap.phone || "";
    const endCustomer = (intake?.endCustomer || "").trim();

    type G = {
      ref: string;
      type: string;
      color: string;
      notes: string;
      lines: Array<{ description: string; price: number }>;
    };
    let garments: G[] = [];
    if (intake?.garments?.length) {
      garments = intake.garments.map((g, i) => ({
        ref: g.ref || `G${i + 1}`,
        type: g.garmentType || "Garment",
        color: g.color || "",
        notes: g.notes || "",
        lines: (g.lines || []).map((l) => ({
          description: l.description || "Work",
          price: Number(l.price) || 0,
        })),
      }));
    } else {
      const flatG = data.cart?.garments || [];
      const flatL = data.cart?.lines || [];
      garments = flatG.map((g, i) => {
        const ref = g.garmentId || `G${i + 1}`;
        return {
          ref,
          type: g.garmentType || "Garment",
          color: g.color || "",
          notes: "",
          lines: flatL
            .filter((l) => (l.garmentRef || "") === ref)
            .map((l) => ({
              description: l.description || "Work",
              price: Number(l.price) || 0,
            })),
        };
      });
    }

    const sell = intake?.sellItems || [];
    const workTotal = garments.reduce(
      (s, g) => s + g.lines.reduce((a, l) => a + l.price, 0),
      0,
    );
    const sellTotal = sell.reduce(
      (s, it) => s + (Number(it.qty) || 1) * (Number(it.rate) || 0),
      0,
    );
    const total =
      Number(data.cart?.total) ||
      Number(intake && (intake as { total?: number }).total) ||
      workTotal + sellTotal;

    return {
      id: data.id,
      location: data.location || "NYC",
      customer,
      phone,
      endCustomer,
      parkNote: intake?.parkNote || "",
      parkLabel: intake?.parkLabel || data.label || "",
      billing: intake?.billing || "billable",
      promiseDate: intake?.promiseDate || "",
      promiseTime: intake?.promiseTime || "",
      garments,
      sell,
      total,
      when: data.updated_at,
    };
  }, [data]);

  useEffect(() => {
    if (view && sp.get("auto") === "1") {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [view, sp]);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-forest-deep grid place-items-center text-brass text-[12px] tracking-[0.2em] uppercase">
        Loading parked cart…
      </div>
    );
  }
  if (isError || !view) {
    return (
      <div className="min-h-dvh bg-forest-deep grid place-items-center gap-3">
        <p className="display italic text-cream text-xl">Parked cart not found</p>
        <button type="button" onClick={() => nav("/parked")} className="text-brass text-xs tracking-widest uppercase">
          Back to Parked
        </button>
      </div>
    );
  }

  const billingLabel =
    view.billing === "redo"
      ? "Re-do"
      : view.billing === "on_order"
        ? "On custom order"
        : "Billable";

  return (
    <>
      <style>{CSS}</style>

      <div className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 bg-forest-deep/95 border-b border-brass/25">
        <button
          type="button"
          onClick={() => nav("/parked")}
          className="flex items-center gap-2 text-cream-muted text-sm"
        >
          <ArrowLeft size={15} /> Parked
        </button>
        <div className="text-center min-w-0">
          <div className="text-cream text-sm font-medium truncate">{view.customer}</div>
          <div className="text-[11px] text-brass/80 tracking-widest uppercase">Hold slip · not a ticket</div>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Link
            to={`/intake/alterations?parked=${encodeURIComponent(view.id)}`}
            className="px-3 py-2 rounded-lg border border-brass/40 text-cream text-xs uppercase tracking-wide"
          >
            Resume
          </Link>
          <button
            type="button"
            disabled={printing}
            onClick={() => void printEpson()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brass text-forest-deep text-xs font-semibold uppercase tracking-wide disabled:opacity-50"
          >
            <Zap size={13} /> {printing ? "…" : "Epson"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brass/40 text-cream text-xs uppercase tracking-wide"
          >
            <Printer size={13} /> Browser
          </button>
        </div>
      </div>

      <div className="stage flex justify-center p-6 bg-forest-deep min-h-[calc(100dvh-64px)]">
        <div className="paper">
          <div
            style={{
              textAlign: "center",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.22em",
              background: "#000",
              color: "#fff",
              padding: "10px 8px",
              margin: "-18px -16px 14px",
            }}
          >
            PARKED · HOLD
          </div>

          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 800, letterSpacing: "0.2em" }}>
            L &amp; S HOUSE
          </div>
          <div style={{ textAlign: "center", fontSize: 9, marginTop: 4, color: "#333" }}>
            138 EAST 61ST · NYC · NOT A TICKET
          </div>

          <div style={{ borderTop: "2px solid #000", borderBottom: "2px solid #000", margin: "12px 0", padding: "10px 0" }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: "#444" }}>CUSTOMER</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, lineHeight: 1.15 }}>{view.customer}</div>
            {view.phone ? <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{view.phone}</div> : null}
            {view.endCustomer ? (
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6 }}>
                End customer: {view.endCustomer}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, fontWeight: 700 }}>
            <div>
              <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#555" }}>PARK ID</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{view.id}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#555" }}>LOCATION</div>
              <div>{view.location}</div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 11, fontWeight: 600 }}>
            <div>Parked: {fmtWhen(view.when)}</div>
            <div style={{ marginTop: 2 }}>Billing intent: {billingLabel}</div>
            {(view.promiseDate || view.promiseTime) && (
              <div style={{ marginTop: 2 }}>
                Promise: {view.promiseDate || "—"}
                {view.promiseTime ? ` · ${view.promiseTime}` : ""}
              </div>
            )}
            {view.parkLabel ? <div style={{ marginTop: 2 }}>Label: {view.parkLabel}</div> : null}
            {view.parkNote ? (
              <div style={{ marginTop: 8, padding: 8, border: "1px dashed #000", fontSize: 11 }}>
                Note: {view.parkNote}
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 14, borderTop: "2px solid #000", paddingTop: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", marginBottom: 8 }}>CONTENTS</div>
            {view.garments.length === 0 && view.sell.length === 0 ? (
              <div style={{ fontSize: 12, fontStyle: "italic" }}>No garments saved</div>
            ) : null}
            {view.garments.map((g) => (
              <div key={g.ref} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  {g.ref} · {g.type}
                  {g.color ? ` · ${g.color}` : ""}
                </div>
                {g.notes ? <div style={{ fontSize: 10, color: "#333" }}>{g.notes}</div> : null}
                {g.lines.length === 0 ? (
                  <div style={{ fontSize: 11, marginTop: 2, color: "#555" }}>No work lines yet</div>
                ) : (
                  g.lines.map((l, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        marginTop: 3,
                      }}
                    >
                      <span style={{ flex: 1 }}>{l.description}</span>
                      <span style={{ flex: "none" }}>{money(l.price)}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
            {view.sell.map((it, i) => (
              <div
                key={`s-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  marginTop: 4,
                }}
              >
                <span>
                  {it.qty || 1}× {it.item_name || "Item"}
                </span>
                <span>{money((Number(it.qty) || 1) * (Number(it.rate) || 0))}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 12,
              borderTop: "3px solid #000",
              paddingTop: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em" }}>HOLD TOTAL</span>
            <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600 }}>
              {money(view.total)}
            </span>
          </div>

          <div
            style={{
              marginTop: 14,
              textAlign: "center",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1.35,
              borderTop: "1px solid #000",
              paddingTop: 10,
            }}
          >
            PARKED — NO TICKET NUMBER YET
            <br />
            Resume on Alts → Parked to finish &amp; print hang tags.
          </div>
        </div>
      </div>
    </>
  );
}
