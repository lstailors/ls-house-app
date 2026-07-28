/**
 * 022 — Luxury thermal: store MASTER (large) + customer copy (compact).
 * Epson TM-m30II via /api/print/* · also browser print preview for proofing.
 * SMS e-ticket preferred for client; print on request.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, MessageSquare, Printer, Zap } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  fmtDueRack,
  fmtMoney,
  payUrl,
  shortTicketNo,
  ticketPublicUrl,
} from "@alts/lib/printUrls";

interface TicketDoc {
  name: string;
  customer_name: string;
  customer_phone?: string;
  origin_location?: string;
  workflow_state?: string;
  ticket_date?: string;
  due_date?: string;
  ticket_total?: number;
  payment_status?: string;
  delivery_method?: string;
  customer_notes?: string;
  internal_notes?: string;
  sales_invoice?: string;
  taken_by?: string;
  owner?: string;
  garments?: Array<{
    name: string;
    garment_id: string;
    garment_type: string;
    garment_description?: string;
    color?: string;
  }>;
  lines?: Array<{
    name: string;
    garment_ref: string;
    description: string;
    price: number;
  }>;
}

function fmtLong(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,600&family=Montserrat:wght@600;700;800&family=JetBrains+Mono:wght@700&display=swap');
* { box-sizing: border-box; }
body { margin: 0; }
@media print {
  @page { size: 80mm auto; margin: 0; }
  html, body { background: #fff !important; }
  .no-print { display: none !important; }
  .cols { display: block !important; padding: 0 !important; gap: 0 !important; }
  .paper { width: 80mm !important; max-width: none !important; box-shadow: none !important; margin: 0 auto 8mm !important; page-break-after: always; }
  .paper:last-child { page-break-after: auto; }
}
.paper {
  background: #fff; color: #000;
  font-family: Montserrat, system-ui, sans-serif;
  padding: 20px 18px 26px;
  width: 340px;
  -webkit-font-smoothing: antialiased;
}
.paper.master { width: 380px; }
.mhead {
  text-align: center; font-size: 14px; font-weight: 800; letter-spacing: 0.22em;
  background: #000; color: #fff; padding: 12px 8px; margin: -20px -18px 18px;
}
.brand {
  text-align: center; font-size: 13px; letter-spacing: 0.28em; font-weight: 800;
  margin-bottom: 6px;
}
.eyebrow {
  font-size: 12px; letter-spacing: 0.2em; font-weight: 800; color: #111;
  text-align: center;
}
.tknum {
  text-align: center; font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 800; letter-spacing: 0.02em; margin-top: 4px; line-height: 1.05;
}
.paper.master .tknum { font-size: 42px; }
.paper.cust .tknum { font-size: 36px; }
.cname {
  text-align: center; font-family: Montserrat, system-ui, sans-serif;
  font-style: normal; font-weight: 700; margin-top: 10px; line-height: 1.15;
  letter-spacing: 0.01em;
}
.paper.master .cname { font-size: 22px; }
.paper.cust .cname { font-size: 20px; }
.dueblock { text-align: center; margin-top: 6px; }
.dueblock .day {
  font-size: 40px; font-weight: 800; line-height: 1.05; letter-spacing: 0.01em;
}
.paper.master .dueblock .day { font-size: 44px; }
.dueblock .time {
  font-size: 40px; font-weight: 800; line-height: 1.05; margin-top: 2px;
  letter-spacing: 0.02em;
}
.paper.master .dueblock .time { font-size: 44px; }
.phone {
  text-align: center; font-size: 16px; font-weight: 700; margin-top: 6px;
}
.addr { text-align: center; font-size: 13px; font-weight: 700; color: #111; margin-top: 6px; }
.solid { height: 3px; background: #000; margin: 14px 0; }
.hair { height: 2px; background: #000; margin: 12px 0; }
.meta {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 13px; padding: 5px 0; font-weight: 700;
}
.paper.master .meta { font-size: 14px; padding: 6px 0; }
.meta span { color: #222; letter-spacing: 0.1em; font-weight: 800; text-transform: uppercase; }
.meta b { font-weight: 800; text-align: right; color: #000; }
.rackrow { display: flex; gap: 8px; margin: 14px 0; }
.rk { flex: 1; border: 2.5px solid #000; text-align: center; padding: 10px 4px; }
.rk .l { font-size: 11px; letter-spacing: 0.14em; font-weight: 800; color: #111; }
.rk .v { font-size: 22px; font-weight: 800; margin-top: 6px; line-height: 1; }
.gname {
  font-size: 14px; font-weight: 800; letter-spacing: 0.06em;
  margin: 14px 0 6px; text-transform: uppercase;
}
.paper.master .gname { font-size: 15px; }
.gl {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 13px; color: #000; padding: 4px 0; font-weight: 600; line-height: 1.35;
}
.paper.master .gl { font-size: 14px; padding: 5px 0; }
.gl .amt { font-variant-numeric: tabular-nums; font-weight: 800; }
.totrow {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-top: 8px;
}
.totrow span { font-size: 14px; letter-spacing: 0.16em; font-weight: 800; }
.totrow b {
  font-size: 28px; font-family: "Cormorant Garamond", Georgia, serif;
  font-style: italic; font-weight: 600;
}
.notebox { border: 2.5px solid #000; padding: 12px; margin-top: 14px; }
.notebox .t { font-size: 11px; letter-spacing: 0.12em; font-weight: 800; margin-bottom: 8px; }
.notebox .b { font-size: 13px; line-height: 1.4; font-weight: 600; }
.qrp { display: flex; justify-content: center; padding: 16px 0 8px; }
.qcap {
  text-align: center; font-size: 12px; letter-spacing: 0.16em;
  font-weight: 800; text-transform: uppercase;
}
.closing {
  text-align: center; font-size: 12px; letter-spacing: 0.12em;
  color: #111; margin-top: 12px; font-weight: 700;
}
.closing b {
  display: block; margin-top: 6px; color: #000;
  letter-spacing: 0.22em; font-size: 13px; font-weight: 800;
}
`;

export default function ThermalTicketPrint() {
  const { ticketName } = useParams<{ ticketName: string }>();
  const navigate = useNavigate();
  const [printing, setPrinting] = useState<string | null>(null);

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ["print-thermal", ticketName],
    queryFn: () => api.get<TicketDoc>(`/api/intake-alterations/tickets/${ticketName}`),
    enabled: !!ticketName,
  });

  const groups = useMemo(() => {
    if (!ticket) return [];
    const lines = ticket.lines ?? [];
    const garments = ticket.garments ?? [];
    if (!garments.length) {
      return [
        {
          key: "all",
          title: "WORK",
          lines: lines.map((l) => ({ desc: l.description, price: l.price })),
        },
      ];
    }
    return garments.map((g) => ({
      key: g.garment_id,
      title: [g.garment_id, g.color, g.garment_type].filter(Boolean).join(" · ").toUpperCase(),
      lines: lines
        .filter((l) => l.garment_ref === g.garment_id || l.garment_ref === g.name)
        .map((l) => ({ desc: l.description, price: l.price })),
    }));
  }, [ticket]);

  const erpPrint = async (what: "all" | "receipts") => {
    if (!ticket) return;
    setPrinting(what);
    try {
      const path = what === "receipts" ? "/api/print/receipt" : "/api/print/ticket";
      const res = await api.raw(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_name: ticket.name, what }),
      });
      const result = await res.json().catch(() => ({}));
      if (!result.ok) throw new Error(result.error ?? "Print failed");
      toast.success(what === "receipts" ? "Customer / receipts sent to Epson" : "Ticket sent to Epson");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Print failed");
    } finally {
      setPrinting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-forest-deep grid place-items-center text-brass text-[12px] tracking-[0.2em] uppercase">
        Loading ticket…
      </div>
    );
  }
  if (isError || !ticket) {
    return (
      <div className="min-h-dvh bg-forest-deep grid place-items-center">
        <p className="display italic text-cream text-xl">Ticket not found</p>
      </div>
    );
  }

  const scanUrl = ticket.sales_invoice
    ? payUrl(ticket.sales_invoice)
    : ticketPublicUrl(ticket.name);
  const payStatus = (ticket.payment_status || "Unpaid").toUpperCase();
  const pieces = ticket.garments?.length ?? 0;
  const exit = (ticket.delivery_method || "Counter pickup").toUpperCase();
  const takenBy = ticket.taken_by || ticket.owner || "—";
  const short = shortTicketNo(ticket.name);
  const due = fmtDueRack(ticket.due_date);
  const custName = ticket.customer_name || "—";

  return (
    <>
      <style>{CSS}</style>

      <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-forest-deep/95 border-b border-brass/25 backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-2 text-cream-muted text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="text-center">
          <div className="text-cream text-sm font-medium">{ticket.name}</div>
          <div className="text-[12px] text-brass/80 tracking-widest uppercase">
            022 thermal · Epson · SMS preferred
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Link
            to={`/t/${ticket.name}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brass/40 text-cream text-xs uppercase tracking-wide"
          >
            <MessageSquare size={13} /> E-ticket
          </Link>
          <button
            type="button"
            disabled={!!printing}
            onClick={() => erpPrint("all")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brass text-forest-deep text-xs font-semibold uppercase tracking-wide disabled:opacity-50"
          >
            <Zap size={13} /> {printing === "all" ? "…" : "Epson all"}
          </button>
          <button
            type="button"
            disabled={!!printing}
            onClick={() => erpPrint("receipts")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brass/40 text-cream text-xs uppercase tracking-wide disabled:opacity-50"
          >
            <Printer size={13} /> {printing === "receipts" ? "…" : "Epson receipts"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream/20 text-cream-muted text-xs uppercase tracking-wide"
          >
            Browser print
          </button>
        </div>
      </div>

      <div className="no-print px-4 py-3 text-[12px] text-cream-muted max-w-4xl mx-auto">
        Store master always for the file. Client:{" "}
        <b className="text-cream">text e-ticket</b> preferred; print customer copy on request.
        {" · "}
        <Link className="text-brass underline" to={`/orders/alterations/${ticket.name}/tags`}>
          3×2 hang tags
        </Link>
      </div>

      <div className="cols flex flex-wrap gap-8 justify-center p-6 bg-[#13291C] min-h-dvh">
        {/* STORE MASTER */}
        <div className="paper master">
          <div className="mhead">STORE MASTER</div>
          {/* Rack top — A14937 / Friday / 04:00 PM */}
          <div className="tknum">{short}</div>
          <div className="dueblock">
            {due.day ? <div className="day">{due.day}</div> : null}
            {due.time ? <div className="time">{due.time}</div> : null}
          </div>
          <div className="cname">{custName}</div>
          {ticket.customer_phone ? <div className="phone">{ticket.customer_phone}</div> : null}
          <div className="solid" />
          <div className="meta">
            <span>TICKET</span>
            <b>{ticket.name}</b>
          </div>
          <div className="meta">
            <span>TAKEN BY</span>
            <b>{String(takenBy).toUpperCase()}</b>
          </div>
          <div className="meta">
            <span>TAKEN IN</span>
            <b>{fmtLong(ticket.ticket_date)}</b>
          </div>
          <div className="meta">
            <span>EXIT</span>
            <b>{exit}</b>
          </div>
          <div className="meta">
            <span>STATE</span>
            <b>{(ticket.workflow_state || "—").toUpperCase()}</b>
          </div>
          <div className="solid" />
          <div className="rackrow">
            <div className="rk">
              <div className="l">RACK</div>
              <div className="v">—</div>
            </div>
            <div className="rk">
              <div className="l">PIECES</div>
              <div className="v">{pieces || "—"}</div>
            </div>
            <div className="rk">
              <div className="l">BAGS</div>
              <div className="v">1</div>
            </div>
          </div>
          <div>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="gname">{g.title}</div>
                {g.lines.length === 0 ? (
                  <div className="gl">
                    <span>No lines</span>
                    <span />
                  </div>
                ) : (
                  g.lines.map((l, i) => (
                    <div className="gl" key={i}>
                      <span>{l.desc}</span>
                      <span className="amt">{Number(l.price).toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
          <div className="solid" />
          <div className="totrow">
            <span>TOTAL</span>
            <b>{fmtMoney(ticket.ticket_total)}</b>
          </div>
          <div className="meta" style={{ paddingTop: 8 }}>
            <span>STATUS</span>
            <b>{payStatus}</b>
          </div>
          {ticket.sales_invoice ? (
            <div className="meta">
              <span>INVOICE</span>
              <b>{ticket.sales_invoice}</b>
            </div>
          ) : null}
          {(ticket.internal_notes || ticket.customer_notes) && (
            <div className="notebox">
              <div className="t">INTERNAL — NOT ON CUSTOMER COPY</div>
              <div className="b">{ticket.internal_notes || ticket.customer_notes}</div>
            </div>
          )}
          <div className="qrp">
            <div style={{ border: "3px solid #000", padding: 6 }}>
              <QRCodeSVG value={ticketPublicUrl(ticket.name)} size={120} level="M" />
            </div>
          </div>
          <div className="qcap">SCAN TO OPEN IN ALTS</div>
        </div>

        {/* CUSTOMER COPY */}
        <div className="paper cust">
          <div className="brand">L &amp; S HOUSE</div>
          <div className="tknum">{short}</div>
          <div className="dueblock">
            {due.day ? <div className="day">{due.day}</div> : null}
            {due.time ? <div className="time">{due.time}</div> : null}
          </div>
          <div className="cname">{custName}</div>
          {ticket.customer_phone ? <div className="phone">{ticket.customer_phone}</div> : null}
          <div className="hair" />
          <div className="meta">
            <span>TICKET</span>
            <b>{ticket.name}</b>
          </div>
          <div className="meta">
            <span>EXIT</span>
            <b>{exit}</b>
          </div>
          <div className="hair" />
          {groups.map((g) => (
            <div key={`c-${g.key}`}>
              <div className="gname">{g.title}</div>
              {g.lines.map((l, i) => (
                <div className="gl" key={i}>
                  <span>{l.desc}</span>
                  <span className="amt">{Number(l.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="hair" />
          <div className="totrow">
            <span>TOTAL</span>
            <b>{fmtMoney(ticket.ticket_total)}</b>
          </div>
          <div className="meta">
            <span>STATUS</span>
            <b>{payStatus}</b>
          </div>
          <div className="qrp">
            <div style={{ border: "3px solid #000", padding: 6 }}>
              <QRCodeSVG value={scanUrl} size={112} level="M" />
            </div>
          </div>
          <div className="qcap">{ticket.sales_invoice ? "SCAN TO PAY" : "SCAN E-TICKET"}</div>
          <div className="closing">
            WITH OUR THANKS
            <b>L&amp;S HOUSE</b>
          </div>
        </div>
      </div>
    </>
  );
}
