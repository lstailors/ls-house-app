import { cn } from "@ls/design/utils";

type Kind = "loading" | "empty" | "error" | "offline";

/**
 * Shared FOH empty/error/loading surface (Lucia 028 direction).
 * TicketKind isError shape: amber text, plain, actionable.
 */
export default function GlassState({
  kind,
  title,
  body,
  onRetry,
  className,
  compact,
}: {
  kind: Kind;
  title?: string;
  body?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const defaults: Record<Kind, { title: string; body: string }> = {
    loading: { title: "Loading…", body: "Pulling from ERPNext." },
    empty: { title: "Nothing here", body: "No rows match right now." },
    error: {
      title: "Could not load",
      body: "Shop data is unreachable. Check wifi, then try again — do not treat an empty list as real.",
    },
    offline: {
      title: "You’re offline",
      body: "Shell still works. New tickets can be drafted; submit when the connection returns.",
    },
  };
  const d = defaults[kind];
  const tone =
    kind === "error" || kind === "offline"
      ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
      : kind === "empty"
        ? "border-brass/25 bg-black/20 text-cream-dim"
        : "border-brass/20 bg-black/20 text-cream-dim";

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        tone,
        compact ? "my-2" : "my-3 p-5",
        className,
      )}
      role={kind === "error" || kind === "offline" ? "alert" : "status"}
    >
      <div className={cn("font-bold tracking-widest uppercase text-[12px]", kind === "loading" && "animate-pulse")}>
        {title ?? d.title}
      </div>
      {(body ?? d.body) && <p className="text-[12px] mt-2 leading-relaxed text-cream-dim">{body ?? d.body}</p>}
      {onRetry && (kind === "error" || kind === "offline") && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-12 min-h-[48px] px-5 rounded-xl border border-brass/40 bg-brass/15 text-brass-light text-[12px] font-bold tracking-widest uppercase"
        >
          Try again
        </button>
      )}
    </div>
  );
}
