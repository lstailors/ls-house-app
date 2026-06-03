import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowLeft,
  ExternalLink,
  Receipt,
  Package,
  User,
  MapPin,
  Phone,
  Mail,
  Calendar,
  DollarSign,
  FileText,
  ArrowUpRight,
  Send,
} from "lucide-react"
import { GlassCard } from "@/components/glass/GlassCard"
import { StatusPill } from "@/components/glass/StatusPill"
import { api } from "@/lib/api"
import { formatUSD, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

// ── Types ────────────────────────────────────────────────────────────────────

interface SalesOrderDetail {
  name: string
  customer: string
  customerName: string
  status: string
  makeType: string | null
  company: string
  transactionDate: string
  deliveryDate: string | null
  contactPhone: string | null
  contactMobile: string | null
  contactEmail: string | null
  addressDisplay: string | null
  shippingAddress: string | null
  total: number
  grandTotal: number
  advancePaid: number
  totalTaxes: number
  taxesAndCharges: string | null
  billingStatus: string | null
  deliveryStatus: string | null
  perBilled: number
  perDelivered: number
  items: {
    name: string
    item_code: string
    item_name: string
    description: string | null
    qty: number
    rate: number
    amount: number
    warehouse: string | null
    deliveredQty: number
    billedAmt: number
  }[]
  invoices: {
    name: string
    status: string
    grand_total: number
    outstanding_amount: number
    posting_date: string
    due_date: string | null
  }[]
  customerMobile: string | null
  customerEmail: string | null
  customerGroup: string | null
  creation: string
  modified: string
  docstatus: number
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 py-1.5 border-b border-brass/10 last:border-0">
      <span className="text-cream-dim text-xs shrink-0">{label}</span>
      <span className="text-cream text-xs text-right">{value ?? "—"}</span>
    </div>
  )
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="ui-label text-[10px]">{label}</span>
        <span className="text-[10px] text-cream-dim">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-forest-raised overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brass/70 to-brass-light transition-all"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  )
}

function DateField({
  label,
  value,
  orderId,
  field,
}: {
  label: string
  value: string | null | undefined
  orderId?: string
  field?: string
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? "")

  const save = useMutation({
    mutationFn: (newVal: string) =>
      api.patch(`/api/sales-orders/${orderId}`, { [field!]: newVal || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-order-detail", orderId] })
      qc.invalidateQueries({ queryKey: ["sales-orders"] })
      toast.success(`${label} updated`)
      setEditing(false)
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  })

  if (!orderId || !field) {
    return (
      <div>
        <div className="ui-label text-[10px] mb-1">{label}</div>
        <div className="text-cream text-sm">
          {value ? formatDate(value) : <span className="text-cream-dim italic">—</span>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="ui-label text-[10px] mb-1 flex items-center gap-1.5">
        {label}
        {!editing ? (
          <button
            onClick={() => {
              setDraft(value ?? "")
              setEditing(true)
            }}
            className="text-brass/50 hover:text-brass transition-colors text-[8px] underline"
          >
            edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 bg-forest-raised border border-brass/30 rounded-lg px-2 py-1 text-cream text-xs focus:outline-none focus:border-brass/60 [color-scheme:dark]"
          />
          <button
            onClick={() => save.mutate(draft)}
            disabled={save.isPending}
            className="text-xs px-2 py-1 rounded bg-brass/20 text-brass-shimmer border border-brass/30 hover:bg-brass/30 disabled:opacity-50"
          >
            {save.isPending ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-cream-dim hover:text-cream">
            ✕
          </button>
        </div>
      ) : (
        <div className="text-cream text-sm">
          {value ? formatDate(value) : <span className="text-cream-dim italic">—</span>}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null)

  const {
    data: order,
    isLoading,
    isError,
  } = useQuery<SalesOrderDetail>({
    queryKey: ["sales-order-detail", id],
    queryFn: () => api.get<SalesOrderDetail>(`/api/sales-orders/${id}`),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-cream-muted text-sm animate-pulse">Loading order…</div>
      </div>
    )
  }

  if (isError || !order) {
    return (
      <div className="space-y-4 animate-fade-up">
        <div className="text-cream-muted text-sm">Order not found.</div>
        <button
          onClick={() => navigate("/sales-orders")}
          className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> Back to orders
        </button>
      </div>
    )
  }

  const erpOrderUrl = `https://erp.lstailors.com/sales-order/${order.name}`
  const balanceDue = order.grandTotal - order.advancePaid
  const emailAddress = order.contactEmail ?? order.customerEmail ?? ""

  const emailCustomer = () => {
    const subject = encodeURIComponent(`Your L&S Custom Tailors Order ${order.name}`)
    const body = encodeURIComponent(
      `Dear ${order.customerName},\n\nThank you for your order ${order.name}.\n\nBalance due: $${Math.max(0, balanceDue).toFixed(2)}\n\nPlease don't hesitate to reach out.\n\nBest,\nL&S Custom Tailors`,
    )
    window.open(`mailto:${emailAddress}?subject=${subject}&body=${body}`)
  }

  return (
    <div className="space-y-6 animate-fade-up pb-10">
      {/* Back + Header bar */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => navigate("/sales-orders")}
          className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors self-start"
        >
          <ArrowLeft className="h-3 w-3" /> Back to orders
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="font-mono text-brass-shimmer text-2xl font-bold tracking-tight">{order.name}</div>
            <div className="text-cream text-base mt-0.5">{order.customerName}</div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusPill status={order.status} />
              {order.makeType ? (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-brass/20 text-brass-light border border-brass/30 uppercase">
                  {order.makeType}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {emailAddress ? (
              <button
                onClick={emailCustomer}
                className="inline-flex items-center gap-1.5 text-xs border border-emerald-500/30 rounded-lg px-3 py-1.5 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <Send className="h-3.5 w-3.5" /> Email Customer
              </button>
            ) : null}
            <a
              href={erpOrderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs border border-brass/30 rounded-lg px-3 py-1.5 text-brass-light hover:bg-brass/10 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in ERPNext
            </a>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* LEFT column */}
        <div className="space-y-6">
          {/* Customer */}
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Customer
            </div>
            <div className="space-y-0">
              <InfoRow label="Name" value={order.customerName} />
              {order.customerGroup ? <InfoRow label="Group" value={order.customerGroup} /> : null}
              {(order.contactPhone ?? order.customerMobile) ? (
                <InfoRow
                  label="Phone"
                  value={
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3 text-brass/60" />
                      {order.contactPhone ?? order.customerMobile}
                    </span>
                  }
                />
              ) : null}
              {order.contactMobile && order.contactMobile !== order.contactPhone ? (
                <InfoRow
                  label="Mobile"
                  value={
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3 text-brass/60" />
                      {order.contactMobile}
                    </span>
                  }
                />
              ) : null}
              {(order.contactEmail ?? order.customerEmail) ? (
                <InfoRow
                  label="Email"
                  value={
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3 text-brass/60" />
                      {order.contactEmail ?? order.customerEmail}
                    </span>
                  }
                />
              ) : null}
              {order.addressDisplay ? (
                <InfoRow
                  label="Address"
                  value={
                    <span className="flex items-start gap-1">
                      <MapPin className="h-3 w-3 text-brass/60 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-line">
                        {order.addressDisplay.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}
                      </span>
                    </span>
                  }
                />
              ) : null}
            </div>
          </GlassCard>

          {/* Order Info */}
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Order Info
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="ui-label text-[10px] mb-1">Order Date</div>
                <div className="text-cream text-sm">{formatDate(order.transactionDate)}</div>
              </div>
              <DateField
                label="Delivery Date"
                value={order.deliveryDate}
                orderId={id}
                field="deliveryDate"
              />
              <div>
                <div className="ui-label text-[10px] mb-1">Company</div>
                <div className="text-cream text-sm">{order.company}</div>
              </div>
            </div>
            {order.makeType ? (
              <div className="mt-2">
                <div className="ui-label text-[10px] mb-1">Make Type</div>
                <div className="text-cream text-sm uppercase">{order.makeType}</div>
              </div>
            ) : null}
          </GlassCard>

          {/* Line Items */}
          {order.items.length > 0 ? (
            <GlassCard className="p-6">
              <div className="ui-label mb-4 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Line Items
              </div>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brass/15">
                      <th className="text-left ui-label text-[10px] pb-2 pr-4">Item</th>
                      <th className="text-center ui-label text-[10px] pb-2 pr-4">Qty</th>
                      <th className="text-right ui-label text-[10px] pb-2 pr-4">Rate</th>
                      <th className="text-right ui-label text-[10px] pb-2 pr-4">Amount</th>
                      <th className="text-center ui-label text-[10px] pb-2">Del'd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brass/10">
                    {order.items.map((item) => (
                      <tr key={item.name} className="group">
                        <td className="py-3 pr-4">
                          <div className="text-cream text-xs font-medium">{item.item_name}</div>
                          {item.description ? (
                            <div className="text-cream-dim text-[10px] mt-0.5 max-w-[200px] truncate">
                              {item.description}
                            </div>
                          ) : null}
                          <div className="text-brass/50 text-[10px] font-mono">{item.item_code}</div>
                        </td>
                        <td className="py-3 pr-4 text-center text-cream-dim tabular-nums text-xs">{item.qty}</td>
                        <td className="py-3 pr-4 text-right tabular-nums text-cream-dim text-xs">
                          {formatUSD(item.rate)}
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums text-cream text-xs font-medium">
                          {formatUSD(item.amount)}
                        </td>
                        <td className="py-3 text-center text-cream-dim text-xs tabular-nums">{item.deliveredQty}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-brass/20">
                      <td colSpan={3} className="py-2 text-right text-cream-dim text-xs pr-4">
                        Subtotal
                      </td>
                      <td className="py-2 text-right tabular-nums text-cream text-xs font-semibold pr-4">
                        {formatUSD(order.total)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </GlassCard>
          ) : null}

          {/* Invoices */}
          {order.invoices.length > 0 ? (
            <GlassCard className="p-6">
              <div className="ui-label mb-4 flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" /> Linked Invoices
              </div>
              <div className="space-y-2">
                {order.invoices.map((inv) => (
                  <div key={inv.name}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedInvoice(expandedInvoice === inv.name ? null : inv.name)
                      }
                      className="w-full flex items-center justify-between rounded-lg border border-brass/15 bg-brass/5 px-4 py-3 gap-4 hover:bg-brass/10 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-cream-dim">{inv.name}</div>
                        <div className="text-[10px] text-cream-dim mt-0.5">
                          {formatDate(inv.posting_date)}
                          {inv.due_date ? ` · Due ${formatDate(inv.due_date)}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-display italic text-brass-shimmer text-sm tabular-nums">
                            {formatUSD(inv.grand_total)}
                          </div>
                          {inv.outstanding_amount > 0 ? (
                            <div className="text-[10px] text-amber-400 tabular-nums">
                              {formatUSD(inv.outstanding_amount)} outstanding
                            </div>
                          ) : null}
                        </div>
                        <StatusPill status={inv.status} />
                      </div>
                    </button>

                    {expandedInvoice === inv.name ? (
                      <div className="mt-1 p-3 bg-forest-raised/50 rounded-lg space-y-1 text-xs border border-brass/10">
                        <div className="flex justify-between">
                          <span className="text-cream-dim">Grand Total</span>
                          <span className="text-cream">{formatUSD(inv.grand_total)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-cream-dim">Outstanding</span>
                          <span className={inv.outstanding_amount > 0 ? "text-red-400" : "text-signal-emerald"}>
                            {formatUSD(inv.outstanding_amount)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-cream-dim">Posted</span>
                          <span className="text-cream">{formatDate(inv.posting_date)}</span>
                        </div>
                        {inv.due_date ? (
                          <div className="flex justify-between">
                            <span className="text-cream-dim">Due</span>
                            <span
                              className={
                                new Date(inv.due_date) < new Date() && inv.outstanding_amount > 0
                                  ? "text-red-400 font-medium"
                                  : "text-cream"
                              }
                            >
                              {formatDate(inv.due_date)}
                            </span>
                          </div>
                        ) : null}
                        <a
                          href={`https://erp.lstailors.com/sales-invoice/${inv.name}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-brass-shimmer hover:underline mt-1"
                        >
                          Open invoice in ERPNext <ArrowUpRight className="w-3 h-3" />
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </GlassCard>
          ) : null}

          {/* Meta */}
          <GlassCard className="p-5">
            <div className="ui-label mb-3 text-[10px]">
              <FileText className="h-3 w-3 inline mr-1" />
              Record Info
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0">
              <InfoRow label="Created" value={formatDate(order.creation)} />
              <InfoRow label="Modified" value={formatDate(order.modified)} />
              <InfoRow
                label="Doc Status"
                value={
                  order.docstatus === 1 ? "Submitted" : order.docstatus === 2 ? "Cancelled" : "Draft"
                }
              />
              <InfoRow label="Customer ID" value={<span className="font-mono">{order.customer}</span>} />
            </div>
          </GlassCard>
        </div>

        {/* RIGHT column — Financial Summary */}
        <div className="space-y-5">
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Financial Summary
            </div>

            {/* Grand Total hero */}
            <div className="mb-5">
              <div className="ui-label text-[10px] mb-1">Grand Total</div>
              <div className="font-display italic text-3xl text-brass-shimmer tabular-nums">
                {formatUSD(order.grandTotal)}
              </div>
            </div>

            <div className="space-y-2 mb-5">
              {order.totalTaxes > 0 ? (
                <div className="flex justify-between items-center py-1">
                  <span className="text-cream-dim text-xs">
                    Taxes{order.taxesAndCharges ? ` (${order.taxesAndCharges})` : ""}
                  </span>
                  <span className="text-cream tabular-nums text-xs">{formatUSD(order.totalTaxes)}</span>
                </div>
              ) : null}

              <div className="flex justify-between items-center py-1 border-t border-brass/15">
                <span className="text-cream-dim text-xs">Deposit / Advance</span>
                <span className="text-emerald-400 tabular-nums text-xs font-medium">
                  − {formatUSD(order.advancePaid)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1.5 border-t border-brass/30">
                <span className="text-cream text-sm font-semibold">Balance Due</span>
                <span
                  className={cn(
                    "font-display italic text-xl tabular-nums",
                    balanceDue <= 0 ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  {formatUSD(Math.max(0, balanceDue))}
                </span>
              </div>
            </div>

            <div className="brass-divider my-4" />

            {/* Progress bars */}
            <div className="space-y-3">
              <ProgressBar value={order.perBilled} label="Billed" />
              <ProgressBar value={order.perDelivered} label="Delivered" />
            </div>

            {/* Billing / Delivery status pills */}
            <div className="mt-4 space-y-2">
              {order.billingStatus ? (
                <div className="flex justify-between items-center">
                  <span className="text-cream-dim text-xs">Billing</span>
                  <StatusPill status={order.billingStatus} />
                </div>
              ) : null}
              {order.deliveryStatus ? (
                <div className="flex justify-between items-center">
                  <span className="text-cream-dim text-xs">Delivery</span>
                  <StatusPill status={order.deliveryStatus} />
                </div>
              ) : null}
            </div>
          </GlassCard>

          {/* Quick actions */}
          <GlassCard className="p-4 space-y-2">
            <div className="ui-label text-[10px] mb-2">Actions</div>
            {emailAddress ? (
              <button
                onClick={emailCustomer}
                className="w-full flex items-center gap-2 text-xs border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <Send className="h-3.5 w-3.5" /> Email Customer
              </button>
            ) : null}
            <a
              href={erpOrderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2 text-xs border border-brass/30 rounded-lg px-3 py-2 text-brass-light hover:bg-brass/10 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in ERPNext
            </a>
          </GlassCard>
        </div>
      </div>
    </div>
  )
}
