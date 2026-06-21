import { cn } from "@/lib/utils";
import { statusToLabel } from "@/lib/format";

type Variant = "emerald" | "amber" | "rose" | "brass" | "muted";

const ORDER_MAP: Record<string, Variant> = {
  intake: "muted",
  in_progress: "amber",
  ready: "emerald",
  picked_up: "muted",
  cancelled: "rose",

  quote: "brass",
  deposit_paid: "amber",
  in_production: "amber",
  delivered: "emerald",

  scheduled: "brass",
  ready_for_pickup: "amber",
  out_for_delivery: "amber",
  failed: "rose",

  draft: "muted",
  sent: "amber",
  paid: "emerald",
  void: "rose",

  active: "amber",
  completed: "emerald",
};

// Status tokens whose default label differs from the auto-generated one.
const LABEL_OVERRIDES: Record<string, string> = {
  ready_for_pickup: "Ready for Pickup",
};

const VARIANT_CLASS: Record<Variant, string> = {
  emerald: "pill-emerald",
  amber: "pill-amber",
  rose: "pill-rose",
  brass: "pill-brass",
  muted: "pill-muted",
};

interface Props {
  status: string;
  variant?: Variant;
  className?: string;
  label?: string;
}

export function StatusPill({ status, variant, className, label }: Props) {
  const v = variant ?? ORDER_MAP[status] ?? "muted";
  return (
    <span className={cn("pill", VARIANT_CLASS[v], className)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          v === "emerald" && "bg-signal-emerald",
          v === "amber" && "bg-signal-amber",
          v === "rose" && "bg-signal-rose",
          v === "brass" && "bg-brass",
          v === "muted" && "bg-cream-dim",
        )}
      />
      {label ?? LABEL_OVERRIDES[status] ?? statusToLabel(status)}
    </span>
  );
}
