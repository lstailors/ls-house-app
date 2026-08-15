import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import type { LiveActivity } from "@ls/types";

export function ActivityTicker({ items }: { items: LiveActivity[] }) {
  const [paused, setPaused] = useState(false);
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <section
      className={cn("live-ticker", paused && "is-paused")}
      data-band="ticker"
      aria-label="Shop activity"
      onClick={() => setPaused((p) => !p)}
    >
      <div className="live-ticker-track">
        {loop.map((ev, i) => (
          <Link key={`${ev.id}-${i}`} to={ev.href} className="live-ticker-item" onClick={(e) => e.stopPropagation()}>
            <b>{ev.at}</b>
            <span>{ev.text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
