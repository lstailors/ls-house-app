import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, DollarSign, Calendar, FileText, User } from "lucide-react";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { formatUSD, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InvoiceDetail {
  id: string;
  erpnextId: string;
  customer: { name: string } | null;
  status: string;
  total: number;
  grandTotal: number;
  outstandingAmount: number;
  paidAmount: number;
  postingDate: string | null;
  dueDate: string | null;
  remarks: string | null;
  type: string;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 py-1.5 border-b border-brass/10 last:border-0">
      <span className="text-cream-dim text-xs shrink-0">{label}</span>
      <span className="text-cream text-xs text-right">{value ?? "—"}</span>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    data: invoice,
    isLoading,
    isError,
  } = useQuery<InvoiceDetail>({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDetail>(`/api/invoices/${id}`),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-cream-muted text-sm animate-pulse">Loading invoice…</div>
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="space-y-4 animate-fade-up">
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
  const isOverdue =
    invoice.dueDate &&
    new Date(invoice.dueDate) < new Date() &&
    (invoice.outstandingAmount ?? 0) > 0;

  return (
    <div className="space-y-6 animate-fade-up pb-10">
      {/* Back + Header */}
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
            <div className="text-cream text-base mt-0.5">
              {invoice.customer?.name ?? "—"}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusPill status={invoice.status} />
              {invoice.type ? (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-brass/20 text-brass-light border border-brass/30 uppercase">
                  {invoice.type}
                </span>
              ) : null}
            </div>
          </div>

          <a
            href={erpInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs border border-brass/20 rounded-lg px-3 py-1.5 text-cream-muted hover:bg-brass/10 transition-colors self-start"
          >
            <ExternalLink className="h-3.5 w-3.5" /> ERPNext
          </a>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* LEFT — Details */}
        <div className="space-y-6">
          {/* Customer */}
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Customer
            </div>
            <InfoRow label="Name" value={invoice.customer?.name ?? "—"} />
          </GlassCard>

          {/* Dates */}
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Dates
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="ui-label text-[10px] mb-1">Posting Date</div>
                <div className="text-cream text-sm">
                  {invoice.postingDate ? (
                    formatDate(invoice.postingDate)
                  ) : (
                    <span className="text-cream-dim italic">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="ui-label text-[10px] mb-1">Due Date</div>
                <div
                  className={cn(
                    "text-sm",
                    isOverdue ? "text-rose-400 font-medium" : "text-cream",
                  )}
                >
                  {invoice.dueDate ? (
                    formatDate(invoice.dueDate)
                  ) : (
                    <span className="text-cream-dim italic">—</span>
                  )}
                  {isOverdue ? (
                    <span className="ml-1.5 text-[10px] text-rose-400/70">overdue</span>
                  ) : null}
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Remarks */}
          {invoice.remarks ? (
            <GlassCard className="p-6">
              <div className="ui-label mb-3 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Remarks
              </div>
              <p className="text-cream-dim text-sm leading-relaxed">{invoice.remarks}</p>
            </GlassCard>
          ) : null}
        </div>

        {/* RIGHT — Financial Summary */}
        <div className="space-y-5">
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Financial Summary
            </div>

            {/* Grand Total hero */}
            <div className="mb-5">
              <div className="ui-label text-[10px] mb-1">Grand Total</div>
              <div className="font-display italic text-3xl text-brass-shimmer tabular-nums">
                {formatUSD(invoice.grandTotal ?? invoice.total)}
              </div>
            </div>

            <div className="space-y-0 mb-2">
              {invoice.total !== invoice.grandTotal ? (
                <div className="flex justify-between items-center py-1.5 border-b border-brass/10">
                  <span className="text-cream-dim text-xs">Subtotal</span>
                  <span className="text-cream tabular-nums text-xs">{formatUSD(invoice.total)}</span>
                </div>
              ) : null}

              <div className="flex justify-between items-center py-1.5 border-b border-brass/10">
                <span className="text-cream-dim text-xs">Paid</span>
                <span className="text-emerald-400 tabular-nums text-xs font-medium">
                  {formatUSD(invoice.paidAmount ?? 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-t border-brass/30 mt-1">
                <span className="text-cream text-sm font-semibold">Outstanding</span>
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
            </div>
          </GlassCard>

          {/* Quick actions */}
          <GlassCard className="p-4">
            <div className="ui-label text-[10px] mb-2">Actions</div>
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
