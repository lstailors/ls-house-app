import { Copy, DoorOpen, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@ls/design/utils";
import { Button } from "@ls/design/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";
import type { StaffAppointment } from "@ls/types";

const AGENT_COLORS: Record<string, { dot: string; text: string }> = {
  "carl@lstailors.com": { dot: "bg-emerald-400", text: "text-emerald-300" },
  "sal@lstailors.com": { dot: "bg-amber-400", text: "text-amber-300" },
  "kelvin@lstailors.com": { dot: "bg-blue-400", text: "text-blue-300" },
  "chris@ckcny.com": { dot: "bg-rose-400", text: "text-rose-300" },
};
const DEFAULT_AGENT_COLOR = { dot: "bg-[#B08D57]", text: "text-[#B08D57]" };

function formatTime(str: string): string {
  return new Date(str.replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getStatusInfo(appt: StaffAppointment): { label: string; className: string } {
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
  appointment: StaffAppointment | null;
  currentUserEmail: string;
  currentUserRole: string;
  onClose: () => void;
  onStatusChange: (name: string, status: "confirm" | "complete" | "no_show" | "cancel") => void;
  isUpdating: boolean;
}

export function AppointmentDetailModal({ appointment, currentUserEmail, currentUserRole, onClose, onStatusChange, isUpdating }: Props) {
  const isOpen = appointment !== null;

  if (!appointment) {
    return (
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent />
      </Dialog>
    );
  }

  const agentEmail = appointment.assignedAgent ?? "";
  const agentColors = AGENT_COLORS[agentEmail] ?? DEFAULT_AGENT_COLOR;
  const statusInfo = getStatusInfo(appointment);
  const isAdmin = currentUserRole === "super_admin" || currentUserRole === "store_manager";
  const isOwner = agentEmail === currentUserEmail;
  const canCancel = isOwner || isAdmin;

  function copyEmail() {
    navigator.clipboard.writeText(appointment!.customerEmail);
    toast.success("Email copied");
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#0D1A10] border border-white/10 text-[#F1E9D6] max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="font-['Cormorant_Garamond'] text-2xl italic text-[#F1E9D6] font-normal leading-tight">
            {appointment.customerName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusInfo.className)}>
              {statusInfo.label}
            </span>
            {appointment.needsRoom ? (
              <div className="flex items-center gap-1 text-xs text-[#B08D57]/70">
                <DoorOpen className="w-3.5 h-3.5" />
                <span>Fitting room</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Email</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-[#F1E9D6] truncate flex-1">{appointment.customerEmail}</p>
                <button
                  type="button"
                  onClick={copyEmail}
                  className="p-1 rounded hover:bg-white/10 transition-colors shrink-0"
                >
                  <Copy className="w-3.5 h-3.5 text-white/40" />
                </button>
              </div>
            </div>

            {appointment.customerPhone ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Phone</p>
                <p className="text-sm text-[#F1E9D6]">{appointment.customerPhone}</p>
              </div>
            ) : null}

            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Time</p>
              <p className="text-sm text-[#F1E9D6]">
                {formatTime(appointment.scheduledTime)}
                {appointment.endTime ? ` – ${formatTime(appointment.endTime)}` : ""}
              </p>
            </div>

            {appointment.appointmentType ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Type</p>
                <p className="text-sm text-[#F1E9D6]">{appointment.appointmentType}</p>
              </div>
            ) : null}

            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Agent</p>
              <div className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full shrink-0", agentColors.dot)} />
                <p className={cn("text-sm", agentColors.text)}>
                  {appointment.agentDisplayName ?? agentEmail ?? "Unassigned"}
                </p>
              </div>
            </div>
          </div>

          {appointment.customerDetails ? (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Notes</p>
              <p className="text-sm text-[#F1E9D6]/70 leading-relaxed">{appointment.customerDetails}</p>
            </div>
          ) : null}

          {appointment.status === "Unverified" ? (
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white border-0"
                onClick={() => onStatusChange(appointment.name, "confirm")}
                disabled={isUpdating}
              >
                Confirm
              </Button>
            </div>
          ) : appointment.status === "Open" ? (
            <div className="flex gap-2 flex-wrap">
              <Button
                className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white border-0 min-w-[80px]"
                onClick={() => onStatusChange(appointment.name, "complete")}
                disabled={isUpdating}
              >
                Complete
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-white/20 text-[#F1E9D6] hover:bg-white/10 min-w-[80px]"
                onClick={() => onStatusChange(appointment.name, "no_show")}
                disabled={isUpdating}
              >
                No-show
              </Button>
              {canCancel ? (
                <Button
                  variant="outline"
                  className="flex-1 border-rose-700/50 text-rose-400 hover:bg-rose-900/30 min-w-[80px]"
                  onClick={() => onStatusChange(appointment.name, "cancel")}
                  disabled={isUpdating}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="text-center py-2">
              <p className="text-sm text-white/30">Appointment closed</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
