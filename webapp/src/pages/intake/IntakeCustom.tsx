import { useMemo, useState } from "react";
import { Sparkles, AlertCircle, CreditCard, FileText } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { GarmentTiles } from "@/components/pos/GarmentTiles";
import { FabricTiles } from "@/components/pos/FabricTiles";
import { StyleChips } from "@/components/pos/StyleChips";
import { PriceCard, TAX_TEMPLATES } from "@/components/pos/PriceCard";
import { DepositReceipt } from "@/components/pos/DepositReceipt";
import { CustomerField, type CustomerDraft } from "@/components/pos/CustomerField";
import { Button } from "@ls/design/ui/button";
import {
  useFabrics,
  useLocations,
  useStyleOptions,
  useCustomers,
  useCreateCustomOrder,
  type DepositReceipt as ReceiptT,
} from "@/lib/queries";
import { useMe } from "@/lib/session";
import { useActiveLocation } from "@/lib/locationContext";
import { computePrice, suggestedDeposit, type SpecChoices } from "@/lib/pricing";
import type { CustomOrder, GarmentType } from "@ls/types";
import { Textarea } from "@ls/design/ui/textarea";
import { Label } from "@ls/design/ui/label";
import { formatUSD } from "@ls/design/format";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";

const STEPS = [
  { n: 1, label: "Customer" },
  { n: 2, label: "Garment" },
  { n: 3, label: "Fabric" },
  { n: 4, label: "Style" },
  { n: 5, label: "Price" },
];

export default function IntakeCustom() {
  const { data: me } = useMe();
  const { activeLocationId } = useActiveLocation();
  const { data: locations = [] } = useLocations();
  const { data: fabrics = [] } = useFabrics();
  const { data: styles = [] } = useStyleOptions();
  const { data: customers = [] } = useCustomers();

  const isAllLocations = !activeLocationId;
  const activeLocationName = activeLocationId
    ? locations.find((l) => l.id === activeLocationId)?.name ?? null
    : me?.role === "super_admin"
      ? "All Locations"
      : null;

  const createOrder = useCreateCustomOrder();

  const [customer, setCustomer] = useState<CustomerDraft>({ name: "", phone: "", email: "" });
  const [garment, setGarment] = useState<GarmentType | undefined>(undefined);
  const [spec, setSpec] = useState<SpecChoices>({});
  const [priceTbd, setPriceTbd] = useState(false);
  const [isTaxable, setIsTaxable] = useState(true); // default taxable for in-store
  const [notes, setNotes] = useState("");
  const [depositAmount, setDepositAmount] = useState(0);

  const [paymentLinkOpen, setPaymentLinkOpen] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<CustomOrder | undefined>(undefined);
  const [completedReceipt, setCompletedReceipt] = useState<ReceiptT | undefined>(undefined);

  const fabric = useMemo(
    () => fabrics.find((f) => f.id === spec.fabricId),
    [fabrics, spec.fabricId],
  );
  const breakdown = useMemo(() => computePrice(garment, fabric, spec), [garment, fabric, spec]);

  const onTbdChange = (v: boolean) => {
    setPriceTbd(v);
    if (v) setDepositAmount(0);
    else if (breakdown.subtotal > 0 && depositAmount === 0) {
      setDepositAmount(suggestedDeposit(breakdown.subtotal));
    }
  };

  const onSpecChange = (next: SpecChoices) => setSpec(next);

  const customerValid = customer.name.trim().length >= 2 && customer.phone.trim().length >= 7;
  const orderValid = customerValid && !!garment && (priceTbd || !!fabric);
  const canSubmit = orderValid && !(isAllLocations && me?.role === "super_admin");

  const currentStep = !customerValid
    ? 1
    : !garment
      ? 2
      : !fabric && !priceTbd
        ? 3
        : Object.keys(spec).filter((k) => k !== "fabricId").length === 0
          ? 4
          : 5;

  const buildOrderPayload = () => {
    const payload: Record<string, unknown> = {
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim(),
      customerEmail: customer.email.trim() || undefined,
      garmentType: garment,
      quotedPrice: priceTbd ? 0 : breakdown.subtotal,
      priceTbd,
      depositAmount: priceTbd ? 0 : 0,
      notes: notes || null,
      spec: {
        ...spec,
        _breakdown: {
          fabricCost: breakdown.fabricCost,
          laborCost: breakdown.laborCost,
          upcharges: breakdown.upcharges,
        },
      },
    };
    if (me?.role === "super_admin" && activeLocationId && !isAllLocations) {
      payload.locationId = activeLocationId;
    }
    // Tax: pass template name for ERPNext, or empty string for tax-exempt
    const locCode = activeLocationId ?? "NYC"
    payload.taxTemplate = isTaxable ? (TAX_TEMPLATES[locCode] ?? "") : ""
    payload.isTaxable = isTaxable
    return payload;
  };

  const handleSaveQuote = async () => {
    if (!orderValid) {
      toast.error("Add customer, garment, and fabric (or toggle Price TBD).");
      return;
    }
    try {
      const order = await createOrder.mutateAsync(buildOrderPayload());
      toast.success(
        priceTbd ? "Quote saved · master tailor to price" : "Order saved",
      );
      setCompletedOrder(order);
      if (priceTbd) {
        resetAll();
      } else {
        toast.info("No deposit charged. You can charge later from the order detail.");
        resetAll();
      }
    } catch (e) {
      toast.error((e as Error).message || "Could not save order");
    }
  };

  const handleChargeDeposit = async () => {
    if (!orderValid) {
      toast.error("Complete customer, garment, and fabric first.");
      return;
    }
    if (depositAmount <= 0) {
      toast.error("Set a deposit amount.");
      return;
    }
    try {
      const order = await createOrder.mutateAsync(buildOrderPayload());
      const invoice = (order as any).erpName ?? order.id;
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice, amount: depositAmount }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.url) {
        throw new Error(result.error?.message ?? "Could not create deposit payment link");
      }
      setCompletedOrder(order);
      setPaymentLink(result.url);
      setPaymentLinkOpen(true);
      navigator.clipboard?.writeText(result.url).catch(() => undefined);
      toast.success("Deposit link created");
    } catch (e) {
      toast.error((e as Error).message || "Could not start deposit payment");
    }
  };

  const resetAll = () => {
    setCustomer({ name: "", phone: "", email: "" });
    setGarment(undefined);
    setSpec({});
    setNotes("");
    setPriceTbd(false);
    setDepositAmount(0);
    setPaymentLink("");
    setCompletedOrder(undefined);
    setCompletedReceipt(undefined);
  };

  const handleNewOrder = () => {
    setReceiptOpen(false);
    resetAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const locationLabel = isAllLocations
    ? me?.role === "super_admin"
      ? "Select a location to record this order"
      : activeLocationName ?? ""
    : activeLocationName ?? "—";

  return (
    <div className="space-y-5 md:space-y-6 animate-fade-up pb-32 lg:pb-0">
      <SectionHeader
        eyebrow="Intake · Custom Made"
        title={<>A new <span className="text-brass-shimmer">commission</span>.</>}
        description="Build the order at the counter. The price assembles itself from the Fabric Pricing and Style Library."
        actions={
          <div className="hidden md:flex items-center gap-2 ui-label text-[10px]">
            <Sparkles className="h-3 w-3 text-brass" />
            <span>{locationLabel}</span>
          </div>
        }
      />

      {/* Step progress — scrolls horizontally on small screens */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-none">
        {STEPS.map((s, i) => {
          const done = s.n < currentStep;
          const active = s.n === currentStep;
          return (
            <div key={s.n} className="flex items-center shrink-0">
              <div
                className={`flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-full border transition-all ${
                  done
                    ? "border-brass/40 bg-brass/10 text-brass-light"
                    : active
                      ? "border-brass bg-brass/15 text-cream shadow-brass-glow"
                      : "border-brass/15 bg-forest-raised/30 text-cream-dim"
                }`}
              >
                <span className="text-[10px] font-medium tabular-nums">{s.n}</span>
                <span className="text-xs">{s.label}</span>
              </div>
              {i < STEPS.length - 1 ? (
                <div className="mx-1 h-px w-4 bg-brass/15" />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 md:gap-6 items-start">
        {/* Left column — build */}
        <div className="space-y-4 md:space-y-5">
          {/* Customer */}
          <GlassCard className="p-4 md:p-5">
            <CustomerField value={customer} onChange={setCustomer} recentCustomers={customers} />
          </GlassCard>

          {/* Garment */}
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="ui-label">Garment</div>
              <div className="text-[10px] text-cream-dim hidden sm:block">Tap to select</div>
            </div>
            <GarmentTiles value={garment} onChange={(g) => setGarment(g)} />
          </GlassCard>

          {/* Fabric */}
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="ui-label">Fabric</div>
              <div className="text-[10px] text-cream-dim">
                {fabrics.length} from the Fabric Pricing book
              </div>
            </div>
            <FabricTiles
              fabrics={fabrics}
              value={spec.fabricId}
              onChange={(id) => setSpec({ ...spec, fabricId: id })}
            />
          </GlassCard>

          {/* Style */}
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="ui-label">Style · from the Library</div>
              {garment ? (
                <div className="text-[10px] text-cream-dim hidden sm:block">Tap to toggle</div>
              ) : null}
            </div>
            <StyleChips garment={garment} styles={styles} value={spec} onChange={onSpecChange} />
          </GlassCard>

          {/* Notes */}
          <GlassCard className="p-4 md:p-5">
            <Label htmlFor="notes" className="ui-label mb-2 block">
              Notes for the master tailor
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything special? Linings, monogram, special handling, fit preferences…"
              rows={3}
              className="bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-sm"
            />
          </GlassCard>

          {isAllLocations && me?.role === "super_admin" ? (
            <div className="flex items-start gap-2 text-xs text-signal-amber bg-signal-amber/10 border border-signal-amber/30 rounded-md px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5" />
              <span>Choose a specific location from the top bar to record this commission.</span>
            </div>
          ) : null}

          {/* Inline price card on tablet/mobile (full controls + deposit options) */}
          <div className="lg:hidden">
            <PriceCard
              breakdown={breakdown}
              priceTbd={priceTbd}
              onTbdChange={onTbdChange}
              depositAmount={depositAmount}
              onDepositChange={setDepositAmount}
              canSubmit={canSubmit}
              onChargeDeposit={handleChargeDeposit}
              onSaveQuote={handleSaveQuote}
              isSubmitting={createOrder.isPending}
              isTaxable={isTaxable}
              onTaxableChange={setIsTaxable}
              location={activeLocationId ?? "NYC"}
            />
          </div>
        </div>

        {/* Right column — sticky PriceCard on desktop only */}
        <div className="hidden lg:block">
          <PriceCard
            breakdown={breakdown}
            priceTbd={priceTbd}
            onTbdChange={onTbdChange}
            depositAmount={depositAmount}
            onDepositChange={setDepositAmount}
            canSubmit={canSubmit}
            onChargeDeposit={handleChargeDeposit}
            onSaveQuote={handleSaveQuote}
            isSubmitting={createOrder.isPending}
            isTaxable={isTaxable}
            onTaxableChange={setIsTaxable}
            location={activeLocationId ?? "NYC"}
          />
        </div>
      </div>

      {/* Mobile/tablet sticky bottom CTA — quick-charge access without scrolling */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-brass/25 bg-forest-deep/95 backdrop-blur-2xl px-3 sm:px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-[1400px] flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="ui-label text-[9px] text-cream-dim">
              {priceTbd ? "Quote mode" : `Subtotal${depositAmount > 0 ? ` · Deposit ${formatUSD(depositAmount)}` : ""}`}
            </div>
            <div
              className={`font-display italic text-3xl leading-none truncate ${
                priceTbd ? "text-cream-muted" : "text-brass-shimmer"
              }`}
            >
              {formatUSD(breakdown.subtotal)}
            </div>
          </div>
          {priceTbd ? (
            <Button
              className="h-14 px-5 bg-signal-amber hover:bg-signal-amber/90 text-forest font-medium shrink-0"
              disabled={!canSubmit || createOrder.isPending}
              onClick={handleSaveQuote}
            >
              <FileText className="h-4 w-4 mr-1.5" />
              Save Quote
            </Button>
          ) : (
            <Button
              className="btn-brass h-14 px-5 shrink-0"
              disabled={!canSubmit || createOrder.isPending || depositAmount === 0}
              onClick={handleChargeDeposit}
            >
              <CreditCard className="h-4 w-4 mr-1.5" />
              {depositAmount === 0 ? "Set deposit" : `Charge ${formatUSD(depositAmount)}`}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={paymentLinkOpen} onOpenChange={setPaymentLinkOpen}>
        <DialogContent className="bg-forest-raised border-brass/20 text-cream">
          <DialogHeader>
            <DialogTitle className="text-brass-shimmer">Deposit payment link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-cream-muted">
              Custom order {completedOrder?.id} was saved. Send this Square link to collect the {formatUSD(depositAmount)} deposit.
            </p>
            <div className="rounded-lg border border-brass/20 bg-forest-deep p-3">
              <p className="break-all font-mono text-xs text-cream-muted">{paymentLink}</p>
            </div>
            <Button
              className="btn-brass"
              onClick={() => {
                navigator.clipboard.writeText(paymentLink).then(() => toast.success("Payment link copied"));
              }}
            >
              Copy Link
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <DepositReceipt
        open={receiptOpen}
        order={completedOrder}
        receipt={completedReceipt}
        breakdown={breakdown}
        customerName={customer.name}
        customerPhone={customer.phone}
        locationName={activeLocationName ?? "L&S House"}
        salespersonName={me?.name ?? ""}
        onClose={() => setReceiptOpen(false)}
        onNewOrder={handleNewOrder}
      />
    </div>
  );
}
