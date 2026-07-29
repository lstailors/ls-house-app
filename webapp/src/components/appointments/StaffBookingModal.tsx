import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@ls/design/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";
import { Input } from "@ls/design/ui/input";
import { Label } from "@ls/design/ui/label";
import { Textarea } from "@ls/design/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ls/design/ui/select";
import type { StaffBookingRequest, LSHAgent, LSHAppointmentType } from "@ls/types";

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

  useEffect(() => {
    if (scheduledTime) {
      setValue("end_time", addMinutes(scheduledTime, 30));
    }
  }, [scheduledTime, setValue]);

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
