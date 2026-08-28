/**
 * Post-submit confirmation — SMS e-ticket, concierge email, selective print, view/edit, checkout.
 */
import { useMemo, useState } from "react";
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
  onDoneHome?: () => void;
};

function money(n?: number | string | null) {
  return formatMoney(n);
}

function firstName(full: string) {
  return (full || "there").trim().split(/\s+/)[0] || "there";
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
    mutationFn: async () => {
      // Prefer links already returned at create
      if (result.squarePaymentLink?.startsWith("http")) {
        return { url: result.squarePaymentLink };
      }
      const inv = result.salesInvoice;
      if (!inv) throw new Error("No invoice yet — open ticket to charge");
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: inv }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        ok?: boolean;
        error?: { message?: string };
      };
      if (res.ok && data.url) return data;
      // last resort: house pay page
      if (result.appPayUrl?.startsWith("http")) return { url: result.appPayUrl };
      throw new Error(data.error?.message || "Could not open checkout");
    },
    onSuccess: (data) => {
      if (data.url) {
        navigator.clipboard?.writeText(data.url).catch(() => undefined);
        window.open(data.url, "_blank", "noopener,noreferrer");
        toast.success("Square checkout opened");
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
        {billing === "billable" && (
          <button
            type="button"
            disabled={checkout.isPending || !result.salesInvoice}
            onClick={() => checkout.mutate()}
            className="min-h-[52px] rounded-2xl border border-brass bg-gradient-to-b from-[#D3AE72] to-[#B08D57] text-[#0C1810] font-bold text-[13px] tracking-wide uppercase inline-flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {checkout.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Checkout · Square
          </button>
        )}

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
