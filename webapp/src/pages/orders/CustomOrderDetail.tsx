import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Sparkles, User, Phone, Mail, Calendar, CreditCard, Star, FileText, Printer, Truck, Copy, Check, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { StatusPill } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { useCustomOrder } from "@/lib/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import type { CustomOrder } from "@ls/types";
import { GARMENT_LABEL } from "@/lib/pricing";
import { formatUSD, formatDateTime } from "@ls/design/format";
import { cn } from "@ls/design/utils";
import { ChargeTerminalButton } from "@/components/payments/ChargeTerminalButton";
import { ChargeCardOnFileButton } from "@/components/payments/ChargeCardOnFileButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";
import MtmStatusRail from "@/components/MtmStatusRail";

const STAGES: CustomOrder["status"][] = [
  "quote",
  "deposit_paid",
  "in_production",
  "ready",
  "delivered",
  "cancelled",
];

const STAGE_LABELS: Record<CustomOrder["status"], string> = {
  quote: "Quote",
  deposit_paid: "Deposit Paid",
  in_production: "In Production",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export default function CustomOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: order, isLoading } = useCustomOrder(id);
  const qc = useQueryClient();
  const [paymentLinkOpen, setPaymentLinkOpen] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [pendingLive, setPendingLive] = useState<string | null>(null);

  const factoryKey = (order as any)?.erpName ?? (order as any)?.erpnextName ?? order?.id ?? id;
  const { data: factoryOrders = [] } = useQuery<any[]>({
    queryKey: ["sales-order-factory", factoryKey],
    queryFn: () => api.get<any[]>(`/api/sales-orders/${factoryKey}/factory`),
    enabled: Boolean(factoryKey),
  });

  const createDelivery = useMutation({
    mutationFn: async () => {
      const o = order as any;
      const summary = o?.garments?.map((g: any) => `${g.garmentType || g.type}`).join(", ")
        || o?.spec?.garment || "Custom Order";

      return api.post<{ id: string; qrToken: string }>("/api/deliveries/from-order", {
        sales_order: o?.erpName ?? o?.erpnextName ?? null,
        customer_name: o?.customer?.name ?? "Walk-in",
        customer_phone: o?.customer?.phone ?? null,
        customer_erp_name: o?.customer?.name ?? null,
        address: o?.customer?.address ?? null,
        notify_phone: o?.customer?.phone ?? null,
        garment_summary: summary,
        garment_count: o?.garments?.length ?? 1,
        location: o?.locationId ?? "NYC",
      });
    },
    onSuccess: (result) => {
      toast.success("Delivery created — opening label");
      navigate(`/deliveries/${result.id}/label`);
    },
    onError: () => toast.error("Could not create delivery"),
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) =>
      api.patch<CustomOrder>(`/api/custom-orders/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-orders"] });
      toast.success("Status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLiveStatus = useMutation({
    mutationFn: ({ name, status }: { name: string; status: string }) =>
      api.patch(`/api/qc/orders/${encodeURIComponent(name)}/status`, { status }),
    onMutate: ({ name }) => setPendingLive(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-orders"] });
      qc.invalidateQueries({ queryKey: ["sales-order-factory"] });
      toast.success("Status updated");
    },
    onError: (e: Error) => toast.error(e.message || "Could not update status"),
    onSettled: () => setPendingLive(null),
  });

  const printTicket = useMutation({
    mutationFn: async () => {
      const target = (order as any)?.erpName ?? (order as any)?.erpnextName ?? order?.id;
      const res = await api.raw("/api/print/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_name: target }),
      });
      const result = await res.json().catch(() => ({}));
      if (!result.ok) throw new Error(result.error?.message ?? result.error ?? "Print failed");
      return result;
    },
    onSuccess: () => toast.success("✓ Printed"),
    onError: (e: Error) => toast.error(e.message),
  });

  const createPaymentLink = useMutation({
    mutationFn: async () => {
      const target = (order as any)?.erpName ?? (order as any)?.erpnextName ?? order?.id;
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: target }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.url) {
        throw new Error(result.error?.message ?? "Could not create payment link");
      }
      return result.url as string;
    },
    onSuccess: (url) => {
      setPaymentLink(url);
      setPaymentLinkOpen(true);
      navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success("Payment link created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const printPaymentLink = useMutation({
    mutationFn: async () => {
      if (!paymentLink) throw new Error("Create a payment link first");
      const target = (order as any)?.erpName ?? (order as any)?.erpnextName ?? order?.id;
      const res = await api.raw("/api/print/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: paymentLink,
          invoice: target,
          amount: Math.max(
            0,
            Number((order as any)?.erp?.grand_total ?? (order as any)?.grandTotal ?? order?.quotedPrice ?? 0) -
              Number((order as any)?.erp?.advance_paid ?? (order as any)?.advancePaid ?? order?.depositAmount ?? 0),
          ),
          customer_name: order?.customer?.name ?? "",
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!result.ok) throw new Error(result.error?.message ?? result.error ?? "QR slip print failed");
      return result;
    },
    onSuccess: () => toast.success("✓ Printed"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-cream-muted text-sm">Loading…</div>;
  }
  if (!order) {
    return (
      <div className="space-y-6">
        <SectionHeader eyebrow="Custom order" title="Not found" />
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
      </div>
    );
  }

  const stageIndex = STAGES.indexOf(order.status as CustomOrder["status"]);
  const invoiceName = (order as any).erpName ?? (order as any).erpnextName ?? order.id;
  const grandTotal = Number((order as any).erp?.grand_total ?? (order as any).grandTotal ?? order.quotedPrice ?? 0);
  const advancePaid = Number((order as any).erp?.advance_paid ?? (order as any).advancePaid ?? order.depositAmount ?? 0);
  const balanceDue = Math.max(0, grandTotal - advancePaid);

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <Link
          to="/orders/custom"
          className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> Back to commissions
        </Link>
        <SectionHeader
          eyebrow={`Commission · #${order.id.slice(-8).toUpperCase()}`}
          title={
            <>
              {order.customer?.name ?? "—"}
              {order.customer?.dossier?.vip ? (
                <Star className="inline h-5 w-5 ml-2 -mt-2 text-brass fill-brass" />
              ) : null}
            </>
          }
          description={`${GARMENT_LABEL[order.garmentType]} · ${formatDateTime(order.createdAt)}`}
          actions={
            <div className="flex items-center gap-2">
              <StatusPill status={order.status} />
              <Button
                variant="outline"
                className="border-brass/20 hover:bg-brass/10 text-cream-muted"
                onClick={() => printTicket.mutate()}
                disabled={printTicket.isPending}
              >
                {printTicket.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}
                Print Ticket
              </Button>
              <Button
                variant="outline"
                className="border-brass/20 hover:bg-brass/10 text-cream-muted"
                onClick={() => createDelivery.mutate()}
                disabled={createDelivery.isPending}
              >
                <Truck className="h-4 w-4 mr-1.5" />
                {createDelivery.isPending ? "Creating…" : "Create Delivery"}
              </Button>
            </div>
          }
        />
      </div>

      {/* Stage stepper — simplified bookkeeping, including Cancelled */}
      <GlassCard variant="strong" className="p-5">
        <div className="ui-label mb-4">Production Stage</div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {STAGES.map((s, i) => {
            const done = i < stageIndex;
            const active = i === stageIndex;
            return (
              <div key={s} className="flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => updateStatus.mutate(s)}
                  disabled={updateStatus.isPending}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs border transition-all min-h-[44px]",
                    done
                      ? "border-brass/30 bg-brass/10 text-brass-light"
                      : active
                        ? "border-brass bg-brass/20 text-cream shadow-brass-glow"
                        : "border-brass/15 bg-forest-raised/40 text-cream-dim hover:border-brass/40",
                  )}
                >
                  {STAGE_LABELS[s]}
                </button>
                {i < STAGES.length - 1 ? <div className="mx-1 h-px w-6 bg-brass/15" /> : null}
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard variant="strong" className="p-5">
        <div className="ui-label mb-3">Live MTM status</div>
        <p className="text-xs text-cream-dim mb-3">
          Full factory list — tap to change. Includes Cancelled.
        </p>
        <MtmStatusRail
          current={(order as CustomOrder & { orderStatus?: string | null }).orderStatus}
          pending={pendingLive === order.id ? updateLiveStatus.variables?.status : null}
          onChange={(status) => updateLiveStatus.mutate({ name: order.id, status })}
        />
        {factoryOrders.filter((fo) => fo?.name && fo.name !== order.id).length > 0 ? (
          <div className="mt-4 space-y-3">
            {factoryOrders
              .filter((fo) => fo?.name && fo.name !== order.id)
              .map((fo: any) => (
                <div key={fo.name} className="rounded-lg border border-brass/15 bg-brass/5 px-3 py-3">
                  <div className="font-mono text-[10px] text-cream-dim mb-2">
                    {fo.name}
                    {fo.order_type ? ` · ${fo.order_type}` : ""}
                  </div>
                  <MtmStatusRail
                    compact
                    current={fo.order_status}
                    pending={pendingLive === fo.name ? updateLiveStatus.variables?.status : null}
                    onChange={(status) => updateLiveStatus.mutate({ name: fo.name, status })}
                  />
                </div>
              ))}
          </div>
        ) : null}
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Left — order detail */}
        <div className="space-y-6">
          {/* Customer */}
          <GlassCard className="p-6">
            <div className="ui-label mb-4">Customer</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field icon={User} label="Name" value={order.customer?.name ?? "—"} />
              <Field icon={Phone} label="Phone" value={order.customer?.phone ?? "—"} />
              <Field icon={Mail} label="Email" value={order.customer?.email ?? "—"} />
            </div>
            {order.customer?.dossier?.preferences ? (
              <div className="mt-4 pt-4 border-t border-brass/10">
                <div className="ui-label text-[10px] mb-1">Preferences</div>
                <div className="text-sm text-cream-muted italic">
                  "{order.customer.dossier.preferences}"
                </div>
              </div>
            ) : null}
          </GlassCard>

          {/* Specification */}
          <GlassCard className="p-6">
            <div className="ui-label mb-4">Specification</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SpecField label="Garment" value={GARMENT_LABEL[order.garmentType]} />
              {order.spec.lapel ? <SpecField label="Lapel" value={order.spec.lapel} /> : null}
              {order.spec.pockets ? <SpecField label="Pockets" value={order.spec.pockets} /> : null}
              {order.spec.vent ? <SpecField label="Vent" value={order.spec.vent} /> : null}
              {order.spec.lining ? <SpecField label="Lining" value={order.spec.lining} /> : null}
              {order.spec.buttons ? <SpecField label="Buttons" value={order.spec.buttons} /> : null}
              {order.spec.collar ? <SpecField label="Collar" value={order.spec.collar} /> : null}
              {order.spec.cuff ? <SpecField label="Cuff" value={order.spec.cuff} /> : null}
              {order.spec.placket ? <SpecField label="Placket" value={order.spec.placket} /> : null}
            </div>
            {order.notes ? (
              <div className="mt-5 pt-4 border-t border-brass/10">
                <div className="flex items-start gap-2">
                  <FileText className="h-3.5 w-3.5 text-brass-light/70 mt-0.5" />
                  <div>
                    <div className="ui-label text-[10px] mb-1">Notes</div>
                    <div className="text-sm text-cream-muted leading-relaxed">{order.notes}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </GlassCard>
        </div>

        {/* Right — pricing */}
        <GlassCard variant="strong" className="p-6 sticky top-4">
          <div className="ui-label mb-3">Financials</div>
          {order.priceTbd ? (
            <div className="rounded-lg border border-signal-amber/30 bg-signal-amber/5 p-3 mb-4">
              <div className="ui-label text-signal-amber text-[10px] mb-1">Quote Mode</div>
              <div className="text-xs text-cream-muted">
                Master tailor to price within 48 hours.
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Row label="Grand total" value={order.priceTbd ? "TBD" : formatUSD(grandTotal)} accent />
            <Row label="Advance paid" value={formatUSD(advancePaid)} />
            {!order.priceTbd ? (
              <Row label="Balance Due" value={formatUSD(balanceDue)} />
            ) : null}
          </div>
          <div className="brass-divider my-4" />
          {balanceDue > 0 ? (
            <div className="space-y-3">
              <ChargeTerminalButton
                invoiceId={invoiceName}
                amountCents={Math.round(balanceDue * 100)}
                amountDisplay={formatUSD(balanceDue)}
                onSuccess={() => {
                  toast.success("Payment captured — refreshing…");
                  qc.invalidateQueries({ queryKey: ["custom-orders", "detail", id] });
                }}
                onError={(msg) => toast.error(msg)}
              />
              <ChargeCardOnFileButton
                fullWidth
                invoiceId={invoiceName}
                amountDisplay={formatUSD(balanceDue)}
                customerLabel={order.customer?.name}
                onSuccess={() => {
                  toast.success("Card on file charged — refreshing…");
                  qc.invalidateQueries({ queryKey: ["custom-orders", "detail", id] });
                }}
                onError={(msg) => toast.error(msg)}
              />
              <Button
                className="w-full btn-brass"
                onClick={() => createPaymentLink.mutate()}
                disabled={createPaymentLink.isPending}
              >
                {createPaymentLink.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CreditCard className="h-4 w-4 mr-1.5" />}
                Send Payment Link
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300">
              Paid ✓
            </div>
          )}
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-cream-dim">
            <Calendar className="h-3 w-3" />
            <span>Created {formatDateTime(order.createdAt)}</span>
          </div>
        </GlassCard>
      </div>
      <Dialog open={paymentLinkOpen} onOpenChange={setPaymentLinkOpen}>
        <DialogContent className="bg-forest-raised border-brass/20 text-cream">
          <DialogHeader>
            <DialogTitle className="text-brass-shimmer">Square payment link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-brass/20 bg-forest-deep p-3">
              <p className="text-xs text-cream-dim mb-1">Secure URL</p>
              <p className="break-all font-mono text-xs text-cream-muted">{paymentLink}</p>
            </div>
            <Button
              variant="outline"
              className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              onClick={() => {
                navigator.clipboard.writeText(paymentLink).then(() => {
                  setCopied(true);
                  toast.success("Payment link copied");
                  setTimeout(() => setCopied(false), 2500);
                });
              }}
            >
              {copied ? <Check className="h-4 w-4 mr-1.5 text-signal-emerald" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {copied ? "Copied" : "Copy URL"}
            </Button>
            <Button
              variant="outline"
              className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              disabled={printPaymentLink.isPending}
              onClick={() => printPaymentLink.mutate()}
            >
              {printPaymentLink.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}
              Print QR Slip
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="ui-label text-[10px] mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-cream truncate">{value}</div>
    </div>
  );
}

function SpecField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-brass/15 bg-brass/5 p-3">
      <div className="ui-label text-[9px] mb-0.5">{label}</div>
      <div className="text-sm text-cream font-medium">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-cream-muted">{label}</span>
      <span
        className={
          accent
            ? "font-display italic text-2xl text-brass-shimmer"
            : "text-cream font-medium tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
