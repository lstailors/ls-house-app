import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@ls/design/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";
import { Input } from "@ls/design/ui/input";
import { Label } from "@ls/design/ui/label";
import { Textarea } from "@ls/design/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ls/design/ui/select";
import { cn } from "@ls/design/utils";
import type { StaffBookingRequest, LSHAgent, LSHAppointmentType } from "@ls/types";
import { storeDayAvailability, minToHhmm, weekdayNy } from "@/lib/booking/store-hours";
import {
  PUBLIC_APPOINTMENT_TYPES,
  BOOKABLE_CLAMP_WEEKDAY,
} from "@/lib/booking/config";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: StaffBookingRequest) => void;
  isSubmitting: boolean;
  agents: LSHAgent[];
  types: LSHAppointmentType[];
  defaultDate?: string;
}

type FormValues = {
  agent_user: string;
  appointment_type: string;
  scheduled_time: string;
  end_time: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  notes: string;
};

function formatToErpDateTime(datetimeLocal: string): string {
  return datetimeLocal.replace("T", " ") + ":00";
}

function addMinutes(datetimeLocal: string, minutes: number): string {
  const d = new Date(datetimeLocal);
  d.setMinutes(d.getMinutes() + minutes);
  const iso = d.toISOString();
  return iso.slice(0, 16);
}

function defaultScheduledTime(defaultDate?: string): string {
  const date = defaultDate ?? new Date().toISOString().split("T")[0];
  return `${date}T09:00`;
}

/** Extract YYYY-MM-DD from datetime-local string */
function ymdFromDtl(dtl: string): string {
  return dtl.split("T")[0] ?? dtl;
}

/** Extract HH:MM from datetime-local string */
function hhmmFromDtl(dtl: string): string {
  return dtl.split("T")[1]?.slice(0, 5) ?? "00:00";
}

function hhmmToMin(hhmm: string): number {
  const parts = hhmm.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

// ─── StoreHoursHint ──────────────────────────────────────────────────────────

type HintVariant = "ok" | "warn" | "error";

interface HintProps {
  scheduledTime: string; // datetime-local "YYYY-MM-DDTHH:MM"
  endTime: string;       // datetime-local "YYYY-MM-DDTHH:MM"
  appointmentType: string;
}

function StoreHoursHint({ scheduledTime, endTime, appointmentType }: HintProps) {
  const ymd = ymdFromDtl(scheduledTime);
  const startHhmm = hhmmFromDtl(scheduledTime);
  const endHhmm = hhmmFromDtl(endTime);
  const startMin = hhmmToMin(startHhmm);
  const endMin = hhmmToMin(endHhmm);

  const avail = useMemo(() => {
    if (!ymd || ymd.length < 10) return null;
    try {
      return storeDayAvailability(ymd);
    } catch {
      return null;
    }
  }, [ymd]);

  const typeInfo = useMemo(() => {
    if (!appointmentType) return null;
    return PUBLIC_APPOINTMENT_TYPES.find(
      (t) => t.id === appointmentType || t.erpName === appointmentType || t.label === appointmentType,
    );
  }, [appointmentType]);

  const durationHint = typeInfo
    ? `${typeInfo.durationMinutes} min · ${typeInfo.label}`
    : null;

  // Compute per-day hours clamp (Saturday ends at 15:00 in regular season)
  const clamp = useMemo(() => {
    if (!ymd || ymd.length < 10) return BOOKABLE_CLAMP_WEEKDAY;
    try {
      const wd = weekdayNy(ymd);
      const avail2 = storeDayAvailability(ymd);
      if (avail2.open) {
        // Saturday regular: endMin 15:00
        const range = avail2.ranges[0];
        if (range) return { fromMin: range.startMin, toMin: range.endMin };
      }
    } catch {
      /* fall through */
    }
    return BOOKABLE_CLAMP_WEEKDAY;
  }, [ymd]);

  if (!avail) return null;

  // --- Closed day cases ---
  if (!avail.open) {
    let icon = "⛔";
    let msg = "";
    let detail = "";

    if (avail.reason === "august_vacation") {
      icon = "🏖️";
      msg = "Store closed — August vacation";
      detail = "L&S is closed Aug 1–14 every year.";
    } else if (avail.reason === "holiday") {
      icon = "🎉";
      msg = "Store closed — US holiday";
      detail = "The shop observes this federal holiday.";
    } else {
      const wd = (() => {
        try { return weekdayNy(ymd); } catch { return -1; }
      })();
      const season = (() => {
        try {
          const probe = storeDayAvailability(
            // check a nearby Tuesday to get the season
            ymd.replace(/-\d{2}$/, "-15"),
          );
          if (probe.open) return probe.season;
        } catch { /* */ }
        return "regular";
      })();
      const seasonLabel = season === "summer" ? "summer (Mon–Fri)" : "regular season (Tue–Sat)";
      icon = "🔒";
      msg = "Store closed this day";
      detail = `During the ${seasonLabel} L&S is closed on this weekday.`;
    }

    return (
      <div className="rounded-[10px] border border-rose-500/30 bg-rose-950/30 px-3 py-2.5 flex gap-2.5 items-start">
        <span className="shrink-0 text-[15px] leading-tight mt-0.5">{icon}</span>
        <div>
          <p className="text-[12px] font-semibold text-rose-300 leading-snug">{msg}</p>
          <p className="text-[11px] text-rose-400/80 leading-snug mt-0.5">{detail}</p>
        </div>
      </div>
    );
  }

  // --- Open day ---
  const rangeLabel = avail.ranges
    .map((r) => `${minToHhmm(r.startMin)}–${minToHhmm(r.endMin)}`)
    .join(", ");
  const seasonTag = avail.season === "summer" ? "Summer (Mon–Fri)" : "Regular season (Tue–Sat)";

  // Check if start or end is outside clamp
  const startOutside = startMin < clamp.fromMin || startMin >= clamp.toMin;
  const endOutside = endMin > clamp.toMin;
  const startNote = startOutside
    ? `Start ${startHhmm} is outside today's ${minToHhmm(clamp.fromMin)}–${minToHhmm(clamp.toMin)} window.`
    : null;
  const endNote = endOutside
    ? `End ${endHhmm} exceeds close time ${minToHhmm(clamp.toMin)}.`
    : null;
  const hasWarning = !!(startNote || endNote);

  return (
    <div
      className={cn(
        "rounded-[10px] border px-3 py-2.5 flex flex-col gap-1.5",
        hasWarning
          ? "border-amber-500/30 bg-amber-950/25"
          : "border-emerald-500/20 bg-emerald-950/20",
      )}
    >
      {/* Top row — open status + season */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full shrink-0",
            hasWarning ? "bg-amber-400" : "bg-emerald-400",
          )}
        />
        <span
          className={cn(
            "text-[11.5px] font-semibold",
            hasWarning ? "text-amber-300" : "text-emerald-300",
          )}
        >
          {hasWarning ? "Outside store hours" : "Store open"}
        </span>
        <span className="text-[10.5px] text-white/35 ml-auto">{seasonTag}</span>
      </div>

      {/* Hours row */}
      <div className="text-[11px] text-white/55 flex items-center gap-1.5">
        <span>🕐</span>
        <span>Today: {rangeLabel}</span>
        {durationHint && (
          <>
            <span className="text-white/25">·</span>
            <span className="text-white/45">{durationHint}</span>
          </>
        )}
      </div>

      {/* Warning messages */}
      {startNote && (
        <p className="text-[11px] text-amber-300/90 leading-snug">
          ⚠ {startNote}
        </p>
      )}
      {endNote && (
        <p className="text-[11px] text-amber-300/90 leading-snug">
          ⚠ {endNote}
        </p>
      )}

      {/* Alterations gate note */}
      {typeInfo?.requiresEligibilityGate && (
        <p className="text-[10.5px] text-amber-200/70 leading-snug mt-0.5 border-t border-amber-500/15 pt-1.5">
          🔑 Alterations — custom client or Casa L&S member required.
        </p>
      )}
    </div>
  );
}

// ─── Main Modal ─────────────────────────────────────────────────────────────

export function StaffBookingModal({ open, onClose, onSubmit, isSubmitting, agents, types, defaultDate }: Props) {
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      agent_user: "",
      appointment_type: "",
      scheduled_time: defaultScheduledTime(defaultDate),
      end_time: addMinutes(defaultScheduledTime(defaultDate), 30),
      customer_name: "",
      customer_email: "",
      customer_phone: "",
      notes: "",
    },
  });

  const scheduledTime = watch("scheduled_time");
  const endTime = watch("end_time");
  const appointmentType = watch("appointment_type");

  useEffect(() => {
    if (scheduledTime) {
      setValue("end_time", addMinutes(scheduledTime, 30));
    }
  }, [scheduledTime, setValue]);

  // Auto-set end time based on appointment type duration
  useEffect(() => {
    if (scheduledTime && appointmentType) {
      const typeInfo = PUBLIC_APPOINTMENT_TYPES.find(
        (t) => t.id === appointmentType || t.erpName === appointmentType || t.label === appointmentType,
      );
      if (typeInfo) {
        setValue("end_time", addMinutes(scheduledTime, typeInfo.durationMinutes));
      }
    }
  }, [appointmentType, scheduledTime, setValue]);

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onClose();
      reset({
        agent_user: "",
        appointment_type: "",
        scheduled_time: defaultScheduledTime(defaultDate),
        end_time: addMinutes(defaultScheduledTime(defaultDate), 30),
        customer_name: "",
        customer_email: "",
        customer_phone: "",
        notes: "",
      });
    }
  }

  function onFormSubmit(values: FormValues) {
    const data: StaffBookingRequest = {
      agent_user: values.agent_user,
      appointment_type: values.appointment_type,
      scheduled_time: formatToErpDateTime(values.scheduled_time),
      end_time: values.end_time ? formatToErpDateTime(values.end_time) : undefined,
      customer_name: values.customer_name,
      customer_email: values.customer_email,
      customer_phone: values.customer_phone || undefined,
      notes: values.notes || undefined,
    };
    onSubmit(data);
  }

  const activeAgents = agents.filter((a) => a.active);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#163524] border border-white/10 text-[#F1E9D6] max-w-sm mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-['Cormorant_Garamond'] text-xl italic text-[#F1E9D6] font-normal">
            New Appointment
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">

          {/* ── Store Hours Availability Hint ── */}
          {scheduledTime && (
            <StoreHoursHint
              scheduledTime={scheduledTime}
              endTime={endTime ?? scheduledTime}
              appointmentType={appointmentType}
            />
          )}

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Agent</Label>
            <Select
              onValueChange={(v) => setValue("agent_user", v)}
              defaultValue=""
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-[#F1E9D6]">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent className="bg-[#163524] border-white/10">
                {activeAgents.map((agent) => (
                  <SelectItem key={agent.agentUser} value={agent.agentUser} className="text-[#F1E9D6] focus:bg-white/10">
                    {agent.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Appointment Type</Label>
            <Select
              onValueChange={(v) => setValue("appointment_type", v)}
              defaultValue=""
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-[#F1E9D6]">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent className="bg-[#163524] border-white/10">
                {types.map((t) => (
                  <SelectItem key={t.name} value={t.appointmentType} className="text-[#F1E9D6] focus:bg-white/10">
                    {t.appointmentType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Start</Label>
              <Input
                type="datetime-local"
                {...register("scheduled_time", { required: true })}
                className="bg-white/5 border-white/10 text-[#F1E9D6] focus:border-[#B08D57]/50 text-xs"
              />
              {errors.scheduled_time ? (
                <p className="text-rose-400 text-[10px] mt-0.5">Required</p>
              ) : null}
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">End (opt.)</Label>
              <Input
                type="datetime-local"
                {...register("end_time")}
                className="bg-white/5 border-white/10 text-[#F1E9D6] focus:border-[#B08D57]/50 text-xs"
              />
            </div>
          </div>

          <div className="h-px bg-white/5" />

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Customer Name</Label>
            <Input
              {...register("customer_name", { required: true })}
              placeholder="Full name"
              className="bg-white/5 border-white/10 text-[#F1E9D6] placeholder:text-white/20 focus:border-[#B08D57]/50"
            />
            {errors.customer_name ? (
              <p className="text-rose-400 text-[10px] mt-0.5">Required</p>
            ) : null}
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Customer Email</Label>
            <Input
              type="email"
              {...register("customer_email", { required: true })}
              placeholder="email@example.com"
              className="bg-white/5 border-white/10 text-[#F1E9D6] placeholder:text-white/20 focus:border-[#B08D57]/50"
            />
            {errors.customer_email ? (
              <p className="text-rose-400 text-[10px] mt-0.5">Valid email required</p>
            ) : null}
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Phone (optional)</Label>
            <Input
              type="tel"
              {...register("customer_phone")}
              placeholder="+1 (555) 000-0000"
              className="bg-white/5 border-white/10 text-[#F1E9D6] placeholder:text-white/20 focus:border-[#B08D57]/50"
            />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Notes (optional)</Label>
            <Textarea
              {...register("notes")}
              placeholder="Any additional notes…"
              rows={3}
              className="bg-white/5 border-white/10 text-[#F1E9D6] placeholder:text-white/20 focus:border-[#B08D57]/50 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 border-white/20 text-[#F1E9D6] hover:bg-white/10"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[#1F3A2E] hover:bg-[#2a4d3e] text-[#F1E9D6] border border-[#B08D57]/30"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Booking…" : "Book"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
