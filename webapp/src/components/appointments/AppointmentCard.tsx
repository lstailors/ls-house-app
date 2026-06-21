import { DoorOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StaffAppointment } from "../../../../backend/src/types";

const AGENT_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  "carl@lstailors.com": { bg: "bg-emerald-900/40", border: "border-emerald-600/50", text: "text-emerald-300", dot: "bg-emerald-400" },
  "sal@lstailors.com": { bg: "bg-amber-900/40", border: "border-amber-600/50", text: "text-amber-300", dot: "bg-amber-400" },
  "kelvin@lstailors.com": { bg: "bg-blue-900/40", border: "border-blue-600/50", text: "text-blue-300", dot: "bg-blue-400" },
  "chris@ckcny.com": { bg: "bg-rose-900/40", border: "border-rose-600/50", text: "text-rose-300", dot: "bg-rose-400" },
};
const DEFAULT_AGENT_COLOR = { bg: "bg-[#1F3A2E]/40", border: "border-[#B08D57]/30", text: "text-[#B08D57]", dot: "bg-[#B08D57]" };

function formatTime(str: string): string {
  return new Date(str.replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getStatusBadge(appt: StaffAppointment): { label: string; className: string } {
  if (appt.status === "Unverified") {
    return { label: "Unconfirmed", className: "bg-amber-900/50 text-amber-300 border border-amber-600/40" };
  }
  if (appt.status === "Open") {
    return { label: "Confirmed", className: "bg-emerald-900/50 text-emerald-300 border border-emerald-600/40" };
  }
  if (appt.customerDetails?.includes("[No-show]")) {
    return { label: "No-show", className: "bg-rose-900/50 text-rose-300 border border-rose-600/40" };
  }
  return { label: "Done", className: "bg-white/5 text-white/40 border border-white/10" };
}

interface Props {
  appointment: StaffAppointment;
  currentUserEmail: string;
  onTap: (appt: StaffAppointment) => void;
}

export function AppointmentCard({ appointment, currentUserEmail, onTap }: Props) {
  const agentEmail = appointment.assignedAgent ?? "";
  const colors = AGENT_COLORS[agentEmail] ?? DEFAULT_AGENT_COLOR;
  const isOwn = agentEmail === currentUserEmail;
  const badge = getStatusBadge(appointment);

  return (
    <button
      type="button"
      onClick={() => onTap(appointment)}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-all active:scale-[0.98]",
        colors.bg,
        isOwn ? cn(colors.border, "border-2 shadow-sm") : "border border-white/10"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs text-[#F1E9D6]/60 font-mono tabular-nums">
              {formatTime(appointment.scheduledTime)}
              {appointment.endTime ? ` – ${formatTime(appointment.endTime)}` : ""}
            </span>
            {appointment.needsRoom ? (
              <DoorOpen className="w-3 h-3 text-[#B08D57]/70 shrink-0" />
            ) : null}
          </div>
          <p className="text-sm font-medium text-[#F1E9D6] truncate leading-tight">
            {appointment.customerName}
          </p>
          {appointment.appointmentType ? (
            <p className="text-xs text-[#F1E9D6]/50 truncate mt-0.5">{appointment.appointmentType}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", badge.className)}>
            {badge.label}
          </span>
          <div className="flex items-center gap-1">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", colors.dot)} />
            <span className={cn("text-[10px] truncate max-w-[70px]", colors.text)}>
              {appointment.agentDisplayName ?? agentEmail.split("@")[0]}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
