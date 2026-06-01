import { Sparkles, FileText, CreditCard, CheckCircle } from "lucide-react";
import type { PriceBreakdown } from "@/lib/pricing";
import { formatUSD } from "@/lib/format";
import { GlassCard } from "@/components/glass/GlassCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  breakdown: PriceBreakdown;
  priceTbd: boolean;
  onTbdChange: (v: boolean) => void;
  depositAmount: number;
  onDepositChange: (v: number) => void;
  manualPrice: number;
  onManualPriceChange: (v: number) => void;
  canSubmit: boolean;
  onChargeDeposit: () => void;
  onChargeFullPayment: () => void;
  onSaveQuote: () => void;
  isSubmitting?: boolean;
}

export function PriceCard({
  breakdown,
  priceTbd,
  onTbdChange,
  depositAmount,
  onDepositChange,
  manualPrice,
  onManualPriceChange,
  canSubmit,
  onChargeDeposit,
  onChargeFullPayment,
  onSaveQuote,
  isSubmitting,
}: Props) {
  const { fabric, fabricCost, laborLabel, laborCost, upcharges, upchargeTotal } = breakdown;
  // Manual price overrides computed breakdown
  const effectiveTotal = manualPrice > 0 ? manualPrice : breakdown.subtotal;
  const hasBreakdown = fabric != null || laborCost > 0;

  return (
    <GlassCard
      variant="strong"
      className={cn(
        "p-6 sticky top-4 transition-colors",
        priceTbd ? "border-signal-amber/40" : "",
      )}
    >
      {/* Mode bar */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-1 rounded-t-2xl transition-colors",
          priceTbd ? "bg-gradient-to-r from-signal-amber/0 via-signal-amber to-signal-amber/0" : "bg-gradient-to-r from-brass/0 via-brass to-brass/0",
        )}
      />
      <div className="flex items-center justify-between mb-4">
        <div className="ui-label">{priceTbd ? "Quote Mode" : "Sale Mode"}</div>
        <div className="flex items-center gap-2">
          <Switch
            id="tbd"
            checked={priceTbd}
            onCheckedChange={onTbdChange}
            className="data-[state=checked]:bg-signal-amber"
          />
          <Label htmlFor="tbd" className="text-xs text-cream-muted cursor-pointer">
            Price TBD
          </Label>
        </div>
      </div>

      {/* Manual price entry — always shown */}
      <div className="mb-4">
        <Label className="ui-label text-[10px] mb-1.5 block">
          Commission Total
        </Label>
        <div className="flex items-center gap-2 bg-forest-raised/40 border border-brass/20 rounded-md px-3 py-2 focus-within:border-brass/50 transition-colors">
          <span className="text-brass-light font-display italic text-lg leading-none">$</span>
          <input
            type="number"
            min={0}
            step={100}
            value={manualPrice > 0 ? manualPrice : ""}
            onChange={(e) => onManualPriceChange(Math.max(0, Number(e.target.value)))}
            placeholder={hasBreakdown ? String(Math.round(breakdown.subtotal)) : "0"}
            className="flex-1 bg-transparent text-cream font-display italic text-2xl leading-none focus:outline-none placeholder:text-cream-dim/40 w-full"
          />
        </div>
        {hasBreakdown && manualPrice === 0 && (
          <div className="text-[10px] text-cream-dim mt-1">
            Computed from fabric + style · override above if needed
          </div>
        )}
      </div>

      {/* Fabric/style breakdown — only when present */}
      {hasBreakdown && manualPrice === 0 && (
        <div className="space-y-1.5 text-sm mb-4">
          <Line
            label={fabric ? `${fabric.fabricName}` : "Fabric"}
            sub={fabric?.mill ?? "Choose a fabric"}
            value={fabricCost}
            empty={!fabric}
          />
          <Line
            label={laborLabel}
            sub="House workmanship"
            value={laborCost}
            empty={laborCost === 0}
          />
          {upcharges.length > 0 && (
            <div className="pt-1 pl-1 space-y-0.5">
              {upcharges.map((u) => (
                <div key={u.label} className="flex items-center justify-between text-xs">
                  <span className="text-cream-dim">+ {u.label}</span>
                  <span className="text-cream-muted">{formatUSD(u.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="brass-divider mb-4" />

      {/* Total display */}
      <div className="flex items-end justify-between mb-4">
        <span className="ui-label text-xs">{priceTbd ? "Reference" : "Total"}</span>
        <span
          className={cn(
            "font-display italic text-4xl leading-none transition-colors",
            priceTbd ? "text-cream-muted line-through decoration-signal-amber/60" : "text-brass-shimmer",
          )}
        >
          {formatUSD(effectiveTotal)}
        </span>
      </div>

      {/* Quote mode */}
      {priceTbd ? (
        <div className="rounded-lg border border-signal-amber/30 bg-signal-amber/5 p-3 mb-4">
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-signal-amber mt-0.5 shrink-0" />
            <div>
              <div className="text-xs text-cream font-medium">Quote saved for review</div>
              <div className="text-[11px] text-cream-muted mt-0.5">
                No payment charged. Master tailor prices within 48 hours.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Deposit selector */}
          <div className="mb-4">
            <Label className="ui-label text-[10px] mb-1.5 block">Deposit Amount</Label>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {[0.25, 0.5, 0.75, 1].map((pct) => {
                const amt = pct === 1 ? effectiveTotal : Math.round((effectiveTotal * pct) / 50) * 50;
                const active = depositAmount === amt && amt > 0;
                return (
                  <button
                    key={pct}
                    type="button"
                    disabled={effectiveTotal === 0}
                    onClick={() => onDepositChange(amt)}
                    className={cn(
                      "rounded-md border py-1.5 text-[11px] font-medium transition-all",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      active
                        ? pct === 1
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                          : "border-brass bg-brass/20 text-cream"
                        : "border-brass/20 bg-forest-raised/40 text-cream-muted hover:border-brass/40",
                    )}
                  >
                    {pct === 1 ? "Full" : `${pct * 100}%`}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-cream-dim text-sm">$</span>
              <input
                type="number"
                min={0}
                step={50}
                value={depositAmount || ""}
                onChange={(e) => onDepositChange(Math.max(0, Number(e.target.value)))}
                placeholder="0"
                className="flex-1 bg-forest-raised/40 border border-brass/20 rounded-md px-2 py-1.5 text-cream text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/40"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {/* Paid in full */}
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              disabled={!canSubmit || isSubmitting || effectiveTotal === 0}
              onClick={onChargeFullPayment}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {isSubmitting ? "Processing…" : `Paid in Full · ${formatUSD(effectiveTotal)}`}
            </Button>
            {/* Deposit */}
            <Button
              className="w-full btn-brass"
              disabled={!canSubmit || isSubmitting || depositAmount === 0}
              onClick={onChargeDeposit}
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {depositAmount === 0
                ? "Set a deposit above"
                : `Charge ${formatUSD(depositAmount)} Deposit`}
            </Button>
            {depositAmount === 0 && effectiveTotal > 0 && (
              <button
                type="button"
                onClick={onSaveQuote}
                disabled={!canSubmit || isSubmitting}
                className="w-full text-[11px] text-cream-dim hover:text-cream-muted transition-colors"
              >
                or save without payment →
              </button>
            )}
          </div>
        </>
      )}

      {priceTbd && (
        <Button
          className="w-full bg-signal-amber hover:bg-signal-amber/90 text-forest font-medium mt-2"
          disabled={!canSubmit || isSubmitting}
          onClick={onSaveQuote}
        >
          <FileText className="h-4 w-4 mr-2" />
          {isSubmitting ? "Saving…" : "Save Quote"}
        </Button>
      )}

      <div className="mt-4 pt-3 border-t border-brass/10 flex items-center gap-1.5 text-[10px] text-cream-dim">
        <Sparkles className="h-3 w-3" />
        <span>Enter price manually or build from Fabric &amp; Style Library</span>
      </div>
    </GlassCard>
  );
}


function Line({ label, sub, value, empty }: { label: string; sub: string; value: number; empty: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className={cn("text-sm truncate", empty ? "text-cream-dim italic" : "text-cream")}>{label}</div>
        <div className="text-[10px] text-cream-dim truncate">{sub}</div>
      </div>
      <div className={cn("font-medium tabular-nums shrink-0", empty ? "text-cream-dim" : "text-cream-muted")}>
        {empty ? "—" : formatUSD(value)}
      </div>
    </div>
  );
}
