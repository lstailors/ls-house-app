import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { storeToday } from "@alts/lib/storeDate";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import "@alts/styles/alts-pos.css";

/** SPEC_061 Floor Performance — Lucia mockups in ~/ls-design/mockups/tailor-productivity/ */

export type TallyGarment = {
  ticket: string;
  garmentId?: string;
  type?: string;
  workerId?: string;
  workerName: string;
  completedAt?: string;
  minutes: number;
  revenue: number;
  status?: string;
  workLocation: null | "shop" | "home";
};

export type TallyTailor = {
  workerId: string;
  workerName: string;
  pieces: number;
  minutes: number;
  hours: number;
  revenue: number;
  tickets: number;
  workLocation?: null | "shop" | "home";
};

export type TallyPayload = {
  date: string | null;
  start?: string;
  end?: string;
  totals: {
    pieces: number;
    minutes: number;
    hours: number;
    revenue: number;
    workers: number;
  };
  tailors: TallyTailor[];
  garments: TallyGarment[];
  byDay?: Array<{
    date: string;
    totals: TallyPayload["totals"];
    tailors: TallyTailor[];
  }>;
};

type SortKey = "time" | "pieces" | "revenue";
type Tab = "dashboard" | "week";
type LocFilter = "all" | "shop" | "home";
type WeekMetric = "hours" | "pieces";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtMins(m: number) {
  if (!m) return "0m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function addDaysIso(iso: string, delta: number): string {
  const ms = Date.parse(`${iso}T12:00:00Z`) + delta * 86_400_000;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function weekdayLetter(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return ["S", "M", "T", "W", "T", "F", "S"][d.getUTCDay()] ?? "·";
}

function fmtClock(iso?: string) {
  if (!iso) return "—";
  // ERP stores "YYYY-MM-DD HH:mm:ss" wall clock NYC — treat as local string for display
  const m = iso.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2];
    const ap = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${min} ${ap}`;
  }
  return iso;
}

function paceOf(minutes: number, avgMinutes: number): { kind: "above" | "avg" | "below"; pct: number; label: string } {
  if (avgMinutes <= 0) {
    return { kind: "avg", pct: minutes > 0 ? 60 : 0, label: "on pace" };
  }
  const ratio = minutes / avgMinutes;
  const pct = Math.min(100, Math.round(ratio * 65));
  if (ratio >= 1.15) return { kind: "above", pct: Math.min(100, pct + 10), label: "above day avg" };
  if (ratio <= 0.7) return { kind: "below", pct: Math.max(12, pct), label: "light day" };
  return { kind: "avg", pct: Math.max(20, pct), label: "on pace" };
}

async function fetchTally(params: { date?: string; start?: string; end?: string }): Promise<TallyPayload> {
  const qs = new URLSearchParams();
  if (params.start && params.end) {
    qs.set("start", params.start);
    qs.set("end", params.end);
  } else if (params.date) {
    qs.set("date", params.date);
  }
  const res = await api.raw(`/api/garment/tally?${qs.toString()}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || "Tally failed");
  return (j?.data ?? j) as TallyPayload;
}

export default function FloorPerformance() {
  const today = storeToday();
  const yesterday = addDaysIso(today, -1);
  const weekStart = addDaysIso(today, -6);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [date, setDate] = useState(today);
  const [sort, setSort] = useState<SortKey>("time");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locFilter, setLocFilter] = useState<LocFilter>("all");
  const [weekMetric, setWeekMetric] = useState<WeekMetric>("hours");
  const [dateOpen, setDateOpen] = useState(false);

  const dayQ = useQuery({
    queryKey: ["tailor-tally", "day", date],
    queryFn: () => fetchTally({ date }),
    staleTime: 45_000,
    refetchInterval: 90_000,
    enabled: tab === "dashboard" || !!selectedId,
  });

  const weekQ = useQuery({
    queryKey: ["tailor-tally", "week", weekStart, today],
    queryFn: () => fetchTally({ start: weekStart, end: today }),
    staleTime: 60_000,
    enabled: tab === "week",
  });

  const data = dayQ.data;
  const empty = !data || data.totals.pieces === 0;

  const avgMinutes = useMemo(() => {
    const list = data?.tailors ?? [];
    if (!list.length) return 0;
    return list.reduce((s, t) => s + t.minutes, 0) / list.length;
  }, [data?.tailors]);

  const sortedTailors = useMemo(() => {
    const list = [...(data?.tailors ?? [])];
    list.sort((a, b) => {
      if (sort === "pieces") return b.pieces - a.pieces || b.minutes - a.minutes;
      if (sort === "revenue") return b.revenue - a.revenue || b.minutes - a.minutes;
      return b.minutes - a.minutes || b.pieces - a.pieces;
    });
    return list;
  }, [data?.tailors, sort]);

  const selected = sortedTailors.find((t) => t.workerId === selectedId) ?? null;
  const [held, setHeld] = useState(selected);
  useEffect(() => {
    if (selected) setHeld(selected);
  }, [selected]);
  const view = selected ?? held;

  const selectedPieces = useMemo(() => {
    if (!view || !data) return [];
    let rows = data.garments.filter((g) => (g.workerId || "unassigned") === view.workerId);
    if (locFilter === "shop") rows = rows.filter((g) => g.workLocation === "shop");
    if (locFilter === "home") rows = rows.filter((g) => g.workLocation === "home");
    return rows;
  }, [view, data, locFilter]);

  const dateChipKind = date === today ? "today" : date === yesterday ? "yesterday" : "custom";

  return (
    <div className="alts-root min-h-dvh bg-forest-deep text-cream">
      <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6 sm:py-6">
        {/* Top */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to="/" className="caps text-[11px] text-brass/80 hover:text-brass">
              ← Home
            </Link>
            <h1 className="font-display text-3xl italic text-cream mt-1 tracking-tight">Floor Performance</h1>
            <p className="text-xs text-cream-dim mt-1">Tailor productivity · alts.lstailors.com</p>
          </div>

          {tab === "dashboard" ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={cn(
                  "min-h-11 px-4 rounded-full border text-xs font-semibold uppercase tracking-[0.14em]",
                  dateChipKind === "today"
                    ? "border-brass bg-brass/20 text-brass-light"
                    : "border-brass/25 text-cream-muted hover:border-brass/50",
                )}
                onClick={() => setDate(today)}
              >
                Today
              </button>
              <button
                type="button"
                className={cn(
                  "min-h-11 px-4 rounded-full border text-xs font-semibold uppercase tracking-[0.14em]",
                  dateChipKind === "yesterday"
                    ? "border-brass bg-brass/20 text-brass-light"
                    : "border-brass/25 text-cream-muted hover:border-brass/50",
                )}
                onClick={() => setDate(yesterday)}
              >
                Yesterday
              </button>
              <label
                className={cn(
                  "min-h-11 px-3 rounded-full border border-dashed text-xs font-semibold uppercase tracking-[0.14em] inline-flex items-center gap-2 cursor-pointer",
                  dateChipKind === "custom"
                    ? "border-brass bg-brass/15 text-brass-light"
                    : "border-brass/35 text-cream-muted",
                )}
              >
                <span>📅</span>
                <span className="sr-only">Pick date</span>
                <input
                  type="date"
                  value={date}
                  max={today}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  onFocus={() => setDateOpen(true)}
                  onBlur={() => setDateOpen(false)}
                  className="bg-transparent text-cream outline-none min-w-[8.5rem]"
                />
              </label>
            </div>
          ) : (
            <div className="text-xs text-cream-dim tabular-nums">
              Week · {weekStart} → {today}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-5 flex gap-1 border-b border-brass/20">
          {(
            [
              ["dashboard", "Dashboard"],
              ["week", "Week Rollup"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "min-h-11 px-4 text-xs font-semibold uppercase tracking-[0.16em] border-b-2 -mb-px",
                tab === id
                  ? "border-brass text-brass-light"
                  : "border-transparent text-cream-dim hover:text-cream-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "dashboard" ? (
          <>
            {dayQ.isLoading ? (
              <p className="text-sm text-cream-dim">Loading tally…</p>
            ) : dayQ.isError ? (
              <p className="text-sm text-signal-amber">Couldn’t load tally</p>
            ) : (
              <>
                {/* KPI */}
                <div className="mb-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: "Total Pieces", val: String(data!.totals.pieces), cream: false },
                    { label: "Total Hours", val: String(data!.totals.hours), cream: false },
                    { label: "Total Work $", val: money(data!.totals.revenue), cream: false },
                    { label: "Active Tailors", val: String(data!.totals.workers), cream: true },
                  ].map((k) => (
                    <div
                      key={k.label}
                      className="rounded-[10px] border border-brass/20 bg-forest-base/80 px-4 py-4"
                    >
                      <div className="text-[10px] uppercase tracking-[0.12em] text-cream-dim mb-1.5">{k.label}</div>
                      <div
                        className={cn(
                          "text-[26px] font-semibold tabular-nums leading-none",
                          k.cream ? "text-cream" : "text-brass-light",
                        )}
                      >
                        {k.val}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sort */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="caps text-cream-dim text-[11px]">
                    Tailors · {date === today ? "Today" : date}
                  </div>
                  <div className="flex gap-1.5">
                    {(
                      [
                        ["time", "Time"],
                        ["pieces", "Pieces"],
                        ["revenue", "$"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSort(k)}
                        className={cn(
                          "min-h-10 min-w-[4.5rem] px-3 rounded-full text-[11px] font-semibold uppercase tracking-[0.12em] border",
                          sort === k
                            ? "border-brass bg-brass/20 text-brass-light"
                            : "border-brass/20 text-cream-dim",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {empty ? (
                  <div className="rounded-xl border border-dashed border-brass/30 bg-black/20 px-5 py-10 text-center text-sm text-cream-dim">
                    No completions logged — scan hang tag → Mark complete → time chip.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {sortedTailors.map((t) => {
                      const pace = paceOf(t.minutes, avgMinutes);
                      const loc = t.workLocation;
                      return (
                        <button
                          key={t.workerId}
                          type="button"
                          onClick={() => {
                            setSelectedId(t.workerId);
                            setLocFilter("all");
                          }}
                          className="text-left rounded-xl border border-brass/20 bg-forest-base/70 p-[18px] hover:border-brass transition-colors min-h-[44px]"
                        >
                          <div className="flex items-center gap-3 mb-3.5">
                            <div className="h-11 w-11 rounded-full bg-forest-deep border border-brass/30 flex items-center justify-center text-sm font-semibold text-brass-light shrink-0">
                              {initials(t.workerName)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-base font-medium text-cream truncate">{t.workerName}</div>
                              {loc === "shop" ? (
                                <span className="inline-block mt-1 text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full bg-brass/15 text-brass-light">
                                  Shop
                                </span>
                              ) : loc === "home" ? (
                                <span className="inline-block mt-1 text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full bg-[#9B8BC4]/18 text-[#B7A8DE]">
                                  Home
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div>
                              <div className="text-lg font-semibold text-brass-light tabular-nums">{t.pieces}</div>
                              <div className="text-[10px] uppercase tracking-wider text-cream-dim">Pcs</div>
                            </div>
                            <div>
                              <div className="text-lg font-semibold text-cream tabular-nums">{fmtMins(t.minutes)}</div>
                              <div className="text-[10px] uppercase tracking-wider text-cream-dim">Time</div>
                            </div>
                            <div>
                              <div className="text-lg font-semibold text-cream tabular-nums">{money(t.revenue)}</div>
                              <div className="text-[10px] uppercase tracking-wider text-cream-dim">Work $</div>
                            </div>
                          </div>
                          <div className="h-[5px] rounded-full bg-forest-raised overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                pace.kind === "above" && "bg-signal-emerald",
                                pace.kind === "avg" && "bg-brass",
                                pace.kind === "below" && "bg-signal-amber",
                              )}
                              style={{ width: `${pace.pct}%` }}
                            />
                          </div>
                          <div className="text-[9.5px] text-cream-dim mt-1.5 text-right">{pace.label}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <WeekRollup q={weekQ} metric={weekMetric} setMetric={setWeekMetric} />
        )}
      </div>

      {/* Detail drawer — slides in from the right and slides back */}
      {view && data ? (
        <LuxuryLayer
          open={!!selected}
          onClose={() => setSelectedId(null)}
          variant="drawer"
          label={`${view.workerName} detail`}
          z={50}
        >
          <aside className="h-full w-full max-w-[480px] bg-forest-base border-l border-brass/25 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-brass/20 bg-forest-base/95 backdrop-blur px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-12 w-12 rounded-full bg-forest-deep border border-brass/30 flex items-center justify-center text-sm font-semibold text-brass-light">
                  {initials(view.workerName)}
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-medium text-cream truncate">{view.workerName}</div>
                  {view.workLocation === "shop" ? (
                    <span className="inline-block mt-1 text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full bg-brass/15 text-brass-light">
                      Shop
                    </span>
                  ) : view.workLocation === "home" ? (
                    <span className="inline-block mt-1 text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full bg-[#9B8BC4]/18 text-[#B7A8DE]">
                      Home
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-full border border-brass/30 text-cream-muted hover:text-cream"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["shop", "Shop only"],
                    ["home", "Home only"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLocFilter(k)}
                    className={cn(
                      "min-h-10 px-3 rounded-full text-[11px] font-semibold uppercase tracking-[0.12em] border",
                      locFilter === k
                        ? "border-brass bg-brass/20 text-brass-light"
                        : "border-brass/20 text-cream-dim",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-xl border border-brass/20 bg-forest-deep/50 p-3">
                <div>
                  <div className="text-lg font-semibold text-brass-light tabular-nums">{view.pieces}</div>
                  <div className="text-[10px] uppercase text-cream-dim">Pieces</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-cream tabular-nums">{fmtMins(view.minutes)}</div>
                  <div className="text-[10px] uppercase text-cream-dim">Time</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-cream tabular-nums">{money(view.revenue)}</div>
                  <div className="text-[10px] uppercase text-cream-dim">Work $</div>
                </div>
              </div>

              {selectedPieces.length === 0 ? (
                <p className="text-sm text-cream-dim py-6 text-center border border-dashed border-brass/25 rounded-xl">
                  Nothing logged for {view.workerName} on {date}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedPieces.map((g, i) => (
                    <li
                      key={`${g.ticket}-${g.garmentId ?? i}-${g.completedAt ?? i}`}
                      className="flex items-start justify-between gap-3 rounded-xl border border-brass/15 bg-black/20 px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-brass-light tabular-nums">{fmtClock(g.completedAt)}</div>
                        <div className="text-sm font-medium text-cream truncate">{g.ticket || "—"}</div>
                        <div className="text-xs text-cream-dim truncate">{g.type || "Garment"}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono tabular-nums text-cream">{fmtMins(g.minutes)}</div>
                        <div className="text-xs text-cream-dim tabular-nums">{money(g.revenue)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </LuxuryLayer>
      ) : null}

      {/* silence unused dateOpen for a11y focus tracking */}
      <span className="hidden" aria-hidden>
        {dateOpen ? "1" : "0"}
      </span>
    </div>
  );
}

function WeekRollup({
  q,
  metric,
  setMetric,
}: {
  q: ReturnType<typeof useQuery<TallyPayload, Error>>;
  metric: WeekMetric;
  setMetric: (m: WeekMetric) => void;
}) {
  if (q.isLoading) return <p className="text-sm text-cream-dim">Loading tally…</p>;
  if (q.isError) return <p className="text-sm text-signal-amber">Couldn’t load tally</p>;

  const data = q.data!;
  const days = data.byDay ?? [];
  const maxVal = Math.max(
    1,
    ...days.flatMap((d) =>
      d.tailors.map((t) => (metric === "hours" ? t.minutes : t.pieces)),
    ),
    ...(data.tailors.map((t) => (metric === "hours" ? t.minutes : t.pieces)) as number[]),
  );

  const leaderboard = [...data.tailors].sort((a, b) =>
    metric === "hours" ? b.minutes - a.minutes : b.pieces - a.pieces,
  );

  // Per-tailor series aligned to byDay dates
  const series = leaderboard.map((t) => {
    const vals = days.map((d) => {
      const hit = d.tailors.find((x) => x.workerId === t.workerId);
      if (!hit) return 0;
      return metric === "hours" ? hit.minutes : hit.pieces;
    });
    return { tailor: t, vals };
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="caps text-cream-dim text-[11px]">7-day rollup</div>
        <div className="flex gap-1.5">
          {(
            [
              ["hours", "Hours"],
              ["pieces", "Pieces"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={cn(
                "min-h-10 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.12em] border",
                metric === k
                  ? "border-brass bg-brass/20 text-brass-light"
                  : "border-brass/20 text-cream-dim",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.totals.pieces === 0 ? (
        <div className="rounded-xl border border-dashed border-brass/30 bg-black/20 px-5 py-10 text-center text-sm text-cream-dim">
          No completions logged — scan hang tag → Mark complete → time chip.
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-8">
            {series.map(({ tailor, vals }) => {
              const totalLabel =
                metric === "hours" ? `${tailor.hours}h` : String(tailor.pieces);
              return (
                <div key={tailor.workerId} className="grid grid-cols-[7rem_1fr_3.5rem] items-end gap-3">
                  <div className="text-sm text-cream truncate pb-1">{tailor.workerName}</div>
                  {/* Fixed height + margin-top:auto baseline (Lucia render-proof §2) */}
                  <div className="chart-bars flex h-[72px] items-stretch gap-1.5">
                    {vals.map((v, i) => {
                      const pct = Math.max(v > 0 ? 8 : 0, Math.round((v / maxVal) * 100));
                      const low = v === 0;
                      return (
                        <div
                          key={days[i]?.date ?? i}
                          className="flex-1 flex flex-col justify-end h-full"
                          title={`${days[i]?.date ?? ""}: ${v}`}
                        >
                          <div
                            className={cn(
                              "w-full rounded-t-sm bg-brass/80",
                              low && "bg-brass/25 min-h-[4px]",
                            )}
                            style={{
                              height: low ? 4 : `${pct}%`,
                              marginTop: "auto",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-sm tabular-nums text-brass-light text-right pb-1">{totalLabel}</div>
                </div>
              );
            })}
            <div className="grid grid-cols-[7rem_1fr_3.5rem] gap-3">
              <div />
              <div className="flex gap-1.5">
                {days.map((d) => (
                  <div key={d.date} className="flex-1 text-center text-[10px] text-cream-dim">
                    {weekdayLetter(d.date)}
                  </div>
                ))}
              </div>
              <div />
            </div>
          </div>

          <div className="caps text-cream-dim text-[11px] mb-2">Leaderboard — Week</div>
          <div className="overflow-x-auto rounded-xl border border-brass/20">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brass/20 text-left text-[10px] uppercase tracking-wider text-cream-dim">
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Tailor</th>
                  <th className="px-3 py-2.5 text-right">Pcs</th>
                  <th className="px-3 py-2.5 text-right">Hours</th>
                  <th className="px-3 py-2.5 text-right">Work $</th>
                  <th className="px-3 py-2.5 text-right">$/hr</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((t, i) => {
                  const perHr =
                    t.hours > 0 ? Math.round(t.revenue / t.hours) : null;
                  return (
                    <tr key={t.workerId} className="border-b border-brass/10 last:border-0">
                      <td className="px-3 py-2.5 text-cream-dim tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2.5 text-cream font-medium">{t.workerName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{t.pieces}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{t.hours}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(t.revenue)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-brass-light">
                        {perHr == null ? "—" : money(perHr)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
