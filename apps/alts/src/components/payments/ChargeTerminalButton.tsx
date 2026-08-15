import { useState, useEffect, useRef } from "react";
import {
  Terminal,
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

type Stage =
  | "idle"
  | "confirming"
  | "sending"
  | "waiting"
  | "completed"
  | "error";

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

  const handleConfirm = async () => {
    setStage("sending");

    try {
      const res = await api.raw("/api/payments/terminal-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(ticketId ? { ticket: ticketId } : { invoice: invoiceId }),
          amount: amountCents / 100,
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
      const msg =
        err instanceof Error ? err.message : "Failed to reach terminal";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
    }
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
              Send to Terminal?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-cream-muted leading-relaxed">
              This will send{" "}
              <span className="text-brass font-semibold">{amountDisplay}</span>{" "}
              to the Square Terminal. The customer will be prompted to tap or
              insert their card.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-brass text-forest-deep hover:bg-brass-light font-semibold"
            >
              Confirm — {amountDisplay}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
        Charge Terminal — {amountDisplay}
      </>
    );
  }
  if (stage === "sending") {
    return (
      <>
        <Loader2 className="h-4 w-4 mr-2 animate-spin text-brass shrink-0" />
        Sending to Terminal…
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
