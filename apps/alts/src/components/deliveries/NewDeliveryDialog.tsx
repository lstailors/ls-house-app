import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Search, Plus, Loader2, User, Scissors, ShoppingBag, UserPlus, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@ls/design/ui/dialog";
import { Button } from "@ls/design/ui/button";
import { Input } from "@ls/design/ui/input";
import { Label } from "@ls/design/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ls/design/ui/select";
import { useCreateDelivery, useDeliverySearchContext, type DeliverySearchResult } from "@alts/lib/queries";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";

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
  saveAddressToCustomer: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_ICON = {
  customer: User,
  alteration: Scissors,
  order: ShoppingBag,
  new: UserPlus,
};
const TYPE_COLOR = {
  customer: "text-brass-light",
  alteration: "text-signal-amber",
  order: "text-signal-emerald",
  new: "text-signal-emerald",
};
const TYPE_LABEL = {
  customer: "Customer",
  alteration: "Alteration",
  order: "Sales Order",
  new: "New Customer",
};

export function NewDeliveryDialog({ open, onClose }: Props) {
  const nav = useNavigate();
  const createDelivery = useCreateDelivery();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DeliverySearchResult | null>(null);
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const { data: searchResults = [], isFetching } = useDeliverySearchContext(search);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      method: "Hand Delivery",
      originLocation: "NYC",
      saveAddressToCustomer: true,
    },
  });

  const saveAddress = watch("saveAddressToCustomer");

  const onSubmit = async (values: FormValues) => {
    const isNew = selected?.customer === "__new__";
    try {
      const created = await createDelivery.mutateAsync({
        customer: isNew ? undefined : (selected?.customer ?? values.customerId),
        customerId: isNew ? undefined : (selected?.customer ?? values.customerId),
        customer_name: isNew ? undefined : (selected?.customerName ?? values.customerId),
        newCustomerName: isNew ? selected?.customerName : undefined,
        newCustomerPhone: isNew ? (newCustomerPhone || null) : undefined,
        notifyPhone: isNew ? (newCustomerPhone || null) : (selected?.phone ?? null),
        method: values.method,
        locationId: values.originLocation,
        origin_location: values.originLocation,
        scheduledAt: values.scheduledAt || null,
        addressLine: values.addressLine || null,
        apt: values.addressApt || null,
        city: values.city || null,
        delivery_state: values.state || null,
        state: values.state || null,
        delivery_zip: values.zip || null,
        zip: values.zip || null,
        driverName: values.driverName || null,
        garmentSummary: values.garmentSummary || null,
        notes: values.notes || null,
        orderRef: selected?.orderRef ?? null,
        alteration_ticket: selected?.alterationTicket ?? null,
        // Always save typed address onto customer so next delivery pulls it
        saveAddressToCustomer: values.saveAddressToCustomer !== false,
      });
      const id = (created as any)?.id || (created as any)?.name || null;
      toast.success(id ? "Delivery created — print label?" : "Delivery created");
      if (id) {
        setCreatedId(String(id));
      } else {
        handleClose();
      }
    } catch (e) {
      toast.error((e as Error).message || "Could not create delivery");
    }
  };

  const handleClose = () => {
    reset({ method: "Hand Delivery", originLocation: "NYC", saveAddressToCustomer: true });
    setSearch("");
    setSelected(null);
    setNewCustomerPhone("");
    setCreatedId(null);
    onClose();
  };

  const openLabel = (auto = false) => {
    if (!createdId) return;
    const path = `/deliveries/${encodeURIComponent(createdId)}/label${auto ? "?auto=1" : ""}`;
    handleClose();
    nav(path);
  };

  const pickResult = async (r: DeliverySearchResult) => {
    setSelected(r);
    setValue("customerId", r.customer ?? r.id, { shouldValidate: true });
    if (r.garmentSummary) setValue("garmentSummary", r.garmentSummary);

    // Pull saved customer / SO address into the form
    let line = (r.address || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (line) setValue("addressLine", line);
    if (r.apt) setValue("addressApt", r.apt);
    if (r.city) setValue("city", r.city);
    if (r.state) setValue("state", r.state);
    if (r.zip) setValue("zip", r.zip);

    // Fallback: full customer profile when search hit has no address
    const custId = r.customer && r.customer !== "__new__" ? r.customer : null;
    if (custId && !line) {
      try {
        const d = await api.get<any>(`/api/customers/${encodeURIComponent(custId)}`);
        if (d?.address) {
          setValue("addressLine", String(d.address));
          if (d.addresses?.[0]?.line2) setValue("addressApt", d.addresses[0].line2);
          if (d.city) setValue("city", d.city);
          if (d.state) setValue("state", d.state);
          if (d.zipCode || d.zip) setValue("zip", d.zipCode || d.zip);
          if (d.phone) setSelected((prev) => (prev ? { ...prev, phone: d.phone, address: d.address } : prev));
        }
      } catch {
        /* leave blank for staff */
      }
    }

    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg bg-[#0e1a14]/95 backdrop-blur-xl border-[#c9a84c]/25 text-[#f5f0e8] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-[#f5f0e8]">
            {createdId ? "Delivery ready" : "New Delivery"}
          </DialogTitle>
          <DialogDescription className="text-[#a89070]">
            {createdId
              ? "Print the 4×6 label for the bag / driver."
              : "Search by customer name, alteration ticket, or sales order. Saved address fills in automatically."}
          </DialogDescription>
        </DialogHeader>

        {createdId ? (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-cream-muted">
              Delivery <span className="font-mono text-brass-light">{createdId}</span> is queued.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                onClick={() => openLabel(true)}
                className="h-12 bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print label
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const id = createdId;
                  handleClose();
                  if (id) nav(`/deliveries/${encodeURIComponent(id)}`);
                }}
                className="h-11 border-[#c9a84c]/20 bg-transparent text-[#a89070] hover:bg-[#c9a84c]/10 hover:text-[#f5f0e8]"
              >
                Open delivery
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                className="h-10 text-[#8a7560] hover:text-[#f5f0e8]"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-1">
            {/* Unified search */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">
                Customer / Order <span className="text-rose-400">*</span>
              </Label>
              {selected ? (
                <div className="flex items-center justify-between rounded-lg border border-[#c9a84c]/25 bg-[#162118]/60 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {(() => {
                      const Icon = TYPE_ICON[selected.type];
                      return <Icon className={cn("h-3.5 w-3.5 shrink-0", TYPE_COLOR[selected.type])} />;
                    })()}
                    <div className="min-w-0">
                      <div className="text-[#f5f0e8] text-sm font-medium truncate">{selected.label}</div>
                      <div className="text-[10px] text-[#8a7560] mt-0.5">
                        {TYPE_LABEL[selected.type]}
                        {selected.phone ? ` · ${selected.phone}` : ""}
                        {selected.address ? ` · ${selected.address}` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setValue("customerId", "");
                      setValue("addressLine", "");
                      setValue("addressApt", "");
                      setValue("city", "");
                      setValue("state", "");
                      setValue("zip", "");
                    }}
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
                      placeholder="Search customer, alteration ticket, sales order…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8 bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
                      autoComplete="off"
                      autoFocus
                    />
                    {isFetching ? (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8a7560] animate-spin" />
                    ) : null}
                  </div>
                  {search.length >= 2 && (
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-[#c9a84c]/20 bg-[#0e1a14] divide-y divide-[#c9a84c]/10">
                      {searchResults.length === 0 && !isFetching ? (
                        <button
                          type="button"
                          onClick={() => {
                            const newEntry: DeliverySearchResult = {
                              type: "new",
                              id: "__new__",
                              label: search,
                              customer: "__new__",
                              customerName: search,
                              phone: null,
                            };
                            setSelected(newEntry);
                            setValue("customerId", "__new__", { shouldValidate: true });
                            setSearch("");
                          }}
                          className="w-full text-left px-3 py-2.5 hover:bg-[#c9a84c]/10 transition-colors flex items-center gap-2.5"
                        >
                          <UserPlus className="h-3.5 w-3.5 shrink-0 text-signal-emerald" />
                          <span className="text-sm text-[#f5f0e8]">
                            + Create <span className="font-medium">"{search}"</span> as new customer
                          </span>
                        </button>
                      ) : (
                        searchResults.map((r) => {
                          const Icon = TYPE_ICON[r.type];
                          return (
                            <button
                              key={`${r.type}-${r.id}`}
                              type="button"
                              onClick={() => pickResult(r)}
                              className="w-full text-left px-3 py-2.5 hover:bg-[#c9a84c]/10 transition-colors flex items-start gap-2.5"
                            >
                              <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", TYPE_COLOR[r.type])} />
                              <div className="min-w-0">
                                <div className="text-sm text-[#f5f0e8] font-medium truncate">{r.label}</div>
                                <div className="text-[10px] text-[#8a7560] mt-0.5">
                                  <span className={cn("font-semibold mr-1", TYPE_COLOR[r.type])}>
                                    {TYPE_LABEL[r.type]}
                                  </span>
                                  {r.sublabel}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
              {selected?.customer === "__new__" && (
                <div className="space-y-1.5 mt-2">
                  <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Phone (optional)</Label>
                  <Input
                    placeholder="+1 (555) 000-0000"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
                  />
                </div>
              )}
              {errors.customerId && <p className="text-xs text-rose-400">{errors.customerId.message}</p>}
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
                      <SelectItem key={m} value={m} className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">
                        {m}
                      </SelectItem>
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
                    <SelectItem value="NYC" className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">
                      NYC
                    </SelectItem>
                    <SelectItem value="HOU" className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">
                      HOU
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Scheduled Date</Label>
              <Input
                type="date"
                {...register("scheduledAt")}
                className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] focus:border-[#c9a84c]/50"
              />
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Street Address</Label>
              <Input
                placeholder="123 Main St"
                {...register("addressLine")}
                className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Apt</Label>
                <Input
                  placeholder="4B"
                  {...register("addressApt")}
                  className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">City</Label>
                <Input
                  placeholder="New York"
                  {...register("city")}
                  className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">State / Zip</Label>
                <div className="flex gap-1">
                  <Input
                    placeholder="NY"
                    {...register("state")}
                    className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50 w-14"
                  />
                  <Input
                    placeholder="10001"
                    {...register("zip")}
                    className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-[#c9a84c]/15 bg-black/20 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 accent-[#c9a84c]"
                checked={!!saveAddress}
                onChange={(e) => setValue("saveAddressToCustomer", e.target.checked)}
              />
              <span className="text-[12px] text-cream-muted leading-snug">
                <span className="text-cream font-medium">Save address on customer</span>
                <span className="block text-[#8a7560] mt-0.5">
                  Next delivery for this client auto-fills from ERP.
                </span>
              </span>
            </label>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Driver Name (optional)</Label>
              <Input
                placeholder="Driver name"
                {...register("driverName")}
                className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Garment Summary (optional)</Label>
              <textarea
                placeholder="2-piece navy suit, white dress shirt…"
                {...register("garmentSummary")}
                rows={2}
                className={cn(
                  "w-full rounded-md border border-[#c9a84c]/20 bg-[#162118]/60 px-3 py-2 text-sm text-[#f5f0e8]",
                  "placeholder:text-[#8a7560] focus:outline-none focus:border-[#c9a84c]/50 resize-none",
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Notes (optional)</Label>
              <textarea
                placeholder="Any special instructions…"
                {...register("notes")}
                rows={2}
                className={cn(
                  "w-full rounded-md border border-[#c9a84c]/20 bg-[#162118]/60 px-3 py-2 text-sm text-[#f5f0e8]",
                  "placeholder:text-[#8a7560] focus:outline-none focus:border-[#c9a84c]/50 resize-none",
                )}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="flex-1 border-[#c9a84c]/20 bg-transparent text-[#a89070] hover:bg-[#c9a84c]/10 hover:text-[#f5f0e8] h-11"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createDelivery.isPending}
                className="flex-1 bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-11"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {createDelivery.isPending ? "Creating…" : "Create Delivery"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
