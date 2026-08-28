import { useLocation } from "react-router-dom";
import { cn } from "@ls/design/utils";
import { usePepePanel } from "./PepeContext";
import { shouldHidePepeFab } from "./pepeHide";

export { shouldHidePepeFab };

/** Compact AI orb — fixed top-right on every FOH page. */
export default function PepeFab({
  badge = 0,
  unread = false,
}: {
  badge?: number;
  unread?: boolean;
}) {
  const { pathname, search } = useLocation();
  const { open, openAsk, close } = usePepePanel();
  if (shouldHidePepeFab(pathname, search)) return null;

  const showBadge = badge > 0 || unread;
  const badgeLabel = badge > 9 ? "9+" : badge > 0 ? String(badge) : unread ? "" : null;

  return (
    <button
      type="button"
      aria-label={open ? "Close Pepe" : "Ask Pepe"}
      aria-expanded={open}
      aria-haspopup="dialog"
      data-testid="pepe-ai-btn"
      onClick={() => (open ? close() : openAsk())}
      className={cn("pepe-ai-btn", open && "is-open", showBadge && "has-badge")}
    >
      <span className="pepe-ai-ring" aria-hidden />
      <span className="pepe-ai-core" aria-hidden>
        {/* Sparkle / AI mark */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" className="pepe-ai-spark">
          <path
            d="M12 3.5l1.2 4.4L17.5 9l-4.3 1.1L12 14.5l-1.2-4.4L6.5 9l4.3-1.1L12 3.5z"
            fill="currentColor"
            opacity="0.95"
          />
          <path
            d="M18.2 13.2l.7 2.4 2.4.6-2.4.6-.7 2.4-.7-2.4-2.4-.6 2.4-.6.7-2.4z"
            fill="currentColor"
            opacity="0.75"
          />
          <path
            d="M6.2 15.4l.55 1.85 1.85.45-1.85.45L6.2 20l-.55-1.85-1.85-.45 1.85-.45.55-1.85z"
            fill="currentColor"
            opacity="0.55"
          />
        </svg>
        <span className="pepe-ai-letter">P</span>
      </span>
      {showBadge && (
        <span
          className={cn("pepe-ai-badge", badgeLabel ? "is-count" : "is-dot")}
          aria-label={badge > 0 ? `${badge} Pepe notifications` : "New from Pepe"}
        >
          {badgeLabel}
        </span>
      )}
    </button>
  );
}
