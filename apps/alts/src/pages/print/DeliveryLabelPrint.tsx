/**
 * 027 / 029 — D520BT delivery label 4″ × 6″ + status bands.
 * PDF → Share → LabelLife on the 4×6 unit (not the 3×2 garment printer).
 * Charge-at-ready: default band PAID IN FULL — COLLECT NOTHING.
 * Unpaid pay-link dispatch gets a different band (C lock).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export type LabelBand =
  | "paid_collect_nothing"
  | "balance_due_do_not_collect"
  | "unpaid_pay_link"
  | "cod_collect";

const BAND_COPY: Record<LabelBand, string> = {
  paid_collect_nothing: "PAID IN FULL — COLLECT NOTHING",
  balance_due_do_not_collect: "BALANCE ON FILE — DO NOT COLLECT",
  unpaid_pay_link: "PAY LINK SENT — DO NOT COLLECT CASH",
  cod_collect: "COLLECT ON DELIVERY",
};

interface LabelData {
  id: string;
  delivery_number: string;
  delivery_no: string | null;
  qr_token: string | null;
  customer_name: string;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_apt: string | null;
  delivery_building: string | null;
  delivery_city: string;
  delivery_state: string;
  delivery_zip: string;
  garment_summary: string | null;
  garment_count: number | null;
  method: string | null;
  items?: { name: string; qty: number; desc?: string | null }[];
  order_ref?: string | null;
  payment_status?: string | null;
}

function inferBand(status?: string | null, forced?: LabelBand | null): LabelBand {
  if (forced) return forced;
  const s = (status || "").toLowerCase();
  if (s.includes("unpaid") || s.includes("part")) return "balance_due_do_not_collect";
  if (s.includes("link")) return "unpaid_pay_link";
  if (s.includes("cod")) return "cod_collect";
  return "paid_collect_nothing";
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&display=swap');
* { box-sizing: border-box; }
body { margin: 0; background: #0D1A10; }
@media print {
  @page { size: 4in 6in; margin: 0; }
  html, body { background: #fff !important; margin: 0 !important; }
  .no-print { display: none !important; }
  .stage { padding: 0 !important; }
  .lbl {
    width: 4in !important; height: 6in !important;
    transform: none !important; box-shadow: none !important; border: none !important;
  }
}
`;

export default function DeliveryLabelPrint() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const forcedBand = (sp.get("band") as LabelBand | null) || null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["delivery-label", id],
    queryFn: () => api.get<LabelData>(`/api/deliveries/${id}/label`),
    enabled: !!id,
    staleTime: 60_000,
  });

  const band = useMemo(
    () => inferBand(data?.payment_status, forcedBand && forcedBand in BAND_COPY ? forcedBand : null),
    [data, forcedBand],
  );

  const qrValue = useMemo(() => {
    if (data?.qr_token) return `https://delivered.lstailors.com/d/${data.qr_token}`;
    if (id) return `https://alts.lstailors.com/deliveries/${id}`;
    return "https://alts.lstailors.com";
  }, [data, id]);

  useEffect(() => {
    if (data && sp.get("auto") === "1") setTimeout(() => window.print(), 600);
  }, [data, sp]);

  const logPrint = () => {
    if (!id) return;
    api.post(`/api/deliveries/${id}/log-label-print`, {}).catch(() => {});
  };

  const handleShare = () => {
    toast.message("Print → PDF → Share → LabelLife", {
      description: "4×6 continuous · delivery D520BT (not the 3×2 tag printer)",
      duration: 6000,
    });
    logPrint();
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-forest-deep grid place-items-center text-brass text-[11px] tracking-[0.2em] uppercase">
        Loading label…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-forest-deep grid place-items-center gap-3">
        <p className="display italic text-cream text-xl">Delivery not found</p>
        <button type="button" onClick={() => navigate(-1)} className="text-brass text-xs tracking-widest uppercase">
          Back
        </button>
      </div>
    );
  }

  const line1 = [data.delivery_address, data.delivery_apt].filter(Boolean).join(", ");
  const line2 = [data.delivery_building].filter(Boolean).join(" ");
  const city = [data.delivery_city, data.delivery_state, data.delivery_zip].filter(Boolean).join(" ");
  const delNo = data.delivery_no || data.delivery_number || data.id;

  return (
    <>
      <style>{CSS}</style>

      <div className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 bg-forest-deep/95 border-b border-brass/25">
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-2 text-cream-muted text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="text-center min-w-0">
          <div className="text-cream text-sm font-medium truncate">{delNo}</div>
          <div className="text-[10px] text-brass/80 tracking-widest uppercase">4×6 · LabelLife · {band}</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brass text-forest-deep text-xs font-semibold uppercase tracking-wide"
          >
            <Share2 size={13} /> PDF / Share
          </button>
          <button
            type="button"
            onClick={() => {
              logPrint();
              window.print();
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brass/40 text-cream text-xs uppercase tracking-wide"
          >
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      <div className="no-print px-4 py-3 max-w-xl mx-auto text-[11px] text-cream-muted space-y-2">
        <p>
          Use the <b className="text-brass">4×6 delivery D520BT</b>, not the garment 3×2. Solid black band —
          no greyscale. POD is proof only — no charge UI on this label.
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(BAND_COPY) as LabelBand[]).map((b) => (
            <a
              key={b}
              href={`?band=${b}`}
              className={`px-2 py-1 rounded border text-[10px] tracking-wide ${
                band === b ? "border-brass text-brass bg-brass/10" : "border-white/15 text-cream-muted"
              }`}
            >
              {b.replace(/_/g, " ")}
            </a>
          ))}
        </div>
      </div>

      <div className="stage flex justify-center p-6">
        <div
          className="lbl"
          style={{
            width: 384,
            height: 576,
            background: "#fff",
            color: "#000",
            border: "2px solid #111",
            fontFamily: "Montserrat, system-ui, sans-serif",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* header */}
          <div style={{ padding: "14px 16px 10px", borderBottom: "3px solid #000" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.22em" }}>L &amp; S HOUSE</div>
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "#222" }}>
              138 EAST 61ST STREET · NYC
            </div>
          </div>

          {/* 029 band */}
          <div
            style={{
              background: "#000",
              color: "#fff",
              padding: "12px 14px",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textAlign: "center",
              lineHeight: 1.25,
            }}
          >
            {BAND_COPY[band]}
          </div>

          {/* TO */}
          <div style={{ padding: "16px 16px 8px", flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", color: "#444" }}>DELIVER TO</div>
            <div style={{ marginTop: 8, fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.01em" }}>
              {(data.customer_name || "—").toUpperCase()}
            </div>
            {data.customer_phone ? (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>{data.customer_phone}</div>
            ) : null}
            <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
              {line1 || "—"}
              {line2 ? (
                <>
                  <br />
                  {line2}
                </>
              ) : null}
              <br />
              {city || "—"}
            </div>

            <div style={{ marginTop: 18, display: "3px solid #000" }} />

            <div style={{ marginTop: 14, display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: "#444" }}>REF</div>
                <div style={{ marginTop: 4, fontSize: 16, fontWeight: 800 }}>{delNo}</div>
                {data.order_ref ? (
                  <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600 }}>{data.order_ref}</div>
                ) : null}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: "#444" }}>METHOD</div>
                <div style={{ marginTop: 4, fontSize: 14, fontWeight: 800 }}>
                  {(data.method || "Hand delivery").toUpperCase()}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600 }}>
                  {data.garment_count != null ? `${data.garment_count} pc` : ""}
                  {data.garment_summary ? ` · ${data.garment_summary}` : ""}
                </div>
              </div>
            </div>

            {data.items && data.items.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: "#444" }}>CONTENTS</div>
                {data.items.slice(0, 6).map((it, i) => (
                  <div key={i} style={{ marginTop: 4, fontSize: 12, fontWeight: 600 }}>
                    {it.qty}× {it.desc || it.name}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* QR footer */}
          <div
            style={{
              borderTop: "3px solid #000",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div style={{ border: "3px solid #000", padding: 3, background: "#fff" }}>
              <QRCodeSVG value={qrValue} size={88} level="M" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em" }}>SCAN FOR POD</div>
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>
                Proof of delivery only.
                <br />
                No payment on this label.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
