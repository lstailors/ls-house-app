import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import type { LiveAging, LiveHome } from "@ls/types";
import { formatCompactMoney, formatMoney } from "@alts/lib/money";
import { TickNumber } from "@alts/components/live/TickNumber";
import { AGING_BUCKETS, type AgingBucket } from "@alts/lib/invoiceAging";

function Spark({ values }: { values: number[] }) {
  const w = 88;
  const h = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="live-spark" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={h - (v / max) * (h - 4) - 2}
          r={i === values.length - 1 ? 2.4 : 1.2}
          className={i === values.length - 1 ? "is-today" : undefined}
        />
      ))}
    </svg>
  );
}

function AgingBar({ aging, total }: { aging: LiveAging; total: number }) {
  const sum = AGING_BUCKETS.reduce((s, b) => s + (aging[b] || 0), 0) || 1;
  return (
    <div className="live-aging" role="img" aria-label="AR aging">
      {AGING_BUCKETS.map((b) => (
        <Link
          key={b}
          to={`/invoices?aging=${encodeURIComponent(b)}`}
          className={cn("live-aging-seg", `is-${b.replace("+", "p")}`)}
          style={{ width: `${Math.max(4, ((aging[b] || 0) / sum) * 100)}%` }}
          title={`${b}: ${formatMoney(aging[b] || 0)}`}
        />
      ))}
      <span className="sr-only">Open AR {formatMoney(total)}</span>
    </div>
  );
}

export function MoneyStrip({
  money,
  pulse,
  coverControl,
}: {
  money: LiveHome["money"];
  pulse?: boolean;
  coverControl?: ReactNode;
}) {
  const weekMax = Math.max(1, money.weekRev, money.lastWeekRev);
  const pipeMax = Math.max(1, money.pipeline.nyc + money.pipeline.hou);
  const delta = money.weekDeltaPct;
  return (
    <section className={cn("live-band live-money", pulse && "is-pulse")} data-band="money" aria-label="Money">
      <div className="live-money-head">
        <div className="live-band-label">Money</div>
        {coverControl}
      </div>
      <div className="live-money-grid">
        <div className="live-money-tile" data-testid="rev-today">
          <span className="live-money-k">Rev today</span>
          <b className="display live-money-n">
            <TickNumber value={money.revToday} format={formatCompactMoney} />
          </b>
          <Spark values={money.revSpark.length ? money.revSpark : [0]} />
        </div>
        <div className="live-money-tile">
          <span className="live-money-k">Week vs last</span>
          <b className={cn("display live-money-n", delta >= 0 ? "is-up" : "is-down")}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </b>
          <div className="live-week-bars" aria-hidden>
            <i style={{ width: `${(money.lastWeekRev / weekMax) * 100}%` }} />
            <i className="is-now" style={{ width: `${(money.weekRev / weekMax) * 100}%` }} />
          </div>
        </div>
        <div className="live-money-tile">
          <span className="live-money-k">Open AR</span>
          <b className="display live-money-n">
            <TickNumber value={money.arTotal} format={formatCompactMoney} />
          </b>
          <AgingBar aging={money.arAging} total={money.arTotal} />
        </div>
        <div className="live-money-tile">
          <span className="live-money-k">Pipeline</span>
          <b className="display live-money-n">
            <TickNumber value={money.pipeline.total} format={formatCompactMoney} />
          </b>
          <div className="live-pipe" aria-hidden>
            <i className="is-nyc" style={{ width: `${(money.pipeline.nyc / pipeMax) * 100}%` }} title="NYC" />
            <i className="is-hou" style={{ width: `${(money.pipeline.hou / pipeMax) * 100}%` }} title="HOU" />
          </div>
          <span className="live-pipe-legend">NYC · HOU</span>
        </div>
      </div>
    </section>
  );
}

export function agingHref(bucket: AgingBucket) {
  return `/invoices?aging=${encodeURIComponent(bucket)}`;
}
