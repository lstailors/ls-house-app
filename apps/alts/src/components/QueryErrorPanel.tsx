import { cn } from "@ls/design/utils";

/** Shared FOH error branch — copy TicketKind amber shape; never fail silent. */
export default function QueryErrorPanel({
  title = "Could not load",
  message,
  onRetry,
  className,
  compact,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border border-signal-amber/40 bg-signal-amber/10 text-signal-amber",
        compact ? "p-3 text-sm" : "p-5 text-sm",
        className,
      )}
    >
      <div className={cn("font-semibold text-cream", compact ? "text-sm" : "text-base")}>{title}</div>
      <p className="mt-1.5 text-signal-amber/95 leading-snug">
        {message ?? "Check the network and try again. The shop keeps going — this is a load failure, not an empty day."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-11 px-5 rounded-xl border border-brass/40 bg-brass/15 text-brass-light text-[12px] font-bold tracking-widest uppercase hover:bg-brass/25"
        >
          Retry
        </button>
      )}
    </div>
  );
}
