import { useMemo } from "react";
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
  origin: "NYC" | "HOU";
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
};

/** FOH promise slots — last is shop EOD default when date-only. */
export const PROMISE_SLOTS = [
  { value: "10:00", label: "10 AM" },
  { value: "11:00", label: "11 AM" },
  { value: "12:00", label: "12 PM" },
  { value: "13:00", label: "1 PM" },
  { value: "14:00", label: "2 PM" },
  { value: "15:00", label: "3 PM" },
  { value: "16:00", label: "4 PM" },
  { value: "17:00", label: "5 PM" },
  { value: "18:00", label: "6 PM · EOD" },
] as const;

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
}: PromiseScheduleProps) {
  const selected = useMemo(
    () => days.find((d) => d.date === selectedDate) || null,
    [days, selectedDate],
  );

  const canConfirm = !!selectedDate && !!selectedTime;

  return (
    <div className="flex flex-col flex-1 min-h-0 max-w-3xl mx-auto w-full">
      <div className="shrink-0 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] font-bold tracking-widest uppercase text-brass-light mb-2"
        >
          ← Back to review
        </button>
        <h2 className="display text-[32px] md:text-[36px] leading-none italic">
          When is it promised?
        </h2>
        <p className="text-[12.5px] text-cream-dim mt-2 leading-relaxed max-w-xl">
          Last step before the ticket. Pick due date and time
          {clientLabel ? ` for ${clientLabel.split(" ")[0]}` : ""}. Bars show how full{" "}
          {origin} already is that day — like a flight load chart.
        </p>
      </div>

      {/* Airline-style day strip */}
      <div className="shrink-0 mb-4">
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2">
          Next 14 shop days · {origin}
        </div>
        {loading ? (
          <div className="h-28 rounded-2xl border border-brass/20 bg-black/25 animate-pulse" />
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {days.map((d) => {
              const level = loadLevel(d.count);
              const lab = fmtDayLabel(d.date);
              const sel = selectedDate === d.date;
              const barH = Math.min(100, 12 + d.count * 14);
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => onSelectDate(d.date)}
                  className={cn(
                    "snap-start flex-none w-[72px] rounded-2xl border px-1.5 pt-2 pb-2 transition-all",
                    "flex flex-col items-center min-h-[112px]",
                    sel
                      ? "border-brass bg-brass/18 shadow-[0_0_0_1px_rgba(176,141,87,0.35)]"
                      : "border-brass/20 bg-black/25 hover:border-brass/45",
                  )}
                >
                  <span className="text-[9px] font-bold tracking-wider uppercase text-cream-dim">
                    {lab.weekday}
                  </span>
                  <span className="display text-[22px] leading-none mt-0.5">{lab.day}</span>
                  <span className="text-[9px] text-cream-dim">{lab.month}</span>
                  <div className="flex-1 w-full flex items-end justify-center mt-2 mb-1 px-2">
                    <i
                      className={cn(
                        "block w-full max-w-[28px] rounded-t-md",
                        level === "open" && "bg-[var(--em,#4FBF8E)]/80",
                        level === "busy" && "bg-[var(--am,#E8A85C)]/85",
                        level === "full" && "bg-[var(--ro,#D97B6C)]/90",
                      )}
                      style={{ height: `${barH}%`, minHeight: 8 }}
                      aria-hidden
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold tabular-nums",
                      level === "open" && "text-[var(--em,#4FBF8E)]",
                      level === "busy" && "text-[var(--am,#E8A85C)]",
                      level === "full" && "text-[var(--ro,#D97B6C)]",
                    )}
                  >
                    {d.count}
                    {d.rush ? ` · ${d.rush}★` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-3 mt-1 text-[10px] text-cream-dim">
          <span className="inline-flex items-center gap-1">
            <i className="w-2.5 h-2.5 rounded-sm bg-[var(--em,#4FBF8E)]" /> Open (0–2)
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="w-2.5 h-2.5 rounded-sm bg-[var(--am,#E8A85C)]" /> Busy (3–5)
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="w-2.5 h-2.5 rounded-sm bg-[var(--ro,#D97B6C)]" /> Heavy (6+)
          </span>
        </div>
      </div>

      {/* Day detail + time */}
      <div className="flex-1 min-h-0 grid md:grid-cols-2 gap-3 overflow-hidden">
        <div className="rounded-2xl border border-brass/20 bg-black/25 flex flex-col min-h-0 overflow-hidden">
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

        <div className="rounded-2xl border border-brass/20 bg-black/25 flex flex-col min-h-0 overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-brass/15 shrink-0">
            <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
              Promise time
            </div>
            <div className="display text-xl italic mt-0.5">
              {selectedTime ? fmtTime(selectedTime) : "Choose a slot"}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
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

          <div className="shrink-0 p-3 border-t border-brass/15">
            <button
              type="button"
              disabled={!canConfirm || confirming}
              onClick={onConfirm}
              className="btn-brass w-full h-14 text-[12px] disabled:opacity-40"
            >
              {confirming
                ? "Writing ticket…"
                : canConfirm
                  ? `Promise ${fmtDayLabel(selectedDate!).month} ${fmtDayLabel(selectedDate!).day} · ${fmtTime(selectedTime)} →`
                  : "Pick date & time"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
