/**
 * Post-submit confirmation — SMS e-ticket, concierge email, selective print, view/edit, checkout.
 */
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  CreditCard,
  Mail,
  MessageSquare,
  Printer,
  ExternalLink,
  Tag,
  FileText,
  Store,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { formatMoney } from "@alts/lib/money";
import { ChargeTerminalButton } from "@alts/components/payments/ChargeTerminalButton";
import { ChargeCardOnFileButton } from "@alts/components/payments/ChargeCardOnFileButton";
import { OutsideTenderButtons } from "@alts/components/payments/OutsideTenderButtons";
import type { IntakePaymentIntent, IntakePaymentMethod } from "@alts/lib/intakePayment";

export type IntakeConfirmResult = {
  ticketName: string;
  salesInvoice?: string | null;
  squarePaymentLink?: string | null;
  appPayUrl?: string | null;
  invoiceTotal?: number | null;
  sellWarnings?: string[];
};

type Props = {
  result: IntakeConfirmResult;
  clientName: string;
  /** Trade Account end-customer display name (optional) */
  endCustomerName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  pieceCount: number;
  /** alter-only or SI total when mixed */
  totalLabel: string;
  billing: "billable" | "on_order" | "redo";
  promiseLabel?: string | null;
  paymentIntent?: IntakePaymentIntent | null;
  onDoneHome?: () => void;
};

function money(n?: number | string | null) {
  return formatMoney(n);
}

function firstName(full: string) {
  return (full || "there").trim().split(/\s+/)[0] || "there";
}

const PAYMENT_METHOD_LABEL: Record<IntakePaymentMethod, string> = {
  counter_terminal: "Counter Terminal",
  mobile_terminal: "Mobile Terminal",
  card_on_file: "Card on file",
  cash: "Cash",
  check: "Check",
  square_handheld: "Square handheld",
  pay_link: "Pay link / QR",
};

function numberFromMoneyLabel(label: string): number {
  const parsed = Number(String(label || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function reprintFlag(ticketName: string) {
  try {
    return sessionStorage.getItem(`ls-print-seen:${ticketName}`) === "1" ? 1 : 0;
  } catch {
    return 0;
  }
}

function markPrinted(ticketName: string) {
  try {
    sessionStorage.setItem(`ls-print-seen:${ticketName}`, "1");
  } catch {
    /* ignore */
  }
}

async function printJson(path: string, body: Record<string, unknown>) {
  const res = await api.raw(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string | { message?: string } };
  if (!result.ok) {
    const err = result.error;
    throw new Error(typeof err === "string" ? err : err?.message || "Print failed");
  }
  return result;
}

export default function IntakeConfirm({
  result,
  clientName,
  clientPhone,
  clientEmail,
  pieceCount,
  totalLabel,
  billing,
  promiseLabel,
  paymentIntent,
  onDoneHome,
}: Props) {
  const nav = useNavigate();
  const ticket = result.ticketName;
  const payUrl =
    result.squarePaymentLink ||
    result.appPayUrl ||
    (result.salesInvoice ? `https://app.lstailors.com/pay/${encodeURIComponent(result.salesInvoice)}` : null);
  const eTicketUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/e-ticket/${encodeURIComponent(ticket)}`
      : `https://alts.lstailors.com/e-ticket/${encodeURIComponent(ticket)}`;
  const invoiceTotal = Math.max(
    0,
    Number(result.invoiceTotal ?? numberFromMoneyLabel(totalLabel)) || 0,
  );
  const initialPaymentAmount =
    paymentIntent?.amount && paymentIntent.amount > 0
      ? Math.min(paymentIntent.amount, invoiceTotal || paymentIntent.amount)
      : invoiceTotal;
  const [paymentAmountInput, setPaymentAmountInput] = useState(
    initialPaymentAmount > 0 ? initialPaymentAmount.toFixed(2) : "",
  );
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const paymentAmount = Number(paymentAmountInput);
  const paymentError =
    !Number.isFinite(paymentAmount) || paymentAmount <= 0
      ? "Enter an amount above $0.00"
      : invoiceTotal > 0 && paymentAmount - invoiceTotal > 0.005
        ? `Amount cannot exceed ${money(invoiceTotal)}`
        : null;
  const paymentAmountDisplay = paymentError ? "—" : money(paymentAmount);

  const [printSel, setPrintSel] = useState({
    tags: true,
    customer: true,
    store: true,
  });

  const smsBody = useMemo(() => {
    const name = firstName(clientName);
    const parts = [
      `Hi ${name}, your L&S alteration ticket is open: ${ticket}.`,
      pieceCount ? `${pieceCount} piece${pieceCount === 1 ? "" : "s"}.` : null,
      promiseLabel ? `Promised ${promiseLabel}.` : null,
      billing === "billable" && result.invoiceTotal
        ? `Balance ${money(Number(result.invoiceTotal))}.`
        : billing === "billable" && totalLabel
          ? `Balance ${totalLabel}.`
          : null,
      `E-ticket: ${eTicketUrl}`,
      payUrl && billing === "billable" ? `Pay: ${payUrl}` : null,
    ].filter(Boolean);
    return parts.join(" ");
  }, [
    clientName,
    ticket,
    pieceCount,
    promiseLabel,
    billing,
    result.invoiceTotal,
    totalLabel,
    eTicketUrl,
    payUrl,
  ]);

  const emailSubject = `Your L&S alteration ticket ${ticket}`;
  const emailBody = useMemo(() => {
    const name = firstName(clientName);
    return [
      `<p>Hi ${name},</p>`,
      `<p>Your alteration ticket <strong>${ticket}</strong> is confirmed.</p>`,
      promiseLabel ? `<p>Promised: <strong>${promiseLabel}</strong></p>` : "",
      pieceCount ? `<p>Pieces: ${pieceCount}</p>` : "",
      billing === "billable"
        ? `<p>Balance: <strong>${result.invoiceTotal != null ? money(Number(result.invoiceTotal)) : totalLabel}</strong></p>`
        : billing === "on_order"
          ? `<p>Billing: included with custom order.</p>`
          : `<p>Billing: re-do / no charge.</p>`,
      `<p><a href="${eTicketUrl}">View e-ticket</a></p>`,
      payUrl && billing === "billable"
        ? `<p><a href="${payUrl}">Pay securely online</a></p>`
        : "",
      `<p style="color:#888;font-size:12px">L&S Custom Tailors · 138 E 61st St · (212) 308-4431</p>`,
    ]
      .filter(Boolean)
      .join("");
  }, [clientName, ticket, promiseLabel, pieceCount, billing, result.invoiceTotal, totalLabel, eTicketUrl, payUrl]);

  const sendSms = useMutation({
    mutationFn: async () => {
      if (!clientPhone?.trim()) throw new Error("No phone on file");
      return api.post(`/api/intake-alterations/tickets/${encodeURIComponent(ticket)}/sms`, {
        phone: clientPhone.trim(),
        message: smsBody,
        includeQr: true,
      });
    },
    onSuccess: () => toast.success("SMS sent via Sofia"),
    onError: (e: Error) => toast.error(e.message || "SMS failed"),
  });

  const sendEmail = useMutation({
    mutationFn: async () => {
      if (!clientEmail?.trim()) throw new Error("No email on file");
      return api.post(`/api/intake-alterations/tickets/${encodeURIComponent(ticket)}/email`, {
        to_email: clientEmail.trim(),
        subject: emailSubject,
        message: emailBody,
      });
    },
    onSuccess: () => toast.success("Email queued from Concierge"),
    onError: (e: Error) => toast.error(e.message || "Email failed"),
  });

  const printSelected = useMutation({
    mutationFn: async () => {
      const reprint = reprintFlag(ticket);
      const jobs: Array<Promise<unknown>> = [];
      if (printSel.tags) {
        jobs.push(printJson("/api/print/tags", { ticket_name: ticket, reprint }));
      }
      // customer + store both come from thermal ticket what=
      // receipts = customer copies; ticket what=all includes office+customer+tags
      // For selective: tags via /tags; store master via what that builds office; customer via receipts
      if (printSel.store && printSel.customer && !printSel.tags) {
        jobs.push(printJson("/api/print/ticket", { ticket_name: ticket, what: "all", reprint }));
      } else {
        if (printSel.store) {
          // office/store master
          jobs.push(printJson("/api/print/ticket", { ticket_name: ticket, what: "office", reprint }));
        }
        if (printSel.customer) {
          jobs.push(
            printJson("/api/print/receipt", {
              invoice: result.salesInvoice || ticket,
              ticket_name: ticket,
              reprint,
            }),
          );
        }
      }
      if (!jobs.length) throw new Error("Select at least one print item");
      const results = await Promise.allSettled(jobs);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length === results.length) {
        const msg = failed[0].status === "rejected" ? String(failed[0].reason?.message || failed[0].reason) : "Print failed";
        throw new Error(msg);
      }
      markPrinted(ticket);
      return { ok: true, partial: failed.length > 0, failed: failed.length };
    },
    onSuccess: (r) =>
      toast.success(r.partial ? "Some prints sent — check printer" : "Sent to printer"),
    onError: (e: Error) => toast.error(e.message || "Print failed"),
  });

  const checkout = useMutation({
    mutationFn: async (amount?: number) => {
      const explicitAmount =
        amount != null && Number.isFinite(amount) && amount > 0 ? amount : undefined;
      const isFullBalance =
        explicitAmount == null ||
        invoiceTotal <= 0 ||
        Math.abs(explicitAmount - invoiceTotal) <= 0.005;
      // Reuse the invoice's canonical link only for the full balance. Partial
      // payments need an amount-specific link and must not overwrite it.
      if (isFullBalance && result.squarePaymentLink?.startsWith("http")) {
        return { url: result.squarePaymentLink };
      }
      const inv = result.salesInvoice;
      if (!inv) throw new Error("No invoice yet — open ticket to charge");
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: inv,
          ...(explicitAmount != null ? { amount: explicitAmount } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        ok?: boolean;
        error?: { message?: string };
      };
      if (res.ok && data.url) return data;
      // The house pay page represents the full balance, so it is not a safe
      // fallback for a failed partial-link request.
      if (isFullBalance && result.appPayUrl?.startsWith("http")) {
        return { url: result.appPayUrl };
      }
      throw new Error(data.error?.message || "Could not open checkout");
    },
    onSuccess: (data) => {
      if (data.url) {
        navigator.clipboard?.writeText(data.url).catch(() => undefined);
        setPaymentLinkUrl(data.url);
        toast.success("Pay link and QR ready");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePrint = (k: keyof typeof printSel) =>
    setPrintSel((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-10 px-4 md:px-6 max-w-xl mx-auto w-full">
      <div className="pt-8 pb-4 text-center">
        <div className="mx-auto w-14 h-14 rounded-full border border-brass/50 bg-brass/15 grid place-items-center mb-4">
          <Check className="w-7 h-7 text-brass-light" strokeWidth={2.5} />
        </div>
        <h1 className="display text-[34px] leading-none italic text-cream">Confirmed</h1>
        <p className="text-[13px] text-cream-dim mt-2">Ticket is live — finish comms & print</p>
      </div>

      <div className="rounded-2xl border border-brass/30 bg-black/30 p-4 mb-4">
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">Ticket</div>
        <div className="display text-[26px] text-cream mt-0.5 leading-tight">{ticket}</div>
        {result.salesInvoice && (
          <div className="text-[12px] text-cream-dim mt-1">{result.salesInvoice}</div>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <span>
            <span className="text-cream-dim">Client </span>
            <span className="font-semibold">{clientName}</span>
          </span>
          {pieceCount > 0 && (
            <span>
              <span className="text-cream-dim">Pieces </span>
              <span className="font-semibold">{pieceCount}</span>
            </span>
          )}
          {promiseLabel && (
            <span>
              <span className="text-cream-dim">Promise </span>
              <span className="font-semibold">{promiseLabel}</span>
            </span>
          )}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-brass/15 pt-3">
          <span className="text-[10px] font-bold tracking-widest uppercase text-cream-dim">
            {billing === "billable" ? "Balance" : billing === "on_order" ? "On order" : "Re-do"}
          </span>
          <span className="display text-[28px] text-brass-light leading-none">
            {billing === "billable"
              ? result.invoiceTotal != null
                ? money(Number(result.invoiceTotal))
                : totalLabel
              : "—"}
          </span>
        </div>
        {!!result.sellWarnings?.length && (
          <p className="text-[11px] text-signal-amber mt-2">{result.sellWarnings.join(" · ")}</p>
        )}
      </div>

      {/* Payment */}
      {billing === "billable" && result.salesInvoice && (
        <section className="mb-4 rounded-2xl border border-brass/35 bg-black/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
                Collect payment
              </div>
              <div className="mt-1 text-[12px] text-cream-dim">
                {paymentIntent
                  ? `Review choice · ${PAYMENT_METHOD_LABEL[paymentIntent.method]}`
                  : "No payment selected at Review · collect now or leave the balance open"}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] font-bold uppercase tracking-widest text-cream-dim">Amount</div>
              <div className="display text-[23px] leading-tight text-brass-light">
                {paymentAmountDisplay}
              </div>
            </div>
          </div>

          <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.14em] text-cream-dim">
            Full or partial amount
            <div className="relative mt-1.5">
              <span className="absolute inset-y-0 left-4 flex items-center text-brass-light">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={paymentAmountInput}
                onChange={(event) => {
                  setPaymentAmountInput(event.target.value);
                  setPaymentLinkUrl(null);
                }}
                aria-invalid={Boolean(paymentError)}
                className={cn(
                  "h-12 w-full rounded-xl border bg-forest-deep pl-8 pr-3 text-[17px] tabular-nums text-cream outline-none",
                  paymentError ? "border-signal-amber" : "border-brass/30 focus:border-brass",
                )}
              />
            </div>
            {paymentError && (
              <span className="mt-1 block normal-case tracking-normal text-[11px] text-signal-amber">
                {paymentError}
              </span>
            )}
          </label>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ChargeTerminalButton
              invoiceId={result.salesInvoice}
              ticketId={ticket}
              amountCents={paymentError ? 0 : Math.round(paymentAmount * 100)}
              amountDisplay={paymentAmountDisplay}
              onSuccess={() => toast.success("Terminal payment completed")}
              onError={(message) => toast.error(message)}
            />
            <ChargeCardOnFileButton
              invoiceId={result.salesInvoice}
              ticketId={ticket}
              amountDollars={paymentError ? undefined : paymentAmount}
              amountDisplay={paymentAmountDisplay}
              customerLabel={clientName}
              onSuccess={() => toast.success("Card on file charged")}
              onError={(message) => toast.error(message)}
            />
          </div>

          <div className="mt-2">
            <OutsideTenderButtons
              ticketId={ticket}
              invoiceId={result.salesInvoice}
              amountDollars={paymentError ? 0 : paymentAmount}
              amountDisplay={paymentAmountDisplay}
              showVoid={false}
              onSuccess={({ method }) => toast.success(`${method || "Payment"} recorded`)}
              onError={(message) => toast.error(message)}
            />
          </div>

          <button
            type="button"
            disabled={Boolean(paymentError) || checkout.isPending}
            onClick={() => checkout.mutate(paymentAmount)}
            className="mt-2 min-h-[48px] w-full rounded-xl border border-brass/40 bg-brass/12 text-[12px] font-bold uppercase tracking-widest text-brass-light disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Pay link / QR
          </button>

          {paymentLinkUrl && (
            <div className="mt-3 rounded-2xl border border-brass/25 bg-cream p-4 text-center">
              <QRCodeSVG
                value={paymentLinkUrl}
                size={180}
                level="M"
                bgColor="#F1E9D6"
                fgColor="#0D1A10"
                className="mx-auto"
              />
              <div className="mt-3 text-[12px] font-semibold text-forest-deep">
                Customer scans to pay {paymentAmountDisplay}
              </div>
              <a
                href={paymentLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-forest-deep px-5 text-[11px] font-bold uppercase tracking-widest text-cream"
              >
                Open Square
              </a>
            </div>
          )}
        </section>
      )}

      {/* Comms */}
      <div className="mb-3">
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2 px-0.5">
          Send
        </div>
        <div className="grid gap-2">
          <button
            type="button"
            disabled={!clientPhone || sendSms.isPending}
            onClick={() => sendSms.mutate()}
            className={cn(
              "min-h-[56px] rounded-2xl border px-4 py-3 flex items-center gap-3 text-left",
              clientPhone
                ? "border-brass/35 bg-brass/[0.08] hover:border-brass/55"
                : "border-brass/15 opacity-45 cursor-not-allowed",
            )}
          >
            {sendSms.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin text-brass-light shrink-0" />
            ) : (
              <MessageSquare className="w-5 h-5 text-brass-light shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold">SMS via Sofia</span>
              <span className="block text-[11px] text-cream-dim truncate">
                E-ticket{payUrl && billing === "billable" ? " + pay link" : ""} · {clientPhone || "no phone"}
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={!clientEmail || sendEmail.isPending}
            onClick={() => sendEmail.mutate()}
            className={cn(
              "min-h-[56px] rounded-2xl border px-4 py-3 flex items-center gap-3 text-left",
              clientEmail
                ? "border-brass/35 bg-white/[0.03] hover:border-brass/55"
                : "border-brass/15 opacity-45 cursor-not-allowed",
            )}
          >
            {sendEmail.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin text-brass-light shrink-0" />
            ) : (
              <Mail className="w-5 h-5 text-brass-light shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold">Email from Concierge</span>
              <span className="block text-[11px] text-cream-dim truncate">
                {clientEmail || "no email on file"}
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* Print */}
      <div className="mb-3">
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2 px-0.5">
          Print
        </div>
        <div className="rounded-2xl border border-brass/30 bg-black/25 overflow-hidden">
          {(
            [
              { k: "tags" as const, label: "Garment tags", sub: "Hang tag per piece", Icon: Tag },
              { k: "customer" as const, label: "Customer copy", sub: "Receipt with pickup terms", Icon: FileText },
              { k: "store" as const, label: "Store master", sub: "Shop rack copy", Icon: Store },
            ] as const
          ).map(({ k, label, sub, Icon }) => {
            const on = printSel[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => togglePrint(k)}
                className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-brass/10 last:border-0 text-left"
              >
                <span
                  className={cn(
                    "w-5 h-5 rounded-md border grid place-items-center shrink-0",
                    on ? "bg-brass border-brass text-[#0C1810]" : "border-brass/35",
                  )}
                >
                  {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                </span>
                <Icon className="w-4 h-4 text-brass-light shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold">{label}</span>
                  <span className="block text-[11px] text-cream-dim">{sub}</span>
                </span>
              </button>
            );
          })}
          <div className="p-3 border-t border-brass/15">
            <button
              type="button"
              disabled={printSelected.isPending || (!printSel.tags && !printSel.customer && !printSel.store)}
              onClick={() => printSelected.mutate()}
              className="btn-brass w-full min-h-[48px] rounded-xl text-[12px] font-bold tracking-widest uppercase disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {printSelected.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              Print selected
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="grid gap-2 mb-4">
        <button
          type="button"
          onClick={() => nav(`/orders/alterations/${encodeURIComponent(ticket)}`)}
          className="min-h-[52px] rounded-2xl border border-brass/35 bg-white/[0.03] text-cream font-semibold text-[13px] inline-flex items-center justify-center gap-2 hover:border-brass/55"
        >
          <ExternalLink className="w-4 h-4 text-brass-light" />
          View / edit ticket
        </button>

        <button
          type="button"
          onClick={() => {
            onDoneHome?.();
            nav("/");
          }}
          className="min-h-[44px] text-[12px] font-bold tracking-widest uppercase text-brass-light"
        >
          Done · Home
        </button>
      </div>
    </div>
  );
}
