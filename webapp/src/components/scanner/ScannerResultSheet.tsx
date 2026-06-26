import { useMemo } from "react";
import {
  FileText, Scissors, Truck, Package, ArrowLeftRight, Tag,
  CreditCard, Loader2, AlertCircle, ExternalLink, type LucideIcon,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScannerResult, ScannerType } from "@/lib/types";

// ── Icon + accent per scanner type ──────────────────────────────────────────

const TYPE_ICON: Record<ScannerType, LucideIcon> = {
  sales_invoice: FileText,
  alteration_ticket: Scissors,
  lsh_delivery: Truck,
  custom_order: Package,
  tailor_transfer: ArrowLeftRight,
  payment_link: CreditCard,
  garment_tag: Tag,
};

function typeIcon(type?: ScannerType): LucideIcon {
  return type ? TYPE_ICON[type] : Package;
}

// ── Action machine-key → label + style ──────────────────────────────────────

type ActionStyle = "default" | "success" | "ghost";

interface ActionDef {
  label: string;
  style: ActionStyle;
}

// Per-type mapping. A given machine key can carry a different label per type
// (e.g. "open" → "Open Transfer" for tailor_transfer), so resolve by type first.
const ACTION_MAP: Partial<Record<ScannerType, Record<string, ActionDef>>> = {
  sales_invoice: {
    open: { label: "Open record", style: "ghost" },
    mark_paid: { label: "Mark Paid", style: "success" },
    open_payment_link: { label: "Open Payment Link", style: "default" },
  },
  payment_link: {
    open: { label: "Open record", style: "ghost" },
    mark_paid: { label: "Mark Paid", style: "success" },
    open_payment_link: { label: "Open Payment Link", style: "default" },
  },
  alteration_ticket: {
    open: { label: "Open record", style: "ghost" },
    mark_in_progress: { label: "→ In Progress", style: "success" },
    mark_ready: { label: "→ Ready", style: "success" },
    mark_picked_up: { label: "→ Picked Up", style: "success" },
    print_tag: { label: "Print Tag", style: "ghost" },
  },
  lsh_delivery: {
    open: { label: "Open record", style: "ghost" },
    mark_delivered: { label: "Mark Delivered", style: "success" },
    send_sms: { label: "Send SMS", style: "ghost" },
  },
  custom_order: {
    open: { label: "Open record", style: "ghost" },
    print_tags: { label: "Print Tags", style: "ghost" },
  },
  tailor_transfer: {
    open: { label: "Open Transfer", style: "ghost" },
    confirm_receipt: { label: "Confirm Receipt", style: "success" },
  },
  garment_tag: {
    open: { label: "Open", style: "ghost" },
  },
};

function actionDef(type: ScannerType | undefined, key: string): ActionDef {
  const byType = type ? ACTION_MAP[type] : undefined;
  return byType?.[key] ?? { label: key.replace(/_/g, " "), style: "ghost" };
}

// ── Meta rendering ──────────────────────────────────────────────────────────

const MONEY_KEYS = new Set(["outstanding_amount", "grand_total"]);

const META_FIELDS: { key: string; label: string }[] = [
  { key: "customer_name", label: "Customer" },
  { key: "address", label: "Address" },
  { key: "garment_summary", label: "Garments" },
  { key: "due_date", label: "Due" },
  { key: "outstanding_amount", label: "Outstanding" },
  { key: "grand_total", label: "Total" },
  { key: "tailor_name", label: "Tailor" },
  { key: "direction", label: "Direction" },
];

function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderMetaValue(key: string, value: unknown): string {
  if (MONEY_KEYS.has(key)) return formatMoney(value);
  return String(value);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  result: ScannerResult | null;
  resolving: boolean;
  pendingAction: string | null;
  onAction: (key: string) => void;
  onScanAgain: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ScannerResultSheet({
  open, result, resolving, pendingAction, onAction, onScanAgain, onOpenChange,
}: Props) {
  const Icon = typeIcon(result?.type);

  const metaRows = useMemo(() => {
    const meta = result?.meta ?? {};
    return META_FIELDS
      .filter((f) => meta[f.key] !== undefined && meta[f.key] !== null && meta[f.key] !== "")
      .map((f) => ({ label: f.label, value: renderMetaValue(f.key, meta[f.key]) }));
  }, [result]);

  const unrecognized = result != null && result.ok === false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="border-t border-brass/25 bg-forest-deep/97 backdrop-blur-2xl rounded-t-3xl max-h-[85vh] overflow-y-auto p-5 pb-8"
      >
        {resolving ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 text-brass animate-spin" />
            <SheetTitle className="text-cream text-base font-medium">Looking up…</SheetTitle>
            <SheetDescription className="text-cream-dim text-xs">
              Resolving the scanned code
            </SheetDescription>
          </div>
        ) : unrecognized ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-signal-rose/15 border border-signal-rose/30 flex items-center justify-center shrink-0">
                <AlertCircle className="h-6 w-6 text-signal-rose" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-cream text-base font-semibold">Unrecognized code</SheetTitle>
                <SheetDescription className="text-cream-dim text-xs">
                  {result?.reason ?? "We couldn't match this code to a record."}
                </SheetDescription>
              </div>
            </div>
            {result?.raw ? (
              <div className="rounded-lg border border-brass/15 bg-forest-raised/40 px-3 py-2">
                <div className="ui-label text-[9px] text-cream-dim mb-1">Raw value</div>
                <div className="text-cream text-xs font-mono break-all">{result.raw}</div>
              </div>
            ) : null}
            <Button onClick={onScanAgain} className="btn-brass w-full min-h-[44px]">
              Scan again
            </Button>
          </div>
        ) : result != null ? (
          <div className="flex flex-col gap-4">
            <SheetDescription className="sr-only">Scanned record details and actions</SheetDescription>
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-xl bg-brass/12 border border-brass/25 flex items-center justify-center shrink-0">
                <Icon className="h-6 w-6 text-brass-light" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-cream text-base font-semibold truncate">
                  {result.title ?? result.name ?? "Record"}
                </SheetTitle>
                {result.subtitle ? (
                  <div className="text-cream-dim text-xs truncate mt-0.5">{result.subtitle}</div>
                ) : null}
              </div>
              {result.state ? (
                <span className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full border border-brass/30 bg-brass/10 text-brass-light">
                  {result.state}
                </span>
              ) : null}
            </div>

            {/* Meta block */}
            {metaRows.length > 0 ? (
              <div className="rounded-xl border border-brass/12 bg-forest-raised/30 divide-y divide-brass/8">
                {metaRows.map((row) => (
                  <div key={row.label} className="flex items-start gap-3 px-3 py-2">
                    <div className="ui-label text-[9px] text-cream-dim w-24 shrink-0 pt-0.5">{row.label}</div>
                    <div className="text-cream text-sm flex-1 min-w-0 break-words">{row.value}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {(result.actions ?? []).map((key) => {
                const def = actionDef(result.type, key);
                const busy = pendingAction === key;
                return (
                  <Button
                    key={key}
                    onClick={() => onAction(key)}
                    disabled={pendingAction != null}
                    className={cn(
                      "w-full min-h-[44px] justify-center gap-2",
                      def.style === "success" && "bg-signal-emerald text-forest-deep hover:bg-signal-emerald/90",
                      def.style === "default" && "btn-brass",
                      def.style === "ghost" &&
                        "bg-forest-raised/50 border border-brass/20 text-cream hover:bg-brass/10",
                    )}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {key === "open" || key === "open_payment_link" ? (
                      <ExternalLink className="h-4 w-4 opacity-70" />
                    ) : null}
                    {def.label}
                  </Button>
                );
              })}
              <Button
                onClick={onScanAgain}
                variant="outline"
                disabled={pendingAction != null}
                className="w-full min-h-[44px] border-brass/25 text-cream-muted hover:bg-brass/8 hover:text-cream"
              >
                Scan again
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
