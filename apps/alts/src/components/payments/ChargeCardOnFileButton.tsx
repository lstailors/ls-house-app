import { useCallback, useEffect, useState } from "react";
import {
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@ls/design/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ls/design/ui/alert-dialog";
import { cn } from "@ls/design/utils";
import { api } from "@ls/api-client";
import {
  DeclineRecovery,
  isDeclineMessage,
  type DeclineAttempt,
} from "@alts/components/payments/DeclineRecovery";

type Stage = "idle" | "loading_cards" | "pick" | "confirming" | "charging" | "completed" | "error";

type PublicCard = {
  id: string;
  brand: string;
  last4: string;
  exp_month?: number | null;
  exp_year?: number | null;
  expired?: boolean;
  cardholder_name?: string;
};

/** Client-side fallback — Square often leaves expired cards enabled=true. */
function isExpiredCard(card: PublicCard): boolean {
  if (card.expired === true) return true;
  if (card.exp_month == null || card.exp_year == null) return false;
  const m = Number(card.exp_month);
  const y = Number(card.exp_year);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m < 1 || m > 12) return false;
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return y < cy || (y === cy && m < cm);
}

function expLabel(card: PublicCard): string | null {
  if (!card.exp_month || !card.exp_year) return null;
  return `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`;
}

interface ChargeCardOnFileButtonProps {
  /** ALT ticket name — preferred; backend resolves SI */
  ticketId?: string;
  /** Sales Invoice name if known */
  invoiceId?: string;
  amountDisplay: string;
  /** dollars — shown in confirm; server uses SI outstanding unless overridden */
  amountDollars?: number;
  customerLabel?: string;
  /** stretch trigger button (pickup / dispatch sidebars) */
  fullWidth?: boolean;
  className?: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function brandLabel(brand: string): string {
  const b = (brand || "").toUpperCase();
  if (b.includes("VISA")) return "Visa";
  if (b.includes("MASTER")) return "Mastercard";
  if (b.includes("AMEX") || b.includes("AMERICAN")) return "Amex";
  if (b.includes("DISCOVER")) return "Discover";
  return brand || "Card";
}

export function ChargeCardOnFileButton({
  ticketId,
  invoiceId,
  amountDisplay,
  amountDollars,
  customerLabel,
  fullWidth,
  className,
  onSuccess,
  onError,
}: ChargeCardOnFileButtonProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [cards, setCards] = useState<PublicCard[]>([]);
  const [selected, setSelected] = useState<PublicCard | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [emptyMsg, setEmptyMsg] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineAttempt, setDeclineAttempt] = useState<DeclineAttempt | null>(null);
  const [declineHistory, setDeclineHistory] = useState<DeclineAttempt[]>([]);

  const reset = useCallback(() => {
    setStage("idle");
    setCards([]);
    setSelected(null);
    setErrorMsg("");
    setEmptyMsg("");
    setDeclineOpen(false);
    setDeclineAttempt(null);
  }, []);

  const loadCards = useCallback(async () => {
    setStage("loading_cards");
    setErrorMsg("");
    setEmptyMsg("");
    try {
      const qs = new URLSearchParams();
      if (ticketId) qs.set("ticket", ticketId);
      else if (invoiceId) qs.set("invoice", invoiceId);
      const res = await api.raw(`/api/payments/cards?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? "Could not load cards");
      }
      const list = (data?.cards ?? []) as PublicCard[];
      setCards(list);
      const usable = list.filter((c) => !isExpiredCard(c));
      if (!list.length) {
        setEmptyMsg(
          data?.message ||
            "No card on file for this customer in Square. Use Terminal or Pay Link.",
        );
        setStage("pick");
        return;
      }
      if (!usable.length) {
        setEmptyMsg(
          data?.message ||
            "Cards on file are expired. Update the card in Square POS, or use Terminal / Pay Link.",
        );
        setSelected(null);
        setStage("pick");
        return;
      }
      setSelected(usable[0]);
      setStage("pick");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not load cards";
      setErrorMsg(msg);
      setEmptyMsg(msg);
      setCards([]);
      setStage("pick"); // keep sheet open so staff can read the full error
      onError(msg);
    }
  }, [ticketId, invoiceId, onError]);

  // Prefetch nothing on mount — only when staff opens the flow.

  const handleCharge = useCallback(async () => {
    if (!selected) return;
    if (isExpiredCard(selected)) {
      const exp = expLabel(selected) || "unknown";
      const msg = `Card ····${selected.last4} expired ${exp}. Update card in Square POS, or use Terminal / Pay Link.`;
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
      return;
    }
    setStage("charging");
    try {
      const res = await api.raw("/api/payments/card-on-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: selected.id,
          ...(ticketId ? { ticket: ticketId } : {}),
          ...(invoiceId && !ticketId ? { invoice: invoiceId } : {}),
          ...(amountDollars != null ? { amount: amountDollars } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? "Charge failed");
      }
      if (data?.ok === false && data?.status === "already_paid") {
        setStage("completed");
        onSuccess();
        return;
      }
      if (!data?.ok) {
        throw new Error(data?.status ? `Square status: ${data.status}` : "Charge not completed");
      }
      setStage("completed");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Charge failed";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
      if (isDeclineMessage(msg)) {
        const attempt: DeclineAttempt = {
          at: new Date().toISOString(),
          last4: selected?.last4,
          brand: selected ? brandLabel(selected.brand) : undefined,
          message: msg,
          retryable: /insufficient|declin|funds/i.test(msg),
        };
        setDeclineAttempt(attempt);
        setDeclineHistory((h) => [...h, attempt]);
        setDeclineOpen(true);
      }
    }
  }, [selected, ticketId, invoiceId, amountDollars, onSuccess, onError]);

  useEffect(() => {
    // no-op mount
  }, []);

  return (
    <div className={cn("flex items-center gap-2", fullWidth && "w-full")}>
      <Button
        onClick={() => {
          if (stage === "idle" || stage === "error") void loadCards();
        }}
        disabled={stage === "loading_cards" || stage === "charging" || stage === "completed"}
        className={cn(
          "relative h-12 px-5 font-medium transition-all border",
          fullWidth && "w-full justify-center",
          (stage === "idle" || stage === "pick" || stage === "confirming") &&
            "bg-brass/15 border-brass/50 text-brass hover:bg-brass/25 hover:border-brass",
          (stage === "loading_cards" || stage === "charging") &&
            "bg-brass/10 border-brass/30 text-cream-muted cursor-not-allowed",
          stage === "completed" &&
            "bg-signal-emerald/10 border-signal-emerald/40 text-signal-emerald",
          stage === "error" &&
            "bg-signal-amber/10 border-signal-amber/40 text-signal-amber hover:bg-signal-amber/20",
          className,
        )}
        variant="outline"
      >
        {stage === "idle" && (
          <>
            <CreditCard className="h-4 w-4 mr-2 shrink-0" />
            Card on file
          </>
        )}
        {stage === "loading_cards" && (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
            Loading cards…
          </>
        )}
        {stage === "charging" && (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
            Charging…
          </>
        )}
        {stage === "completed" && (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />
            Card charged
          </>
        )}
        {stage === "error" && (
          <>
            <AlertTriangle className="h-4 w-4 mr-2 shrink-0" />
            {errorMsg.length > 28 ? "Error — tap to retry" : errorMsg || "Error — retry"}
          </>
        )}
        {(stage === "pick" || stage === "confirming") && (
          <>
            <CreditCard className="h-4 w-4 mr-2 shrink-0" />
            Card on file
          </>
        )}
      </Button>

      {stage === "error" && (
        <Button
          onClick={reset}
          size="icon"
          variant="ghost"
          className="h-12 w-12 text-cream-dim hover:text-cream"
          title="Reset"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      <AlertDialog
        open={stage === "pick" || stage === "confirming"}
        onOpenChange={(open) => {
          if (!open && stage !== "charging" && stage !== "completed") reset();
        }}
      >
        <AlertDialogContent className="bg-forest-raised/95 backdrop-blur-xl border-brass/30 text-cream max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display italic text-2xl">
              {stage === "confirming" ? "Charge card on file?" : "Card on file"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-cream-muted leading-relaxed space-y-3">
              {customerLabel ? (
                <span className="block text-cream">
                  Customer: <span className="text-brass">{customerLabel}</span>
                </span>
              ) : null}
              {emptyMsg ? (
                <span className="block text-signal-amber">{emptyMsg}</span>
              ) : stage === "confirming" && selected ? (
                <span className="block">
                  Charge{" "}
                  <span className="text-brass font-semibold">{amountDisplay}</span> to{" "}
                  <span className="text-cream font-semibold">
                    {brandLabel(selected.brand)} ····{selected.last4}
                  </span>
                  . Customer does not need to be present. Never auto-bills — this
                  confirm is required.
                </span>
              ) : (
                <span className="block">Select a saved card, then confirm the charge.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {cards.length > 0 && stage === "pick" && (
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto py-1">
              {cards.map((card) => {
                const expired = isExpiredCard(card);
                const active = selected?.id === card.id;
                const exp = expLabel(card);
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={expired}
                    onClick={() => {
                      if (!expired) {
                        setEmptyMsg("");
                        setSelected(card);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-md border px-3 py-3 text-left transition-colors",
                      expired && "opacity-50 cursor-not-allowed border-signal-amber/30",
                      !expired && active && "border-brass bg-brass/15 text-cream",
                      !expired &&
                        !active &&
                        "border-brass/20 text-cream-muted hover:border-brass/40 hover:bg-brass/10",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard
                        className={cn(
                          "h-4 w-4 shrink-0",
                          expired ? "text-signal-amber" : "text-brass",
                        )}
                      />
                      <span className="font-medium">
                        {brandLabel(card.brand)} ····{card.last4}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        expired ? "text-signal-amber font-semibold" : "text-cream-dim",
                      )}
                    >
                      {expired ? `EXPIRED ${exp || ""}`.trim() : exp || ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              onClick={reset}
            >
              Cancel
            </AlertDialogCancel>
            {!emptyMsg && stage === "pick" && (
              <AlertDialogAction
                disabled={!selected || isExpiredCard(selected)}
                onClick={(e) => {
                  e.preventDefault();
                  setStage("confirming");
                }}
                className="bg-brass text-forest-deep hover:bg-brass-light font-semibold"
              >
                Continue
              </AlertDialogAction>
            )}
            {!emptyMsg && stage === "confirming" && selected && !isExpiredCard(selected) && (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void handleCharge();
                }}
                className="bg-brass text-forest-deep hover:bg-brass-light font-semibold"
              >
                Charge {amountDisplay} · ····{selected.last4}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {declineAttempt && (
        <DeclineRecovery
          open={declineOpen}
          onClose={() => setDeclineOpen(false)}
          ticketId={ticketId}
          invoiceId={invoiceId}
          amountDisplay={amountDisplay}
          amountDollars={amountDollars}
          customerLabel={customerLabel}
          attempt={declineAttempt}
          attempts={declineHistory}
          onRetrySameCard={() => {
            setDeclineOpen(false);
            setStage("confirming");
          }}
          onRecovered={() => {
            setDeclineOpen(false);
            reset();
            onSuccess();
          }}
        />
      )}
    </div>
  );
}
