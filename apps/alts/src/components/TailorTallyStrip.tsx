import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";

export type TailorTally = {
  date: string;
  totals: {
    pieces: number;
    minutes: number;
    hours: number;
    revenue: number;
    workers: number;
  };
  tailors: Array<{
    workerId: string;
    workerName: string;
    pieces: number;
    minutes: number;
    hours: number;
    revenue: number;
    tickets: number;
  }>;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtMins(m: number) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Compact "who finished what today" strip for home / shop floor. */
export function TailorTallyStrip({ className }: { className?: string }) {
  const q = useQuery({
    queryKey: ["tailor-tally"],
    queryFn: async () => {
      const res = await api.raw("/api/garment/tally");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message || "Tally failed");
      return (j?.data ?? j) as TailorTally;
    },
    staleTime: 45_000,
    refetchInterval: 90_000,
    retry: 1,
  });

  const data = q.data;
  const empty = !data || data.totals.pieces === 0;

  return (
    <section
      className={cn(
        "rounded-2xl border border-brass/25 bg-black/25 px-4 py-3 sm:px-5 sm:py-4",
        className,
      )}
      aria-label="Today's tailor tally"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="caps text-brass">Today’s floor · by tailor</div>
          <div className="text-[11px] text-cream-dim mt-0.5">
            Time from complete chips · {data?.date ?? "…"}
          </div>
        </div>
        {data && !empty ? (
          <div className="flex gap-3 text-xs text-cream-muted flex-wrap">
            <span>
              <strong className="text-cream tabular-nums">{data.totals.pieces}</strong> pcs
            </span>
            <span>
              <strong className="text-cream tabular-nums">{fmtMins(data.totals.minutes)}</strong>
            </span>
            <span>
              <strong className="text-cream tabular-nums">{money(data.totals.revenue)}</strong> work $
            </span>
          </div>
        ) : null}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-cream-dim">Loading tally…</p>
      ) : q.isError ? (
        <p className="text-sm text-signal-amber">Couldn’t load tally</p>
      ) : empty ? (
        <p className="text-sm text-cream-dim">
          No completions logged yet today. Scan hang tag → Mark complete → pick time chip.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data!.tailors.map((t) => (
            <li
              key={t.workerId}
              className="rounded-xl border border-brass/15 bg-forest-deep/40 px-3 py-2.5 flex items-center justify-between gap-2 min-h-[52px]"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-cream truncate">{t.workerName}</div>
                <div className="text-[11px] text-cream-dim">
                  {t.pieces} pc · {t.tickets} ticket{t.tickets === 1 ? "" : "s"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-mono tabular-nums text-brass">{fmtMins(t.minutes)}</div>
                <div className="text-[11px] text-cream-dim tabular-nums">{money(t.revenue)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
