/**
 * SPEC 013 — Card declined recovery (deliberate routes, no auto-retry).
 * Mock: ~/ls-design/alts-pos/013-decline
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { payUrl } from "@alts/lib/printUrls";
import LuxuryLayer from "@alts/components/LuxuryLayer";

export type DeclineAttempt = {
  at: string;
  last4?: string;
  brand?: string;
  message: string;
  code?: string;
  retryable: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  ticketId?: string;
  invoiceId?: string;
  amountDisplay: string;
  amountDollars?: number;
  customerLabel?: string;
  attempt: DeclineAttempt;
  attempts?: DeclineAttempt[];
  onRetrySameCard?: () => void;
  onRecovered?: () => void;
};

function parseCode(msg: string): string {
  const m = msg.match(/\b(CARD_DECLINED|INSUFFICIENT_FUNDS|GENERIC_DECLINE|CVV_FAILURE|EXPIRED_CARD)\b/i);
  if (m) return m[1].toUpperCase();
  if (/insufficient/i.test(msg)) return "INSUFFICIENT_FUNDS";
  if (/declin/i.test(msg)) return "CARD_DECLINED";
  return "CHARGE_FAILED";
}

export function isDeclineMessage(msg: string): boolean {
  return /declin|insufficient|card_declined|not authorized|do not honor|pickup card|expired card|cvv/i.test(
    msg || "",
  );
}

export function DeclineRecovery({
  open,
  onClose,
  ticketId,
  invoiceId,
  amountDisplay,
  customerLabel,
  attempt,
  attempts = [],
  onRetrySameCard,
  onRecovered,
}: Props) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const code = attempt.code || parseCode(attempt.message);
  const history = attempts.length ? attempts : [attempt];

  // Stay mounted while the sheet slides back.

  async function sendPayLink() {
    if (!invoiceId && !ticketId) {
      toast.error("No invoice on file — open Invoices to mint a link");
      return;
    }
    setBusy("link");
    try {
      const invoiceRef = invoiceId || ticketId!;
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: invoiceRef }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || data?.error || "Pay link failed");
      const url = data?.url || data?.data?.url || payUrl(invoiceRef);
      if (ticketId) {
        await api
          .post(`/api/intake-alterations/tickets/${encodeURIComponent(ticketId)}/sms`, {
            message: `Hi${customerLabel ? ` ${customerLabel.split(" ")[0]}` : ""} — your L&S balance ${amountDisplay} is ready to pay: ${url}`,
          })
          .catch(() => {
            /* link still minted */
          });
      }
      toast.success("Pay link ready — dispatch is not held");
      onRecovered?.();
      onClose();
      if (url && typeof window !== "undefined") {
        try {
          await navigator.clipboard.writeText(url);
          toast.message("Link copied");
        } catch {
          /* ignore */
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Pay link failed");
    } finally {
      setBusy(null);
    }
  }

  function takeTerminal() {
    onClose();
    if (invoiceId) {
      nav(`/invoices/${encodeURIComponent(invoiceId)}`);
      toast.message("Use Terminal on the invoice");
    } else if (ticketId) {
      nav(`/orders/alterations/${encodeURIComponent(ticketId)}`);
      toast.message("Use Terminal on the ticket");
    } else {
      nav("/invoices");
    }
  }

  function counterPickup() {
    onClose();
    if (ticketId) {
      nav(`/dispatch?ticket=${encodeURIComponent(ticketId)}`);
      toast.message("Switch delivery to counter pickup — no auto-dispatch on decline");
    } else {
      nav("/pickup");
    }
  }

  return (
    <LuxuryLayer open={open} onClose={onClose} variant="modal" label="Card declined" z={80}>
      <div className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-signal-amber/40 bg-forest-raised/98 text-cream shadow-glass-lg">
        <div className="flex items-start gap-3 p-5 border-b border-brass/15">
          <div className="h-11 w-11 rounded-full bg-signal-amber/15 border border-signal-amber/40 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-signal-amber" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="display text-2xl leading-none">Payment declined</div>
            <div className="caps mt-1 text-signal-amber">Nothing charged · nothing shipped</div>
            {(ticketId || customerLabel) && (
              <div className="text-[12px] text-cream-dim mt-2 truncate">
                {[ticketId, customerLabel].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 rounded-full border border-brass/25 flex items-center justify-center text-cream-dim"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="card-glass p-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-cream-dim">Reason</span>
              <span className="text-right">{attempt.message}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-cream-dim">Square code</span>
              <span className="font-mono text-brass-light">{code}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-cream-dim">Attempted</span>
              <span>{new Date(attempt.at).toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-cream-dim">Retryable</span>
              <span>{attempt.retryable ? "Yes — only if client says funds cleared" : "No"}</span>
            </div>
            {attempt.last4 && (
              <div className="flex justify-between gap-3">
                <span className="text-cream-dim">Card</span>
                <span>
                  {attempt.brand ? `${attempt.brand} ` : ""}····{attempt.last4}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-brass/20 bg-black/25 p-3 text-[12px] text-cream-dim space-y-1">
            <div className="caps text-cream mb-1">Nothing broke — state</div>
            <p>No Payment Entry was created.</p>
            <p>
              {invoiceId || "Invoice"} still open at <span className="text-cream">{amountDisplay}</span>.
            </p>
            <p>No LSH Delivery opened. Ticket stays Ready. Sofia stays quiet until you choose.</p>
          </div>

          {history.length > 0 && (
            <div>
              <div className="caps mb-2">Attempts on this invoice</div>
              <div className="space-y-2">
                {history.map((a, i) => (
                  <div
                    key={`${a.at}-${i}`}
                    className="flex items-start justify-between gap-2 text-[12px] border border-brass/15 rounded-lg px-3 py-2"
                  >
                    <div>
                      <div className="text-cream">
                        {a.last4 ? `····${a.last4}` : "Card"} · {a.code || parseCode(a.message)}
                      </div>
                      <div className="text-cream-dim truncate max-w-[240px]">{a.message}</div>
                    </div>
                    <div className="text-cream-dim shrink-0">
                      {new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="caps mb-2">How do you want to recover?</div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void sendPayLink()}
                className="btn-brass h-12 text-[12px] justify-between px-4 flex items-center"
              >
                <span>Send pay link · best</span>
                {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="opacity-70">Square Checkout</span>}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={takeTerminal}
                className="h-12 rounded-xl border border-brass/40 text-[12px] font-bold uppercase tracking-wide px-4 text-left hover:bg-brass/10"
              >
                Take a different card · Terminal
              </button>
              <button
                type="button"
                disabled={!!busy || !attempt.retryable || !onRetrySameCard}
                onClick={() => {
                  onClose();
                  onRetrySameCard?.();
                }}
                className={cn(
                  "h-12 rounded-xl border text-[12px] font-bold uppercase tracking-wide px-4 text-left",
                  attempt.retryable && onRetrySameCard
                    ? "border-brass/40 hover:bg-brass/10"
                    : "border-brass/15 text-cream-dim opacity-50",
                )}
              >
                Retry {attempt.last4 ? `····${attempt.last4}` : "same card"}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={counterPickup}
                className="h-12 rounded-xl border border-brass/40 text-[12px] font-bold uppercase tracking-wide px-4 text-left hover:bg-brass/10"
              >
                Switch to counter pickup
              </button>
            </div>
          </div>

          <p className="text-[12px] text-cream-dim leading-relaxed">
            No auto-retry — silent loops trip fraud rules and stack holds. A declined card stops
            dispatch because no money moved. A pay link does not hold dispatch.
          </p>
        </div>
      </div>
    </LuxuryLayer>
  );
}
