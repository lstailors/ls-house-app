import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ExternalLink,
  DollarSign,
  Package,
  CreditCard,
  User,
  Calendar,
  FileText,
  Scissors,
  Save,
  Terminal,
  Link2,
  Check,
} from "lucide-react";
import { ChargeTerminalButton } from "@/components/payments/ChargeTerminalButton";
import { ChargeCardOnFileButton } from "@/components/payments/ChargeCardOnFileButton";
import { api } from "@ls/api-client";
import { GlassCard } from "@ls/design";
import { StatusPill } from "@ls/design";
import { formatUSD, formatDate } from "@ls/design/format";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";

interface InvoiceItem {
  itemCode: string | null;
  itemName: string;
  description: string | null;
  qty: number;
  rate: number;
  amount: number;
  uom: string | null;
}

interface InvoiceTax {
  description: string;
  rate: number;
  taxAmount: number;
}

interface InvoicePayment {
  modeOfPayment: string;
  amount: number;
  referenceNo: string | null;
  referenceDate: string | null;
}

interface InvoiceDetail {
  id: string;
  erpnextId: string;
  customer: { name: string } | null;
  customerName: string | null;
  status: string;
  type: string;
  total: number;
  netTotal: number;
  grandTotal: number;
  totalTaxes: number;
  discountAmount: number;
  additionalDiscountPct: number;
  outstandingAmount: number;
  paidAmount: number;
  writeOffAmount: number;
  postingDate: string | null;
  dueDate: string | null;
  remarks: string | null;
  alterationTicketRef: string | null;
  billingAddress: string | null;
  contactEmail: string | null;
  contactMobile: string | null;
  paymentTerms: string | null;
  items: InvoiceItem[];
  taxes: InvoiceTax[];
  payments: InvoicePayment[];
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editRemarks, setEditRemarks] = useState<string>("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [editDueDate, setEditDueDate] = useState<string>("");

  const {
    data: invoice,
    isLoading,
    isError,
  } = useQuery<InvoiceDetail>({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDetail>(`/api/invoices/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (invoice) {
      setEditRemarks(invoice.remarks ?? "");
      setEditDueDate(invoice.dueDate ?? "");
    }
  }, [invoice]);

  const isDirty =
    invoice &&
    (editRemarks !== (invoice.remarks ?? "") ||
      editDueDate !== (invoice.dueDate ?? ""));

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<InvoiceDetail>(`/api/invoices/${id}`, {
        remarks: editRemarks,
        due_date: editDueDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      toast.success("Invoice updated");
    },
    onError: () => toast.error("Failed to save changes"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-5 w-5 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="space-y-4 animate-fade-up p-6">
        <div className="text-cream-muted text-sm">Invoice not found.</div>
        <button
          onClick={() => navigate("/invoices")}
          className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> Back to invoices
        </button>
      </div>
    );
  }

  const erpInvoiceUrl = `https://erp.lstailors.com/sales-invoice/${invoice.erpnextId}`;
  const displayName = invoice.customerName ?? invoice.customer?.name ?? "—";
  const isAlteration = invoice.type?.toLowerCase().includes("alteration");

  return (
    <div className="space-y-6 animate-fade-up pb-12">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => navigate("/invoices")}
          className="inline-flex items-center gap-1.5 text-xs text-cream-dim hover:text-cream transition-colors self-start"
        >
          <ArrowLeft className="h-3 w-3" /> Back to invoices
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="font-mono text-brass-shimmer text-2xl font-bold tracking-tight">
              {invoice.erpnextId ?? `#${invoice.id.slice(-6).toUpperCase()}`}
            </div>
            <div className="text-cream text-base mt-0.5">{displayName}</div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusPill status={invoice.status} />
              {invoice.type ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide border uppercase",
                    isAlteration
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-brass/20 text-brass-light border-brass/30",
                  )}
                >
                  {isAlteration ? (
                    <Scissors className="h-2.5 w-2.5" />
                  ) : (
                    <DollarSign className="h-2.5 w-2.5" />
                  )}
                  {invoice.type}
                </span>
              ) : null}
              {invoice.alterationTicketRef ? (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono text-cream-dim bg-white/5 border border-white/10">
                  {invoice.alterationTicketRef}
                </span>
              ) : null}
            </div>
          </div>

          <a
            href={erpInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs border border-brass/20 rounded-lg px-3 py-1.5 text-cream-muted hover:bg-brass/10 hover:text-brass-light transition-colors self-start"
          >
            <ExternalLink className="h-3.5 w-3.5" /> ERPNext
          </a>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        {/* ════ LEFT column ════ */}
        <div className="space-y-6">
          {/* 1. Line Items */}
          <GlassCard variant="strong" className="p-5">
            <div className="ui-label mb-3 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Line Items
            </div>
            {invoice.items.length > 0 ? (
              <div className="w-full overflow-x-auto -mx-1 px-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-brass/10">
                      <th className="text-left text-cream-dim font-normal pb-2 pr-3">Item</th>
                      <th className="text-right text-cream-dim font-normal pb-2 px-2 whitespace-nowrap">Qty</th>
                      <th className="text-right text-cream-dim font-normal pb-2 px-2 whitespace-nowrap">Rate</th>
                      <th className="text-right text-cream-dim font-normal pb-2 pl-2 whitespace-nowrap">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item, i) => (
                      <tr
                        key={i}
                        className="border-b border-brass/5 last:border-0 align-top"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="text-cream font-medium leading-snug">
                            {item.itemName}
                          </div>
                          {item.description ? (
                            <div className="text-cream-dim text-[10px] mt-0.5 leading-relaxed">
                              {item.description}
                            </div>
                          ) : null}
                          {item.itemCode ? (
                            <div className="text-cream-dim/50 font-mono text-[9px] mt-0.5">
                              {item.itemCode}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-cream whitespace-nowrap align-middle">
                          {item.qty}
                          {item.uom ? (
                            <span className="text-cream-dim ml-0.5">{item.uom}</span>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-cream whitespace-nowrap align-middle">
                          {formatUSD(item.rate)}
                        </td>
                        <td className="py-2.5 pl-2 text-right font-mono tabular-nums text-cream font-medium whitespace-nowrap align-middle">
                          {formatUSD(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-brass/20">
                      <td colSpan={3} className="pt-2.5 text-cream-dim">
                        Subtotal
                      </td>
                      <td className="pt-2.5 text-right font-mono tabular-nums text-cream font-medium">
                        {formatUSD(invoice.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-cream-dim text-sm italic">No line items</p>
            )}
          </GlassCard>

          {/* 2. Financial Breakdown */}
          <GlassCard variant="strong" className="p-5">
            <div className="ui-label mb-3 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Financial Breakdown
            </div>

            <div className="space-y-0">
              {/* Subtotal */}
              <div className="flex justify-between items-center py-1.5 border-b border-brass/5">
                <span className="text-cream-dim text-xs">Subtotal</span>
                <span className="font-mono tabular-nums text-xs text-cream">
                  {formatUSD(invoice.total)}
                </span>
              </div>

              {/* Discount (fixed) */}
              {invoice.discountAmount > 0 ? (
                <div className="flex justify-between items-center py-1.5 border-b border-brass/5">
                  <span className="text-cream-dim text-xs">Discount</span>
                  <span className="font-mono tabular-nums text-xs text-rose-400">
                    -{formatUSD(invoice.discountAmount)}
                  </span>
                </div>
              ) : null}

              {/* Discount (percent) */}
              {invoice.additionalDiscountPct > 0 ? (
                <div className="flex justify-between items-center py-1.5 border-b border-brass/5">
                  <span className="text-cream-dim text-xs">
                    Discount ({invoice.additionalDiscountPct}%)
                  </span>
                  <span className="font-mono tabular-nums text-xs text-rose-400">
                    -{formatUSD(invoice.total * (invoice.additionalDiscountPct / 100))}
                  </span>
                </div>
              ) : null}

              {/* Taxes */}
              {invoice.taxes.map((tax, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center py-1.5 border-b border-brass/5"
                >
                  <span className="text-cream-dim text-xs">
                    {tax.description}
                    {tax.rate > 0 ? (
                      <span className="ml-1 text-cream-dim/50">({tax.rate}%)</span>
                    ) : null}
                  </span>
                  <span className="font-mono tabular-nums text-xs text-cream">
                    {formatUSD(tax.taxAmount)}
                  </span>
                </div>
              ))}

              {/* Divider + Grand Total */}
              <div className="border-t border-brass/20 mt-1 pt-3 pb-1">
                <div className="flex justify-between items-baseline">
                  <span className="text-cream text-base sm:text-sm font-medium">Grand Total</span>
                  <span className="font-display italic text-2xl text-brass-shimmer tabular-nums">
                    {formatUSD(invoice.grandTotal)}
                  </span>
                </div>
              </div>

              {/* Paid */}
              <div className="flex justify-between items-center py-1.5 border-b border-brass/5">
                <span className="text-cream-dim text-xs">Paid</span>
                <span className="font-mono tabular-nums text-xs text-emerald-400 font-medium">
                  {formatUSD(invoice.paidAmount ?? 0)}
                </span>
              </div>

              {/* Write-off */}
              {(invoice.writeOffAmount ?? 0) > 0 ? (
                <div className="flex justify-between items-center py-1.5 border-b border-brass/5">
                  <span className="text-cream-dim text-xs">Write-off</span>
                  <span className="font-mono tabular-nums text-xs text-cream-dim">
                    {formatUSD(invoice.writeOffAmount)}
                  </span>
                </div>
              ) : null}

              {/* Outstanding */}
              <div className="flex justify-between items-baseline pt-2.5 border-t border-brass/20 mt-1">
                <span className="text-cream text-base sm:text-sm font-semibold">Outstanding</span>
                <span
                  className={cn(
                    "font-display italic text-xl tabular-nums",
                    (invoice.outstandingAmount ?? 0) <= 0
                      ? "text-emerald-400"
                      : "text-signal-amber",
                  )}
                >
                  {formatUSD(invoice.outstandingAmount ?? 0)}
                </span>
              </div>

              {/* Square payment actions */}
              {(invoice.outstandingAmount ?? 0) > 0 ? (
                <div className="pt-3 flex gap-2 flex-wrap">
                  <ChargeTerminalButton
                    invoiceId={invoice.erpnextId}
                    amountCents={Math.round((invoice.outstandingAmount ?? 0) * 100)}
                    amountDisplay={formatUSD(invoice.outstandingAmount ?? 0)}
                    onSuccess={() => qc.invalidateQueries({ queryKey: ["invoice", id] })}
                    onError={(msg) => toast.error(msg)}
                  />
                  <ChargeCardOnFileButton
                    invoiceId={invoice.erpnextId}
                    amountDisplay={formatUSD(invoice.outstandingAmount ?? 0)}
                    customerLabel={invoice.customerName ?? undefined}
                    onSuccess={() => {
                      toast.success("Card on file charged — refreshing…");
                      qc.invalidateQueries({ queryKey: ["invoice", id] });
                    }}
                    onError={(msg) => toast.error(msg)}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/pay/${invoice.erpnextId}`);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brass/30 bg-brass/5 hover:bg-brass/10 text-xs text-brass-light transition-colors"
                  >
                    {linkCopied ? <Check className="h-3.5 w-3.5 text-signal-emerald" /> : <Link2 className="h-3.5 w-3.5" />}
                    {linkCopied ? "Copied!" : "Copy Pay Link"}
                  </button>
                </div>
              ) : null}
            </div>
          </GlassCard>

          {/* 3. Payment History */}
          {invoice.payments.length > 0 ? (
            <GlassCard variant="strong" className="p-5">
              <div className="ui-label mb-3 flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> Payment History
              </div>
              <div className="space-y-0">
                {invoice.payments.map((pmt, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 py-2.5 border-b border-brass/5 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="text-cream text-xs font-medium">
                        {pmt.modeOfPayment}
                      </div>
                      {pmt.referenceNo ? (
                        <div className="text-cream-dim font-mono text-[10px] mt-0.5">
                          Ref: {pmt.referenceNo}
                        </div>
                      ) : null}
                      {pmt.referenceDate ? (
                        <div className="text-cream-dim text-[10px] mt-0.5">
                          {formatDate(pmt.referenceDate)}
                        </div>
                      ) : null}
                    </div>
                    <span className="font-mono tabular-nums text-xs text-emerald-400 font-medium whitespace-nowrap pt-0.5">
                      {formatUSD(pmt.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          ) : null}
        </div>

        {/* ════ RIGHT column (sidebar) ════ */}
        <div className="space-y-5">
          {/* 1. Customer */}
          <GlassCard variant="strong" className="p-5">
            <div className="ui-label mb-3 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Customer
            </div>
            <div className="space-y-2">
              <div className="text-cream text-base sm:text-sm font-semibold leading-snug">
                {displayName}
              </div>
              {invoice.billingAddress ? (
                <pre className="text-cream-dim text-[11px] whitespace-pre-wrap font-sans leading-relaxed">
                  {invoice.billingAddress}
                </pre>
              ) : null}
              {invoice.contactEmail ? (
                <div className="text-cream-dim text-[11px]">
                  {invoice.contactEmail}
                </div>
              ) : null}
              {invoice.contactMobile ? (
                <div className="text-cream-dim text-[11px]">
                  {invoice.contactMobile}
                </div>
              ) : null}
            </div>
          </GlassCard>

          {/* 2. Details (editable) */}
          <GlassCard variant="strong" className="p-5">
            <div className="ui-label mb-3 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Details
            </div>

            <div className="space-y-3">
              {/* Posting Date — read-only */}
              <div>
                <div className="text-cream-dim text-[10px] mb-1 font-medium uppercase tracking-wider">
                  Posting Date
                </div>
                <div className="text-cream text-base sm:text-sm">
                  {invoice.postingDate ? (
                    formatDate(invoice.postingDate)
                  ) : (
                    <span className="text-cream-dim italic text-xs">—</span>
                  )}
                </div>
              </div>

              {/* Due Date — editable */}
              <div>
                <div className="text-cream-dim text-[10px] mb-1 font-medium uppercase tracking-wider">
                  Due Date
                </div>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="w-full bg-transparent border border-brass/20 rounded-lg px-3 py-2 text-cream text-base sm:text-sm focus:outline-none focus:border-brass/50 transition-colors"
                />
              </div>

              {/* Payment Terms — read-only */}
              {invoice.paymentTerms ? (
                <div>
                  <div className="text-cream-dim text-[10px] mb-1 font-medium uppercase tracking-wider">
                    Payment Terms
                  </div>
                  <div className="text-cream text-xs">{invoice.paymentTerms}</div>
                </div>
              ) : null}

              {/* Save Changes */}
              {isDirty ? (
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 bg-brass/20 hover:bg-brass/30 border border-brass/40 text-brass-light text-sm font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50 disabled:pointer-events-none mt-1"
                >
                  {saveMutation.isPending ? (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {saveMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
              ) : null}
            </div>
          </GlassCard>

          {/* 3. Remarks — editable */}
          <GlassCard variant="strong" className="p-5">
            <div className="ui-label mb-3 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Notes
            </div>
            <textarea
              value={editRemarks}
              onChange={(e) => setEditRemarks(e.target.value)}
              placeholder="Add notes or remarks…"
              className="w-full bg-transparent border border-brass/20 rounded-lg px-3 py-2 text-cream text-base sm:text-sm focus:outline-none focus:border-brass/50 transition-colors resize-none h-24 placeholder:text-cream-dim/40"
            />
          </GlassCard>

          {/* 4. Actions */}
          <GlassCard className="p-4">
            <div className="text-cream-dim text-[10px] font-medium uppercase tracking-wider mb-2">
              Actions
            </div>
            <a
              href={erpInvoiceUrl}
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
  );
}
