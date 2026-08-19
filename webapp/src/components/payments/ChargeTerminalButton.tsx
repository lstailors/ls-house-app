import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Terminal,
  Smartphone,
  Banknote,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@ls/design/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ls/design/ui/alert-dialog";
import { cn } from "@ls/design/utils";
import { api } from "@ls/api-client";

type Stage =
  | "idle"
  | "confirming"
  | "sending"
  | "waiting"
  | "completed"
  | "error";

type PayMethod = "counter" | "mobile" | "cash";

interface ChargeTerminalButtonProps {
  invoiceId: string;
  amountCents: number;
  amountDisplay: string;
  deviceId?: string;
  ticketId?: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
  autoStart?: boolean;
}

export function ChargeTerminalButton({
  invoiceId,
  amountCents,
  amountDisplay,
  ticketId,
  onSuccess,
  onError,
  autoStart,
}: ChargeTerminalButtonProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [mobileReady, setMobileReady] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    if (autoStart && stage === "idle") setStage("confirming");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(() => {
    if (stage !== "confirming") return;
    let cancelled = false;
    api
      .raw("/api/payments/terminals")
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const terminals = data?.terminals ?? data?.data?.terminals ?? [];
        const mobile = terminals.find((t: { id?: string }) => t.id === "mobile");
        setMobileReady(Boolean(mobile?.configured || mobile?.device_id));
      })
      .catch(() => {
        if (!cancelled) setMobileReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const pollCheckoutStatus = (checkoutId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.raw(`/api/payments/terminal-checkout/${checkoutId}`);
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(result?.error?.message ?? result?.error ?? "Could not poll terminal");
        }
        const status = (result?.status ?? result?.data?.status ?? "").toUpperCase();

        if (status === "COMPLETED") {
          cleanup();
          setStage("completed");
          onSuccess();
        } else if (status === "CANCELED" || status === "CANCELLED" || status === "FAILED") {
          cleanup();
          const msg = "Terminal payment failed or was cancelled";
          setStage("error");
          setErrorMsg(msg);
          onError(msg);
        }
      } catch {
        // Keep polling until timeout
      }
    }, 2000);

    timeoutRef.current = setTimeout(() => {
      cleanup();
      const msg = "Terminal timed out — please retry";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
    }, 3 * 60 * 1000);
  };

  const startTerminal = async (device: "counter" | "mobile") => {
    setStage("sending");
    try {
      const res = await api.raw("/api/payments/terminal-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(ticketId ? { ticket: ticketId } : { invoice: invoiceId }),
          amount: amountCents / 100,
          device,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? "Failed to reach terminal");
      }
      const checkoutId = data?.checkout_id ?? data?.data?.checkout_id;
      if (!checkoutId) {
        throw new Error(data?.error?.message ?? data?.error ?? "No checkout ID returned");
      }

      setStage("waiting");
      pollCheckoutStatus(checkoutId as string);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reach terminal";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
    }
  };

  const startCash = async () => {
    setStage("sending");
    try {
      const res = await api.raw("/api/payments/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(ticketId ? { ticket: ticketId } : { invoice: invoiceId }),
          amount: amountCents / 100,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message ?? data?.error ?? "Could not record cash");
      }
      if (data?.ok === false && data?.status === "already_paid") {
        setStage("completed");
        onSuccess();
        return;
      }
      if (data?.ok === false) {
        throw new Error(data?.error?.message ?? data?.error ?? "Could not record cash");
      }
      setStage("completed");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not record cash";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
    }
  };

  const handleMethod = (method: PayMethod) => {
    if (method === "cash") return startCash();
    return startTerminal(method);
  };

  const reset = () => {
    cleanup();
    setStage("idle");
    setErrorMsg("");
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => {
          if (stage === "idle") setStage("confirming");
        }}
        disabled={
          stage === "sending" ||
          stage === "waiting" ||
          stage === "completed"
        }
        className={cn(
          "relative h-12 px-5 font-medium transition-all border",
          stage === "idle" &&
            "bg-brass/15 border-brass/50 text-brass hover:bg-brass/25 hover:border-brass",
          (stage === "sending" || stage === "waiting") &&
            "bg-brass/10 border-brass/30 text-cream-muted cursor-not-allowed",
          stage === "completed" &&
            "bg-signal-emerald/10 border-signal-emerald/40 text-signal-emerald",
          stage === "error" &&
            "bg-signal-amber/10 border-signal-amber/40 text-signal-amber hover:bg-signal-amber/20"
        )}
        variant="outline"
      >
        <ButtonLabel
          stage={stage}
          amountDisplay={amountDisplay}
          errorMsg={errorMsg}
        />
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
        open={stage === "confirming"}
        onOpenChange={(open) => {
          if (!open) setStage("idle");
        }}
      >
        <AlertDialogContent className="bg-forest-raised/95 backdrop-blur-xl border-brass/30 text-cream">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display italic text-2xl">
              Collect {amountDisplay}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-cream-muted leading-relaxed">
              Send this balance to a Square terminal, or record cash in ERP.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2 py-2">
            <MethodButton
              icon={<Terminal className="h-4 w-4" />}
              label="Counter Terminal"
              hint="Fixed Square Terminal at the desk"
              onClick={() => handleMethod("counter")}
            />
            <MethodButton
              icon={<Smartphone className="h-4 w-4" />}
              label="Mobile Terminal"
              hint={
                mobileReady === false
                  ? "Set Mobile Device ID in Square Integration Settings"
                  : "Handheld / mobile Square reader"
              }
              disabled={mobileReady === false}
              onClick={() => handleMethod("mobile")}
            />
            <MethodButton
              icon={<Banknote className="h-4 w-4" />}
              label="Cash"
              hint="Posts a Cash Payment Entry now"
              onClick={() => handleMethod("cash")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MethodButton({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
        disabled
          ? "border-brass/10 text-cream-dim cursor-not-allowed opacity-60"
          : "border-brass/30 hover:bg-brass/10 hover:border-brass text-cream"
      )}
    >
      <span className="mt-0.5 text-brass">{icon}</span>
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-cream-muted mt-0.5">{hint}</span>
      </span>
    </button>
  );
}

function ButtonLabel({
  stage,
  amountDisplay,
  errorMsg,
}: {
  stage: Stage;
  amountDisplay: string;
  errorMsg: string;
}) {
  if (stage === "idle") {
    return (
      <>
        <Terminal className="h-4 w-4 mr-2 shrink-0" />
        Checkout — {amountDisplay}
      </>
    );
  }
  if (stage === "sending") {
    return (
      <>
        <Loader2 className="h-4 w-4 mr-2 animate-spin text-brass shrink-0" />
        Sending…
      </>
    );
  }
  if (stage === "waiting") {
    return (
      <>
        <Loader2 className="h-4 w-4 mr-2 animate-spin text-brass shrink-0" />
        Waiting for Terminal…
      </>
    );
  }
  if (stage === "completed") {
    return (
      <>
        <CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />
        Payment Captured
      </>
    );
  }
  if (stage === "error") {
    return (
      <>
        <AlertTriangle className="h-4 w-4 mr-2 shrink-0" />
        {errorMsg.length > 40 ? "Error — retry" : (errorMsg || "Error — retry")}
      </>
    );
  }
  return null;
}
