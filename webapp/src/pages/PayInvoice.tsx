// Public invoice + pay page.
// Details mirror the branded email (items, totals). Payment is Square hosted
// checkout only (Apple Pay / cards) — embedded Web Payments SDK removed so
// clients always get a working Apple Pay path on square.link.
//
// Already-paid state (Lucia): keep full invoice details + public PDF download.
// Do not collapse to a bare checkmark screen.

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ExternalLink,
  Download,
  FileText,
} from "lucide-react";
import { formatUSD, formatDate } from "@ls/design/format";

const API_BASE = import.meta.env.VITE_BACKEND_URL || "";

interface LineItem {
  item_name?: string;
  description?: string;
  qty?: number | null;
  rate?: number | null;
  amount?: number | null;
}

interface InvoiceData {
  erp_name: string;
  customer_name: string;
  grand_total: number;
  outstanding_amount: number;
  net_total: number | null;
  total_taxes_and_charges: number;
  discount_amount: number;
  status: string;
  due_date: string | null;
  posting_date: string | null;
  items: LineItem[];
  currency: string;
  square_payment_link: string | null;
}

type PageState = "loading" | "not_found" | "already_paid" | "ready" | "error";

function cleanDesc(raw?: string | null): string {
  if (!raw) return "";
  const plain = String(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Split on middot / bullet separators and drop internal segments (Lucia D3).
  const parts = plain
    .split(/\s*[·•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const seg of parts) {
    const low = seg.toLowerCase();
    if (
      low.includes("gocreate") ||
      low.includes("mtmpro") ||
      low.includes("lstsu") ||
      low.includes("factory") ||
      low.startsWith("fit ") ||
      /^lst-\d/i.test(seg)
    ) {
      continue;
    }
    kept.push(seg);
    if (kept.length >= 2) break;
  }
  if (kept.length) return kept.join(" · ");
  if (plain.includes("factory $")) {
    return plain.split("factory $")[0].replace(/[·\s]+$/g, "").trim();
  }
  return plain;
}

const glassPanel: CSSProperties = {
  backdropFilter: "blur(12px)",
  background: "rgba(15, 26, 16, 0.7)",
  borderColor: "rgba(176, 141, 87, 0.25)",
};

export default function PayInvoice() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [minting, setMinting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  useEffect(() => {
    if (!invoiceId) {
      setPageState("not_found");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/pay-info/${encodeURIComponent(invoiceId)}`);
        if (!res.ok) {
          setPageState("not_found");
          return;
        }
        const json = await res.json();
        const d = json?.data;
        if (!d) {
          setPageState("not_found");
          return;
        }
        let link =
          (d.square_payment_link || d.lsh_square_payment_link || "").trim() || null;
        const outstanding = Number(d.outstanding_amount ?? 0);
        // Self-heal: if unpaid and no link, mint once via ERP (POST ensure-link).
        if (!link && outstanding > 0 && (d.status ?? "") !== "Paid") {
          try {
            const mintRes = await fetch(
              `${API_BASE}/api/pay-info/${encodeURIComponent(d.id || invoiceId)}/ensure-link`,
              { method: "POST" },
            );
            if (mintRes.ok) {
              const mintJson = await mintRes.json();
              const minted = (mintJson?.data?.square_payment_link || "").trim();
              if (minted.startsWith("http")) link = minted;
            }
          } catch {
            /* keep unavailable UI */
          }
        }
        const row: InvoiceData = {
          erp_name: d.id,
          customer_name: d.customer_name ?? "Valued Customer",
          grand_total: Number(d.grand_total ?? 0),
          outstanding_amount: outstanding,
          net_total: d.net_total != null ? Number(d.net_total) : null,
          total_taxes_and_charges: Number(d.total_taxes_and_charges ?? 0),
          discount_amount: Number(d.discount_amount ?? 0),
          status: d.status ?? "Unpaid",
          due_date: d.due_date ?? null,
          posting_date: d.posting_date ?? null,
          items: Array.isArray(d.items)
            ? d.items.map((it: any) => ({
                item_name: it.item_name || "Item",
                description: cleanDesc(it.description),
                qty: it.qty ?? 1,
                rate: it.rate ?? null,
                amount: it.amount ?? null,
              }))
            : [],
          currency: d.currency ?? "USD",
          square_payment_link: link,
        };
        setInvoice(row);
        if (row.status === "Paid" || row.outstanding_amount <= 0) {
          setPageState("already_paid");
        } else {
          setPageState("ready");
        }
      } catch {
        setPageState("not_found");
      }
    })();
  }, [invoiceId]);

  const ensurePayLink = async () => {
    if (!invoice?.erp_name || minting) return;
    setMinting(true);
    setErrorMsg("");
    try {
      const mintRes = await fetch(
        `${API_BASE}/api/pay-info/${encodeURIComponent(invoice.erp_name)}/ensure-link`,
        { method: "POST" },
      );
      if (!mintRes.ok) {
        setErrorMsg("Could not create payment link. Please call Concierge at (212) 308-4431.");
        return;
      }
      const mintJson = await mintRes.json();
      const minted = (mintJson?.data?.square_payment_link || "").trim();
      if (minted.startsWith("http")) {
        setInvoice({ ...invoice, square_payment_link: minted });
        window.location.href = minted;
        return;
      }
      setErrorMsg("Could not create payment link. Please call Concierge at (212) 308-4431.");
    } catch {
      setErrorMsg("Could not create payment link. Please call Concierge at (212) 308-4431.");
    } finally {
      setMinting(false);
    }
  };

  const downloadPdf = async () => {
    if (!invoice?.erp_name || pdfBusy) return;
    setPdfBusy(true);
    setPdfError("");
    const url = `${API_BASE}/api/pay-info/${encodeURIComponent(invoice.erp_name)}/pdf`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        let msg =
          "Could not open PDF right now. Please call Concierge at (212) 308-4431.";
        try {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } catch {
          /* keep default */
        }
        setPdfError(msg);
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size < 200 || blob.type.includes("json")) {
        setPdfError("Could not open PDF right now. Please call Concierge at (212) 308-4431.");
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${invoice.erp_name}.pdf`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Also open inline for mobile Safari (download attribute is flaky).
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setPdfError("Could not open PDF right now. Please call Concierge at (212) 308-4431.");
    } finally {
      setPdfBusy(false);
    }
  };

  const outstanding = invoice?.outstanding_amount ?? invoice?.grand_total ?? 0;
  const paid = pageState === "already_paid";
  const amountDisplay = invoice
    ? formatUSD(paid ? Number(invoice.grand_total) : outstanding)
    : "";
  const customerName = invoice?.customer_name ?? "Valued Customer";
  const payHref = invoice?.square_payment_link || null;

  if (pageState === "loading") {
    return (
      <div className="min-h-dvh bg-forest-deep flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-brass animate-spin" />
      </div>
    );
  }

  if (pageState === "not_found") {
    return (
      <div className="min-h-dvh bg-forest-deep flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="font-display italic text-3xl text-cream mb-3">Invoice not found</div>
          <p className="text-cream-muted text-sm">
            This invoice doesn&apos;t exist or the link may have expired. Call us at (212) 308-4431.
          </p>
        </div>
      </div>
    );
  }

  const items = invoice?.items ?? [];
  const showTax = (invoice?.total_taxes_and_charges ?? 0) > 0;
  const showDiscount = (invoice?.discount_amount ?? 0) > 0;
  const showSubtotal =
    invoice?.net_total != null &&
    Math.abs(Number(invoice.net_total) - Number(invoice.grand_total)) > 0.001;

  return (
    <div className="min-h-dvh bg-forest-deep px-5 py-10 pb-[env(safe-area-inset-bottom,2.5rem)]">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <img
            src="https://erp.lstailors.com/files/ls-logo-email-192.png"
            alt="L&S"
            className="mx-auto mb-3 h-12 w-12 rounded"
            width={48}
            height={48}
          />
          <div className="font-display italic text-3xl text-cream mb-1">L&amp;S Custom Tailors</div>
          <div
            className="text-brass text-[10px] tracking-[0.2em] font-medium uppercase"
            style={{ fontFamily: "Montserrat, sans-serif" }}
          >
            {paid ? "Invoice · Paid" : "Your Invoice"}
          </div>
          {!paid && (
            <div className="flex items-center justify-center gap-1.5 mt-2">
              <Lock className="h-3 w-3 text-cream-dim" />
              <span className="text-cream-dim text-[10px]">Secure payment via Square</span>
            </div>
          )}
        </div>

        {/* Paid banner */}
        {paid && (
          <div
            className="mb-5 rounded-xl border p-4 flex items-start gap-3"
            style={{
              ...glassPanel,
              borderColor: "rgba(143, 191, 159, 0.35)",
              background: "rgba(15, 40, 24, 0.75)",
            }}
          >
            <div className="relative shrink-0 mt-0.5">
              <div className="absolute inset-0 rounded-full bg-signal-emerald/25 blur-xl" />
              <CheckCircle2 className="relative h-7 w-7 text-signal-emerald" />
            </div>
            <div className="min-w-0">
              <div className="font-display italic text-2xl text-cream leading-tight">
                Paid in full
              </div>
              <p className="text-cream-muted text-xs mt-1 leading-relaxed">
                Thank you — this invoice is settled. Your details and PDF are below for your
                records.
              </p>
            </div>
          </div>
        )}

        {/* Invoice details — email parity (paid + unpaid) */}
        {invoice && (
          <div className="mb-5 rounded-xl border p-5" style={glassPanel}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div
                  className="text-cream-dim text-[9px] tracking-widest uppercase mb-1"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  Invoice
                </div>
                <div className="font-mono text-cream text-sm break-all">{invoice.erp_name}</div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className="text-cream-dim text-[9px] tracking-widest uppercase mb-1"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  Customer
                </div>
                <div className="text-cream text-sm">{customerName}</div>
              </div>
            </div>

            {(invoice.posting_date || invoice.due_date) && (
              <div className="grid grid-cols-2 gap-3 mb-4 pb-3 border-b border-brass/10">
                {invoice.posting_date && (
                  <div>
                    <div
                      className="text-cream-dim text-[9px] tracking-widest uppercase mb-0.5"
                      style={{ fontFamily: "Montserrat, sans-serif" }}
                    >
                      Date
                    </div>
                    <div className="text-cream text-xs">{formatDate(invoice.posting_date)}</div>
                  </div>
                )}
                {invoice.due_date && (
                  <div className="text-right">
                    <div
                      className="text-cream-dim text-[9px] tracking-widest uppercase mb-0.5"
                      style={{ fontFamily: "Montserrat, sans-serif" }}
                    >
                      {paid ? "Status" : "Due"}
                    </div>
                    <div className="text-cream text-xs">
                      {paid ? "Paid" : formatDate(invoice.due_date)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Line items */}
            <div className="mb-1">
              <div
                className="text-brass text-[9px] tracking-[0.2em] uppercase font-medium mb-2"
                style={{ fontFamily: "Montserrat, sans-serif" }}
              >
                Items
              </div>
              {items.length === 0 ? (
                <p className="text-cream-dim text-xs mb-3">See your email for full item detail.</p>
              ) : (
                <div className="space-y-3 mb-4">
                  {items.map((item, i) => {
                    const name = item.item_name || "Item";
                    const desc =
                      item.description && item.description !== name ? item.description : "";
                    const qty = item.qty != null && Number(item.qty) !== 1 ? Number(item.qty) : null;
                    const rate =
                      item.rate != null && Number(item.rate) > 0 ? Number(item.rate) : null;
                    return (
                      <div
                        key={i}
                        className="flex justify-between gap-3 border-t border-brass/10 pt-3 first:border-0 first:pt-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-cream text-sm font-medium leading-snug">
                            {name}
                            {qty != null && (
                              <span className="text-cream-dim font-normal"> × {qty}</span>
                            )}
                          </div>
                          {desc && (
                            <div className="text-cream-dim text-[11px] leading-snug mt-1">{desc}</div>
                          )}
                          {qty != null && rate != null && (
                            <div
                              className="text-brass text-[9px] tracking-wider uppercase mt-1"
                              style={{ fontFamily: "Montserrat, sans-serif" }}
                            >
                              Qty {qty} · {formatUSD(rate)} each
                            </div>
                          )}
                        </div>
                        <div className="text-cream text-sm font-mono tabular-nums shrink-0">
                          {item.amount != null ? formatUSD(Number(item.amount)) : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="border-t border-brass/20 pt-3 space-y-1.5">
              {showSubtotal && (
                <div className="flex justify-between text-xs">
                  <span className="text-cream-dim uppercase tracking-wider">Subtotal</span>
                  <span className="text-cream font-mono tabular-nums">
                    {formatUSD(Number(invoice.net_total))}
                  </span>
                </div>
              )}
              {showTax && (
                <div className="flex justify-between text-xs">
                  <span className="text-cream-dim uppercase tracking-wider">Tax</span>
                  <span className="text-cream font-mono tabular-nums">
                    {formatUSD(Number(invoice.total_taxes_and_charges))}
                  </span>
                </div>
              )}
              {showDiscount && (
                <div className="flex justify-between text-xs">
                  <span className="text-cream-dim uppercase tracking-wider">Discount</span>
                  <span className="text-cream font-mono tabular-nums">
                    −{formatUSD(Number(invoice.discount_amount))}
                  </span>
                </div>
              )}
              {!paid &&
                (showSubtotal || showTax || showDiscount) &&
                Math.abs(Number(invoice.grand_total) - Number(outstanding)) > 0.01 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-cream-dim uppercase tracking-wider">Invoice total</span>
                    <span className="text-cream font-mono tabular-nums">
                      {formatUSD(Number(invoice.grand_total))}
                    </span>
                  </div>
                )}
              <div className="flex items-end justify-between pt-2">
                <div
                  className="text-brass text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  {paid ? "Paid in Full" : "Balance Due"}
                </div>
                <div
                  className={`font-display italic text-3xl leading-none ${
                    paid ? "text-signal-emerald" : "text-brass-shimmer"
                  }`}
                >
                  {amountDisplay}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div
          className="rounded-xl border p-5 space-y-3"
          style={{
            ...glassPanel,
            borderColor: "rgba(176, 141, 87, 0.3)",
          }}
        >
          {paid ? (
            <>
              <button
                type="button"
                onClick={downloadPdf}
                disabled={pdfBusy}
                className="flex w-full h-14 items-center justify-center gap-2 rounded-md bg-brass text-forest-deep hover:bg-brass-light font-semibold text-base transition-all disabled:opacity-60"
              >
                {pdfBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing PDF…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Download PDF
                  </>
                )}
              </button>
              <a
                href={`${API_BASE}/api/pay-info/${encodeURIComponent(invoice?.erp_name || invoiceId || "")}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full h-11 items-center justify-center gap-2 rounded-md border border-brass/40 text-cream text-sm font-medium hover:bg-brass/10 transition-all"
              >
                <FileText className="h-4 w-4 text-brass" />
                Open PDF in browser
              </a>
              {pdfError && (
                <div className="flex items-start gap-2 rounded-lg p-3 text-sm text-signal-amber border border-signal-amber/20 bg-signal-amber/10">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed">{pdfError}</p>
                </div>
              )}
              <p className="text-center text-cream-dim text-[11px] leading-relaxed">
                Keep a copy for your records — same Liquid Glass invoice we email.
              </p>
            </>
          ) : payHref ? (
            <>
              <a
                href={payHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full h-14 items-center justify-center gap-2 rounded-md bg-brass text-forest-deep hover:bg-brass-light font-semibold text-base transition-all"
              >
                <ExternalLink className="h-4 w-4" />
                Pay {amountDisplay}
              </a>
              <p className="text-center text-cream-dim text-[11px] leading-relaxed">
                Opens secure Square Checkout — <span className="text-cream-muted">Apple Pay</span>,
                cards, and more
              </p>
              <a
                href={`${API_BASE}/api/pay-info/${encodeURIComponent(invoice?.erp_name || invoiceId || "")}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full h-11 items-center justify-center gap-2 rounded-md border border-brass/30 text-cream-muted text-sm hover:bg-brass/10 hover:text-cream transition-all"
              >
                <FileText className="h-4 w-4" />
                Download invoice PDF
              </a>
            </>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={ensurePayLink}
                disabled={minting}
                className="flex w-full h-14 items-center justify-center gap-2 rounded-md bg-brass text-forest-deep hover:bg-brass-light font-semibold text-base transition-all disabled:opacity-60"
              >
                {minting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing secure checkout…
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4" />
                    Pay {amountDisplay}
                  </>
                )}
              </button>
              <div className="flex items-start gap-2 rounded-lg p-4 text-sm text-signal-amber border border-signal-amber/20 bg-signal-amber/10">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1">
                    {errorMsg ? "Payment link issue" : "Preparing payment"}
                  </p>
                  <p className="text-xs opacity-80">
                    {errorMsg ||
                      "Tap Pay above to open secure Square Checkout. Or call Concierge at (212) 308-4431."}
                  </p>
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-cream-dim text-[10px] pt-1">
            Questions?{" "}
            <a href="tel:+12123084431" className="text-cream-muted underline-offset-2 hover:underline">
              (212) 308-4431
            </a>{" "}
            · concierge@lstailors.com
          </p>
        </div>

        <p className="text-center text-cream-dim text-[10px] mt-6 leading-relaxed">
          138 E 61st Street, Suite 201 · New York, NY 10065
          <br />
          Handcrafted in New York since 1974
        </p>
      </div>
    </div>
  );
}
