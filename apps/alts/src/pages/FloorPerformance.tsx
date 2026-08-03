/**
 * SPEC 061 — Floor Performance dashboard (alts)
 * Mocks: ~/ls-design/mockups/tailor-productivity/
 * Data: GET /api/garment/tally?date= | ?start=&end=
 * Shop/Home badges: only when workLocation is set — never invent (Lucia §0.3).
 */
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import {
  type PaceKind,
  type TallyGarment,
  type TallyTailor,
  type TailorTally,
  type WorkLocation,
  addDaysIso,
  dollarsPerHour,
  fmtMins,
  formatPieceTime,
  formatWeekLabel,
  initials,
  money,
  nyToday,
  paceFor,
  weekRangeContaining,
} from "@alts/lib/tally";

type Tab = "dashboard" | "week";
type SortKey = "time" | "pieces" | "revenue";
type LocFilter = "all" | "shop" | "home";
type WeekMetric = "hours" | "pieces";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const EMPTY_DASH =
  "No completions logged — scan hang tag → Mark complete → time chip.";

async function fetchTally(params: Record<string, string>): Promise<TailorTally> {
  const qs = new URLSearchParams(params).toString();
  const res = await api.raw(`/api/garment/tally?${qs}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || "Tally failed");
  return (j?.data ?? j) as TailorTally;
}

function LocBadge({ loc }: { loc?: WorkLocation }) {
  if (loc !== "shop" && loc !== "home") return null;
  return (
    <span
      className={cn(
        "inline-block mt-0.5 text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full",
        loc === "shop" && "bg-brass/15 text-brass-light",
        loc === "home" && "bg-[#9B8BC4]/18 text-[#B7A8DE]",
      )}
    >
      {loc === "shop" ? "Shop" : "Home"}
    </span>
  );
}

function PaceBar({ kind, pct, label }: { kind: PaceKind; pct: number; label: string }) {
  return (
    <div>
      <div className="h-[5px] rounded-sm bg-forest-mid overflow-hidden">
        <div
          className={cn(
            "h-full rounded-sm",
            kind === "above" && "bg-signal-emerald",
            kind === "avg" && "bg-brass",
            kind === "below" && "bg-signal-amber",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[9.5px] text-cream-dim mt-1 text-right">{label}</div>
    </div>
  );
}

function KpiStrip({
  totals,
  loading,
}: {
  totals?: TailorTally["totals"];
  loading?: boolean;
}) {
  const cells = [
    { label: "Total Pieces", short: "Pieces", val: totals ? String(totals.pieces) : "—", cream: false },
    { label: "Total Hours", short: "Hours", val: totals ? String(totals.hours) : "—", cream: false },
    {
      label: "Total Work $",
      short: "Work $",
      val: totals ? money(totals.revenue) : "—",
      cream: false,
    },
    {
      label: "Active Tailors",
      short: "Tailors",
      val: totals ? String(totals.workers) : "—",
      cream: true,
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4 md:mb-5">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-[10px] border border-brass/20 bg-forest/80 px-3.5 py-3 md:px-[18px] md:py-4"
        >
          <div className="text-[9px] md:text-[10px] uppercase tracking-[0.12em] text-cream-dim mb-1 md:mb-1.5">
            <span className="md:hidden">{c.short}</span>
            <span className="hidden md:inline">{c.label}</span>
          </div>
          <div
            className={cn(
              "text-xl md:text-[26px] font-semibold tabular-nums",
              c.cream ? "text-cream" : "text-brass-light",
              loading && "opacity-50",
            )}
          >
            {c.val}
          </div>
        </div>
      ))}
    </div>
  );
}

function TailorDetailDrawer({
  open,
  onClose,
  tailor,
  garments,
  dateLabel,
}: {
  open: boolean;
  onClose: () => void;
  tailor: TallyTailor | null;
  garments: TallyGarment[];
  dateLabel: string;
}) {
  const [filter, setFilter] = useState<LocFilter>("all");

  const filtered = useMemo(() => {
    if (!tailor) return [];
    let list = garments.filter((g) => (g.workerId || "unassigned") === tailor.workerId);
    if (filter === "shop") list = list.filter((g) => g.workLocation === "shop");
    if (filter === "home") list = list.filter((g) => g.workLocation === "home");
    return list;
  }, [garments, tailor, filter]);

  const totals = useMemo(() => {
    const pieces = filtered.length;
    const minutes = filtered.reduce((s, g) => s + (g.minutes || 0), 0);
    const revenue = filtered.reduce((s, g) => s + (g.revenue || 0), 0);
    return { pieces, minutes, revenue };
  }, [filtered]);

  if (!open || !tailor) return null;

  const body = (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative z-10 flex flex-col w-full sm:w-[480px] max-w-full h-full",
          "bg-forest-deep border-l border-brass shadow-2xl",
          "animate-in slide-in-from-right duration-200",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-cream-dim hover:text-cream text-xl leading-none min-h-11 min-w-11 flex items-center justify-center"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="px-5 sm:px-6 pt-6 pb-4 border-b border-brass/15">
          <div className="flex items-center gap-3.5 pr-10">
            <div className="w-[52px] h-[52px] rounded-full bg-forest-mid border border-brass flex items-center justify-center text-brass-light font-bold text-base shrink-0">
              {initials(tailor.workerName)}
            </div>
            <div>
              <div className="text-[22px] text-cream font-display italic leading-tight">
                {tailor.workerName}
              </div>
              <LocBadge loc={tailor.workLocation ?? null} />
            </div>
          </div>

          <div className="flex gap-1.5 mt-4 flex-wrap">
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
                onClick={() => setFilter(k)}
                className={cn(
                  "text-[10.5px] border px-3.5 py-1.5 rounded-full min-h-9",
                  filter === k
                    ? "bg-brass text-forest-deep border-brass font-bold"
                    : "border-brass/25 text-cream-dim",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5 mt-4 rounded-[10px] border border-brass/20 bg-forest/80 p-3.5">
            <div className="text-center">
              <div className="text-xl font-semibold text-brass-light tabular-nums">{totals.pieces}</div>
              <div className="text-[9px] uppercase tracking-wider text-cream-dim mt-0.5">Pieces</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-brass-light tabular-nums">
                {fmtMins(totals.minutes)}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-cream-dim mt-0.5">Time</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-brass-light tabular-nums">
                {money(totals.revenue)}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-cream-dim mt-0.5">Work $</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          <div className="text-[10.5px] uppercase tracking-[0.1em] text-brass-light mb-2.5">
            {dateLabel} · Piece by Piece
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-cream-dim py-8 text-center border border-dashed border-brass/25 rounded-xl">
              Nothing logged for {tailor.workerName} on {dateLabel}.
            </p>
          ) : (
            <ul>
              {filtered.map((g, i) => (
                <li
                  key={`${g.ticket}-${g.garmentId ?? i}-${g.completedAt ?? i}`}
                  className="flex items-center justify-between gap-3 py-3 border-b border-brass/15 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-[10.5px] text-cream-dim">{formatPieceTime(g.completedAt)}</div>
                    <div className="text-sm text-cream mt-0.5 truncate">{g.ticket || "—"}</div>
                    <div className="text-[11.5px] text-cream-dim mt-0.5 truncate">
                      {g.type || "Garment"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold text-brass-light tabular-nums">
                      {fmtMins(g.minutes)}
                    </div>
                    <div className="text-[11.5px] text-cream-dim mt-0.5 tabular-nums">
                      {money(g.revenue)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );

  return createPortal(body, document.body);
}

export default function FloorPerformance() {
  const today = nyToday();
  const yesterday = addDaysIso(today, -1);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [date, setDate] = useState(today);
  const [sort, setSort] = useState<SortKey>("time");
  const [weekMetric, setWeekMetric] = useState<WeekMetric>("hours");
  const [selected, setSelected] = useState<TallyTailor | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const week = useMemo(() => weekRangeContaining(today), [today]);

  const dayQ = useQuery({
    queryKey: ["tailor-tally", "day", date],
    queryFn: () => fetchTally({ date }),
    staleTime: 45_000,
    refetchInterval: 90_000,
    retry: 1,
    enabled: tab === "dashboard",
  });

  const weekQ = useQuery({
    queryKey: ["tailor-tally", "week", week.start, week.end],
    queryFn: () => fetchTally({ start: week.start, end: week.end }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
    enabled: tab === "week",
  });

  const dayData = dayQ.data;
  const weekData = weekQ.data;

  const dayAvgMinutes = useMemo(() => {
    const list = dayData?.tailors ?? [];
    if (!list.length) return 0;
    return list.reduce((s, t) => s + t.minutes, 0) / list.length;
  }, [dayData]);

  const sortedTailors = useMemo(() => {
    const list = [...(dayData?.tailors ?? [])];
    list.sort((a, b) => {
      if (sort === "pieces") return b.pieces - a.pieces || b.minutes - a.minutes;
      if (sort === "revenue") return b.revenue - a.revenue || b.minutes - a.minutes;
      return b.minutes - a.minutes || b.pieces - a.pieces;
    });
    return list;
  }, [dayData, sort]);

  const datePreset: "today" | "yesterday" | "other" =
    date === today ? "today" : date === yesterday ? "yesterday" : "other";

  const dateLabel =
    date === today ? "Today" : date === yesterday ? "Yesterday" : date;

  const weekRows = useMemo(() => {
    const byDay = weekData?.byDay ?? [];
    const names = new Map<string, string>();
    for (const t of weekData?.tailors ?? []) names.set(t.workerId, t.workerName);

    return (weekData?.tailors ?? []).map((t) => {
      const days = byDay.map((d) => {
        const hit = d.tailors.find((x) => x.workerId === t.workerId);
        return {
          date: d.date,
          minutes: hit?.minutes ?? 0,
          hours: hit?.hours ?? 0,
          pieces: hit?.pieces ?? 0,
          revenue: hit?.revenue ?? 0,
        };
      });
      const dph = dollarsPerHour(t.revenue, t.hours);
      return { ...t, days, dollarsPerHour: dph, name: names.get(t.workerId) || t.workerName };
    });
  }, [weekData]);

  const weekMax = useMemo(() => {
    let m = 0;
    for (const row of weekRows) {
      for (const d of row.days) {
        const v = weekMetric === "hours" ? d.hours : d.pieces;
        if (v > m) m = v;
      }
    }
    return m || 1;
  }, [weekRows, weekMetric]);

  return (
    <div className="min-h-dvh bg-forest-deep text-cream">
      <div className="max-w-[1400px] mx-auto px-4 py-4 sm:px-7 sm:py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="text-[11px] uppercase tracking-widest text-cream-dim hover:text-cream min-h-11 inline-flex items-center"
              >
                ← Home
              </Link>
            </div>
            <h1 className="font-display italic text-[22px] sm:text-[28px] text-cream font-normal m-0 leading-tight">
              Floor Performance
            </h1>
            <div className="text-[11px] sm:text-xs text-cream-dim mt-0.5">
              {tab === "week"
                ? formatWeekLabel(week.start, week.end)
                : "Tailor productivity · alts.lstailors.com"}
            </div>
          </div>

          {tab === "dashboard" ? (
            <div className="flex gap-1.5 items-center overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setDate(today)}
                className={cn(
                  "border text-[11px] px-3.5 py-2 rounded-full min-h-11 whitespace-nowrap",
                  datePreset === "today"
                    ? "bg-brass text-forest-deep border-brass font-bold"
                    : "border-brass/25 text-cream-dim",
                )}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDate(yesterday)}
                className={cn(
                  "border text-[11px] px-3.5 py-2 rounded-full min-h-11 whitespace-nowrap",
                  datePreset === "yesterday"
                    ? "bg-brass text-forest-deep border-brass font-bold"
                    : "border-brass/25 text-cream-dim",
                )}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()}
                className={cn(
                  "border border-dashed text-[11px] px-3.5 py-2 rounded-full min-h-11 whitespace-nowrap",
                  datePreset === "other"
                    ? "bg-brass text-forest-deep border-brass font-bold"
                    : "border-brass/40 text-cream-dim",
                )}
              >
                📅 {datePreset === "other" ? date : "Pick date"}
              </button>
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                max={today}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
              />
            </div>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-brass/20 mb-4 md:mb-5">
          {(
            [
              ["dashboard", "Dashboard"],
              ["week", "Week Rollup"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "px-1 py-2.5 mr-5 text-[11px] uppercase tracking-[0.1em] font-bold border-b-2 min-h-11",
                tab === k
                  ? "text-brass-light border-brass"
                  : "text-cream-dim border-transparent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "dashboard" ? (
          <>
            {dayQ.isLoading ? (
              <p className="text-sm text-cream-dim mb-4">Loading tally…</p>
            ) : dayQ.isError ? (
              <p className="text-sm text-signal-amber mb-4">Couldn&apos;t load tally</p>
            ) : null}

            <KpiStrip totals={dayData?.totals} loading={dayQ.isLoading} />

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-brass-light">
                Tailors · {dateLabel}
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
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
                      "text-[10.5px] border px-3 py-1.5 rounded-full min-h-9 whitespace-nowrap",
                      sort === k
                        ? "bg-brass-light text-forest-deep border-brass-light font-semibold"
                        : "border-brass/25 text-cream-dim",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {!dayQ.isLoading && !dayQ.isError && (!dayData || dayData.totals.pieces === 0) ? (
              <div className="rounded-xl border border-dashed border-brass/30 bg-forest/60 px-4 py-10 text-center text-[13px] text-cream-dim">
                {EMPTY_DASH}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 md:gap-3.5 mb-6">
                {sortedTailors.map((t) => {
                  const pace = paceFor(t.minutes, dayAvgMinutes);
                  return (
                    <button
                      key={t.workerId}
                      type="button"
                      onClick={() => setSelected(t)}
                      className="text-left rounded-xl border border-brass/20 bg-forest/80 p-3.5 md:p-[18px] hover:border-brass transition-colors min-h-11"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-forest-mid border border-brass flex items-center justify-center text-brass-light font-bold text-xs md:text-[13px] shrink-0">
                          {initials(t.workerName)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[15px] md:text-base text-cream font-medium truncate">
                            {t.workerName}
                          </div>
                          <LocBadge loc={t.workLocation ?? null} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center">
                          <div className="text-base md:text-[19px] font-semibold text-brass-light tabular-nums">
                            {t.pieces}
                          </div>
                          <div className="text-[8.5px] md:text-[9.5px] uppercase tracking-wide text-cream-dim mt-0.5">
                            Pcs
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-base md:text-[19px] font-semibold text-cream tabular-nums">
                            {fmtMins(t.minutes)}
                          </div>
                          <div className="text-[8.5px] md:text-[9.5px] uppercase tracking-wide text-cream-dim mt-0.5">
                            Time
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-base md:text-[19px] font-semibold text-cream tabular-nums">
                            {money(t.revenue)}
                          </div>
                          <div className="text-[8.5px] md:text-[9.5px] uppercase tracking-wide text-cream-dim mt-0.5">
                            Work $
                          </div>
                        </div>
                      </div>
                      <PaceBar kind={pace.kind} pct={pace.pct} label={pace.label} />
                    </button>
                  );
                })}
              </div>
            )}

            <p className="text-[10.5px] text-cream-dim text-right">
              Time from complete chips · no fake live timers · work $ = garment line total, not cash
              collected
            </p>
          </>
        ) : (
          <>
            {weekQ.isLoading ? (
              <p className="text-sm text-cream-dim mb-4">Loading tally…</p>
            ) : weekQ.isError ? (
              <p className="text-sm text-signal-amber mb-4">Couldn&apos;t load tally</p>
            ) : null}

            <div className="flex gap-1.5 mb-3.5">
              {(
                [
                  ["hours", "Hours"],
                  ["pieces", "Pieces"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWeekMetric(k)}
                  className={cn(
                    "text-[10.5px] border px-3.5 py-1.5 rounded-full min-h-9",
                    weekMetric === k
                      ? "bg-brass text-forest-deep border-brass font-bold"
                      : "border-brass/25 text-cream-dim",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-brass/20 bg-forest/80 p-4 md:p-5 mb-5">
              {!weekQ.isLoading && weekRows.length === 0 ? (
                <div className="text-center text-sm text-cream-dim py-8">{EMPTY_DASH}</div>
              ) : (
                <>
                  {weekRows.map((row) => {
                    const totalLabel =
                      weekMetric === "hours" ? `${row.hours}h` : String(row.pieces);
                    return (
                      <div key={row.workerId} className="flex items-center gap-3 mb-3.5 last:mb-0">
                        <div className="w-[72px] sm:w-[90px] text-[12px] sm:text-[13px] text-cream truncate shrink-0">
                          {row.workerName}
                        </div>
                        {/* Fixed-height flex row; bars use margin-top:auto (SPEC §2) */}
                        <div className="flex-1 flex gap-1 h-9 min-w-0">
                          {row.days.map((d, i) => {
                            const v = weekMetric === "hours" ? d.hours : d.pieces;
                            const low = v <= 0;
                            const hPct = low ? 0 : Math.max(12, Math.round((v / weekMax) * 100));
                            return (
                              <div
                                key={d.date || i}
                                className={cn(
                                  "flex-1 min-w-0 rounded-t-[3px] relative mt-auto",
                                  low
                                    ? "bg-forest-mid border border-brass/20 min-h-[4px]"
                                    : "bg-brass",
                                )}
                                style={low ? undefined : { height: `${hPct}%` }}
                                title={`${d.date}: ${weekMetric === "hours" ? `${d.hours}h` : `${d.pieces} pcs`}`}
                              />
                            );
                          })}
                        </div>
                        <div className="w-14 sm:w-[70px] text-right text-sm font-semibold text-brass-light tabular-nums shrink-0">
                          {totalLabel}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex gap-1 mt-1.5 ml-[72px] sm:ml-[102px] mr-14 sm:mr-[70px]">
                    {DAY_LETTERS.map((L, i) => (
                      <span
                        key={`${L}-${i}`}
                        className="flex-1 text-center text-[9px] uppercase text-cream-dim"
                      >
                        {L}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="text-[10.5px] uppercase tracking-[0.1em] text-brass-light mb-2.5">
              Leaderboard — Week
            </div>
            <div className="overflow-x-auto rounded-xl border border-brass/20 bg-forest/60">
              <table className="w-full border-collapse min-w-[520px]">
                <thead>
                  <tr>
                    <th className="w-6 text-left text-[9.5px] uppercase tracking-wider text-cream-dim px-2.5 py-2 border-b border-brass/15" />
                    <th className="text-left text-[9.5px] uppercase tracking-wider text-cream-dim px-2.5 py-2 border-b border-brass/15">
                      Tailor
                    </th>
                    <th className="text-right text-[9.5px] uppercase tracking-wider text-cream-dim px-2.5 py-2 border-b border-brass/15">
                      Pcs
                    </th>
                    <th className="text-right text-[9.5px] uppercase tracking-wider text-cream-dim px-2.5 py-2 border-b border-brass/15">
                      Hours
                    </th>
                    <th className="text-right text-[9.5px] uppercase tracking-wider text-cream-dim px-2.5 py-2 border-b border-brass/15">
                      Work $
                    </th>
                    <th className="text-right text-[9.5px] uppercase tracking-wider text-cream-dim px-2.5 py-2 border-b border-brass/15">
                      $/hr
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weekRows.map((row, idx) => (
                    <tr key={row.workerId}>
                      <td className="px-2.5 py-3 text-brass-light font-bold border-b border-brass/15">
                        {idx + 1}
                      </td>
                      <td className="px-2.5 py-3 text-[13px] text-cream border-b border-brass/15">
                        {row.workerName}
                      </td>
                      <td className="px-2.5 py-3 text-[13px] text-right tabular-nums border-b border-brass/15">
                        {row.pieces}
                      </td>
                      <td className="px-2.5 py-3 text-[13px] text-right tabular-nums border-b border-brass/15">
                        {row.hours}
                      </td>
                      <td className="px-2.5 py-3 text-[13px] text-right tabular-nums border-b border-brass/15">
                        {money(row.revenue)}
                      </td>
                      <td className="px-2.5 py-3 text-[13px] text-right tabular-nums border-b border-brass/15">
                        {row.dollarsPerHour == null ? "—" : money(row.dollarsPerHour)}
                      </td>
                    </tr>
                  ))}
                  {!weekQ.isLoading && weekRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2.5 py-8 text-center text-cream-dim text-sm">
                        No completions this week.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <TailorDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        tailor={selected}
        garments={dayData?.garments ?? []}
        dateLabel={dateLabel}
      />
    </div>
  );
}
