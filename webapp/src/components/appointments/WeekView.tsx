import { cn } from "@ls/design/utils";
import { BlockCard } from "./BlockCard";
import type { StaffAppointment, TimeBlock } from "@ls/types";

const AGENT_COLORS: Record<string, { dot: string; border: string }> = {
  "carl@lstailors.com": { dot: "bg-emerald-400", border: "border-l-emerald-500" },
  "sal@lstailors.com": { dot: "bg-amber-400", border: "border-l-amber-500" },
  "kelvin@lstailors.com": { dot: "bg-blue-400", border: "border-l-blue-500" },
  "chris@ckcny.com": { dot: "bg-rose-400", border: "border-l-rose-500" },
};
const DEFAULT_AGENT_COLOR = { dot: "bg-[#B08D57]", border: "border-l-[#B08D57]" };

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatTime(str: string): string {
  return new Date(str.replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function toDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

interface Props {
  appointments: StaffAppointment[];
  blocks: TimeBlock[];
  weekStart: Date;
  currentUserEmail: string;
  filter: "my" | "all";
  onTapAppointment: (appt: StaffAppointment) => void;
}

interface MiniCardProps {
  appointment: StaffAppointment;
  currentUserEmail: string;
  onTap: (appt: StaffAppointment) => void;
}

function MiniCard({ appointment, currentUserEmail, onTap }: MiniCardProps) {
  const agentEmail = appointment.assignedAgent ?? "";
  const colors = AGENT_COLORS[agentEmail] ?? DEFAULT_AGENT_COLOR;
  const isOwn = agentEmail === currentUserEmail;

  return (
    <button
      type="button"
      onClick={() => onTap(appointment)}
      className={cn(
        "w-full text-left rounded-lg border-l-2 border border-white/10 bg-white/5 px-2 py-1.5 transition-all active:scale-[0.98]",
        colors.border,
        isOwn ? "bg-white/10" : "bg-white/5"
      )}
    >
      <p className="text-[10px] text-[#F1E9D6]/50 font-mono tabular-nums leading-none mb-0.5">
        {formatTime(appointment.scheduledTime)}
      </p>
      <p className="text-xs text-[#F1E9D6] truncate leading-tight">
        {appointment.customerName.length > 15 ? appointment.customerName.slice(0, 14) + "…" : appointment.customerName}
      </p>
      <div className="flex items-center gap-1 mt-0.5">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", colors.dot)} />
      </div>
    </button>
  );
}

interface MiniBlockProps {
  block: TimeBlock;
}

function MiniBlock({ block }: MiniBlockProps) {
  return (
    <div
      className="w-full rounded-lg border border-white/10 bg-[#163524]/60 px-2 py-1.5 relative overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(-45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 8px)",
      }}
    >
      <p className="text-[10px] text-white/30 truncate">{block.reason ?? "Blocked"}</p>
      {block.allDay ? (
        <p className="text-[10px] text-white/20">All day</p>
      ) : (
        <p className="text-[10px] text-white/20 font-mono">{formatTime(block.startsOn)}</p>
      )}
    </div>
  );
}

export function WeekView({ appointments, blocks, weekStart, currentUserEmail, filter, onTapAppointment }: Props) {
  const today = toDateKey(new Date());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const filteredAppts = filter === "my"
    ? appointments.filter((a) => a.assignedAgent === currentUserEmail)
    : appointments;

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="flex gap-2" style={{ minWidth: `${7 * 148}px` }}>
        {days.map((day, idx) => {
          const dateKey = toDateKey(day);
          const isToday = dateKey === today;

          const dayAppts = filteredAppts
            .filter((a) => a.scheduledTime.startsWith(dateKey))
            .sort(
              (a, b) =>
                new Date(a.scheduledTime.replace(" ", "T")).getTime() -
                new Date(b.scheduledTime.replace(" ", "T")).getTime()
            );

          const dayBlocks = filter === "all"
            ? blocks.filter((b) => b.startsOn.startsWith(dateKey) || b.allDay)
            : [];

          return (
            <div key={dateKey} className="flex-1 min-w-[140px]">
              <div
                className={cn(
                  "flex flex-col items-center py-2 rounded-t-xl mb-2",
                  isToday ? "bg-[#B08D57]/20 border border-[#B08D57]/30" : "bg-white/5 border border-white/10"
                )}
              >
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wider font-medium",
                    isToday ? "text-[#B08D57]" : "text-white/40"
                  )}
                >
                  {DAY_LABELS[idx]}
                </span>
                <span
                  className={cn(
                    "text-base font-semibold",
                    isToday ? "text-[#B08D57]" : "text-[#F1E9D6]/60"
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="space-y-1.5">
                {dayAppts.map((appt) => (
                  <MiniCard
                    key={appt.name}
                    appointment={appt}
                    currentUserEmail={currentUserEmail}
                    onTap={onTapAppointment}
                  />
                ))}
                {dayBlocks.map((block) => (
                  <MiniBlock key={block.name} block={block} />
                ))}
                {dayAppts.length === 0 && dayBlocks.length === 0 ? (
                  <div className="text-center py-3">
                    <span className="text-[10px] text-white/15">—</span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
