import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import type { LiveActivity } from "@ls/types";
import { redactMoney } from "@alts/lib/coverMoney";

export function ActivityTicker({
  items,
  coverMoney = false,
}: {
  items: LiveActivity[];
  coverMoney?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <section
      className={cn("live-ticker", paused && "is-paused")}
      data-band="ticker"
      aria-label="Just happened in the shop"
      onClick={() => setPaused((p) => !p)}
    >
      <span className="live-ticker-label">Just happened</span>
      <div className="live-ticker-track">
        {loop.map((ev, i) => (
          <Link key={`${ev.id}-${i}`} to={ev.href} className="live-ticker-item" onClick={(e) => e.stopPropagation()}>
            <b>{ev.at}</b>
            <span>{coverMoney ? redactMoney(ev.text) : ev.text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
