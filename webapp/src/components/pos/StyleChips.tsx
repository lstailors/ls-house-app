import type { GarmentType, StyleOption } from "@/lib/types";
import {
  SPEC_KEY_BY_CATEGORY,
  STYLE_GROUP_ORDER,
  STYLE_UPCHARGE,
  type SpecChoices,
  groupStyles,
} from "@/lib/pricing";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  garment: GarmentType | undefined;
  styles: StyleOption[];
  value: SpecChoices;
  onChange: (next: SpecChoices) => void;
}

export function StyleChips({ garment, styles, value, onChange }: Props) {
  if (!garment) {
    return (
      <div className="text-sm text-cream-muted italic">
        Select a garment to reveal style options.
      </div>
    );
  }

  const grouped = groupStyles(styles);
  const applicable = STYLE_GROUP_ORDER.filter((g) => g.appliesTo.includes(garment));

  return (
    <div className="space-y-4">
      {applicable.map((group) => {
        const items = grouped[group.key] ?? [];
        const specKey = SPEC_KEY_BY_CATEGORY[group.key];
        const selected = value[specKey];
        if (items.length === 0) return null;
        return (
          <div key={group.key}>
            <div className="ui-label text-[10px] mb-1.5">{group.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((opt) => {
                const active = selected === opt.name;
                const surcharge = STYLE_UPCHARGE[opt.name];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChange({ ...value, [specKey]: active ? undefined : opt.name })}
                    aria-pressed={active}
                    className={cn(
                      "rounded-full border px-4 py-2 sm:py-1 text-sm sm:text-xs transition-all min-h-[40px] sm:min-h-0",
                      active
                        ? "border-brass bg-brass/20 text-cream shadow-brass-glow"
                        : "border-brass/20 bg-forest-raised/40 text-cream-muted hover:border-brass/40 hover:text-cream active:bg-brass/10",
                    )}
                  >
                    {opt.name}
                    {surcharge ? (
                      <span className={cn("ml-1.5 text-[10px]", active ? "text-brass-light" : "text-cream-dim")}>
                        +{formatUSD(surcharge)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
