import { CalendarX } from "lucide-react";
import { AppointmentCard } from "./AppointmentCard";
import { BlockCard } from "./BlockCard";
import type { StaffAppointment, TimeBlock } from "../../../../backend/src/types";

interface Props {
  appointments: StaffAppointment[];
  blocks: TimeBlock[];
  currentUserEmail: string;
  filter: "my" | "all";
  onTapAppointment: (appt: StaffAppointment) => void;
}

type TimeOfDay = "Morning" | "Afternoon" | "Evening";

function getTimeOfDay(dateStr: string): TimeOfDay {
  const hour = new Date(dateStr.replace(" ", "T")).getHours();
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

function sortByTime(items: StaffAppointment[]): StaffAppointment[] {
  return [...items].sort(
    (a, b) => new Date(a.scheduledTime.replace(" ", "T")).getTime() - new Date(b.scheduledTime.replace(" ", "T")).getTime()
  );
}

function groupByTimeOfDay(items: StaffAppointment[]): Record<TimeOfDay, StaffAppointment[]> {
  const groups: Record<TimeOfDay, StaffAppointment[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const item of items) {
    groups[getTimeOfDay(item.scheduledTime)].push(item);
  }
  return groups;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <CalendarX className="w-6 h-6 text-white/20" />
      <p className="text-xs text-[#F1E9D6]/30">{message}</p>
    </div>
  );
}

interface SectionProps {
  title: string;
  appointments: StaffAppointment[];
  blocks: TimeBlock[];
  currentUserEmail: string;
  onTapAppointment: (appt: StaffAppointment) => void;
  showBlocks?: boolean;
  emptyMessage: string;
}

function AgendaSection({ title, appointments, blocks, currentUserEmail, onTapAppointment, showBlocks, emptyMessage }: SectionProps) {
  const sorted = sortByTime(appointments);
  const grouped = groupByTimeOfDay(sorted);
  const timeSlots: TimeOfDay[] = ["Morning", "Afternoon", "Evening"];
  const hasContent = sorted.length > 0 || (showBlocks && blocks.length > 0);

  return (
    <div className="mb-6">
      <h3 className="text-xs uppercase tracking-widest text-[#B08D57] font-medium mb-3 px-1">{title}</h3>
      {hasContent ? (
        <div className="space-y-4">
          {timeSlots.map((slot) => {
            const slotAppts = grouped[slot];
            const slotBlocks = showBlocks && slot === "Morning"
              ? blocks.filter((b) => {
                  if (b.allDay) return true;
                  const h = new Date(b.startsOn.replace(" ", "T")).getHours();
                  return h < 12;
                })
              : showBlocks && slot === "Afternoon"
              ? blocks.filter((b) => {
                  if (b.allDay) return false;
                  const h = new Date(b.startsOn.replace(" ", "T")).getHours();
                  return h >= 12 && h < 17;
                })
              : showBlocks && slot === "Evening"
              ? blocks.filter((b) => {
                  if (b.allDay) return false;
                  const h = new Date(b.startsOn.replace(" ", "T")).getHours();
                  return h >= 17;
                })
              : [];

            if (slotAppts.length === 0 && (!showBlocks || slotBlocks.length === 0)) return null;

            return (
              <div key={slot}>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5 px-1">{slot}</p>
                <div className="space-y-2">
                  {slotAppts.map((appt) => (
                    <AppointmentCard
                      key={appt.name}
                      appointment={appt}
                      currentUserEmail={currentUserEmail}
                      onTap={onTapAppointment}
                    />
                  ))}
                  {slotBlocks.map((block) => (
                    <BlockCard key={block.name} block={block} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </div>
  );
}

export function AgendaView({ appointments, blocks, currentUserEmail, filter, onTapAppointment }: Props) {
  const myAppts = appointments.filter((a) => a.assignedAgent === currentUserEmail);
  const otherAppts = appointments.filter((a) => a.assignedAgent !== currentUserEmail);

  return (
    <div className="space-y-2">
      <AgendaSection
        title="My Day"
        appointments={myAppts}
        blocks={[]}
        currentUserEmail={currentUserEmail}
        onTapAppointment={onTapAppointment}
        showBlocks={false}
        emptyMessage="No appointments for you today"
      />
      {filter === "all" ? (
        <AgendaSection
          title="Shop"
          appointments={otherAppts}
          blocks={blocks}
          currentUserEmail={currentUserEmail}
          onTapAppointment={onTapAppointment}
          showBlocks={true}
          emptyMessage="No other appointments today"
        />
      ) : null}
    </div>
  );
}
