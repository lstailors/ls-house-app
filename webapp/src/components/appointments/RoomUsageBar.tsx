import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StaffAppointment } from "../../../../backend/src/types";

interface Props {
  appointments: StaffAppointment[];
  currentHour: number;
}

function isActiveNow(appt: StaffAppointment, currentHour: number): boolean {
  const start = new Date(appt.scheduledTime.replace(" ", "T"));
  const startHour = start.getHours();
  const end = appt.endTime ? new Date(appt.endTime.replace(" ", "T")) : null;
  const endHour = end ? end.getHours() : startHour + 1;
  return startHour <= currentHour && currentHour < endHour;
}

export function RoomUsageBar({ appointments, currentHour }: Props) {
  const roomAppts = appointments.filter(
    (a) => a.needsRoom && (a.status === "Open" || a.status === "Unverified") && isActiveNow(a, currentHour)
  );

  const room1Taken = roomAppts.length >= 1;
  const room2Taken = roomAppts.length >= 2;
  const bothTaken = room1Taken && room2Taken;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#F1E9D6]/40 uppercase tracking-wider font-medium">Fitting Rooms</span>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors",
              room1Taken
                ? "bg-[#B08D57]/20 border-[#B08D57]/40 text-[#B08D57]"
                : "bg-white/5 border-white/10 text-white/30"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", room1Taken ? "bg-[#B08D57]" : "bg-white/20")} />
            Room 1
          </div>
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors",
              room2Taken
                ? "bg-[#B08D57]/20 border-[#B08D57]/40 text-[#B08D57]"
                : "bg-white/5 border-white/10 text-white/30"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", room2Taken ? "bg-[#B08D57]" : "bg-white/20")} />
            Room 2
          </div>
        </div>
      </div>
      {bothTaken ? (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-900/30 border border-amber-600/30">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300">Both fitting rooms in use</span>
        </div>
      ) : null}
    </div>
  );
}
