import { useEffect, useRef } from "react";
import { Printer, X, Sparkles, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@ls/design/ui/dialog";
import { Button } from "@ls/design/ui/button";
import { formatUSD, formatDateTime } from "@ls/design/format";
import { Monogram } from "@ls/design";
import { GARMENT_LABEL, type PriceBreakdown } from "@/lib/pricing";
import type { CustomOrder } from "@ls/types";
import type { DepositReceipt as ReceiptT } from "@/lib/queries";

interface Props {
  open: boolean;
  order: CustomOrder | undefined;
  receipt: ReceiptT | undefined;
  breakdown: PriceBreakdown;
  customerName: string;
  customerPhone: string;
  locationName: string;
  salespersonName: string;
  onClose: () => void;
  onNewOrder: () => void;
}

export function DepositReceipt({
  open,
  order,
  receipt,
  breakdown,
  customerName,
  customerPhone,
  locationName,
  salespersonName,
  onClose,
  onNewOrder,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        window.print();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!order || !receipt) return null;

  const remaining = order.quotedPrice - order.depositAmount;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-forest-raised/95 border-brass/30 text-cream sm:max-w-md p-0 overflow-hidden print:bg-white print:text-black print:max-w-full print:border-0">
        <DialogTitle className="sr-only">Deposit Receipt</DialogTitle>
        <DialogDescription className="sr-only">
          Receipt for deposit on custom order {order.id}.
        </DialogDescription>

        <div ref={ref} id="deposit-receipt" className="px-7 py-7 print:px-12 print:py-10">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-5">
            <Monogram size="md" />
            <div className="font-display italic text-2xl mt-2 print:text-black">L&amp;S House</div>
            <div className="ui-label text-[10px] mt-0.5 print:text-gray-600">
              Bespoke Tailors · {locationName}
            </div>
            <div className="ui-label text-[10px] text-cream-dim mt-0.5 print:text-gray-500">
              app.lstailors.com
            </div>
          </div>

          <div className="brass-divider print:bg-black/20" />

          {/* Meta */}
          <div className="grid grid-cols-2 gap-y-1 text-xs mt-4 mb-4">
            <Meta k="Order #" v={order.id.slice(-8).toUpperCase()} />
            <Meta k="Date" v={formatDateTime(receipt.timestamp)} />
            <Meta k="Customer" v={customerName} />
            <Meta k="Phone" v={customerPhone} />
            <Meta k="Salesperson" v={salespersonName} />
            <Meta k="Garment" v={GARMENT_LABEL[order.garmentType]} />
          </div>

          <div className="brass-divider print:bg-black/20" />

          {/* Lines */}
          <div className="mt-4 space-y-1 text-sm">
            <ReceiptLine
              label={breakdown.fabric ? breakdown.fabric.fabricName : "Fabric"}
              sub={breakdown.fabric?.mill ?? ""}
              value={breakdown.fabricCost}
            />
            <ReceiptLine
              label={breakdown.laborLabel}
              sub="House workmanship"
              value={breakdown.laborCost}
            />
            {breakdown.upcharges.map((u) => (
              <ReceiptLine key={u.label} label={u.label} sub="Style upcharge" value={u.amount} />
            ))}
          </div>

          <div className="brass-divider mt-3 print:bg-black/20" />

          {/* Totals */}
          <div className="mt-3 space-y-1 text-sm">
            <TotalLine label="Order total" value={order.quotedPrice} />
            <TotalLine label="Deposit paid" value={order.depositAmount} accent />
            <TotalLine label="Balance due at pickup" value={remaining} muted />
          </div>

          {/* Payment box */}
          <div className="mt-4 rounded-md border border-brass/30 bg-brass/5 px-3 py-2.5 print:border-black print:bg-transparent">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widerer text-cream-dim print:text-gray-600 mb-1">
              <span>Payment</span>
              <span>{receipt.provider}</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-cream print:text-black">Visa ••• {receipt.last4}</div>
                <div className="text-[10px] text-cream-dim print:text-gray-500 font-mono">
                  {receipt.transactionId}
                </div>
              </div>
              <div className="font-display italic text-xl text-brass-shimmer print:text-black">
                {formatUSD(receipt.amount)}
              </div>
            </div>
            <div className="text-[10px] text-signal-emerald mt-1 print:text-black/70">
              ✓ Approved
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-5 text-[10px] text-cream-dim print:text-gray-600 leading-relaxed">
            <Sparkles className="inline h-3 w-3 mr-0.5 -mt-0.5 print:hidden" />
            Thank you for your patronage. First fitting scheduled in 3–4 weeks.
            <div className="mt-1 font-mono text-[9px]">RETAIN FOR YOUR RECORDS</div>
          </div>
        </div>

        {/* Actions (hidden when printing) */}
        <div className="px-6 pb-6 flex gap-2 print:hidden">
          <Button
            variant="outline"
            className="flex-1 border-brass/20 text-cream-muted hover:bg-brass/10"
            onClick={onClose}
          >
            <X className="h-4 w-4 mr-1.5" /> Close
          </Button>
          <Button
            variant="outline"
            className="border-brass/40 text-brass-light hover:bg-brass/15"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
          <Button className="btn-brass flex-1" onClick={onNewOrder}>
            New <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div className="text-cream-dim print:text-gray-600">{k}</div>
      <div className="text-cream text-right truncate print:text-black">{v}</div>
    </>
  );
}

function ReceiptLine({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-cream truncate print:text-black">{label}</div>
        <div className="text-[10px] text-cream-dim truncate print:text-gray-500">{sub}</div>
      </div>
      <div className="tabular-nums text-cream-muted shrink-0 print:text-black">
        {formatUSD(value)}
      </div>
    </div>
  );
}

function TotalLine({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={
          accent
            ? "text-brass-light font-medium print:text-black"
            : muted
              ? "text-cream-muted text-xs print:text-gray-600"
              : "text-cream print:text-black"
        }
      >
        {label}
      </span>
      <span
        className={
          accent
            ? "font-display italic text-lg text-brass-shimmer print:text-black"
            : muted
              ? "text-xs text-cream-muted print:text-gray-600"
              : "text-cream font-medium print:text-black"
        }
      >
        {formatUSD(value)}
      </span>
    </div>
  );
}
