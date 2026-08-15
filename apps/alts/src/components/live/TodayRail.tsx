import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import type { LiveHome } from "@ls/types";
import { TickNumber } from "@alts/components/live/TickNumber";

function pct(min: number, open: number, close: number) {
  const span = Math.max(1, close - open);
  return Math.max(0, Math.min(100, ((min - open) / span) * 100));
}

function hourLabel(min: number) {
  const h = Math.floor(min / 60);
  const h12 = h % 12 || 12;
  return `${h12}${h < 12 ? "a" : "p"}`;
}

export function TodayRail({
  rail,
  pulse,
}: {
  rail: LiveHome["todayRail"];
  pulse?: boolean;
}) {
  const [nowMin, setNowMin] = useState(rail.nowMin);
  useEffect(() => {
    setNowMin(rail.nowMin);
    const id = window.setInterval(() => {
      const ny = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const h = Number(ny.find((p) => p.type === "hour")?.value ?? 0);
      const m = Number(ny.find((p) => p.type === "minute")?.value ?? 0);
      setNowMin(h * 60 + m);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [rail.nowMin]);

  const ticks: number[] = [];
  for (let t = rail.openMin; t <= rail.closeMin; t += 60) ticks.push(t);
  const marks = [
    ...rail.appointments.map((m) => ({ ...m, glyph: "●" })),
    ...rail.dueOuts.map((m) => ({ ...m, glyph: "♢" })),
    ...rail.deliveries.map((m) => ({ ...m, glyph: "⛟" })),
  ];

  return (
    <section className={cn("live-band live-today", pulse && "is-pulse")} data-band="today" aria-label="Today">
      <div className="live-band-label">Today</div>
      <div className="live-rail" data-testid="today-rail">
        <div className="live-rail-track">
          {ticks.map((t) => (
            <span key={t} className="live-rail-tick" style={{ left: `${pct(t, rail.openMin, rail.closeMin)}%` }}>
              {hourLabel(t)}
            </span>
          ))}
          {marks.map((m) => (
            <Link
              key={`${m.kind}-${m.id}`}
              to={m.href}
              className={cn("live-rail-mark", `is-${m.kind}`)}
              style={{ left: `${pct(m.minutes, rail.openMin, rail.closeMin)}%` }}
              title={m.label}
            >
              <span aria-hidden>{m.glyph}</span>
              <em>{m.label}</em>
            </Link>
          ))}
          <span
            className="live-rail-now"
            style={{ left: `${pct(nowMin, rail.openMin, rail.closeMin)}%` }}
            aria-hidden
          />
        </div>
      </div>
      <div className="live-today-chips">
        <Link to="/appointments" className="live-chip">
          Coming in today: <b className="display"><TickNumber value={rail.chips.comingIn} /></b>
        </Link>
        <Link to="/shop-floor?filter=today" className="live-chip">
          Must leave today: <b className="display"><TickNumber value={rail.chips.mustLeave} /></b>
        </Link>
        <Link to="/pickup" className={cn("live-chip", rail.chips.readyAllTexted && "is-ok")}>
          Ready for pickup:{" "}
          <b className="display">
            <TickNumber value={rail.chips.readyPickup} />
          </b>
          {rail.chips.readyAllTexted ? " (all texted ✓)" : ""}
        </Link>
      </div>
    </section>
  );
}
