import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Search, Plus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateDelivery, useCustomerSearch } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Customer } from "@/lib/types";

const schema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  method: z.string().default("Hand Delivery"),
  originLocation: z.string().default("NYC"),
  scheduledAt: z.string().optional(),
  addressLine: z.string().optional(),
  addressApt: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  driverName: z.string().optional(),
  garmentSummary: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewDeliveryDialog({ open, onClose }: Props) {
  const createDelivery = useCreateDelivery();
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const { data: searchResults = [], isFetching } = useCustomerSearch(customerSearch);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { method: "Hand Delivery", originLocation: "NYC" },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await createDelivery.mutateAsync({
        customer_id: values.customerId,
        method: values.method,
        origin_location: values.originLocation,
        scheduled_at: values.scheduledAt || null,
        delivery_address: values.addressLine || null,
        delivery_apt: values.addressApt || null,
        delivery_city: values.city || null,
        delivery_state: values.state || null,
        delivery_zip: values.zip || null,
        driver_name: values.driverName || null,
        garment_summary: values.garmentSummary || null,
        delivery_notes: values.notes || null,
      });
      toast.success("Delivery created");
      handleClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not create delivery");
    }
  };

  const handleClose = () => {
    reset();
    setCustomerSearch("");
    setSelectedCustomer(null);
    onClose();
  };

  const pickCustomer = (c: Customer) => {
    setSelectedCustomer(c);
    setValue("customerId", c.id, { shouldValidate: true });
    setCustomerSearch("");
    // Pre-fill address from customer if available
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg bg-[#0e1a14]/95 backdrop-blur-xl border-[#c9a84c]/25 text-[#f5f0e8] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-[#f5f0e8]">New Delivery</DialogTitle>
          <DialogDescription className="text-[#a89070]">
            Schedule a garment delivery for a customer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-1">

          {/* Customer search */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">
              Customer <span className="text-rose-400">*</span>
            </Label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-lg border border-[#c9a84c]/25 bg-[#162118]/60 px-3 py-2">
                <div>
                  <div className="text-[#f5f0e8] text-sm font-medium">{selectedCustomer.name}</div>
                  {selectedCustomer.phone ? (
                    <div className="text-[10px] text-[#8a7560] mt-0.5">{selectedCustomer.phone}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedCustomer(null); setValue("customerId", ""); }}
                  className="text-[#8a7560] hover:text-[#f5f0e8] text-xs ml-3 shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8a7560]" />
                  <Input
                    placeholder="Type name, phone, or email…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-8 bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
                    autoComplete="off"
                  />
                  {isFetching ? (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8a7560] animate-spin" />
                  ) : null}
                </div>
                {customerSearch.length >= 2 && (
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-[#c9a84c]/20 bg-[#0e1a14] divide-y divide-[#c9a84c]/10">
                    {searchResults.length === 0 && !isFetching ? (
                      <div className="px-3 py-2 text-xs text-[#8a7560]">No customers found</div>
                    ) : (
                      searchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickCustomer(c)}
                          className="w-full text-left px-3 py-2.5 hover:bg-[#c9a84c]/10 transition-colors"
                        >
                          <div className="text-sm text-[#f5f0e8] font-medium">{c.name}</div>
                          <div className="text-[10px] text-[#8a7560] mt-0.5">
                            {[c.phone, c.email].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            {errors.customerId && (
              <p className="text-xs text-rose-400">{errors.customerId.message}</p>
            )}
          </div>

          {/* Method + Origin */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Method</Label>
              <Select defaultValue="Hand Delivery" onValueChange={(v) => setValue("method", v)}>
                <SelectTrigger className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0e1a14] border-[#c9a84c]/25 text-[#f5f0e8]">
                  {["Hand Delivery", "Courier", "Ship Direct", "In-Store Pickup", "Uber Messenger"].map((m) => (
                    <SelectItem key={m} value={m} className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Origin</Label>
              <Select defaultValue="NYC" onValueChange={(v) => setValue("originLocation", v)}>
                <SelectTrigger className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0e1a14] border-[#c9a84c]/25 text-[#f5f0e8]">
                  <SelectItem value="NYC" className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">NYC</SelectItem>
                  <SelectItem value="HOU" className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">HOU</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Scheduled date */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Scheduled Date</Label>
            <Input type="date" {...register("scheduledAt")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] focus:border-[#c9a84c]/50" />
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Street Address</Label>
            <Input placeholder="123 Main St" {...register("addressLine")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Apt</Label>
              <Input placeholder="4B" {...register("addressApt")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">City</Label>
              <Input placeholder="New York" {...register("city")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">State / Zip</Label>
              <div className="flex gap-1">
                <Input placeholder="NY" {...register("state")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50 w-14" />
                <Input placeholder="10001" {...register("zip")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
              </div>
            </div>
          </div>

          {/* Driver */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Driver Name (optional)</Label>
            <Input placeholder="Driver name" {...register("driverName")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
          </div>

          {/* Garments */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Garment Summary (optional)</Label>
            <textarea
              placeholder="2-piece navy suit, white dress shirt…"
              {...register("garmentSummary")}
              rows={2}
              className={cn("w-full rounded-md border border-[#c9a84c]/20 bg-[#162118]/60 px-3 py-2 text-sm text-[#f5f0e8]", "placeholder:text-[#8a7560] focus:outline-none focus:border-[#c9a84c]/50 resize-none")}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Notes (optional)</Label>
            <textarea
              placeholder="Any special instructions…"
              {...register("notes")}
              rows={2}
              className={cn("w-full rounded-md border border-[#c9a84c]/20 bg-[#162118]/60 px-3 py-2 text-sm text-[#f5f0e8]", "placeholder:text-[#8a7560] focus:outline-none focus:border-[#c9a84c]/50 resize-none")}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} className="flex-1 border-[#c9a84c]/20 bg-transparent text-[#a89070] hover:bg-[#c9a84c]/10 hover:text-[#f5f0e8] h-11">
              Cancel
            </Button>
            <Button type="submit" disabled={createDelivery.isPending} className="flex-1 bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-11">
              <Plus className="h-4 w-4 mr-1.5" />
              {createDelivery.isPending ? "Creating…" : "Create Delivery"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
