import { useEffect, useMemo, useState } from "react";
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

function clockLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 || 12;
  const ap = h < 12 ? "a" : "p";
  if (m === 0) return `${h12}${ap}`;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
}

function shortLabel(label: string) {
  const t = (label || "").trim();
  if (!t) return "—";
  const first = t.split(/\s+/)[0] || t;
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
}

type Mark = {
  id: string;
  kind: string;
  minutes: number;
  label: string;
  href: string;
  glyph: string;
  short: string;
  /** 0 = lowest label row (closest to track), 1 = mid, 2 = highest */
  lane: 0 | 1 | 2;
};

/**
 * Pack labels into up to 3 vertical lanes so close events don't stack.
 * Greedy: try lane 0 first, then 1, then 2 if occupied within gap.
 */
function assignLanes(
  raw: Array<Omit<Mark, "lane">>,
  open: number,
  close: number,
): Mark[] {
  const sorted = [...raw].sort(
    (a, b) => a.minutes - b.minutes || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
  // % of day span — about one label width on a tablet
  const minGapPct = 11;
  const lastAt: Array<number | null> = [null, null, null];
  const out: Mark[] = [];

  for (const m of sorted) {
    const p = pct(m.minutes, open, close);
    let lane: 0 | 1 | 2 = 0;
    let placed = false;
    for (const tryLane of [0, 1, 2] as const) {
      const prev = lastAt[tryLane];
      if (prev == null || p - prev >= minGapPct) {
        lane = tryLane;
        lastAt[tryLane] = p;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Force highest free-ish lane and still record
      lane = 2;
      lastAt[2] = p;
    }
    out.push({ ...m, lane });
  }
  return out;
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

  const marks = useMemo(() => {
    const raw = [
      ...rail.appointments.map((m) => ({
        ...m,
        glyph: "●",
        short: shortLabel(m.label),
      })),
      ...rail.dueOuts.map((m) => ({
        ...m,
        glyph: "◇",
        short: shortLabel(m.label),
      })),
      ...rail.deliveries.map((m) => ({
        ...m,
        glyph: "🚚",
        short: shortLabel(m.label),
      })),
    ];
    return assignLanes(raw, rail.openMin, rail.closeMin);
  }, [rail.appointments, rail.dueOuts, rail.deliveries, rail.openMin, rail.closeMin]);

  return (
    <section
      className={cn("live-band live-today", pulse && "is-pulse")}
      data-band="today"
      aria-label="Today"
    >
      <div className="live-today-head">
        <div className="live-band-label">Today</div>
        <div className="live-today-legend" aria-hidden>
          <span className="is-appointment">
            <i>●</i> Appointment
          </span>
          <span className="is-due_out">
            <i>◇</i> Promised due
          </span>
          <span className="is-delivery">
            <i>🚚</i> Delivery run
          </span>
        </div>
      </div>

      {/*
        Top → bottom:
        1) Name labels (3 staggered lanes, tall band)
        2) Color dots on track
        3) Hour ticks under the line
      */}
      <div className="live-rail" data-testid="today-rail">
        <div className="live-rail-labels">
          {marks.map((m) => (
            <Link
              key={`lab-${m.kind}-${m.id}`}
              to={m.href}
              className={cn(
                "live-rail-label",
                `is-${m.kind}`,
                m.lane === 1 && "is-lane-1",
                m.lane === 2 && "is-lane-2",
              )}
              style={{ left: `${pct(m.minutes, rail.openMin, rail.closeMin)}%` }}
              title={`${m.label} · ${clockLabel(m.minutes)}`}
            >
              <strong>{m.short}</strong>
              <small>{clockLabel(m.minutes)}</small>
            </Link>
          ))}
        </div>

        <div className="live-rail-track">
          {marks.map((m) => (
            <Link
              key={`dot-${m.kind}-${m.id}`}
              to={m.href}
              className={cn("live-rail-mark", `is-${m.kind}`)}
              style={{ left: `${pct(m.minutes, rail.openMin, rail.closeMin)}%` }}
              title={`${m.label} · ${clockLabel(m.minutes)}`}
            >
              <span className="live-rail-dot" aria-hidden>
                {m.glyph}
              </span>
            </Link>
          ))}
          <span
            className="live-rail-now"
            style={{ left: `${pct(nowMin, rail.openMin, rail.closeMin)}%` }}
            aria-hidden
          />
        </div>

        <div className="live-rail-hours">
          {ticks.map((t) => (
            <span
              key={t}
              className="live-rail-tick"
              style={{ left: `${pct(t, rail.openMin, rail.closeMin)}%` }}
            >
              {hourLabel(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="live-today-chips">
        <Link to="/appointments" className="live-chip is-appointment">
          Coming in
          <b className="display">
            <TickNumber value={rail.chips.comingIn} />
          </b>
        </Link>
        <Link to="/shop-floor?filter=today" className="live-chip is-due_out">
          Must leave
          <b className="display">
            <TickNumber value={rail.chips.mustLeave} />
          </b>
        </Link>
        <Link
          to="/pickup"
          className={cn("live-chip is-ready", rail.chips.readyAllTexted && "is-ok")}
        >
          Ready pickup
          <b className="display">
            <TickNumber value={rail.chips.readyPickup} />
          </b>
          {rail.chips.readyAllTexted ? <span className="live-chip-ok">all texted</span> : null}
        </Link>
      </div>
    </section>
  );
}
