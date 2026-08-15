import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import type { LiveException } from "@ls/types";

const ACTION: Record<LiveException["action"], string> = {
  open: "Open",
  text: "Text",
  charge: "Charge",
};

export function NeedsYouNow({
  items,
  pulse,
}: {
  items: LiveException[];
  pulse?: boolean;
}) {
  return (
    <section
      className={cn("live-band live-needs", pulse && "is-pulse")}
      data-band="needs-you"
      aria-label="Needs you now"
    >
      <div className="live-band-label">Needs you now</div>
      <div className="live-needs-row">
        {items.length === 0 ? (
          <div className="live-need-card is-calm" data-testid="needs-clean">
            <span className="live-need-icon" aria-hidden>
              ✓
            </span>
            <div className="live-need-body">
              <b>Floor is clean.</b>
              <span>Nothing needs you.</span>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              to={item.href}
              className={cn("live-need-card", item.severity === "urgent" ? "is-urgent" : "is-attention")}
              data-exception={item.kind}
            >
              <span className="live-need-icon" aria-hidden>
                {item.icon}
              </span>
              <div className="live-need-body">
                <b className="truncate">{item.name}</b>
                <span className="truncate">{item.subtitle || ACTION[item.action]}</span>
              </div>
              <em className="live-need-num display">{item.number}</em>
              <i className="live-need-act">{ACTION[item.action]}</i>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
