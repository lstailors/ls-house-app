import { useState } from "react";
import { cn } from "@/lib/utils";
import type { StaffAppointment, TimeBlock } from "../../../../backend/src/types";

const AGENT_DOT: Record<string, string> = {
  "carl@lstailors.com":   "bg-emerald-400",
  "sal@lstailors.com":    "bg-amber-400",
  "kelvin@lstailors.com": "bg-blue-400",
  "chris@ckcny.com":      "bg-rose-400",
};
const AGENT_CARD: Record<string, { bg: string; border: string; dot: string; name: string }> = {
  "carl@lstailors.com":   { bg: "bg-emerald-900/30", border: "border-emerald-600/40", dot: "bg-emerald-400", name: "text-emerald-300" },
  "sal@lstailors.com":    { bg: "bg-amber-900/30",   border: "border-amber-600/40",   dot: "bg-amber-400",   name: "text-amber-300"   },
  "kelvin@lstailors.com": { bg: "bg-blue-900/30",    border: "border-blue-600/40",    dot: "bg-blue-400",    name: "text-blue-300"    },
  "chris@ckcny.com":      { bg: "bg-rose-900/30",    border: "border-rose-600/40",    dot: "bg-rose-400",    name: "text-rose-300"    },
};
const DEFAULT_CARD = { bg: "bg-[#1F3A2E]/40", border: "border-[#B08D57]/30", dot: "bg-[#B08D57]", name: "text-[#B08D57]" };

const DAY_HDRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function fmtTime(str: string): string {
  return new Date(str.replace(" ", "T")).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // back to Sunday
  const weeks: Date[][] = [];
  const cur = new Date(start);
  while (cur <= last || weeks.length < 5) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
    if (cur > last && weeks.length >= 5) break;
  }
  return weeks;
}

interface Props {
  appointments: StaffAppointment[];
  blocks: TimeBlock[];
  monthDate: Date;
  currentUserEmail: string;
  filter: "my" | "all";
  onTapAppointment: (appt: StaffAppointment) => void;
  onDrillDay: (date: Date) => void;
}

export function MonthView({
  appointments,
  blocks,
  monthDate,
  currentUserEmail,
  filter,
  onTapAppointment,
  onDrillDay,
}: Props) {
  const todayKey = toKey(new Date());
  const year  = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const weeks = buildGrid(year, month);

  const [selectedKey, setSelectedKey] = useState<string>(todayKey);

  const visibleAppts = filter === "my"
    ? appointments.filter((a) => a.assignedAgent === currentUserEmail)
    : appointments;

  // ── Day cell helpers ──────────────────────────────────────────────────────
  function dayAppts(key: string) {
    return visibleAppts.filter((a) => a.scheduledTime.startsWith(key))
      .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  }
  function dayBlocks(key: string) {
    return filter === "all"
      ? blocks.filter((b) => b.startsOn.startsWith(key) || b.allDay)
      : [];
  }

  // ── Selected-day data ─────────────────────────────────────────────────────
  const selAppts  = dayAppts(selectedKey);
  const selBlocks = dayBlocks(selectedKey);
  const selDate   = new Date(selectedKey + "T00:00:00");

  return (
    <div>
      {/* ── Calendar grid ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden mb-4">
        {/* Header row */}
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAY_HDRS.map((h) => (
            <div key={h} className="text-center py-2 text-[9px] text-white/25 uppercase tracking-widest">
              {h}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className={cn("grid grid-cols-7", wi < weeks.length - 1 && "border-b border-white/10")}
          >
            {week.map((day) => {
              const key          = toKey(day);
              const inMonth      = day.getMonth() === month;
              const isToday      = key === todayKey;
              const isSelected   = key === selectedKey;
              const appts        = dayAppts(key);
              const blks         = dayBlocks(key);
              const total        = appts.length + blks.length;
              const MAX_DOTS     = 3;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className={cn(
                    "min-h-[56px] py-1.5 flex flex-col items-center gap-0.5 transition-colors",
                    isSelected && "bg-[#B08D57]/10",
                    !inMonth && "opacity-25",
                  )}
                >
                  <span
                    className={cn(
                      "w-7 h-7 flex items-center justify-center rounded-full text-sm font-semibold leading-none",
                      isToday && !isSelected && "bg-[#B08D57] text-[#0D1A10]",
                      isToday && isSelected  && "bg-[#B08D57] text-[#0D1A10] ring-2 ring-[#B08D57]/40",
                      !isToday && isSelected && "bg-white/15 text-[#F1E9D6]",
                      !isToday && !isSelected && "text-[#F1E9D6]/70",
                    )}
                  >
                    {day.getDate()}
                  </span>

                  {/* Event dots */}
                  {total > 0 && (
                    <div className="flex items-center gap-[3px] flex-wrap justify-center px-1">
                      {appts.slice(0, MAX_DOTS).map((a) => (
                        <span
                          key={a.name}
                          className={cn("w-1.5 h-1.5 rounded-full shrink-0", AGENT_DOT[a.assignedAgent ?? ""] ?? "bg-[#B08D57]")}
                        />
                      ))}
                      {blks.slice(0, MAX_DOTS - Math.min(appts.length, MAX_DOTS)).map((b) => (
                        <span key={b.name} className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/20" />
                      ))}
                      {total > MAX_DOTS && (
                        <span className="text-[8px] text-white/25 leading-none">+{total - MAX_DOTS}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Selected-day panel ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <p className="text-xs font-medium text-[#F1E9D6]/60 uppercase tracking-wider">
            {selDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <button
            type="button"
            onClick={() => onDrillDay(selDate)}
            className="text-[11px] text-[#B08D57]/60 hover:text-[#B08D57] transition-colors"
          >
            Day view →
          </button>
        </div>

        {selAppts.length === 0 && selBlocks.length === 0 ? (
          <div className="text-center py-10 text-white/20 text-sm">No appointments</div>
        ) : (
          <div className="space-y-2">
            {/* Blocks first */}
            {selBlocks.map((block) => (
              <div
                key={block.name}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(-45deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 2px, transparent 2px, transparent 8px)",
                }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                    {block.isWholeshop ? "All Staff Blocked" : "Blocked"}
                  </span>
                </div>
                <p className="text-sm text-white/50">{block.reason ?? "Time blocked"}</p>
                {!block.allDay && (
                  <p className="text-xs text-white/25 font-mono mt-1">
                    {fmtTime(block.startsOn)}
                    {block.endsOn ? ` – ${fmtTime(block.endsOn)}` : ""}
                  </p>
                )}
              </div>
            ))}

            {/* Appointment cards */}
            {selAppts.map((appt) => {
              const c = AGENT_CARD[appt.assignedAgent ?? ""] ?? DEFAULT_CARD;
              const statusLabel =
                appt.status === "Unverified" ? "Unconfirmed" :
                appt.status === "Open" ? "Confirmed" :
                appt.customerDetails?.includes("[No-show]") ? "No-show" : "Done";
              const statusCls =
                appt.status === "Unverified" ? "text-amber-400" :
                appt.status === "Open" ? "text-emerald-400" :
                appt.customerDetails?.includes("[No-show]") ? "text-rose-400" :
                "text-white/25";

              return (
                <button
                  key={appt.name}
                  type="button"
                  onClick={() => onTapAppointment(appt)}
                  className={cn(
                    "w-full text-left rounded-xl border px-4 py-3 transition-all active:scale-[0.98]",
                    c.bg, c.border,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/40 font-mono tabular-nums mb-0.5">
                        {fmtTime(appt.scheduledTime)}
                        {appt.endTime ? ` – ${fmtTime(appt.endTime)}` : ""}
                      </p>
                      <p className="text-sm font-semibold text-[#F1E9D6] truncate leading-snug">
                        {appt.customerName}
                      </p>
                      {appt.appointmentType ? (
                        <p className="text-xs text-white/40 truncate mt-0.5">{appt.appointmentType}</p>
                      ) : null}
                    </div>
                    {/* Right */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={cn("text-[10px] font-medium", statusCls)}>{statusLabel}</span>
                      <div className="flex items-center gap-1">
                        <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
                        <span className={cn("text-[10px]", c.name)}>
                          {appt.agentDisplayName ?? appt.assignedAgent?.split("@")[0]}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
