import { useEffect, useState } from "react";
import { cn } from "@ls/design/utils";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";

export const LOAD_TIMEOUT_MS = 15_000;

/** True after `timeoutMs` while `active` stays true. Resets when `active` drops or `resetKey` changes. */
export function useLoadTimeout(active: boolean, timeoutMs = LOAD_TIMEOUT_MS, resetKey = 0) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!active) {
      setTimedOut(false);
      return;
    }
    setTimedOut(false);
    const id = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(id);
  }, [active, timeoutMs, resetKey]);
  return timedOut;
}

type Props = {
  timeoutMs?: number;
  label?: string;
  onRetry?: () => void;
  fullscreen?: boolean;
  className?: string;
};

/**
 * Page-level spinner that cannot hang forever.
 * After 15s → error + retry. Mutation/button spinners should stay on their request lifecycle.
 */
export default function TimedSpinner({
  timeoutMs = LOAD_TIMEOUT_MS,
  label = "Loading…",
  onRetry,
  fullscreen = false,
  className,
}: Props) {
  const [epoch, setEpoch] = useState(0);
  const timedOut = useLoadTimeout(true, timeoutMs, epoch);

  const retry = () => {
    setEpoch((n) => n + 1);
    if (onRetry) onRetry();
    else window.location.reload();
  };

  const inner = timedOut ? (
    <QueryErrorPanel
      title="This is taking too long"
      message="Nothing came back. Check the network, then try again — a spinner is not a status."
      onRetry={retry}
      compact={!fullscreen}
    />
  ) : (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <div className="h-10 w-10 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
      <p className="text-sm text-cream-dim">{label}</p>
    </div>
  );

  if (fullscreen) {
    return (
      <div className={cn("flex items-center justify-center min-h-dvh bg-forest-deep p-5", className)}>
        {inner}
      </div>
    );
  }

  return <div className={cn("flex items-center justify-center p-5", className)}>{inner}</div>;
}
