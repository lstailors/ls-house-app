import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { ChargeTerminalButton } from "@alts/components/payments/ChargeTerminalButton";
import { ChargeCardOnFileButton } from "@alts/components/payments/ChargeCardOnFileButton";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";

type Item = {
  itemCode?: string | null;
  itemName: string;
  description?: string | null;
  qty: number;
  rate: number;
  amount: number;
};

type Invoice = {
  id: string;
  erpnextId: string;
  customer?: { id: string; name: string } | null;
  customerName?: string | null;
  status: string;
  kind?: string;
  type?: string;
  grandTotal: number;
  total: number;
  outstandingAmount: number;
  paidAmount?: number;
  postingDate?: string | null;
  dueDate?: string | null;
  alterationTicketRef?: string | null;
  salesOrder?: string | null;
  remarks?: string | null;
  contactMobile?: string | null;
  contactEmail?: string | null;
  squarePaymentLink?: string | null;
  items: Item[];
  netTotal?: number;
  totalTaxes?: number;
  discountAmount?: number;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();

  const invQ = useQuery({
    queryKey: ["alts-invoice", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.raw(`/api/invoices/${encodeURIComponent(id!)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `Load failed (${res.status})`);
      return (json?.data ?? json) as Invoice;
    },
    staleTime: 15_000,
  });

  const inv = invQ.data;
  const outstanding = Number(inv?.outstandingAmount ?? 0);
  const canCharge = outstanding > 0.005;
  const cents = Math.round(outstanding * 100);
  const customerId = inv?.customer?.id ?? null;
  const kind = inv?.kind ?? (inv?.alterationTicketRef ? "alteration" : "custom");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["alts-invoice", id] });
    void qc.invalidateQueries({ queryKey: ["alts-invoices"] });
  };

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20 shrink-0">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="text-brass-light text-sm font-bold tracking-widest uppercase"
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-brass-shimmer text-lg truncate">{inv?.id ?? "…"}</div>
          <div className="text-xs text-cream-dim truncate">
            {inv?.customerName ?? inv?.customer?.name ?? "Invoice"}
          </div>
        </div>
        <Link to="/invoices" className="text-[10px] uppercase tracking-widest text-cream-dim">
          All
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 pb-28 space-y-4">
        {invQ.isError ? (
          <QueryErrorPanel
            title="Invoice not found"
            message={(invQ.error as Error)?.message}
            onRetry={() => invQ.refetch()}
          />
        ) : invQ.isLoading || !inv ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-28 rounded-xl bg-brass/5 border border-brass/10" />
            <div className="h-40 rounded-xl bg-brass/5 border border-brass/10" />
          </div>
        ) : (
          <>
            {/* Balance hero */}
            <div
              className={cn(
                "rounded-2xl border p-5",
                canCharge
                  ? "border-signal-rose/25 bg-signal-rose/5"
                  : "border-signal-green/25 bg-signal-green/5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="ui-label text-[10px] text-cream-muted mb-1">
                    {canCharge ? "Amount due" : "Paid in full"}
                  </p>
                  <p
                    className={cn(
                      "font-display italic text-4xl leading-none",
                      canCharge ? "text-signal-rose" : "text-signal-green",
                    )}
                  >
                    {money(canCharge ? outstanding : inv.grandTotal)}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-brass/25 text-cream-dim">
                      {inv.status.replace(/_/g, " ")}
                    </span>
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border",
                        kind === "alteration"
                          ? "border-emerald-500/30 text-emerald-400"
                          : "border-brass/30 text-brass-light",
                      )}
                    >
                      {kind === "alteration" ? "Alteration" : "Custom made"}
                    </span>
                  </div>
                </div>
                <div className="text-right text-[11px] text-cream-dim">
                  <div>Total {money(inv.grandTotal)}</div>
                  {inv.postingDate && (
                    <div className="mt-1">
                      {new Date(inv.postingDate + "T12:00:00").toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>

              {inv.alterationTicketRef && (
                <Link
                  to={`/orders/alterations/${encodeURIComponent(inv.alterationTicketRef)}`}
                  className="inline-block mt-3 text-[11px] text-brass-light font-bold uppercase tracking-widest"
                >
                  Open ticket {inv.alterationTicketRef} →
                </Link>
              )}
              {inv.salesOrder && !inv.alterationTicketRef && (
                <p className="mt-3 text-[11px] text-cream-dim font-mono">SO {inv.salesOrder}</p>
              )}
            </div>

            {/* Charge actions */}
            {canCharge && (
              <div className="rounded-2xl border border-brass/20 bg-black/30 p-4 space-y-3">
                <p className="ui-label text-[10px] text-brass-light tracking-wider">Collect payment</p>
                <div className="flex flex-col gap-2">
                  <ChargeTerminalButton
                    invoiceId={inv.id}
                    amountCents={cents}
                    amountDisplay={money(outstanding)}
                    ticketId={inv.alterationTicketRef ?? undefined}
                    onSuccess={() => {
                      toast.success("Terminal paid — refreshing");
                      refresh();
                    }}
                    onError={(msg) => toast.error(msg)}
                  />
                  {customerId && (
                    <ChargeCardOnFileButton
                      invoiceId={inv.id}
                      amountDollars={outstanding}
                      amountDisplay={money(outstanding)}
                      customerLabel={inv.customerName ?? inv.customer?.name ?? undefined}
                      fullWidth
                      onSuccess={() => {
                        toast.success("Card charged — refreshing");
                        refresh();
                      }}
                      onError={(msg) => toast.error(msg)}
                    />
                  )}
                  <a
                    href={`https://pay.lstailors.com/${encodeURIComponent(inv.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="h-12 inline-flex items-center justify-center rounded-xl border border-brass/30 text-brass-light text-xs font-bold uppercase tracking-widest"
                  >
                    Open pay link
                  </a>
                </div>
                <p className="text-[10px] text-cream-dim">
                  Use terminal at the counter, card on file, or send the pay link.
                </p>
              </div>
            )}

            {/* Lines */}
            <div className="rounded-2xl border border-brass/15 overflow-hidden">
              <div className="px-4 py-3 border-b border-brass/10 ui-label text-[10px] text-brass-light">
                Line items
              </div>
              {(inv.items ?? []).length === 0 ? (
                <p className="px-4 py-6 text-sm text-cream-dim text-center">No lines on this invoice.</p>
              ) : (
                <div className="divide-y divide-brass/8">
                  {inv.items.map((it, i) => (
                    <div key={i} className="px-4 py-3 flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-cream text-sm">{it.itemName}</p>
                        {it.description && (
                          <p className="text-[10px] text-cream-dim mt-0.5 line-clamp-2">
                            {String(it.description).replace(/<[^>]+>/g, " ").trim()}
                          </p>
                        )}
                        <p className="text-[10px] text-cream-dim mt-0.5">
                          {it.qty} × {money(it.rate)}
                        </p>
                      </div>
                      <p className="font-display italic text-brass-shimmer shrink-0">{money(it.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-4 py-3 border-t border-brass/15 space-y-1 text-xs">
                {!!inv.totalTaxes && (
                  <div className="flex justify-between text-cream-dim">
                    <span>Tax</span>
                    <span>{money(inv.totalTaxes)}</span>
                  </div>
                )}
                <div className="flex justify-between text-cream">
                  <span>Grand total</span>
                  <span className="font-display italic text-brass-shimmer">{money(inv.grandTotal)}</span>
                </div>
                {canCharge && (
                  <div className="flex justify-between text-signal-rose">
                    <span>Outstanding</span>
                    <span className="font-display italic">{money(outstanding)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="rounded-2xl border border-brass/15 p-4 text-xs text-cream-dim space-y-1.5">
              {inv.contactMobile && <div>Phone {inv.contactMobile}</div>}
              {inv.contactEmail && <div>Email {inv.contactEmail}</div>}
              {inv.dueDate && (
                <div>Due {new Date(inv.dueDate + "T12:00:00").toLocaleDateString()}</div>
              )}
              {customerId && (
                <Link
                  to={`/customers/${encodeURIComponent(customerId)}`}
                  className="inline-block text-brass-light font-bold uppercase tracking-widest text-[10px] mt-2"
                >
                  Client profile →
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
