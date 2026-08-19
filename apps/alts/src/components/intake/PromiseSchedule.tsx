import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@ls/design/utils";

export type DayLoad = {
  date: string; // YYYY-MM-DD
  count: number;
  rush: number;
  tickets: Array<{
    name: string;
    customer_name?: string;
    due_time?: string | null;
    is_rush?: number | boolean;
    workflow_state?: string;
  }>;
  appointments?: Array<{
    id: string;
    title: string;
    start?: string;
    end?: string;
  }>;
};

export type PromiseScheduleProps = {
  origin: "NYC";
  days: DayLoad[];
  loading?: boolean;
  selectedDate: string | null;
  selectedTime: string | null; // HH:mm
  isRush: boolean;
  clientLabel?: string;
  onSelectDate: (d: string) => void;
  onSelectTime: (t: string) => void;
  onRush: (v: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  /** Delivery method + address sit in the same scroll as the date wheel. */
  lead?: ReactNode;
};

/** FOH promise slots — 4 PM is used when staff skip the time picker. */
export const DEFAULT_PROMISE_TIME = "16:00";

export const PROMISE_SLOTS = [
  { value: "10:00", label: "10 AM" },
  { value: "16:00", label: "4 PM" },
] as const;

export function snapPromiseTime(value?: string | null): string {
  const raw = String(value || "").trim().slice(0, 5);
  return raw === "10:00" ? "10:00" : DEFAULT_PROMISE_TIME;
}

function loadLevel(count: number): "open" | "busy" | "full" {
  if (count <= 2) return "open";
  if (count <= 5) return "busy";
  return "full";
}

function fmtDayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    weekday: dt.toLocaleDateString("en-US", { weekday: "short" }),
    day: String(d),
    month: dt.toLocaleDateString("en-US", { month: "short" }),
  };
}

function fmtTime(t?: string | null) {
  if (!t) return "EOD";
  const raw = String(t).slice(0, 5);
  const [hh, mm] = raw.split(":").map(Number);
  if (Number.isNaN(hh)) return raw;
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${ampm}`;
}

/**
 * Last intake step — promised due date + time with day load (airline-style).
 * Stage 1: count-based capacity. Later: minutes × tailor hours.
 *
 * Mobile: scroll body + sticky finish CTA (was clipped by overflow-hidden).
 */
export default function PromiseSchedule({
  origin,
  days,
  loading,
  selectedDate,
  selectedTime,
  isRush,
  clientLabel,
  onSelectDate,
  onSelectTime,
  onRush,
  onBack,
  onConfirm,
  confirming,
  lead,
}: PromiseScheduleProps) {
  const selected = useMemo(
    () => days.find((d) => d.date === selectedDate) || null,
    [days, selectedDate],
  );

  useEffect(() => {
    const snapped = snapPromiseTime(selectedTime);
    if (snapped !== (selectedTime || "")) {
      onSelectTime(snapped);
    }
  }, [selectedTime, onSelectTime]);

  const [shown, setShown] = useState(14);
  const visibleDays = days.slice(0, shown);
  const hasMore = days.length > shown;
  const canConfirm = !!selectedDate && !!selectedTime;

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full relative">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-28 px-1">
        <div className="shrink-0 mb-4">
          <button
            type="button"
            onClick={onBack}
            className="text-[12px] font-bold tracking-widest uppercase text-brass-light mb-2 min-h-[44px]"
          >
            ← Back to review
          </button>
        </div>
        {lead ? <div className="mb-4">{lead}</div> : null}
        <div className="shrink-0 mb-4">
          <h2 className="display text-[36px] md:text-[44px] leading-none italic">
            When is it promised?
          </h2>
          <p className="text-[15px] text-cream-dim mt-2 leading-relaxed max-w-2xl">
            Last step before the ticket. Pick due date and time
            {clientLabel ? ` for ${clientLabel.split(" ")[0]}` : ""}. Bars show how full{" "}
            {origin} already is that day.
          </p>
        </div>

        <div className="mb-5">
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase text-brass-light mb-3">
            Shop days · {origin}
          </div>
          {loading ? (
            <div className="h-40 rounded-2xl border border-brass/20 bg-black/25 animate-pulse" />
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {visibleDays.map((d) => {
                const level = loadLevel(d.count);
                const lab = fmtDayLabel(d.date);
                const sel = selectedDate === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => onSelectDate(d.date)}
                    className={cn(
                      "rounded-2xl border px-1.5 pt-2 pb-2 transition-all",
                      "flex flex-col items-center min-h-[108px] w-full",
                      sel
                        ? "border-brass bg-brass/18 shadow-[0_0_0_1px_rgba(176,141,87,0.35)]"
                        : "border-brass/20 bg-black/25 hover:border-brass/45",
                    )}
                  >
                    <span className="text-[10px] font-bold tracking-wider uppercase text-cream-dim">
                      {lab.weekday}
                    </span>
                    <span className="display text-[26px] leading-none mt-0.5">{lab.day}</span>
                    <span className="text-[10px] text-cream-dim">{lab.month}</span>
                    <div className="flex gap-[2.5px] justify-center mt-2 mb-1 px-1 w-full">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-[6px] flex-1 max-w-[8px] rounded-full",
                            i < Math.min(d.count, 6)
                              ? level === "open"
                                ? "bg-[var(--em,#4FBF8E)]"
                                : level === "busy"
                                  ? "bg-[var(--am,#E8A85C)]"
                                  : "bg-[var(--ro,#D97B6C)]"
                              : "bg-cream/15",
                          )}
                        />
                      ))}
                    </div>
                    <span
                      className={cn(
                        "text-[11px] font-bold tabular-nums",
                        level === "open" && "text-[var(--em,#4FBF8E)]",
                        level === "busy" && "text-[var(--am,#E8A85C)]",
                        level === "full" && "text-[var(--ro,#D97B6C)]",
                      )}
                    >
                      {d.count}
                      {d.rush ? `★` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {hasMore ? (
              <button
                type="button"
                onClick={() => setShown((n) => n + 14)}
                className="rounded-xl border border-brass/40 bg-brass/10 px-3.5 py-2 text-[12px] font-bold tracking-wider uppercase text-brass-light min-h-[44px]"
              >
                More dates →
              </button>
            ) : null}
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 min-h-[44px]">
              <span className="text-[11px] font-bold tracking-wider uppercase text-cream-dim">
                Later
              </span>
              <input
                type="date"
                min={days[0]?.date || new Date().toISOString().slice(0, 10)}
                className="bg-transparent text-sm text-cream outline-none"
                value={selectedDate || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setShown((n) => Math.max(n, days.length));
                  onSelectDate(v);
                }}
              />
            </label>
          </div>
          <div className="flex gap-4 mt-2 text-[12px] text-cream-dim">
            <span className="inline-flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm bg-[var(--em,#4FBF8E)]" /> Open
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm bg-[var(--am,#E8A85C)]" /> Busy
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm bg-[var(--ro,#D97B6C)]" /> Heavy
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-2 min-h-[280px]">
          <div className="rounded-2xl border border-brass/20 bg-black/25 flex flex-col min-h-[260px] overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-brass/15 shrink-0">
              <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
                Already on this day
              </div>
              <div className="display text-xl italic mt-0.5">
                {selectedDate
                  ? `${fmtDayLabel(selectedDate).weekday} ${fmtDayLabel(selectedDate).month} ${fmtDayLabel(selectedDate).day}`
                  : "Pick a day"}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5">
              {!selectedDate && (
                <p className="text-sm text-cream-dim px-2 py-6 text-center">
                  Tap a day above to see the load.
                </p>
              )}
              {selectedDate && selected && selected.tickets.length === 0 && (
                <p className="text-sm text-cream-dim px-2 py-6 text-center">
                  Nothing due yet — open sky.
                </p>
              )}
              {selected?.tickets.map((t) => (
                <div
                  key={t.name}
                  className="rounded-xl border border-brass/15 bg-white/[0.03] px-3 py-2.5 flex items-center gap-2"
                >
                  <span className="text-[11px] font-mono text-brass-light tabular-nums w-14 shrink-0">
                    {fmtTime(t.due_time)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold truncate">
                      {t.customer_name || t.name}
                    </span>
                    <span className="block text-[10px] text-cream-dim truncate">
                      {t.name}
                      {t.workflow_state ? ` · ${t.workflow_state}` : ""}
                      {t.is_rush ? " · rush" : ""}
                    </span>
                  </span>
                </div>
              ))}
              {(selected?.appointments || []).map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-[rgba(155,139,196,0.35)] bg-[rgba(155,139,196,0.08)] px-3 py-2.5 flex items-center gap-2"
                >
                  <span className="text-[11px] font-mono text-[var(--vi,#9B8BC4)] tabular-nums w-14 shrink-0">
                    {a.start ? fmtTime(String(a.start).slice(11, 16)) : "Appt"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold truncate">{a.title}</span>
                    <span className="block text-[10px] text-cream-dim">Appointment</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-brass/20 bg-black/25 flex flex-col overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-brass/15 shrink-0">
              <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
                Promise time
              </div>
              <div className="display text-xl italic mt-0.5">
                {selectedTime ? fmtTime(selectedTime) : "Choose a slot"}
              </div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-3 gap-2">
                {PROMISE_SLOTS.map((s) => {
                  const sel = selectedTime === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      disabled={!selectedDate}
                      onClick={() => onSelectTime(s.value)}
                      className={cn(
                        "h-12 rounded-xl border text-[12px] font-bold tracking-wide",
                        sel
                          ? "border-brass bg-brass text-forest-deep"
                          : "border-brass/25 bg-black/30 text-cream hover:border-brass/50",
                        !selectedDate && "opacity-40",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              <label className="mt-4 flex items-center gap-3 min-h-12 px-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRush}
                  onChange={(e) => onRush(e.target.checked)}
                  className="w-5 h-5 accent-[var(--am,#E8A85C)]"
                />
                <span>
                  <span className="block text-[13px] font-semibold">Rush</span>
                  <span className="block text-[11px] text-cream-dim">
                    Marks the ticket · still pick a real due slot
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky finish CTA — always visible on phone (was buried under overflow) */}
      <div className="absolute bottom-0 inset-x-0 z-20 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-forest-deep via-forest-deep/95 to-transparent pointer-events-none">
        <div className="pointer-events-auto px-0">
          <button
            type="button"
            disabled={!canConfirm || confirming}
            onClick={onConfirm}
            className="btn-brass w-full h-14 text-[12px] disabled:opacity-40 shadow-[0_12px_34px_rgba(176,141,87,0.28)]"
          >
            {confirming
              ? "Writing ticket…"
              : canConfirm
                ? `Finish · ${fmtDayLabel(selectedDate!).month} ${fmtDayLabel(selectedDate!).day} · ${fmtTime(selectedTime)} →`
                : "Pick date & time to finish"}
          </button>
        </div>
      </div>
    </div>
  );
}
