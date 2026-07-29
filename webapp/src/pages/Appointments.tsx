import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Ban, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@ls/design/utils";
import { Button } from "@ls/design/ui/button";
import { SectionHeader } from "@ls/design";
import { useMe } from "@ls/auth";
import { AgendaView } from "@/components/appointments/AgendaView";
import { WeekView } from "@/components/appointments/WeekView";
import { MonthView } from "@/components/appointments/MonthView";
import { RoomUsageBar } from "@/components/appointments/RoomUsageBar";
import { AppointmentDetailModal } from "@/components/appointments/AppointmentDetailModal";
import { BlockTimeModal } from "@/components/appointments/BlockTimeModal";
import { StaffBookingModal } from "@/components/appointments/StaffBookingModal";
import {
  useAppointmentsData,
  useLSHAgents,
  useLSHTypes,
  useBlockTime,
  useBookAppointment,
  useSetAppointmentStatus,
} from "@/hooks/useAppointments";
import type { StaffAppointment, BlockTimeRequest, StaffBookingRequest } from "@ls/types";

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getMondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export default function Appointments() {
  const { data: me } = useMe();
  const currentUserEmail = me?.email ?? "";
  const currentUserRole = me?.role ?? "";

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [view, setView] = useState<"today" | "week" | "month">("today");
  const [filter, setFilter] = useState<"my" | "all">("my");
  const [selectedAppointment, setSelectedAppointment] = useState<StaffAppointment | null>(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = toDateStr(selectedDate) === toDateStr(today);

  const weekStart = getMondayOf(selectedDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  // Month grid range: covers the full calendar grid including bleed days
  const monthFirst = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthLast  = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const gridStart  = new Date(monthFirst);
  gridStart.setDate(monthFirst.getDate() - monthFirst.getDay());
  const gridEnd    = new Date(monthLast);
  const daysUntilSat = 6 - monthLast.getDay();
  gridEnd.setDate(monthLast.getDate() + daysUntilSat);

  const dateFrom =
    view === "today" ? toDateStr(selectedDate) :
    view === "week"  ? toDateStr(weekStart) :
    toDateStr(gridStart);
  const dateTo =
    view === "today" ? toDateStr(selectedDate) :
    view === "week"  ? toDateStr(weekEnd) :
    toDateStr(gridEnd);

  const { data, isLoading } = useAppointmentsData(dateFrom, dateTo);
  const { data: agents = [] } = useLSHAgents();
  const { data: types = [] } = useLSHTypes();

  const blockMutation = useBlockTime();
  const bookMutation = useBookAppointment();
  const statusMutation = useSetAppointmentStatus();

  const appointments = data?.appointments ?? [];
  const blocks = data?.blocks ?? [];

  function prevPeriod() {
    const d = new Date(selectedDate);
    if (view === "today") {
      d.setDate(d.getDate() - 1);
    } else if (view === "week") {
      d.setDate(d.getDate() - 7);
    } else {
      d.setMonth(d.getMonth() - 1);
    }
    setSelectedDate(d);
  }

  function nextPeriod() {
    const d = new Date(selectedDate);
    if (view === "today") {
      d.setDate(d.getDate() + 1);
    } else if (view === "week") {
      d.setDate(d.getDate() + 7);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    setSelectedDate(d);
  }

  function goToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setSelectedDate(d);
  }

  const dateLabel =
    view === "month"
      ? selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : view === "week"
      ? weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " – " +
        weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : isToday
      ? "Today"
      : selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  async function handleStatusChange(name: string, status: "confirm" | "complete" | "no_show" | "cancel") {
    try {
      await statusMutation.mutateAsync({ name, status });
      setSelectedAppointment(null);
      toast.success("Status updated");
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleBlock(data: {
    start: string;
    end?: string;
    reason?: string;
    all_day?: boolean;
    whole_shop?: boolean;
  }) {
    try {
      await blockMutation.mutateAsync({
        start: data.start,
        end: data.end,
        reason: data.reason,
        all_day: data.all_day ?? false,
        whole_shop: data.whole_shop ?? false,
      });
      setBlockModalOpen(false);
      toast.success("Time blocked");
    } catch {
      toast.error("Failed to block time");
    }
  }

  async function handleBook(data: StaffBookingRequest) {
    try {
      await bookMutation.mutateAsync(data);
      setBookingModalOpen(false);
      toast.success("Appointment booked");
    } catch {
      toast.error("Failed to book appointment");
    }
  }

  return (
    <div className="min-h-dvh bg-[#163524] pb-20">
      <SectionHeader
        eyebrow="Schedule"
        title="Appointments"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-white/20 text-[#F1E9D6]/70 hover:bg-white/10 h-8 px-2.5 text-xs"
              onClick={() => setBlockModalOpen(true)}
            >
              <Ban className="w-3.5 h-3.5 mr-1" />
              Block
            </Button>
            <Button
              size="sm"
              className="bg-[#1F3A2E] hover:bg-[#2a4d3e] text-[#F1E9D6] border border-[#B08D57]/30 h-8 px-2.5 text-xs"
              onClick={() => setBookingModalOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              New
            </Button>
          </div>
        }
      />

      <div className="px-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prevPeriod}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-[#F1E9D6]/60" />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="text-sm text-[#F1E9D6] font-medium px-1 min-w-0 truncate max-w-[160px]"
            >
              {dateLabel}
            </button>
            <button
              type="button"
              onClick={nextPeriod}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-[#F1E9D6]/60" />
            </button>
          </div>

          <div className="flex items-center bg-white/5 rounded-lg border border-white/10 p-0.5">
            {(["today", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors capitalize",
                  view === v
                    ? "bg-[#B08D57]/20 text-[#B08D57] border border-[#B08D57]/30"
                    : "text-white/40 hover:text-white/70"
                )}
              >
                {v === "today" && <CalendarDays className="w-3 h-3" />}
                {v === "today" ? "Day" : v === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter("my")}
            className={cn(
              "px-3 py-1 rounded-full text-xs border transition-colors",
              filter === "my"
                ? "bg-[#1F3A2E] border-[#B08D57]/40 text-[#B08D57]"
                : "border-white/10 text-white/40 hover:text-white/70"
            )}
          >
            My Appointments
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "px-3 py-1 rounded-full text-xs border transition-colors",
              filter === "all"
                ? "bg-[#1F3A2E] border-[#B08D57]/40 text-[#B08D57]"
                : "border-white/10 text-white/40 hover:text-white/70"
            )}
          >
            All Staff
          </button>
        </div>

        {view === "today" && isToday ? (
          <div className="glass-panel rounded-xl p-3">
            <RoomUsageBar
              appointments={appointments}
              currentHour={new Date().getHours()}
            />
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-[#B08D57]/60 animate-spin" />
          </div>
        ) : view === "month" ? (
          <MonthView
            appointments={appointments}
            blocks={blocks}
            monthDate={selectedDate}
            currentUserEmail={currentUserEmail}
            filter={filter}
            onTapAppointment={setSelectedAppointment}
            onDrillDay={(date) => {
              setSelectedDate(date);
              setView("today");
            }}
          />
        ) : view === "today" ? (
          <AgendaView
            appointments={appointments}
            blocks={blocks}
            currentUserEmail={currentUserEmail}
            filter={filter}
            onTapAppointment={setSelectedAppointment}
          />
        ) : (
          <WeekView
            appointments={appointments}
            blocks={blocks}
            weekStart={weekStart}
            currentUserEmail={currentUserEmail}
            filter={filter}
            onTapAppointment={setSelectedAppointment}
          />
        )}
      </div>

      <AppointmentDetailModal
        appointment={selectedAppointment}
        currentUserEmail={currentUserEmail}
        currentUserRole={currentUserRole}
        onClose={() => setSelectedAppointment(null)}
        onStatusChange={handleStatusChange}
        isUpdating={statusMutation.isPending}
      />

      <BlockTimeModal
        open={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        onSubmit={handleBlock}
        isSubmitting={blockMutation.isPending}
        currentUserEmail={currentUserEmail}
        currentUserRole={currentUserRole}
        agents={agents}
      />

      <StaffBookingModal
        open={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        onSubmit={handleBook}
        isSubmitting={bookMutation.isPending}
        agents={agents}
        types={types}
        defaultDate={toDateStr(selectedDate)}
      />
    </div>
  );
}
