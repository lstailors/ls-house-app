import { useState } from "react";
import { Scissors, Plus, Trash2, Calendar as CalendarIcon, Hammer, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { CustomerField, type CustomerDraft } from "@/components/pos/CustomerField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateAlteration, useCustomers, useTailors } from "@/lib/queries";
import { useActiveLocation } from "@/lib/locationContext";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRESET_ITEMS = [
  { label: "Hem trousers", price: 60 },
  { label: "Shorten sleeves", price: 100 },
  { label: "Take in waist", price: 80 },
  { label: "Press 2 garments", price: 60 },
  { label: "Replace zipper", price: 90 },
  { label: "Reline jacket", price: 280 },
  { label: "Adjust shoulders", price: 280 },
  { label: "Taper trousers", price: 120 },
];

interface LineItem { label: string; price: number }

export default function IntakeAlterations() {
  const { activeLocationId } = useActiveLocation();
  const { data: customers = [] } = useCustomers();
  const { data: tailors = [] } = useTailors();
  const createAlteration = useCreateAlteration();

  const [customer, setCustomer] = useState<CustomerDraft>({ name: "", phone: "", email: "" });
  const [items, setItems] = useState<LineItem[]>([]);
  const [tailorId, setTailorId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [notes, setNotes] = useState("");

  const scopedTailors = tailors.filter(
    (t) => !activeLocationId || t.locationId === activeLocationId,
  );

  const total = items.reduce((s, i) => s + i.price, 0);
  const valid = customer.name.length >= 2 && customer.phone.length >= 7 && items.length > 0;

  const addPreset = (p: LineItem) => setItems([...items, p]);
  const addBlank = () => setItems([...items, { label: "", price: 0 }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, partial: Partial<LineItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...partial } : it)));

  const submit = async () => {
    if (!valid) {
      toast.error("Customer and at least one item required.");
      return;
    }
    try {
      await createAlteration.mutateAsync({
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email || undefined,
        items: items.map((i) => ({ label: i.label, price: i.price })),
        price: total,
        tailorId: tailorId || null,
        dueDate: dueDate || null,
        notes: notes || null,
      });
      toast.success("Alteration ticket created");
      setCustomer({ name: "", phone: "", email: "" });
      setItems([]);
      setTailorId("");
      setDueDate("");
      setNotes("");
    } catch (e) {
      toast.error((e as Error).message || "Could not create ticket");
    }
  };

  return (
    <div className="space-y-5 md:space-y-6 animate-fade-up pb-32 lg:pb-0">
      <SectionHeader
        eyebrow="Intake · Alterations"
        title={<>A new <span className="text-brass-shimmer">alteration</span> ticket.</>}
        description="Drop the customer in, tap line items, set who handles it. Done in twenty seconds."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 md:gap-6 items-start">
        <div className="space-y-4 md:space-y-5">
          {/* Customer */}
          <GlassCard className="p-4 md:p-5">
            <CustomerField value={customer} onChange={setCustomer} recentCustomers={customers} />
          </GlassCard>

          {/* Presets */}
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="ui-label">Line items</div>
              <div className="text-[10px] text-cream-dim hidden sm:block">Tap a preset or add a custom row</div>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-4">
              {PRESET_ITEMS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => addPreset(p)}
                  className="rounded-xl border border-brass/20 bg-forest-raised/40 hover:border-brass/40 hover:bg-brass/10 active:bg-brass/15 px-3 py-3 sm:py-2 text-sm sm:text-xs text-cream-muted hover:text-cream transition-all flex items-center justify-between sm:justify-start gap-1.5 min-h-[48px] sm:min-h-[36px]"
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-4 w-4 sm:h-3 sm:w-3" />
                    {p.label}
                  </span>
                  <span className="text-brass-light/80 text-xs sm:text-[10px] tabular-nums">{formatUSD(p.price)}</span>
                </button>
              ))}
            </div>

            {/* Items list */}
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-brass/15 bg-brass/[0.03] py-8 text-center">
                <Scissors className="h-5 w-5 text-brass-light/40 mx-auto mb-1.5" />
                <div className="text-sm text-cream-muted">No items yet</div>
                <div className="text-[10px] text-cream-dim mt-0.5">Tap a preset above</div>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg border border-brass/15 bg-forest-raised/40 p-2"
                  >
                    <span className="ui-label text-[9px] text-cream-dim tabular-nums shrink-0 w-6 text-center">
                      {idx + 1}
                    </span>
                    <Input
                      value={it.label}
                      onChange={(e) => updateItem(idx, { label: e.target.value })}
                      placeholder="Line item"
                      className="flex-1 bg-transparent border-0 focus-visible:ring-0 text-cream h-10 sm:h-8 px-2 text-sm"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-cream-dim text-sm">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={it.price}
                        onChange={(e) => updateItem(idx, { price: Math.max(0, Number(e.target.value)) })}
                        className="w-20 bg-forest-raised/60 border border-brass/15 rounded px-2 py-2 sm:py-1 text-cream text-sm focus:outline-none focus:ring-1 focus:ring-brass/40 tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-cream-dim hover:text-signal-rose transition-colors p-2 -mr-1 min-h-[40px] min-w-[40px] flex items-center justify-center"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addBlank}
                  className="w-full rounded-lg border border-dashed border-brass/15 hover:border-brass/40 hover:bg-brass/5 py-3 sm:py-2 text-sm sm:text-xs text-cream-muted hover:text-cream transition-all flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Add custom row
                </button>
              </div>
            )}
          </GlassCard>

          {/* Routing */}
          <GlassCard className="p-4 md:p-5">
            <div className="ui-label mb-3">Assignment</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-3">
              <div>
                <Label className="ui-label text-[10px] mb-2 block">Tailor</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setTailorId("")}
                    className={cn(
                      "rounded-full px-4 py-2.5 sm:py-1.5 text-sm sm:text-xs border transition-all min-h-[44px] sm:min-h-0",
                      !tailorId
                        ? "border-brass bg-brass/15 text-cream"
                        : "border-brass/15 bg-forest-raised/40 text-cream-muted hover:border-brass/40 active:bg-brass/10",
                    )}
                  >
                    Unassigned
                  </button>
                  {scopedTailors.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTailorId(t.id)}
                      className={cn(
                        "rounded-full px-4 py-2.5 sm:py-1.5 text-sm sm:text-xs border transition-all flex items-center gap-1.5 min-h-[44px] sm:min-h-0",
                        tailorId === t.id
                          ? "border-brass bg-brass/15 text-cream shadow-brass-glow"
                          : "border-brass/15 bg-forest-raised/40 text-cream-muted hover:border-brass/40 active:bg-brass/10",
                      )}
                    >
                      <Hammer className="h-3.5 w-3.5" />
                      {t.name}
                    </button>
                  ))}
                  {scopedTailors.length === 0 ? (
                    <div className="text-[10px] text-cream-dim italic px-2 py-1.5">
                      No tailors for this location
                    </div>
                  ) : null}
                </div>
              </div>
              <div>
                <Label htmlFor="due" className="ui-label text-[10px] mb-2 block">Due date</Label>
                <div className="relative">
                  <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream-dim pointer-events-none" />
                  <Input
                    id="due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="pl-10 h-12 sm:h-10 bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-base sm:text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="alt-notes" className="ui-label text-[10px] mb-2 block">Notes</Label>
              <Textarea
                id="alt-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Tailor instructions, customer preferences…"
                className="bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-sm"
              />
            </div>
          </GlassCard>
        </div>

        {/* Right rail — total. Desktop only. */}
        <GlassCard variant="strong" className="hidden lg:block p-6 sticky top-4">
          <div className="ui-label mb-3">Ticket Total</div>
          <div className="flex items-end justify-between mb-5">
            <span className="font-display italic text-5xl text-brass-shimmer leading-none">
              {formatUSD(total)}
            </span>
          </div>
          <div className="space-y-1 text-xs text-cream-muted mb-4">
            <div className="flex justify-between">
              <span>Line items</span>
              <span>{items.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Tailor</span>
              <span className="text-cream truncate max-w-[160px]">
                {tailorId
                  ? scopedTailors.find((t) => t.id === tailorId)?.name ?? "—"
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Due</span>
              <span className="text-cream">{dueDate || "—"}</span>
            </div>
          </div>
          <Button
            className="w-full btn-brass h-11"
            disabled={!valid || createAlteration.isPending}
            onClick={submit}
          >
            {createAlteration.isPending ? "Creating…" : "Create ticket"}
          </Button>
          {!valid ? (
            <div className="mt-3 flex items-start gap-2 text-[11px] text-cream-dim">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Add customer name, phone, and at least one line item.</span>
            </div>
          ) : null}
        </GlassCard>
      </div>

      {/* Mobile/tablet sticky bottom bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-brass/25 bg-forest-deep/95 backdrop-blur-2xl px-3 sm:px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-[1400px] flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="ui-label text-[9px] text-cream-dim">Ticket Total · {items.length} item{items.length === 1 ? "" : "s"}</div>
            <div className="font-display italic text-3xl text-brass-shimmer leading-none truncate">
              {formatUSD(total)}
            </div>
          </div>
          <Button
            className="btn-brass h-14 px-6 text-base shrink-0"
            disabled={!valid || createAlteration.isPending}
            onClick={submit}
          >
            {createAlteration.isPending ? "Creating…" : "Create ticket"}
          </Button>
        </div>
      </div>
    </div>
  );
}
