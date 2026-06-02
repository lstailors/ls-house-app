import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import QRCode from "qrcode";
import { api } from "@/lib/api";

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
}

export default function DeliveryLabel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [scale, setScale] = useState<number>(1);
  const printLoggedRef = useRef(false);

  useEffect(() => {
    const update = () => setScale(Math.min(1, (window.innerWidth - 32) / 812));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["label", id],
    queryFn: () => api.get<LabelData>(`/api/deliveries/${id}/label`),
    enabled: !!id,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!data?.qr_token) return;
    QRCode.toDataURL(
      `https://ls-house-app.vercel.app/d/${data.qr_token}`,
      { width: 300, margin: 2, color: { dark: "#000000", light: "#ffffff" } },
    ).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [data?.qr_token]);

  const logPrint = () => {
    if (printLoggedRef.current || !id) return;
    printLoggedRef.current = true;
    api.post(`/api/deliveries/${id}/log-label-print`, {}).catch(() => {});
  };

  const autoPrinted = useRef(false);
  useEffect(() => {
    if (data && qrDataUrl && !autoPrinted.current) {
      autoPrinted.current = true;
      setTimeout(() => { logPrint(); window.print(); }, 800);
    }
  }, [data, qrDataUrl]);

  const handlePrint = () => { logPrint(); window.print(); };

  if (isLoading) {
    return (
      <div style={{ background: "#0D1A10", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 11, color: "rgba(176,141,87,0.6)", letterSpacing: "0.2em" }}>LOADING LABEL…</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ background: "#0D1A10", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontStyle: "italic", color: "#F1E9D6" }}>Delivery not found</div>
        <button onClick={() => navigate(-1)} style={{ fontFamily: "Montserrat, sans-serif", fontSize: 11, color: "#B08D57", background: "none", border: "1px solid rgba(176,141,87,0.3)", borderRadius: 8, padding: "10px 20px", cursor: "pointer", letterSpacing: "0.12em" }}>
          GO BACK
        </button>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600;1,700&family=Montserrat:wght@500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @media print {
          @page { size: 4in 6in; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          /* Hide everything on the page */
          body * { visibility: hidden !important; }
          /* Then show only the label */
          .print-label, .print-label * { visibility: visible !important; }
          .print-label {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 4in !important;
            height: 6in !important;
            transform: none !important;
            box-shadow: none !important;
            overflow: hidden !important;
          }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #16271E 0%, #0D1A10 100%)", padding: "24px 16px 60px", fontFamily: "Montserrat, sans-serif", color: "#F1E9D6" }}>

        {/* Top bar */}
        <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 900, margin: "0 auto 20px" }}>
          <button
            onClick={() => navigate("/deliveries")}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(176,141,87,0.08)", border: "1px solid rgba(176,141,87,0.3)", color: "#F1E9D6", padding: "10px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", cursor: "pointer", fontFamily: "Montserrat, sans-serif" }}
          >
            <ArrowLeft size={14} /> BACK
          </button>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#B08D57", letterSpacing: "0.25em" }}>
            DELIVERY {data.delivery_no ?? `#${data.delivery_number}`} · LABEL
          </div>
        </div>

        {/* Title */}
        <div className="no-print" style={{ textAlign: "center", maxWidth: 900, margin: "0 auto 24px" }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34, fontWeight: 500, fontStyle: "italic", margin: 0, color: "#F1E9D6" }}>
            Thermal Label · 4″ × 6″
          </h1>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic", fontSize: 13, color: "#F1E9D6", opacity: 0.5, marginTop: 6 }}>
            Print at "Actual Size", no scaling.
          </div>
        </div>

        {/* Print button */}
        <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 28 }}>
          <button
            onClick={handlePrint}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 32px", borderRadius: 10, background: "linear-gradient(135deg, #B08D57, #B8965A)", border: "none", color: "#0D1A10", fontFamily: "Montserrat, sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: "0.18em", cursor: "pointer", boxShadow: "0 4px 16px rgba(176,141,87,0.3)", minHeight: 52, minWidth: 200, justifyContent: "center" }}
          >
            <Printer size={16} /> PRINT LABEL
          </button>
        </div>

        {/* Hint */}
        <div className="no-print" style={{ maxWidth: 600, margin: "0 auto 32px", padding: "14px 18px", background: "rgba(176,141,87,0.08)", border: "1px solid rgba(176,141,87,0.25)", borderRadius: 8, fontSize: 12, fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic", color: "#F1E9D6", textAlign: "center", lineHeight: 1.5 }}>
          Print at "Actual Size" — true 4″ × 6″ thermal label. No scaling needed.
        </div>

        {/* Preview / printable */}
        <div style={{ display: "flex", justifyContent: "center", overflowX: "hidden" }}>
          <div style={{ width: 812 * scale, height: 1218 * scale, flexShrink: 0, overflow: "hidden" }}>
            <div style={{ transformOrigin: "top left", transform: `scale(${scale})`, width: 812, height: 1218 }}>
              <LabelPreview label={data} qrDataUrl={qrDataUrl} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Label preview (matches delivery-app LabelWebPreview 1:1) ─────────────────

function LabelPreview({ label, qrDataUrl }: { label: LabelData; qrDataUrl: string }) {
  return (
    <div
      className="print-label"
      style={{
        width: 812, height: 1218,
        background: "#FFFFFF", color: "#000",
        fontFamily: "Montserrat, sans-serif",
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ background: "#000", color: "#fff", padding: "28px 32px 24px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <LogoMonogram size={88} />
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic", fontWeight: 600, fontSize: 44, lineHeight: 1, letterSpacing: "-0.01em", color: "#fff" }}>
              L&amp;S Custom Tailors
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.3em", marginTop: 7, color: "#fff" }}>
              ATELIER · EST. 1974 · NEW YORK
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.28em", fontWeight: 700, opacity: 0.65, color: "#fff" }}>DELIVERY</div>
          <div style={{ fontWeight: 800, fontSize: 42, letterSpacing: "0.04em", lineHeight: 1, color: "#fff" }}>
            #{label.delivery_number}
          </div>
        </div>
      </div>

      {/* Triple rule */}
      <div style={{ height: 6, background: "#000", flexShrink: 0 }} />
      <div style={{ height: 4, background: "#fff", flexShrink: 0 }} />
      <div style={{ height: 2, background: "#000", flexShrink: 0 }} />

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "22px 32px 0" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.32em", color: "#888", marginBottom: 6 }}>DELIVER TO</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 90, lineHeight: 0.9, letterSpacing: "-0.02em", color: "#000", marginBottom: 14 }}>
            {label.customer_name}
          </div>
          {label.delivery_apt ? (
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: "inline-block", background: "#000", color: "#fff", padding: "8px 20px", fontWeight: 800, fontSize: 46, letterSpacing: "0.05em", lineHeight: 1 }}>
                APT {label.delivery_apt.toUpperCase()}
              </span>
            </div>
          ) : null}
          {label.delivery_address ? (
            <div style={{ fontWeight: 700, fontSize: 36, letterSpacing: "0.01em", color: "#000", lineHeight: 1.15, marginBottom: 4 }}>
              {label.delivery_address.toUpperCase()}
            </div>
          ) : null}
          <div style={{ fontWeight: 600, fontSize: 28, color: "#000", letterSpacing: "0.01em", lineHeight: 1.2 }}>
            {[label.delivery_city, label.delivery_state, label.delivery_zip].filter(Boolean).join(" ")}
          </div>
        </div>

        {label.delivery_building ? (
          <div style={{ border: "2.5px solid #000", padding: "10px 16px", marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.28em", marginBottom: 4, color: "#000" }}>BUILDING INSTRUCTIONS</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic", fontWeight: 600, fontSize: 26, lineHeight: 1.15, color: "#000" }}>
              {label.delivery_building}
            </div>
          </div>
        ) : null}

        <div style={{ flex: 1, display: "flex", gap: 14, minHeight: 90 }}>
          <div style={{ flex: 2, border: "2.5px solid #000", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.28em", marginBottom: 6, color: "#000" }}>GARMENTS</div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontStyle: "italic", fontSize: 30, lineHeight: 1.15, color: "#000" }}>
              {label.garment_summary ?? "—"}
            </div>
          </div>
          <div style={{ flex: 1, border: "2.5px solid #000", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.28em", marginBottom: 6, color: "#000" }}>METHOD</div>
            <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: "0.05em", lineHeight: 1, color: "#000" }}>
              {label.method ? label.method.split(" ")[0].toUpperCase() : "—"}
            </div>
          </div>
        </div>

        {/* Footer: QR + contact */}
        <div style={{ borderTop: "2px solid #000", padding: "18px 0 20px", display: "flex", gap: 22, alignItems: "flex-start", flexShrink: 0 }}>
          <div style={{ flexShrink: 0 }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR" width={185} height={185} style={{ display: "block", border: "3px solid #000", padding: 4 }} />
            ) : (
              <div style={{ width: 185, height: 185, border: "3px solid #000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>QR</div>
            )}
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textAlign: "center", marginTop: 6 }}>SCAN TO CONFIRM</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.28em", marginBottom: 4 }}>CUSTOMER</div>
            <div style={{ fontWeight: 700, fontSize: 28, letterSpacing: "0.02em", marginBottom: 14 }}>
              {label.customer_phone ?? "—"}
            </div>
            <div style={{ background: "#000", color: "#fff", padding: "13px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.28em", opacity: 0.8, marginBottom: 4 }}>SOFIA · CONCIERGE</div>
              <div style={{ fontWeight: 800, fontSize: 32, letterSpacing: "0.02em", lineHeight: 1 }}>212‑308‑4431</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em" }}>delivered.lstailors.com</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogoMonogram({ size = 60 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, background: "#fff", border: "3px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <div style={{ width: size - 8, height: size - 8, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic", fontWeight: 700, fontSize: size * 0.55, color: "#fff", lineHeight: 1, letterSpacing: "-0.04em" }}>
          L<span style={{ fontSize: size * 0.32, opacity: 0.85, margin: "0 1px" }}>&amp;</span>S
        </span>
      </div>
    </div>
  );
}
