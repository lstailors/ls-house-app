import { TrendingUp, Receipt, FileText, Wallet, Coins, BadgeDollarSign } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { useFinancials, useSalesOrders, useInvoices, useCustomOrders } from "@/lib/queries";
import { formatUSD } from "@/lib/format";

export default function Financials() {
  const { data: fin, isLoading } = useFinancials();
  const { data: salesOrders = [] } = useSalesOrders();
  const { data: invoices = [] } = useInvoices();
  const { data: customOrders = [] } = useCustomOrders();

  const margin =
    fin && fin.revenue > 0 ? Math.round((fin.grossProfit / fin.revenue) * 100) : 0;

  const tbdCount = customOrders.filter((o) => o.priceTbd).length;
  const paidInvoices = invoices.filter((i) => i.status === "paid").length;
  const outstandingInvoices = invoices.filter((i) => i.status === "sent").length;
  const avgOrderValue =
    salesOrders.length > 0
      ? salesOrders.reduce((s, o) => s + o.total, 0) / salesOrders.length
      : 0;

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="House · Financials"
        title={
          <>
            The <span className="text-brass-shimmer">books</span>, at a glance.
          </>
        }
        description="Revenue, deposits, COGS, gross profit — the numbers that pay the cutters."
      />

      {isLoading || !fin ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : (
        <>
          {/* Headline trio */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GlassCard variant="strong" className="p-6 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-brass/8 via-transparent to-transparent pointer-events-none" />
              <div className="relative">
                <div className="ui-label mb-2 flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3 text-brass-light" /> Revenue
                </div>
                <div className="font-display italic text-5xl text-brass-shimmer leading-none">
                  {formatUSD(fin.revenue, { compact: true })}
                </div>
                <div className="text-[11px] text-cream-dim mt-2">
                  Across {fin.salesOrderCount} sales orders
                </div>
              </div>
            </GlassCard>

            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-2 flex items-center gap-1.5">
                <Coins className="h-3 w-3 text-signal-emerald" /> Gross Profit
              </div>
              <div className="font-display italic text-5xl text-signal-emerald leading-none">
                {formatUSD(fin.grossProfit, { compact: true })}
              </div>
              <div className="text-[11px] text-cream-dim mt-2">
                Margin · <span className="text-cream-muted">{margin}%</span>
              </div>
            </GlassCard>

            <GlassCard variant="strong" className="p-6">
              <div className="ui-label mb-2 flex items-center gap-1.5">
                <Wallet className="h-3 w-3 text-signal-amber" /> Deposits Pending
              </div>
              <div className="font-display italic text-5xl text-signal-amber leading-none">
                {formatUSD(fin.depositsPendingTotal, { compact: true })}
              </div>
              <div className="text-[11px] text-cream-dim mt-2">
                {fin.depositsPendingCount} commission{fin.depositsPendingCount === 1 ? "" : "s"} awaiting
              </div>
            </GlassCard>
          </div>

          {/* Sub-KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Invoiced"
              value={formatUSD(fin.invoicesTotal, { compact: true })}
              hint={`${fin.invoiceCount} invoices`}
              icon={<FileText className="h-4 w-4" />}
            />
            <KpiCard
              label="COGS"
              value={formatUSD(fin.cogs, { compact: true })}
              hint="Materials + labor"
              icon={<Receipt className="h-4 w-4" />}
            />
            <KpiCard
              label="Avg Order"
              value={formatUSD(avgOrderValue, { compact: true })}
              hint="Per sales order"
              icon={<BadgeDollarSign className="h-4 w-4" />}
            />
            <KpiCard
              label="Open Quotes"
              value={tbdCount}
              hint="Awaiting master tailor"
              accent="amber"
              icon={<Coins className="h-4 w-4" />}
            />
          </div>

          {/* P&L style breakdown */}
          <GlassCard variant="strong" className="p-6">
            <div className="ui-label mb-4">Statement</div>
            <div className="space-y-1">
              <PnlRow label="Revenue" amount={fin.revenue} accent="brass" />
              <PnlRow label="Cost of Goods Sold" amount={-fin.cogs} muted />
              <div className="brass-divider my-2" />
              <PnlRow label="Gross Profit" amount={fin.grossProfit} accent="emerald" bold />
              <div className="brass-divider my-2" />
              <PnlRow label="Deposits Held (liability)" amount={fin.depositsPendingTotal} accent="amber" sub />
            </div>
            <div className="mt-5 pt-4 border-t border-brass/10 text-[11px] text-cream-dim italic leading-relaxed">
              A simplified house view. Authoritative numbers sync from ERPNext nightly — figures here are
              real-time approximations from the operations data.
            </div>
          </GlassCard>

          {/* Invoice activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <GlassCard className="p-5">
              <div className="ui-label mb-3">Invoice Activity</div>
              <div className="space-y-3">
                <ActivityLine label="Paid" value={paidInvoices} color="emerald" />
                <ActivityLine label="Outstanding" value={outstandingInvoices} color="amber" />
                <ActivityLine
                  label="Drafts"
                  value={invoices.filter((i) => i.status === "draft").length}
                  color="muted"
                />
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="ui-label mb-3">Commission Mix</div>
              <div className="space-y-3">
                <ActivityLine
                  label="In Production"
                  value={customOrders.filter((o) => o.status === "in_production").length}
                  color="brass"
                />
                <ActivityLine
                  label="Deposit Paid"
                  value={customOrders.filter((o) => o.status === "deposit_paid").length}
                  color="emerald"
                />
                <ActivityLine
                  label="Awaiting Quote"
                  value={tbdCount}
                  color="amber"
                />
              </div>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}

function PnlRow({
  label,
  amount,
  accent,
  muted,
  bold,
  sub,
}: {
  label: string;
  amount: number;
  accent?: "brass" | "emerald" | "amber";
  muted?: boolean;
  bold?: boolean;
  sub?: boolean;
}) {
  const accentClass =
    accent === "brass"
      ? "text-brass-shimmer"
      : accent === "emerald"
        ? "text-signal-emerald"
        : accent === "amber"
          ? "text-signal-amber"
          : "text-cream";

  return (
    <div className="flex items-center justify-between py-1.5">
      <span
        className={
          sub
            ? "text-[11px] text-cream-dim uppercase tracking-wider"
            : bold
              ? "text-cream font-medium"
              : "text-cream-muted text-sm"
        }
      >
        {label}
      </span>
      <span
        className={
          bold
            ? `font-display italic text-3xl ${accentClass}`
            : `tabular-nums text-base ${muted ? "text-cream-dim" : accentClass}`
        }
      >
        {formatUSD(amount)}
      </span>
    </div>
  );
}

function ActivityLine({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "emerald" | "amber" | "muted" | "brass";
}) {
  const dotClass =
    color === "emerald"
      ? "bg-signal-emerald"
      : color === "amber"
        ? "bg-signal-amber"
        : color === "brass"
          ? "bg-brass-light"
          : "bg-cream-dim/50";
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="text-sm text-cream-muted">{label}</span>
      </div>
      <span className="font-mono text-cream tabular-nums">{value}</span>
    </div>
  );
}
