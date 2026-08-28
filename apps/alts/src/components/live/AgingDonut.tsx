import { cn } from "@ls/design/utils";
import type { AgingBucket } from "@alts/lib/invoiceAging";
import { AGING_BUCKETS } from "@alts/lib/invoiceAging";
import { formatCompactMoney } from "@alts/lib/money";

const COLORS: Record<AgingBucket, string> = {
  "0-30": "#4FBF8E",
  "31-60": "#E8A85C",
  "61-90": "#D97B6C",
  "90+": "#E85050",
};

const FILL_CLASS: Record<AgingBucket, string> = {
  "0-30": "is-0-30",
  "31-60": "is-31-60",
  "61-90": "is-61-90",
  "90+": "is-90p",
};

/** SVG donut + horizontal stack for AR aging (Azira KPI → Liquid Glass). */
export function AgingDonutPanel({
  counts,
  amounts,
  active,
  onSelect,
  centerLabel = "Open AR",
  centerValue,
}: {
  counts: Record<AgingBucket, number>;
  amounts?: Record<AgingBucket, number>;
  active?: AgingBucket | null;
  onSelect?: (b: AgingBucket | null) => void;
  centerLabel?: string;
  centerValue?: string;
}) {
  const totalCount = AGING_BUCKETS.reduce((s, b) => s + (counts[b] || 0), 0);
  const totalAmt = amounts
    ? AGING_BUCKETS.reduce((s, b) => s + (amounts[b] || 0), 0)
    : totalCount;
  const R = 36;
  const C = 2 * Math.PI * R;
  let offset = 0;

  const arcs = AGING_BUCKETS.map((b) => {
    const n = counts[b] || 0;
    const frac = totalCount > 0 ? n / totalCount : 0;
    const len = frac * C;
    const dash = `${len} ${C - len}`;
    const dashOffset = -offset;
    offset += len;
    return { b, n, frac, dash, dashOffset };
  });

  return (
    <div className="inv-aging-panel" data-testid="inv-aging-panel">
      <div className="inv-donut" aria-hidden>
        <svg viewBox="0 0 96 96">
          <circle
            cx="48"
            cy="48"
            r={R}
            fill="none"
            stroke="rgba(176,141,87,0.14)"
            strokeWidth="10"
          />
          {totalCount === 0 ? null : (
            arcs.map(({ b, n, dash, dashOffset }) =>
              n <= 0 ? null : (
                <circle
                  key={b}
                  cx="48"
                  cy="48"
                  r={R}
                  fill="none"
                  stroke={COLORS[b]}
                  strokeWidth="10"
                  strokeDasharray={dash}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt"
                />
              ),
            )
          )}
        </svg>
        <div className="inv-donut-center">
          <div>
            <b>{centerValue ?? (totalAmt ? formatCompactMoney(totalAmt) : String(totalCount))}</b>
            <span>{centerLabel}</span>
          </div>
        </div>
      </div>

      <div className="inv-aging-stack" role="list">
        {AGING_BUCKETS.map((b) => {
          const n = counts[b] || 0;
          const amt = amounts?.[b] ?? 0;
          const pct = totalCount > 0 ? Math.max(n > 0 ? 6 : 0, (n / totalCount) * 100) : 0;
          return (
            <button
              key={b}
              type="button"
              role="listitem"
              className={cn("inv-aging-row", active === b && "is-on")}
              onClick={() => onSelect?.(active === b ? null : b)}
            >
              <span className="inv-aging-label">{b}</span>
              <span className="inv-aging-track">
                <i
                  className={cn("inv-aging-fill", FILL_CLASS[b])}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="inv-aging-amt">
                {amounts ? formatCompactMoney(amt) : `${n}`}
                <span className="opacity-60"> · {n}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
