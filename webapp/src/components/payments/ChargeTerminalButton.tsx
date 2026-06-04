import { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";

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
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export function ChargeTerminalButton({
  invoiceId,
  amountCents,
  amountDisplay,
  deviceId,
  onSuccess,
  onError,
}: ChargeTerminalButtonProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => () => cleanup(), []);

  const subscribeToCheckout = (checkoutId: string) => {
    const channel = supabase
      .channel(`terminal-checkout-${checkoutId}`)
      .on(
        // @ts-ignore — postgres_changes is a valid event type
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "square_sync_log",
          filter: `square_id=eq.${checkoutId}`,
        },
        (payload: { new: { status: string; phase: string } }) => {
          const { status, phase } = payload.new ?? {};
          if (
            status === "completed" ||
            (phase === "webhook" && status === "completed")
          ) {
            cleanup();
            setStage("completed");
            onSuccess();
          } else if (status === "failed" || status === "cancelled") {
            cleanup();
            const msg = "Terminal payment failed or was cancelled";
            setStage("error");
            setErrorMsg(msg);
            onError(msg);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    // 3-minute timeout
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

    const terminalDeviceId =
      deviceId ?? import.meta.env.VITE_SQUARE_TERMINAL_DEVICE_ID ?? "";

    if (!terminalDeviceId) {
      const msg = "No terminal device configured";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
      return;
    }

    let checkoutId: string;
    try {
      const { data, error } = await supabase.functions.invoke(
        "square-terminal-checkout",
        {
          body: {
            invoice_id: invoiceId,
            amount_cents: amountCents,
            device_id: terminalDeviceId,
          },
        }
      );

      if (error) throw error;
      if (!data?.checkout_id) {
        throw new Error(data?.error ?? "No checkout ID returned");
      }
      checkoutId = data.checkout_id as string;
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to reach terminal";
      setStage("error");
      setErrorMsg(msg);
      onError(msg);
      return;
    }

    setStage("waiting");
    subscribeToCheckout(checkoutId);
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
