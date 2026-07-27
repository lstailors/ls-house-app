import { useEffect, useRef, useState } from "react";
import { Smartphone, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { GlassCard } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Stage = "idle" | "starting" | "waiting" | "paired" | "error";

// Pairs the in-store Square Terminal to the app via a one-time device code.
// Required before the "Charge Terminal" button can push a bill to the device —
// the Device ID on the terminal's About screen is not enough on its own.
export function PairTerminalCard() {
  const [stage, setStage] = useState<Stage>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const poll = async (id: string) => {
    try {
      const res = await api.raw(`/api/payments/terminal/pair/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Pairing check failed");

      if (data.status === "PAIRED" && data.device_id) {
        setDeviceId(data.device_id as string);
        setStage("paired");
        stopPolling();
        toast.success("Terminal paired");
        return;
      }
      if (data.status === "EXPIRED") {
        setStage("error");
        setErrorMsg("The code expired before it was entered. Please start again.");
        stopPolling();
        return;
      }
      pollRef.current = setTimeout(() => poll(id), 3000);
    } catch (e) {
      setStage("error");
      setErrorMsg(e instanceof Error ? e.message : "Pairing check failed");
      stopPolling();
    }
  };

  const start = async () => {
    stopPolling();
    setStage("starting");
    setErrorMsg("");
    setCode(null);
    setDeviceId(null);
    try {
      const res = await api.raw("/api/payments/terminal/pair", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) throw new Error(data?.error?.message ?? "Could not start pairing");
      setCode(data.code as string);
      setStage("waiting");
      poll(data.id as string);
    } catch (e) {
      setStage("error");
      setErrorMsg(e instanceof Error ? e.message : "Could not start pairing");
    }
  };

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-brass" />
        <span className="text-sm text-cream font-medium">Square Terminal</span>
      </div>
      <p className="text-xs text-cream-dim leading-relaxed">
        Pair the in-store Square Terminal so the “Charge Terminal” button can send bills to it.
        You only need to do this once per device.
      </p>

      {stage === "waiting" && code ? (
        <div className="rounded-xl bg-brass/10 border border-brass/20 p-4 space-y-2 text-center">
          <p className="text-xs text-cream-muted">On the Square Terminal: tap <b>≡ More → Settings → Sign in</b> → “Use a device code”, then enter:</p>
          <p className="font-mono tracking-[0.3em] text-2xl text-brass-shimmer">{code}</p>
          <p className="text-[11px] text-cream-dim flex items-center justify-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for the terminal to connect…
          </p>
        </div>
      ) : null}

      {stage === "paired" ? (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3 text-xs text-emerald-300 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Terminal paired and saved.</p>
            <p className="text-cream-dim mt-0.5 font-mono break-all">device {deviceId}</p>
          </div>
        </div>
      ) : null}

      {stage === "error" ? (
        <div className="rounded-xl bg-signal-amber/10 border border-signal-amber/25 p-3 text-xs text-signal-amber flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{errorMsg}</p>
        </div>
      ) : null}

      <Button
        variant="outline"
        className="btn-ghost-brass"
        onClick={start}
        disabled={stage === "starting" || stage === "waiting"}
      >
        {stage === "starting" || stage === "waiting" ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Smartphone className="h-4 w-4 mr-1.5" />
        )}
        {stage === "waiting" ? "Waiting…" : stage === "paired" ? "Pair a different terminal" : "Pair Square Terminal"}
      </Button>
    </GlassCard>
  );
}
