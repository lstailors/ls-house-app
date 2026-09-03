import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Banknote,
  FileText,
  Smartphone,
  Loader2,
  Undo2,
  CheckCircle2,
} from "lucide-react";
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
import { preferredTenderAmount } from "@alts/lib/intakePayment";

export type OutsideMethod = "cash" | "check" | "square_handheld";

type Snapshot = {
  ok?: boolean;
  ticket?: string | null;
  invoice?: string | null;
  outstanding?: number | null;
  grand_total?: number | null;
  payment_status?: string | null;
  square_payment_method?: string | null;
  check_number?: string | null;
  can_record?: boolean;
  can_void?: boolean;
  payment_entry?: string | null;
};

type PromptState =
  | null
  | { kind: "record"; method: OutsideMethod }
  | { kind: "void" };

interface OutsideTenderButtonsProps {
  ticketId?: string;
  invoiceId?: string;
  amountDollars: number;
  amountDisplay: string;
  fullWidth?: boolean;
  className?: string;
  /** Hide void when parent only wants record buttons */
  showVoid?: boolean;
  onSuccess: (info: { method?: string; status?: string }) => void;
  onError: (msg: string) => void;
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n || 0);
}

export function OutsideTenderButtons({
  ticketId,
  invoiceId,
  amountDollars,
  amountDisplay,
  fullWidth,
  className,
  showVoid = true,
  onSuccess,
  onError,
}: OutsideTenderButtonsProps) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [checkNumber, setCheckNumber] = useState("");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(amountDollars || ""));

  const load = useCallback(async () => {
    if (!ticketId && !invoiceId) return;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (ticketId) q.set("ticket", ticketId);
      if (invoiceId) q.set("invoice", invoiceId);
      const res = await api.raw(`/api/payments/outside?${q.toString()}`);
      const data = (await res.json().catch(() => ({}))) as Snapshot & {
        error?: { message?: string } | string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : data.error?.message || "Could not load payment options",
        );
      }
      setSnap(data);
      const outstanding =
        typeof data.outstanding === "number" && data.outstanding > 0
          ? data.outstanding
          : amountDollars;
      // Keep a deliberate partial request, while clamping stale bag totals to
      // the live SI balance so Payment Entry never overpays.
      setAmount(String(preferredTenderAmount(amountDollars, outstanding)));
    } catch (e) {
      // Non-fatal — still allow record with local amount
      setSnap({
        can_record: amountDollars > 0,
        can_void: false,
        outstanding: amountDollars,
      });
    } finally {
      setLoading(false);
    }
  }, [ticketId, invoiceId, amountDollars]);

  useEffect(() => {
    void load();
  }, [load]);

  // Seed from the parent intent without ever crossing the live outstanding.
  useEffect(() => {
    if (typeof snap?.outstanding === "number" && snap.outstanding > 0) {
      setAmount(String(preferredTenderAmount(amountDollars, snap.outstanding)));
      return;
    }
    if (amountDollars > 0) setAmount(String(amountDollars));
  }, [amountDollars, snap?.outstanding, ticketId, invoiceId]);

  const canRecord =
    (snap?.can_record ?? amountDollars > 0) &&
    (snap?.payment_status !== "Paid" || (snap?.outstanding ?? 0) > 0.02);
  const canVoid = Boolean(showVoid && snap?.can_void);

  const submitRecord = async (method: OutsideMethod) => {
    setBusy(true);
    try {
      if (method === "check" && !checkNumber.trim()) {
        throw new Error("Check number is required");
      }
      let amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error("Amount must be positive");
      }
      // Hard clamp to outstanding so bag-total never blows past one SI.
      if (typeof snap?.outstanding === "number" && snap.outstanding > 0.02) {
        if (amt - snap.outstanding > 0.02) {
          amt = snap.outstanding;
          setAmount(String(snap.outstanding));
        }
      }
      const res = await api.raw("/api/payments/outside", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(ticketId ? { ticket: ticketId } : {}),
          ...(invoiceId ? { invoice: invoiceId } : {}),
          method,
          amount: amt,
          ...(method === "check" ? { check_number: checkNumber.trim() } : {}),
          ...(method === "square_handheld" && reference.trim()
            ? { reference: reference.trim() }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        const raw =
          data?.error?.message ||
          data?.error ||
          data?.message ||
          data?.exception ||
          "";
        // Prefer Frappe _server_messages when present
        let detail = typeof raw === "string" ? raw : "";
        if (!detail && typeof data?._server_messages === "string") {
          try {
            const arr = JSON.parse(data._server_messages) as unknown[];
            const first = typeof arr[0] === "string" ? JSON.parse(arr[0] as string) : arr[0];
            detail = String((first as any)?.message || "");
          } catch {
            detail = data._server_messages;
          }
        }
        throw new Error(
          (detail || "Could not record payment").replace(/<[^>]+>/g, " ").trim().slice(0, 280),
        );
      }
      setPrompt(null);
      setCheckNumber("");
      setReference("");
      await load();
      onSuccess({ method, status: data?.status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not record payment";
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const submitVoid = async () => {
    setBusy(true);
    try {
      const res = await api.raw("/api/payments/outside/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(ticketId ? { ticket: ticketId } : {}),
          ...(invoiceId ? { invoice: invoiceId } : {}),
          ...(snap?.payment_entry ? { payment_entry: snap.payment_entry } : {}),
          confirm: 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(
          data?.error?.message ||
            data?.error ||
            data?.message ||
            "Could not void payment",
        );
      }
      setPrompt(null);
      await load();
      onSuccess({ status: "voided" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not void payment";
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const btn = (opts: {
    key: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    tone?: "brass" | "amber" | "muted";
    disabled?: boolean;
  }) => (
    <button
      key={opts.key}
      type="button"
      disabled={opts.disabled || busy || loading}
      onClick={opts.onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl border text-[12px] font-bold tracking-widest uppercase transition-colors disabled:opacity-40",
        fullWidth && "w-full",
        opts.tone === "amber" &&
          "border-signal-amber/40 bg-signal-amber/10 text-signal-amber hover:bg-signal-amber/20",
        opts.tone === "muted" &&
          "border-brass/20 bg-black/20 text-cream-dim hover:bg-brass/10 hover:text-cream",
        (!opts.tone || opts.tone === "brass") &&
          "border-brass/40 bg-brass/15 text-brass hover:bg-brass/25",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : opts.icon}
      {opts.label}
    </button>
  );

  const methodTitle: Record<OutsideMethod, string> = {
    cash: "Paid via Cash",
    check: "Paid via Check",
    square_handheld: "Paid via Square Handheld",
  };

  return (
    <div className={cn("space-y-2", className)}>
      {canRecord && (
        <div
          className={cn(
            "flex gap-2",
            fullWidth ? "flex-col" : "flex-wrap items-center justify-end",
          )}
        >
          {btn({
            key: "cash",
            label: fullWidth ? `Cash · ${amountDisplay}` : "Cash",
            icon: <Banknote className="h-4 w-4 shrink-0" />,
            onClick: () => setPrompt({ kind: "record", method: "cash" }),
          })}
          {btn({
            key: "check",
            label: fullWidth ? `Check · ${amountDisplay}` : "Check",
            icon: <FileText className="h-4 w-4 shrink-0" />,
            onClick: () => setPrompt({ kind: "record", method: "check" }),
          })}
          {btn({
            key: "handheld",
            label: fullWidth
              ? `Square handheld · ${amountDisplay}`
              : "Square handheld",
            icon: <Smartphone className="h-4 w-4 shrink-0" />,
            onClick: () =>
              setPrompt({ kind: "record", method: "square_handheld" }),
          })}
        </div>
      )}

      {canVoid &&
        btn({
          key: "void",
          label: snap?.square_payment_method
            ? `Undo ${snap.square_payment_method}`
            : "Undo / void payment",
          icon: <Undo2 className="h-4 w-4 shrink-0" />,
          tone: "amber",
          onClick: () => setPrompt({ kind: "void" }),
        })}

      {!canRecord && !canVoid && snap?.payment_status === "Paid" && (
        <div className="inline-flex items-center gap-1.5 text-sm text-signal-emerald">
          <CheckCircle2 className="h-4 w-4" />
          Paid
          {snap.square_payment_method ? ` · ${snap.square_payment_method}` : ""}
          {snap.check_number ? ` #${snap.check_number}` : ""}
        </div>
      )}

      <AlertDialog
        open={prompt?.kind === "record"}
        onOpenChange={(open) => {
          if (!open) setPrompt(null);
        }}
      >
        <AlertDialogContent className="bg-forest-raised/95 backdrop-blur-xl border-brass/30 text-cream max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display italic text-2xl">
              {prompt?.kind === "record"
                ? methodTitle[prompt.method]
                : "Record payment"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-cream-muted leading-relaxed">
              Records a payment already taken at the counter (does not charge a
              card). Creates a Payment Entry so the invoice can be matched later.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <label className="block text-xs uppercase tracking-widest text-cream-dim">
              Amount
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full h-11 rounded-lg border border-brass/25 bg-forest-deep px-3 text-cream tabular-nums"
              />
            </label>
            {prompt?.kind === "record" && prompt.method === "check" && (
              <label className="block text-xs uppercase tracking-widest text-cream-dim">
                Check number <span className="text-signal-amber">required</span>
                <input
                  type="text"
                  value={checkNumber}
                  onChange={(e) => setCheckNumber(e.target.value)}
                  placeholder="e.g. 4521"
                  className="mt-1 w-full h-11 rounded-lg border border-brass/25 bg-forest-deep px-3 text-cream"
                  autoFocus
                />
              </label>
            )}
            {prompt?.kind === "record" && prompt.method === "square_handheld" && (
              <label className="block text-xs uppercase tracking-widest text-cream-dim">
                Square payment ID{" "}
                <span className="normal-case tracking-normal text-cream-dim/80">
                  (optional)
                </span>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="From handheld receipt"
                  className="mt-1 w-full h-11 rounded-lg border border-brass/25 bg-forest-deep px-3 text-cream"
                />
              </label>
            )}
            {typeof snap?.outstanding === "number" && (
              <p className="text-xs text-cream-dim">
                Outstanding on invoice:{" "}
                <span className="text-cream font-semibold tabular-nums">{money(snap.outstanding)}</span>
                {(Number(amount) || 0) - snap.outstanding > 0.02 && (
                  <span className="block text-signal-amber mt-1">
                    Amount is higher than outstanding — ERP will reject. Match the invoice total.
                  </span>
                )}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (prompt?.kind === "record") void submitRecord(prompt.method);
              }}
              className="bg-brass text-forest-deep hover:bg-brass-light font-semibold"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Record · {money(Number(amount) || 0)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={prompt?.kind === "void"}
        onOpenChange={(open) => {
          if (!open) setPrompt(null);
        }}
      >
        <AlertDialogContent className="bg-forest-raised/95 backdrop-blur-xl border-signal-amber/30 text-cream max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display italic text-2xl text-signal-amber">
              Undo this payment?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-cream-muted leading-relaxed">
              Cancels the Payment Entry
              {snap?.payment_entry ? (
                <>
                  {" "}
                  <span className="font-mono text-brass-light">
                    {snap.payment_entry}
                  </span>
                </>
              ) : null}{" "}
              and clears the ticket payment stamps so you can record again.
              {snap?.square_payment_method
                ? ` Method on file: ${snap.square_payment_method}.`
                : ""}
              {snap?.check_number ? ` Check #${snap.check_number}.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
            >
              Keep payment
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void submitVoid();
              }}
              className="bg-signal-amber text-forest-deep hover:bg-signal-amber/90 font-semibold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Void payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
