// IMPORTANT: Before Apple Pay works in production, register app.lstailors.com
// in Square Developer Dashboard > Apple Pay.
// Square provides the domain association file — host it at:
// app.lstailors.com/.well-known/apple-developer-merchantid-domain-association
// Add this as a static file in the Vite public/ directory.

import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CreditCard,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUSD, formatDate } from "@/lib/format";

// Use sandbox SDK in dev, production in prod
const IS_PROD = import.meta.env.PROD;
const SQUARE_JS_URL = IS_PROD
  ? "https://web.squarecdn.com/v1/square.js"
  : "https://sandbox.web.squarecdn.com/v1/square.js";

const SQUARE_APP_ID = import.meta.env.VITE_SQUARE_APPLICATION_ID as string | undefined;
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID as string | undefined;
const API_BASE = import.meta.env.VITE_BACKEND_URL || "";

declare global {
  interface Window {
    Square: any;
  }
}

interface InvoiceData {
  erp_name: string;
  customer_name: string;
  grand_total: number;
  outstanding_amount: number;
  status: string;
  due_date: string | null;
  posting_date: string | null;
  items: Array<{ item_name?: string; description?: string; amount?: number | null }>;
  currency: string;
}

type PageState = "loading" | "not_found" | "already_paid" | "ready" | "sdk_error" | "processing" | "success" | "error";

export default function PayInvoice() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [successPaymentId, setSuccessPaymentId] = useState("");

  const cardRef = useRef<any>(null);
  const paymentsRef = useRef<any>(null);

  // Load Square SDK script
  useEffect(() => {
    if (!SQUARE_APP_ID || !SQUARE_LOCATION_ID) {
      console.error("[PayInvoice] Missing VITE_SQUARE_APPLICATION_ID or VITE_SQUARE_LOCATION_ID");
      setPageState("sdk_error");
      setErrorMsg("Payment system is not configured. Please contact us directly.");
      return;
    }
    if (document.querySelector(`script[src="${SQUARE_JS_URL}"]`)) {
      if (window.Square) setSdkReady(true);
      else document.querySelector(`script[src="${SQUARE_JS_URL}"]`)!
        .addEventListener("load", () => setSdkReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = SQUARE_JS_URL;
    script.onload = () => setSdkReady(true);
    script.onerror = () => {
      setPageState("sdk_error");
      setErrorMsg("Failed to load payment processor. Please try again or contact us.");
    };
    document.head.appendChild(script);
  }, []);

  // Fetch invoice / ticket
  useEffect(() => {
    if (!invoiceId) { setPageState("not_found"); return; }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/pay-info/${encodeURIComponent(invoiceId)}`);
        if (!res.ok) { setPageState("not_found"); return; }
        const json = await res.json();
        const d = json?.data;
        if (!d) { setPageState("not_found"); return; }
        const row: InvoiceData = {
          erp_name: d.id,
          customer_name: d.customer_name ?? "Valued Customer",
          grand_total: d.grand_total ?? 0,
          outstanding_amount: d.outstanding_amount ?? 0,
          status: d.status ?? "Unpaid",
          due_date: d.due_date ?? null,
          posting_date: d.posting_date ?? null,
          items: d.items ?? [],
          currency: d.currency ?? "USD",
        };
        setInvoice(row);
        if (row.status === "Paid" || row.outstanding_amount <= 0) {
          setPageState("already_paid");
        } else if (pageState === "loading") {
          setPageState("ready");
        }
      } catch {
        setPageState("not_found");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // Init Square card element once invoice loaded + SDK ready
  useEffect(() => {
    if (pageState !== "ready" || !sdkReady || !invoice) return;
    if (!window.Square || !SQUARE_APP_ID || !SQUARE_LOCATION_ID) return;

    (async () => {
      try {
        const payments = window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        paymentsRef.current = payments;

        const card = await payments.card({
          style: {
            ".input-container": { borderColor: "#4a7c59", borderRadius: "6px" },
            input: { color: "#1a2e1d", fontFamily: "Montserrat", fontSize: "14px" },
            "input::placeholder": { color: "#9ca3af" },
          },
        });
        await card.attach("#card-container");
        if (!document.querySelector("#card-container iframe")) {
          throw new Error("Card element did not render — check Square Dashboard configuration.");
        }
        cardRef.current = card;

        const amountStr = (invoice.outstanding_amount ?? invoice.grand_total ?? 0).toFixed(2);
        const paymentRequest = payments.paymentRequest({
          countryCode: "US",
          currencyCode: "USD",
          total: { amount: amountStr, label: "L&S Custom Tailors" },
        });

        // Apple Pay
        try {
          const applePay = await payments.applePay(paymentRequest);
          await applePay.attach("#apple-pay-button");
        } catch {
          const el = document.getElementById("apple-pay-button");
          if (el) el.style.display = "none";
        }

        // Google Pay
        try {
          const googlePay = await payments.googlePay(paymentRequest);
          await googlePay.attach("#google-pay-button");
        } catch {
          const el = document.getElementById("google-pay-button");
          if (el) el.style.display = "none";
        }
      } catch (err: any) {
        console.error("[PayInvoice] Square init error:", err);
        setPageState("sdk_error");
        setErrorMsg(err?.message ?? "Payment system failed to load. Please try again.");
      }
    })();
  }, [pageState, sdkReady, invoice]);

  const handlePay = async () => {
    if (!cardRef.current || !invoice) return;
    setPageState("processing");
    setErrorMsg("");

    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK") {
        setPageState("ready");
        setErrorMsg(result.errors?.[0]?.message ?? "Card tokenization failed. Please check your card details.");
        return;
      }

      const outstanding = invoice.outstanding_amount ?? invoice.grand_total ?? 0;
      const amountCents = Math.round(outstanding * 100);

      const res = await fetch(`${API_BASE}/api/pay-info/${encodeURIComponent(invoice.erp_name)}/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: result.token as string, amount_cents: amountCents }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPageState("ready");
        setErrorMsg(data?.error ?? "Payment could not be processed. Please try again.");
        return;
      }

      setSuccessPaymentId(data?.data?.payment_id ?? "");
      setPageState("success");
    } catch {
      setPageState("ready");
      setErrorMsg("An unexpected error occurred. Please try again.");
    }
  };

  const outstanding = invoice?.outstanding_amount ?? invoice?.grand_total ?? 0;
  const amountDisplay = invoice ? formatUSD(outstanding) : "";
  const customerName = invoice?.customer_name ?? "Valued Customer";

  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-brass animate-spin" />
      </div>
    );
  }

  if (pageState === "not_found") {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center px-6">
        <div className="text-center">
          <div className="font-display italic text-3xl text-cream mb-3">Invoice not found</div>
          <p className="text-cream-muted">This invoice doesn&apos;t exist or the link may have expired.</p>
        </div>
      </div>
    );
  }

  if (pageState === "already_paid") {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="relative inline-flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full bg-signal-emerald/20 blur-3xl" />
            <CheckCircle2 className="relative h-16 w-16 text-signal-emerald" />
          </div>
          <div className="font-display italic text-3xl text-cream mb-3">Already paid</div>
          <p className="text-cream-muted text-sm">
            Invoice <span className="font-mono text-cream">{invoice?.erp_name}</span> is fully settled. Thank you!
          </p>
        </div>
      </div>
    );
  }

  if (pageState === "success") {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="relative inline-flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full bg-signal-emerald/20 blur-3xl" />
            <CheckCircle2 className="relative h-16 w-16 text-signal-emerald" />
          </div>
          <div className="font-display italic text-4xl text-cream mb-2">Payment confirmed</div>
          <p className="text-cream-muted mb-1 text-sm">
            Invoice <span className="font-mono text-cream">{invoice?.erp_name}</span>
          </p>
          <p className="font-display italic text-brass-shimmer text-2xl mb-6">{amountDisplay}</p>
          <p className="text-cream-dim text-sm mb-6">
            Thank you, {customerName}. Your payment has been received.
          </p>
          {successPaymentId && (
            <p className="text-cream-dim text-xs mb-4">Payment ID: <span className="font-mono">{successPaymentId}</span></p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forest-deep px-5 py-10">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="font-display italic text-3xl text-cream mb-1">L&amp;S Custom Tailors</div>
          <div className="text-brass text-[10px] tracking-[0.2em] font-medium uppercase" style={{ fontFamily: "Montserrat, sans-serif" }}>
            Secure Payment
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Lock className="h-3 w-3 text-cream-dim" />
            <span className="text-cream-dim text-[10px]">Powered by Square</span>
          </div>
        </div>

        {/* Invoice summary */}
        {invoice && (
          <div className="mb-5 rounded-xl border p-5" style={{ backdropFilter: "blur(12px)", background: "rgba(15, 26, 16, 0.7)", borderColor: "rgba(176, 141, 87, 0.25)" }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-cream-dim text-[9px] tracking-widest uppercase mb-1" style={{ fontFamily: "Montserrat, sans-serif" }}>Invoice</div>
                <div className="font-mono text-cream text-sm">{invoice.erp_name}</div>
              </div>
              <div className="text-right">
                <div className="text-cream-dim text-[9px] tracking-widest uppercase mb-1" style={{ fontFamily: "Montserrat, sans-serif" }}>Customer</div>
                <div className="text-cream text-sm">{customerName}</div>
              </div>
            </div>

            {Array.isArray(invoice.items) && invoice.items.length > 0 && (
              <div className="border-t border-brass/10 pt-3 mb-4 space-y-1.5">
                {invoice.items.slice(0, 6).map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-cream-muted truncate max-w-[60%]">{item.item_name ?? item.description ?? "Item"}</span>
                    <span className="text-cream-dim font-mono tabular-nums">{item.amount != null ? formatUSD(item.amount) : ""}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-brass/20 pt-4 flex items-end justify-between">
              <div>
                <div className="text-cream-dim text-[9px] tracking-widest uppercase mb-1" style={{ fontFamily: "Montserrat, sans-serif" }}>Amount Due</div>
                {invoice.due_date && <div className="text-cream-dim text-xs">Due {formatDate(invoice.due_date)}</div>}
              </div>
              <div className="font-display italic text-3xl text-brass-shimmer">{amountDisplay}</div>
            </div>
          </div>
        )}

        {/* Payment form */}
        <div className="rounded-xl border p-5 space-y-4" style={{ backdropFilter: "blur(12px)", background: "rgba(15, 26, 16, 0.7)", borderColor: "rgba(176, 141, 87, 0.3)" }}>
          {pageState === "sdk_error" ? (
            <div className="flex items-start gap-2 rounded-lg p-4 text-sm text-signal-amber border border-signal-amber/20 bg-signal-amber/10">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">Payment system unavailable</p>
                <p className="text-xs opacity-80">{errorMsg}</p>
                <p className="text-xs mt-2 opacity-70">Please call us at (212) 564-3536 to pay by phone.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Apple Pay */}
              <div id="apple-pay-button" className="w-full min-h-[48px]" />

              {/* Google Pay */}
              <div id="google-pay-button" className="w-full min-h-[48px]" />

              {/* Card */}
              <div>
                <div className="flex items-center gap-2 text-cream-dim text-[9px] tracking-widest uppercase mb-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
                  <CreditCard className="h-3 w-3" />
                  Card details
                </div>
                <div id="card-container" className="rounded-md overflow-hidden" style={{ border: "1px solid rgba(176, 141, 87, 0.5)", background: "#ffffff", minHeight: "54px" }} />
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-lg p-3 text-sm text-signal-amber border border-signal-amber/20 bg-signal-amber/10">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <Button
                onClick={handlePay}
                disabled={pageState === "processing" || !sdkReady || !cardRef.current}
                className="w-full h-14 bg-brass text-forest-deep hover:bg-brass-light font-semibold text-base transition-all disabled:opacity-50"
              >
                {pageState === "processing" ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</>
                ) : (
                  <>Pay {amountDisplay}</>
                )}
              </Button>

              <p className="text-center text-cream-dim text-[10px]">
                Your payment is encrypted and processed securely by Square.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
