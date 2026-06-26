import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import {
  ArrowLeft,
  Scissors,
  Zap,
  Calendar,
  MapPin,
  Package,
  FileText,
  CreditCard,
  Truck,
  Bell,
  CheckCircle,
  MessageSquare,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { Button } from "@/components/ui/button";
import { useAlterationDetail, useAlterationTransitions } from "@/lib/queries";
import type { Transition } from "@/lib/queries";
import { api } from "@/lib/api";
import { formatUSD, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Transition action button colours ────────────────────────────────────────
function actionColor(action: string) {
  if (action === "start_work")   return "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20";
  if (action === "mark_ready")   return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20";
  if (action === "mark_picked_up") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20";
  if (action === "cancel")       return "border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20";
  if (action === "reopen")       return "border-blue-500/50 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20";
  return "border-brass/30 bg-brass/10 text-brass-light hover:bg-brass/20";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    start_work: "Start Work",
    mark_ready: "Mark Ready",
    mark_picked_up: "Mark Picked Up",
    cancel: "Cancel",
    reopen: "Reopen",
  };
  return labels[action] ?? action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Billing badge ────────────────────────────────────────────────────────────
function billingBadge(status: string) {
  if (status === "Billable")               return "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";
  if (status === "Warranty")               return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
  if (status === "Included in Custom Order") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  return "border-brass/20 bg-brass/5 text-cream-dim";
}

// ── Payment badge ─────────────────────────────────────────────────────────────
function paymentBadge(status: string) {
  if (status === "Paid")            return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (status === "Unpaid")          return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (status === "Partially Paid")  return "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";
  if (status === "Overdue")         return "border-red-500/40 bg-red-500/10 text-red-300";
  return "border-zinc-500/40 bg-zinc-500/10 text-zinc-400";
}

export default function AlterationDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: ticket, isLoading } = useAlterationDetail(id);
  const { data: transitions = [] } = useAlterationTransitions(id);

  const advance = useMutation({
    mutationFn: (action: string) =>
      api.patch(`/api/alterations/${id}/state`, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alterations", "detail", id] });
      qc.invalidateQueries({ queryKey: ["alterations", "transitions", id] });
      qc.invalidateQueries({ queryKey: ["alterations"] });
      toast.success("Status updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-cream-muted text-sm animate-pulse">Loading ticket…</div>;
  }
  if (!ticket) {
    return (
      <div className="space-y-4">
        <SectionHeader eyebrow="Alteration" title="Ticket not found" />
        <Link to="/orders/alterations" className="inline-flex items-center gap-1.5 text-sm text-cream-dim hover:text-cream">
          <ArrowLeft className="h-4 w-4" /> Back to alterations
        </Link>
      </div>
    );
  }

  // Safely read rich fields (forward-compat when backend adds them)
  const t = ticket as any;
  const ticketRef   = t.ticket_id ?? `ALT-${ticket.id.slice(-8).toUpperCase()}`;
  const workflowState = t.workflow_state ?? ticket.status ?? "intake";
  const originLocation = t.origin_location ?? ticket.locationId ?? "—";
  const isRush       = !!t.is_rush;
  const ticketDate   = t.ticket_date ?? ticket.createdAt;
  const dueDate      = t.due_date ?? ticket.dueDate;
  const promisedDate = t.promised_date ?? null;
  const garments: any[] = t.garments ?? [];
  const lines: any[]    = t.lines ?? ticket.items ?? [];
  const billingStatus   = t.billing_status ?? "Billable";
  const paymentStatus   = t.payment_status ?? "Unpaid";
  const salesInvoice    = t.sales_invoice ?? null;
  const linkedSalesOrder= t.linked_sales_order ?? null;
  const deliveryMethod  = t.delivery_method ?? "—";
  const notifiedReadyAt = t.notified_ready_at ?? null;
  const pickedUpAt      = t.picked_up_at ?? null;
  const internalNotes   = t.internal_notes ?? ticket.notes ?? null;
  const customerNotes   = t.customer_notes ?? null;
  const total           = t.total ?? ticket.price ?? 0;
  const customerPhone   = t.customer_phone ?? ticket.customer?.phone ?? "";

  const [smsOpen, setSmsOpen] = useState(false);
  const [smsText, setSmsText] = useState(
    `Hi ${ticket.customer?.name?.split(" ")[0] ?? "there"}, your alteration ticket ${t.ticket_id ?? ticket.id} at L&S Custom Tailors — ${paymentStatus === "Paid" ? "is ready for pickup!" : `balance: $${Number(total).toFixed(2)}.`} Call us at 212-752-1638. — L&S Custom Tailors`
  );
  const smsMutation = useMutation({
    mutationFn: () => api.post("/api/sofia/send", { to: customerPhone, message: smsText }),
    onSuccess: () => { toast.success("SMS sent"); setSmsOpen(false); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to send SMS"),
  });

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Back link */}
      <div>
        <Link
          to="/orders/alterations"
          className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> Back to alterations
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <SectionHeader
            eyebrow={`Alteration · ${ticketRef}`}
            title={
              <span className="flex items-center gap-3 flex-wrap">
                {ticket.customer?.name ?? "—"}
                {isRush ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-300 tracking-widest uppercase">
                    <Zap className="h-3 w-3" /> Rush
                  </span>
                ) : null}
              </span>
            }
            description={
              <span className="flex items-center gap-2 text-cream-dim text-sm flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {originLocation}
                </span>
                <span>·</span>
                <StatusPill status={workflowState} />
              </span>
            }
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/api/intake-alterations/tickets/${ticket.id}/receipt`, "_blank")}
            className="border-brass/20 hover:bg-brass/10 text-cream-muted h-8 px-2 shrink-0 mt-1"
            title="Print receipt"
          >
            <FileText className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Workflow actions */}
      {(transitions.length > 0 || customerPhone) ? (
        <GlassCard variant="strong" className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="ui-label">Actions</div>
            {customerPhone ? (
              <button onClick={() => setSmsOpen(true)} className="inline-flex items-center gap-1.5 text-xs border border-brass/30 rounded-lg px-3 py-1.5 text-brass-shimmer hover:bg-brass/10 transition-colors">
                <MessageSquare className="h-3.5 w-3.5" /> SMS Customer
              </button>
            ) : null}
          </div>
          {transitions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {transitions.map((tr) => (
                <button
                  key={tr.action}
                  type="button"
                  onClick={() => advance.mutate(tr.action)}
                  disabled={advance.isPending}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-all disabled:opacity-50",
                    actionColor(tr.action),
                  )}
                >
                  {tr.label ?? actionLabel(tr.action)}
                </button>
              ))}
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      {/* SMS Modal */}
      {smsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-brass" />
                <span className="text-cream font-medium">Send SMS to {ticket.customer?.name ?? customerPhone}</span>
              </div>
              <span className="text-xs text-cream-dim font-mono">{customerPhone}</span>
            </div>
            <textarea rows={4} value={smsText} onChange={e => setSmsText(e.target.value)}
              className="w-full bg-forest-raised border border-brass/20 rounded-xl px-3 py-2.5 text-cream text-sm focus:outline-none focus:border-brass/50 resize-none mb-3" />
            <div className="flex gap-2">
              <button onClick={() => smsMutation.mutate()} disabled={smsMutation.isPending || !smsText.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brass/20 border border-brass/40 text-brass-shimmer font-medium text-sm hover:bg-brass/30 transition-all disabled:opacity-50">
                <Send className="h-3.5 w-3.5" />
                {smsMutation.isPending ? "Sending…" : "Send SMS"}
              </button>
              <button onClick={() => setSmsOpen(false)} className="px-4 py-2.5 rounded-xl border border-brass/20 text-cream-muted text-sm hover:border-brass/40 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Left column */}
        <div className="space-y-6">
          {/* Dates */}
          <GlassCard className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Dates
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <DateField label="Ticket Date"          value={ticketDate} />
              <DateField label="Work Due"             value={dueDate}       ticketId={ticket.id} field="dueDate" />
              <DateField label="Promised to Customer" value={promisedDate}  ticketId={ticket.id} field="promisedDate" />
            </div>
          </GlassCard>

          {/* Garments */}
          {garments.length > 0 ? (
            <GlassCard className="p-6">
              <div className="ui-label mb-4 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Garments
              </div>
              <div className="space-y-2">
                {garments.map((g: any, i: number) => {
                  const photos: string[] = Array.isArray(g.photos) ? g.photos : [];
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-brass/10 bg-brass/5 px-3 py-2 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-cream text-sm">{g.description ?? g.label ?? g.garment_type ?? `Garment ${i + 1}`}</span>
                        {g.status ? <StatusPill status={g.status} /> : null}
                      </div>
                      {photos.length > 0 ? (
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                          {photos.map((url: string, j: number) => (
                            <a
                              key={j}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="aspect-square rounded-md overflow-hidden border border-brass/20 bg-forest-deep"
                            >
                              <img src={url} alt={`Garment ${i + 1} photo ${j + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          ) : null}

          {/* Alteration Lines */}
          {lines.length > 0 ? (
            <GlassCard className="p-6">
              <div className="ui-label mb-4 flex items-center gap-1.5">
                <Scissors className="h-3.5 w-3.5" /> Alteration Lines
              </div>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brass/15">
                      <th className="text-left ui-label text-[10px] pb-2 pr-4">Description</th>
                      <th className="text-center ui-label text-[10px] pb-2 pr-4">Status</th>
                      <th className="text-right ui-label text-[10px] pb-2">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brass/10">
                    {lines.map((line: any, i: number) => (
                      <tr key={i} className="group">
                        <td className="py-2 pr-4 text-cream-muted">{line.description ?? line.label ?? `Line ${i + 1}`}</td>
                        <td className="py-2 pr-4 text-center">
                          {line.line_status ? (
                            <span className="text-xs text-cream-dim">{line.line_status}</span>
                          ) : null}
                        </td>
                        <td className="py-2 text-right tabular-nums text-cream">
                          {line.price != null ? formatUSD(line.price) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          ) : null}

          {/* Delivery */}
          <GlassCard className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Delivery
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <InfoField label="Method"        value={deliveryMethod} />
              <InfoField label="Notified Ready" value={notifiedReadyAt ? formatDateTime(notifiedReadyAt) : "—"} />
              <InfoField label="Picked Up"      value={pickedUpAt ? formatDateTime(pickedUpAt) : "—"} />
            </div>
          </GlassCard>

          {/* Notes */}
          {(internalNotes || customerNotes) ? (
            <GlassCard className="p-6">
              <div className="ui-label mb-4 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Notes
              </div>
              <div className="space-y-4">
                {internalNotes ? (
                  <div>
                    <div className="ui-label text-[10px] mb-1 text-cream-dim">Internal</div>
                    <p className="text-sm text-cream-muted leading-relaxed">{internalNotes}</p>
                  </div>
                ) : null}
                {customerNotes ? (
                  <div>
                    <div className="ui-label text-[10px] mb-1 text-cream-dim">Customer</div>
                    <p className="text-sm text-cream-muted leading-relaxed italic">"{customerNotes}"</p>
                  </div>
                ) : null}
              </div>
            </GlassCard>
          ) : null}
        </div>

        {/* Right column — billing & total */}
        <div className="space-y-5">
          {/* Billing */}
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Billing
            </div>

            {/* Billing status badge */}
            <div className="mb-4">
              <div className="ui-label text-[10px] mb-1.5">Billing Status</div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                  billingBadge(billingStatus),
                )}
              >
                {billingStatus}
              </span>
            </div>

            {/* Billing-status-specific info */}
            {billingStatus === "Warranty" ? (
              <div className="rounded-lg border border-zinc-500/20 bg-zinc-500/5 px-3 py-2 text-xs text-zinc-300">
                Covered under warranty — no charge to customer.
              </div>
            ) : billingStatus === "Included in Custom Order" && linkedSalesOrder ? (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-300">
                Linked Sales Order: <span className="font-medium">{linkedSalesOrder}</span>
              </div>
            ) : billingStatus === "Billable" ? (
              <div className="space-y-3">
                {salesInvoice ? (
                  <div>
                    <div className="ui-label text-[10px] mb-1">Invoice</div>
                    <div className="text-sm text-cream font-medium">{salesInvoice}</div>
                  </div>
                ) : null}
                <div>
                  <div className="ui-label text-[10px] mb-1.5">Payment Status</div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                      paymentBadge(paymentStatus),
                    )}
                  >
                    {paymentStatus === "Paid" ? <CheckCircle className="h-3 w-3" /> : null}
                    {paymentStatus}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="brass-divider my-5" />

            {/* Total */}
            <div>
              <div className="ui-label text-[10px] mb-1">Ticket Total</div>
              <div className="font-display italic text-3xl text-brass-shimmer tabular-nums">
                {formatUSD(total)}
              </div>
            </div>
          </GlassCard>

          {/* Quick-info card */}
          <GlassCard className="p-5">
            <div className="ui-label mb-3 text-[10px]">Ticket Info</div>
            <div className="space-y-2 text-sm">
              <InfoRow label="ID"       value={ticketRef} />
              <InfoRow label="Location" value={originLocation} />
              <InfoRow label="Tailor"   value={ticket.tailor?.name ?? "Unassigned"} />
              <InfoRow label="Created"  value={formatDate(ticket.createdAt)} />
              {ticket.createdBy ? (
                <InfoRow label="By" value={ticket.createdBy.name ?? ticket.createdBy.email ?? "—"} />
              ) : null}
            </div>
          </GlassCard>

          {/* Notification status */}
          {notifiedReadyAt ? (
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 text-emerald-300">
                <Bell className="h-4 w-4" />
                <span className="text-sm font-medium">Customer notified</span>
              </div>
              <div className="text-xs text-cream-dim mt-1">{formatDateTime(notifiedReadyAt)}</div>
            </GlassCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

function DateField({ label, value, ticketId, field }: {
  label: string; value: string | null | undefined;
  ticketId?: string; field?: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const save = useMutation({
    mutationFn: (newVal: string) => api.patch(`/api/alterations/${ticketId}`, { [field!]: newVal || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alteration", ticketId] });
      toast.success(`${label} updated`);
      setEditing(false);
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  });

  if (!ticketId || !field) {
    return (
      <div>
        <div className="ui-label text-[10px] mb-1">{label}</div>
        <div className="text-cream text-sm">{value ? formatDate(value) : <span className="text-cream-dim italic">—</span>}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="ui-label text-[10px] mb-1 flex items-center gap-1.5">
        {label}
        {!editing && (
          <button onClick={() => { setDraft(value ?? ""); setEditing(true); }}
            className="text-brass/50 hover:text-brass transition-colors text-[8px] underline">edit</button>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input type="date" value={draft} onChange={e => setDraft(e.target.value)}
            className="flex-1 bg-forest-raised border border-brass/30 rounded-lg px-2 py-1 text-cream text-xs focus:outline-none focus:border-brass/60 [color-scheme:dark]" />
          <button onClick={() => save.mutate(draft)} disabled={save.isPending}
            className="text-xs px-2 py-1 rounded bg-brass/20 text-brass-shimmer border border-brass/30 hover:bg-brass/30 disabled:opacity-50">
            {save.isPending ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-cream-dim hover:text-cream">✕</button>
        </div>
      ) : (
        <div className="text-cream text-sm">{value ? formatDate(value) : <span className="text-cream-dim italic">—</span>}</div>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ui-label text-[10px] mb-1">{label}</div>
      <div className="text-cream text-sm">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-cream-dim">{label}</span>
      <span className="text-cream font-medium">{value}</span>
    </div>
  );
}
