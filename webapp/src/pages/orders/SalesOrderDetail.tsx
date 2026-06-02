import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
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
} from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { api } from "@/lib/api";
import { formatUSD, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SalesOrderDetail {
  name: string;
  customer: string;
  customerName: string;
  status: string;
  makeType: string | null;
  company: string;
  transactionDate: string;
  deliveryDate: string | null;
  contactPhone: string | null;
  contactMobile: string | null;
  contactEmail: string | null;
  addressDisplay: string | null;
  shippingAddress: string | null;
  total: number;
  grandTotal: number;
  advancePaid: number;
  totalTaxes: number;
  taxesAndCharges: string | null;
  billingStatus: string | null;
  deliveryStatus: string | null;
  perBilled: number;
  perDelivered: number;
  items: {
    name: string;
    item_code: string;
    item_name: string;
    description: string | null;
    qty: number;
    rate: number;
    amount: number;
    warehouse: string | null;
    deliveredQty: number;
    billedAmt: number;
  }[];
  invoices: {
    name: string;
    status: string;
    grand_total: number;
    outstanding_amount: number;
    posting_date: string;
    due_date: string | null;
  }[];
  customerMobile: string | null;
  customerEmail: string | null;
  customerGroup: string | null;
  creation: string;
  modified: string;
  docstatus: number;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 py-1.5 border-b border-brass/10 last:border-0">
      <span className="text-cream-dim text-xs shrink-0">{label}</span>
      <span className="text-cream text-xs text-right">{value ?? "—"}</span>
    </div>
  );
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
  );
}

export default function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: order, isLoading, isError } = useQuery<SalesOrderDetail>({
    queryKey: ["sales-order-detail", id],
    queryFn: () => api.get<SalesOrderDetail>(`/api/sales-orders/${id}`),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-cream-muted text-sm animate-pulse">Loading order…</div>
      </div>
    );
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
    );
  }

  const erpOrderUrl = `https://erp.lstailors.com/sales-order/${order.name}`;
  const balanceDue = order.grandTotal - order.advancePaid;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Back link */}
      <button
        onClick={() => navigate("/sales-orders")}
        className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> Back to orders
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="font-mono text-brass-shimmer text-2xl font-bold tracking-tight">
            {order.name}
          </div>
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
        <a
          href={erpOrderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs border border-brass/30 rounded-lg px-3 py-1.5 text-brass-light hover:bg-brass/10 transition-colors self-start"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open in ERPNext
        </a>
      </div>

      {/* QR Code */}
      <GlassCard variant="strong" className="p-6 flex flex-col items-center gap-3">
        <div className="p-3 bg-white rounded-xl">
          <QRCodeSVG value={erpOrderUrl} size={120} />
        </div>
        <div className="ui-label text-[10px] text-cream-dim text-center">
          Scan to open in ERPNext
        </div>
      </GlassCard>

      {/* Two-column info grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer */}
        <GlassCard variant="strong" className="p-6">
          <div className="ui-label mb-4 flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> Customer
          </div>
          <div className="space-y-0">
            <InfoRow label="Name" value={order.customerName} />
            {order.customerGroup ? (
              <InfoRow label="Group" value={order.customerGroup} />
            ) : null}
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
                    <span className="whitespace-pre-line">{order.addressDisplay.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}</span>
                  </span>
                }
              />
            ) : null}
          </div>
        </GlassCard>

        {/* Order details */}
        <GlassCard variant="strong" className="p-6">
          <div className="ui-label mb-4 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Order Details
          </div>
          <div className="space-y-0 mb-4">
            <InfoRow label="Order Date" value={formatDate(order.transactionDate)} />
            <InfoRow label="Delivery Date" value={order.deliveryDate ? formatDate(order.deliveryDate) : "—"} />
            <InfoRow label="Company" value={order.company} />
            {order.makeType ? <InfoRow label="Make Type" value={order.makeType} /> : null}
            {order.billingStatus ? <InfoRow label="Billing Status" value={<StatusPill status={order.billingStatus} />} /> : null}
            {order.deliveryStatus ? <InfoRow label="Delivery Status" value={<StatusPill status={order.deliveryStatus} />} /> : null}
          </div>
          <div className="space-y-3 mt-4">
            <ProgressBar value={order.perBilled} label="Billed" />
            <ProgressBar value={order.perDelivered} label="Delivered" />
          </div>
        </GlassCard>
      </div>

      {/* Financial Summary */}
      <GlassCard variant="strong" className="p-6">
        <div className="ui-label mb-4 flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5" /> Financial Summary
        </div>
        <div className="space-y-2 max-w-sm">
          <div className="flex justify-between items-center py-1.5">
            <span className="text-cream-dim text-sm">Subtotal</span>
            <span className="text-cream font-medium tabular-nums">{formatUSD(order.total)}</span>
          </div>
          {order.totalTaxes > 0 ? (
            <div className="flex justify-between items-center py-1.5">
              <span className="text-cream-dim text-sm">
                Taxes{order.taxesAndCharges ? ` (${order.taxesAndCharges})` : ""}
              </span>
              <span className="text-cream tabular-nums">{formatUSD(order.totalTaxes)}</span>
            </div>
          ) : null}
          <div className="flex justify-between items-center py-1.5 border-t border-brass/20">
            <span className="text-cream-dim text-sm font-medium">Grand Total</span>
            <span className="font-display italic text-brass-shimmer text-lg tabular-nums">
              {formatUSD(order.grandTotal)}
            </span>
          </div>
          <div className="flex justify-between items-center py-1.5">
            <span className="text-cream-dim text-sm">Advance Paid</span>
            <span className="text-emerald-400 tabular-nums">− {formatUSD(order.advancePaid)}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-t border-brass/30">
            <span className="text-cream text-sm font-semibold">Balance Due</span>
            <span className={cn(
              "font-display italic text-xl tabular-nums",
              balanceDue <= 0 ? "text-emerald-400" : "text-brass-shimmer"
            )}>
              {formatUSD(Math.max(0, balanceDue))}
            </span>
          </div>
        </div>
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
                  <th className="text-center ui-label text-[10px] pb-2">QR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brass/10">
                {order.items.map((item) => (
                  <tr key={item.name} className="group">
                    <td className="py-3 pr-4">
                      <div className="text-cream text-xs font-medium">{item.item_name}</div>
                      {item.description ? (
                        <div className="text-cream-dim text-[10px] mt-0.5 max-w-[200px] truncate">{item.description}</div>
                      ) : null}
                      <div className="text-brass/50 text-[10px] font-mono">{item.item_code}</div>
                    </td>
                    <td className="py-3 pr-4 text-center text-cream-dim tabular-nums text-xs">
                      {item.qty}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-cream-dim text-xs">
                      {formatUSD(item.rate)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-cream text-xs font-medium">
                      {formatUSD(item.amount)}
                    </td>
                    <td className="py-3 text-center">
                      <div className="inline-block p-1 bg-white rounded">
                        <QRCodeSVG
                          value={`https://erp.lstailors.com/item/${item.item_code}`}
                          size={32}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      ) : null}

      {/* Linked Invoices */}
      {order.invoices.length > 0 ? (
        <GlassCard className="p-6">
          <div className="ui-label mb-4 flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Linked Invoices
          </div>
          <div className="space-y-3">
            {order.invoices.map((inv) => (
              <div
                key={inv.name}
                className="flex items-center justify-between rounded-lg border border-brass/15 bg-brass/5 px-4 py-3 gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-1 bg-white rounded shrink-0">
                    <QRCodeSVG
                      value={`https://erp.lstailors.com/sales-invoice/${inv.name}`}
                      size={36}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-cream-dim">{inv.name}</div>
                    <div className="text-[10px] text-cream-dim mt-0.5">
                      {formatDate(inv.posting_date)}
                      {inv.due_date ? ` · Due ${formatDate(inv.due_date)}` : ""}
                    </div>
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
                  <a
                    href={`https://erp.lstailors.com/sales-invoice/${inv.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cream-dim hover:text-cream transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {/* Meta */}
      <GlassCard className="p-5">
        <div className="ui-label mb-3 text-[10px]">
          <FileText className="h-3 w-3 inline mr-1" />Record Info
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0">
          <InfoRow label="Created" value={formatDate(order.creation)} />
          <InfoRow label="Modified" value={formatDate(order.modified)} />
          <InfoRow label="Doc Status" value={order.docstatus === 1 ? "Submitted" : order.docstatus === 2 ? "Cancelled" : "Draft"} />
          <InfoRow label="Customer ID" value={<span className="font-mono">{order.customer}</span>} />
        </div>
      </GlassCard>
    </div>
  );
}
