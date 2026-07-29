/**
 * 004 / 027 — D520BT garment hang tags (3″ × 2″ continuous).
 * Path: PDF via system print → Share → LabelLife (no Web Bluetooth).
 * QR → alts /g/{ticket}/{garmentId}
 *
 * Rack hierarchy (classic purple slip):
 *   A14937
 *   Friday
 *   04:00 PM
 *   Customer Name
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fmtDueRack, garmentJobUrl, shortTicketNo } from "@alts/lib/printUrls";

interface TicketDoc {
  name: string;
  customer_name: string;
  due_date?: string;
  origin_location?: string;
  garments?: Array<{
    name: string;
    garment_id: string;
    garment_type: string;
    garment_description?: string;
    color?: string;
    brand?: string;
  }>;
}

const PRINT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&display=swap');
* { box-sizing: border-box; }
body { margin: 0; background: #163524; }
@media print {
  @page { size: 3in 2in; margin: 0; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .no-print { display: none !important; }
  .screen-grid { display: block !important; padding: 0 !important; gap: 0 !important; max-width: none !important; }
  .tag {
    width: 3in !important; height: 2in !important;
    page-break-after: always; break-after: page;
    border: none !important; box-shadow: none !important;
    margin: 0 !important; border-radius: 0 !important;
  }
  .tag:last-child { page-break-after: auto; }
}
`;

export default function GarmentTagPrint() {
  const { ticketName } = useParams<{ ticketName: string }>();
  const [sp] = useSearchParams();
  const onlyId = sp.get("g") || sp.get("garment");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const auto = useRef(false);

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ["print-tags", ticketName],
    queryFn: () => api.get<TicketDoc>(`/api/intake-alterations/tickets/${ticketName}`),
    enabled: !!ticketName,
  });

  const garments = useMemo(() => {
    const all = ticket?.garments ?? [];
    if (!onlyId) return all;
    return all.filter((g) => g.garment_id === onlyId || g.name === onlyId);
  }, [ticket, onlyId]);

  useEffect(() => {
    if (ticket && garments.length && !auto.current) {
      auto.current = true;
      if (sp.get("auto") === "1") setTimeout(() => window.print(), 500);
    }
  }, [ticket, garments, sp]);

  const shareHint = async () => {
    setBusy(true);
    try {
      toast.message("Print → Save as PDF → Share → LabelLife", {
        description: "3×2 continuous · D520BT garment printer",
        duration: 6000,
      });
      window.print();
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-forest-deep grid place-items-center text-brass text-[12px] tracking-[0.2em] uppercase font-ui">
        Loading tags…
      </div>
    );
  }
  if (isError || !ticket) {
    return (
      <div className="min-h-dvh bg-forest-deep grid place-items-center gap-4">
        <p className="display italic text-cream text-xl">Ticket not found</p>
        <button type="button" onClick={() => navigate(-1)} className="text-brass text-xs tracking-widest uppercase">
          Back
        </button>
      </div>
    );
  }

  const short = shortTicketNo(ticket.name);
  const due = fmtDueRack(ticket.due_date);

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 bg-forest-deep/95 border-b border-brass/25 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-cream-muted hover:text-cream text-sm"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <div className="text-center min-w-0">
          <div className="text-cream text-sm font-medium truncate">{ticket.name}</div>
          <div className="text-[12px] text-brass/80 tracking-widest uppercase">
            {garments.length} tag{garments.length !== 1 ? "s" : ""} · 3×2 · LabelLife
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={busy || !garments.length}
            onClick={shareHint}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brass text-forest-deep text-xs font-semibold tracking-wide uppercase disabled:opacity-50"
          >
            <Share2 size={13} /> PDF / Share
          </button>
          <button
            type="button"
            disabled={!garments.length}
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brass/40 text-cream text-xs font-medium tracking-wide uppercase"
          >
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      <div className="no-print px-4 py-3 text-[12px] text-cream-muted max-w-3xl mx-auto leading-relaxed">
        iPad: <b className="text-cream">Print → Save to Files / PDF</b>, then Share →{" "}
        <b className="text-cream">LabelLife</b> on the <b className="text-brass">3×2 D520BT</b>.
        {" · "}
        <Link className="text-brass underline" to={`/orders/alterations/${ticket.name}/thermal`}>
          Thermal store/customer
        </Link>
      </div>

      <div className="screen-grid p-4 flex flex-wrap gap-4 justify-center max-w-5xl mx-auto">
        {garments.length === 0 && (
          <p className="text-cream-muted py-16">No garments on this ticket.</p>
        )}
        {garments.map((g, i) => {
          const url = garmentJobUrl(ticket.name, g.garment_id);
          const gm = [g.garment_type, g.garment_id].filter(Boolean).join(" · ");
          const meta = [g.color, g.brand || g.garment_description].filter(Boolean).join(" · ");
          const fullName = (ticket.customer_name || "—").trim();
          return (
            <div
              key={g.name || g.garment_id || i}
              className="tag"
              style={{
                width: 288,
                height: 192,
                background: "#fff",
                color: "#000",
                border: "3px solid #000",
                borderRadius: 4,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                fontFamily: "Montserrat, system-ui, sans-serif",
                textAlign: "center",
              }}
            >
              {/* A14937 */}
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1 }}>
                {short}
              </div>
              {/* Friday */}
              {due.day ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 28,
                    fontWeight: 800,
                    lineHeight: 1.05,
                  }}
                >
                  {due.day}
                </div>
              ) : null}
              {/* 04:00 PM */}
              {due.time ? (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 26,
                    fontWeight: 800,
                    lineHeight: 1.05,
                  }}
                >
                  {due.time}
                </div>
              ) : null}

              <div style={{ height: 2, background: "#000", margin: "6px 0" }} />

              <div
                style={{
                  fontSize: fullName.length > 18 ? 14 : 16,
                  fontWeight: 700,
                  lineHeight: 1.1,
                }}
              >
                {fullName}
              </div>

              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 6,
                  textAlign: "left",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{gm}</div>
                  {meta ? (
                    <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700 }}>{meta.slice(0, 32)}</div>
                  ) : null}
                </div>
                <div style={{ flexShrink: 0, border: "2px solid #000", padding: 1, background: "#fff" }}>
                  <QRCodeSVG value={url} size={52} level="M" includeMargin={false} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
