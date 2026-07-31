import type { ReactNode } from "react";
import { cn } from "@ls/design/utils";

export type GarmentFilterId = "All" | "Tailoring" | "Tops" | "Dresses" | "Other";

export const GARMENT_FILTERS: { id: GarmentFilterId; types: string[] | null }[] = [
  { id: "All", types: null },
  {
    id: "Tailoring",
    types: ["Jacket", "Trouser", "Vest", "Suit (2pc)", "Suit (3pc)", "Coat"],
  },
  { id: "Tops", types: ["Shirt"] },
  { id: "Dresses", types: ["Dress", "Skirt"] },
  { id: "Other", types: ["Other"] },
];

type Props = {
  firstName: string;
  types: readonly string[];
  garments: Array<{ garmentType: string }>;
  filter: GarmentFilterId;
  onFilter: (id: GarmentFilterId) => void;
  onAdd: (type: string) => void;
  icon: (type: string) => ReactNode;
  /** SPEC 057 — optional Alter|Sell switch above filters (walk-in only) */
  modeSwitch?: ReactNode;
  title?: string;
  lede?: string;
};

export default function GarmentCatalog({
  firstName,
  types,
  garments,
  filter,
  onFilter,
  onAdd,
  icon,
  modeSwitch,
  title,
  lede,
}: Props) {
  const active = GARMENT_FILTERS.find((f) => f.id === filter) ?? GARMENT_FILTERS[0];
  const visible = active.types ? types.filter((t) => active.types!.includes(t)) : [...types];

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden px-3 pt-3 pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:px-5 md:pt-4 md:pb-3">
      <div className="flex items-end gap-3.5 mb-3 shrink-0">
        <div className="min-w-0">
          <h2 className="display text-[24px] md:text-[28px] leading-none italic">
            {title || `What did ${firstName} bring in?`}
          </h2>
          <p className="text-[11.5px] text-cream-dim mt-1.5 leading-snug max-w-md">
            {lede ||
              "Tap a piece to add it — options slide up. Same type again for another."}
          </p>
        </div>
      </div>

      {modeSwitch}

      <div className="flex gap-1.5 flex-wrap mb-3 shrink-0">
        {GARMENT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            className={cn(
              "h-11 md:h-[34px] px-3 rounded-full border text-[10px] font-bold tracking-[0.12em] uppercase transition-colors",
              filter === f.id
                ? "bg-brass/20 border-brass text-brass-light"
                : "border-brass/25 bg-black/25 text-cream-muted hover:border-brass/45 hover:text-cream",
            )}
          >
            {f.id}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 md:pr-1">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-2.5">
          {visible.map((t) => {
            const count = garments.filter((g) => g.garmentType === t).length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onAdd(t)}
                className={cn(
                  "relative min-h-[132px] md:min-h-[148px] rounded-2xl border flex flex-col items-center justify-center gap-2.5 p-3 md:p-3.5 transition-all active:scale-[0.97]",
                  count > 0
                    ? "border-brass/55 bg-[linear-gradient(160deg,rgba(176,141,87,0.16),rgba(176,141,87,0.03))]"
                    : "border-brass/25 bg-white/[0.03] hover:border-brass/45 hover:bg-white/[0.06]",
                )}
              >
                {count > 0 && (
                  <span className="absolute top-2.5 right-2.5 min-w-6 h-6 px-1.5 rounded-full bg-brass text-forest-deep text-[11px] font-bold grid place-items-center shadow-[0_4px_12px_rgba(176,141,87,0.35)]">
                    {count}
                  </span>
                )}
                <span className="text-brass-light opacity-90">{icon(t)}</span>
                <span
                  className={cn(
                    "text-[10.5px] font-bold tracking-[0.14em] uppercase text-center leading-tight",
                    count > 0 ? "text-cream" : "text-cream-muted",
                  )}
                >
                  {t}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
