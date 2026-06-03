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
import { supabase } from "@/lib/supabaseClient";
import { formatUSD, formatDate } from "@/lib/format";

const SQUARE_JS_URL = "https://web.squarecdn.com/v1/square.js";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Square: any;
  }
}

interface InvoiceRow {
  id: string;
  erp_name: string;
  end_customer: string | null;
  erp_customer: string | null;
  grand_total: number | null;
  outstanding_amount: number | null;
  status: string | null;
  due_date: string | null;
  posting_date: string | null;
  items: Array<{ item_name?: string; description?: string; amount?: number }>;
  currency: string | null;
}

type PageState =
  | "loading"
  | "not_found"
  | "already_paid"
  | "ready"
  | "processing"
  | "success"
  | "error";

export default function PayInvoice() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [successPaymentId, setSuccessPaymentId] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentsRef = useRef<any>(null);

  // Load Square SDK
  useEffect(() => {
    if (document.querySelector(`script[src="${SQUARE_JS_URL}"]`)) {
      if (window.Square) setSdkReady(true);
      else {
        document
          .querySelector(`script[src="${SQUARE_JS_URL}"]`)!
          .addEventListener("load", () => setSdkReady(true));
      }
      return;
    }
    const script = document.createElement("script");
    script.src = SQUARE_JS_URL;
    script.onload = () => setSdkReady(true);
    document.head.appendChild(script);
  }, []);

  // Fetch invoice
  useEffect(() => {
    if (!invoiceId) {
      setPageState("not_found");
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("erp_sales_invoices")
        .select(
          "id, erp_name, end_customer, erp_customer, grand_total, outstanding_amount, status, due_date, posting_date, items, currency"
        )
        .eq("erp_name", invoiceId)
        .single();

      if (error || !data) {
        setPageState("not_found");
        return;
      }

      setInvoice(data as InvoiceRow);
      const outstanding = (data as InvoiceRow).outstanding_amount ?? 0;
      if (
        data.status === "Paid" ||
        outstanding <= 0
      ) {
        setPageState("already_paid");
      } else {
        setPageState("ready");
      }
    })();
  }, [invoiceId]);

  // Init Square SDK once invoice + SDK are ready
  useEffect(() => {
    if (pageState !== "ready" || !sdkReady || !invoice) return;
    if (!window.Square) return;

    (async () => {
      try {
        const appId = import.meta.env.VITE_SQUARE_APPLICATION_ID as string;
        const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID as string;

        const payments = window.Square.payments(appId, locationId);
        paymentsRef.current = payments;

        const card = await payments.card({
          style: {
            ".input-container": {
              borderColor: "#B08D57",
              borderRadius: "4px",
            },
            ".input-container.is-focused": { borderColor: "#F1E9D6" },
            input: {
              color: "#F1E9D6",
              fontFamily: "Montserrat, sans-serif",
              fontSize: "14px",
            },
            "input::placeholder": { color: "#6B7A6B" },
          },
        });
        await card.attach("#card-container");
        cardRef.current = card;

        const outstanding =
          invoice.outstanding_amount ?? invoice.grand_total ?? 0;
        const amountStr = outstanding.toFixed(2);
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
      } catch (err) {
        console.error("[PayInvoice] Square SDK init error:", err);
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
        const msg =
          result.errors?.[0]?.message ?? "Card tokenization failed";
        setPageState("ready");
        setErrorMsg(msg);
        return;
      }

      const outstanding =
        invoice.outstanding_amount ?? invoice.grand_total ?? 0;
      const amountCents = Math.round(outstanding * 100);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: anonKey,
      };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(
        `${supabaseUrl}/functions/v1/square-capture-payment`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            source_id: result.token as string,
            invoice_id: invoice.erp_name,
            amount_cents: amountCents,
          }),
        }
      );

      const resData = (await res.json()) as {
        status?: string;
        payment_id?: string;
        error?: string;
      };

      if (!res.ok) {
        setPageState("ready");
        setErrorMsg(
          resData.error ?? "Payment could not be processed. Please try again."
        );
        return;
      }

      setSuccessPaymentId(resData.payment_id ?? "");
      setPageState("success");
    } catch {
      setPageState("ready");
      setErrorMsg("An unexpected error occurred. Please try again.");
    }
  };

  const outstanding =
    invoice?.outstanding_amount ?? invoice?.grand_total ?? 0;
  const amountDisplay = invoice ? formatUSD(outstanding) : "";
  const customerName =
    invoice?.end_customer ?? invoice?.erp_customer ?? "Valued Customer";

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
          <div className="font-display italic text-3xl text-cream mb-3">
            Invoice not found
          </div>
          <p className="text-cream-muted">
            This invoice doesn&apos;t exist or the link may have expired.
          </p>
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
          <div className="font-display italic text-3xl text-cream mb-3">
            This invoice has already been paid
          </div>
          <p className="text-cream-muted text-sm">
            Invoice{" "}
            <span className="font-mono text-cream">{invoice?.erp_name}</span>{" "}
            is fully settled. Thank you!
          </p>
        </div>
      </div>
    );
  }

  if (pageState === "success") {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center px-6">
        <div className="text-center max-w-sm animate-fade-up">
          <div className="relative inline-flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full bg-signal-emerald/20 blur-3xl" />
            <CheckCircle2 className="relative h-16 w-16 text-signal-emerald" />
          </div>
          <div className="font-display italic text-4xl text-cream mb-2">
            Payment confirmed
          </div>
          <p className="text-cream-muted mb-1 text-sm">
            Invoice{" "}
            <span className="font-mono text-cream">{invoice?.erp_name}</span>
          </p>
          <p className="font-display italic text-brass-shimmer text-2xl mb-6">
            {amountDisplay}
          </p>
          <p className="text-cream-dim text-sm mb-6">
            Thank you, {customerName}. Your payment has been received.
          </p>
          <Link
            to="/"
            className="inline-block text-brass text-sm hover:text-brass-light transition-colors underline underline-offset-4"
          >
            Return to your account →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forest-deep px-5 py-10">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="font-display italic text-3xl text-cream mb-1">
            L&amp;S Custom Tailors
          </div>
          <div
            className="text-brass text-[10px] tracking-[0.2em] font-medium uppercase"
            style={{ fontFamily: "Montserrat, sans-serif" }}
          >
            Secure Payment
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Lock className="h-3 w-3 text-cream-dim" />
            <span className="text-cream-dim text-[10px]">
              Powered by Square
            </span>
          </div>
        </div>

        {/* Invoice summary card */}
        {invoice && (
          <div
            className="mb-5 rounded-xl border p-5"
            style={{
              backdropFilter: "blur(12px)",
              background: "rgba(15, 26, 16, 0.7)",
              borderColor: "rgba(176, 141, 87, 0.25)",
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div
                  className="text-cream-dim text-[9px] tracking-widest uppercase mb-1"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  Invoice
                </div>
                <div className="font-mono text-cream text-sm">
                  {invoice.erp_name}
                </div>
              </div>
              <div className="text-right">
                <div
                  className="text-cream-dim text-[9px] tracking-widest uppercase mb-1"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  Customer
                </div>
                <div className="text-cream text-sm">{customerName}</div>
              </div>
            </div>

            {Array.isArray(invoice.items) && invoice.items.length > 0 && (
              <div className="border-t border-brass/10 pt-3 mb-4 space-y-1.5">
                {invoice.items.slice(0, 6).map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-cream-muted truncate max-w-[60%]">
                      {item.item_name ?? item.description ?? "Item"}
                    </span>
                    <span className="text-cream-dim font-mono tabular-nums">
                      {item.amount != null ? formatUSD(item.amount) : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-brass/20 pt-4 flex items-end justify-between">
              <div>
                <div
                  className="text-cream-dim text-[9px] tracking-widest uppercase mb-1"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  Amount Due
                </div>
                {invoice.due_date && (
                  <div className="text-cream-dim text-xs">
                    Due {formatDate(invoice.due_date)}
                  </div>
                )}
              </div>
              <div className="font-display italic text-3xl text-brass-shimmer">
                {amountDisplay}
              </div>
            </div>
          </div>
        )}

        {/* Payment form */}
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{
            backdropFilter: "blur(12px)",
            background: "rgba(15, 26, 16, 0.7)",
            borderColor: "rgba(176, 141, 87, 0.3)",
          }}
        >
          {/* Apple Pay */}
          <div id="apple-pay-button" className="w-full min-h-[48px]" />

          {/* Google Pay */}
          <div id="google-pay-button" className="w-full min-h-[48px]" />

          {/* Card */}
          <div>
            <div
              className="flex items-center gap-2 text-cream-dim text-[9px] tracking-widest uppercase mb-2"
              style={{ fontFamily: "Montserrat, sans-serif" }}
            >
              <CreditCard className="h-3 w-3" />
              Card details
            </div>
            <div
              id="card-container"
              className="rounded-md min-h-[48px] px-1"
              style={{
                border: "1px solid rgba(176, 141, 87, 0.35)",
                background: "rgba(13, 26, 16, 0.5)",
                padding: "12px",
              }}
            />
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg p-3 text-sm text-signal-amber border border-signal-amber/20 bg-signal-amber/10">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <Button
            onClick={handlePay}
            disabled={pageState === "processing" || !sdkReady}
            className="w-full h-14 bg-brass text-forest-deep hover:bg-brass-light font-semibold text-base transition-all disabled:opacity-50"
          >
            {pageState === "processing" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing…
              </>
            ) : (
              <>Pay {amountDisplay}</>
            )}
          </Button>

          <p className="text-center text-cream-dim text-[10px]">
            Your payment is encrypted and processed securely by Square.
          </p>
        </div>
      </div>
    </div>
  );
}
