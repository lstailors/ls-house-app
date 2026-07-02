import { Shirt, type LucideIcon } from "lucide-react";
import type { YZOrder } from "@/lib/types";
import { garmentLines } from "@/lib/shopFloor";
import { cn } from "@/lib/utils";

// Simple label→icon mapping. lucide has no vest/pant/coat glyphs, so we lean on
// a small set of tailoring-appropriate marks and fall back to Shirt.
const ICON_BY_KEY: Record<string, LucideIcon> = {
  qty_suit_coat: Shirt,
  qty_tux_coat: Shirt,
  qty_overcoat: Shirt,
  qty_shirt: Shirt,
};

interface Props {
  order: YZOrder;
  className?: string;
}

/** Visual per-garment breakdown for the drawer — one tile per non-zero qty. */
export function GarmentBreakdown({ order, className }: Props) {
  const lines = garmentLines(order);
  if (lines.length === 0) {
    return (
      <div className="text-sm text-cream-dim">No garment quantities recorded.</div>
    );
  }
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
      {lines.map((line) => {
        const Icon = ICON_BY_KEY[line.key] ?? Shirt;
        return (
          <div
            key={line.key}
            className="flex items-center gap-2.5 rounded-xl border border-brass/15 bg-forest-deep/40 px-3 py-2.5"
          >
            <Icon className="h-4 w-4 shrink-0 text-brass-light/70" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-cream">{line.label}</div>
            </div>
            <div className="font-display italic text-xl leading-none text-brass-light">
              {line.qty}
            </div>
          </div>
        );
      })}
    </div>
  );
}
