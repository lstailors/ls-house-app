import { useMemo, useState } from "react";
import { Sparkles, Palette } from "lucide-react";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { EmptyState } from "@ls/design";
import { useStyleOptions } from "@/lib/queries";
import { STYLE_UPCHARGE } from "@/lib/pricing";
import type { StyleCategory, StyleOption } from "@ls/types";
import { formatUSD } from "@ls/design/format";
import { cn } from "@ls/design/utils";

const CATEGORY_LABEL: Record<StyleCategory, string> = {
  lapel: "Lapel",
  pocket: "Pocket",
  vent: "Vent",
  lining: "Lining",
  button: "Buttons",
  collar: "Collar",
  cuff: "Cuff",
  placket: "Placket",
};

const CATEGORY_ORDER: StyleCategory[] = [
  "lapel",
  "pocket",
  "vent",
  "lining",
  "button",
  "collar",
  "cuff",
  "placket",
];

export default function StyleLibraryPage() {
  const { data: styles = [], isLoading } = useStyleOptions();
  const [activeCategory, setActiveCategory] = useState<StyleCategory | "all">("all");

  const byCategory = useMemo(() => {
    const m = new Map<StyleCategory, StyleOption[]>();
    for (const s of styles) {
      const arr = m.get(s.category) ?? [];
      arr.push(s);
      m.set(s.category, arr);
    }
    return m;
  }, [styles]);

  const visibleCategories = useMemo(() => {
    if (activeCategory === "all") return CATEGORY_ORDER.filter((c) => byCategory.has(c));
    return byCategory.has(activeCategory) ? [activeCategory] : [];
  }, [activeCategory, byCategory]);

  const totalOptions = styles.length;
  const upchargeCount = styles.filter((s) => STYLE_UPCHARGE[s.name]).length;

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Reference · Style Library"
        title={
          <>
            The <span className="text-brass-shimmer">style</span> book.
          </>
        }
        description="Lapels, vents, linings, buttons — every choice a gentleman can make on a commission."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5">
          <div className="ui-label mb-1 flex items-center gap-1.5">
            <Palette className="h-3 w-3" /> Total Options
          </div>
          <div className="kpi-number">{totalOptions}</div>
        </div>
        <div className="glass-panel p-5">
          <div className="ui-label mb-1">Categories</div>
          <div className="kpi-number">{byCategory.size}</div>
        </div>
        <div className="glass-panel p-5">
          <div className="ui-label mb-1">With Upcharge</div>
          <div className="kpi-number text-brass-light">{upchargeCount}</div>
        </div>
      </div>

      {/* Category chips */}
      {byCategory.size > 0 ? (
        <div className="flex flex-wrap gap-2">
          <CategoryChip
            label="All"
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          />
          {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => (
            <CategoryChip
              key={c}
              label={CATEGORY_LABEL[c]}
              active={activeCategory === c}
              onClick={() => setActiveCategory(c)}
              count={byCategory.get(c)?.length}
            />
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : styles.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No style options"
          description="Style options seed during onboarding — check your admin setup."
        />
      ) : (
        <div className="space-y-6">
          {visibleCategories.map((category) => {
            const options = byCategory.get(category) ?? [];
            return (
              <section key={category}>
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="display-heading text-2xl text-cream">
                    {CATEGORY_LABEL[category]}
                  </h3>
                  <span className="ui-label text-[10px]">{options.length} options</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {options.map((option) => (
                    <StyleCard key={option.id} option={option} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="text-[11px] text-cream-dim italic flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-brass-light/60" />
        Options here populate the Custom Made POS chips — toggle one and it appears at the counter.
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs border transition-all uppercase tracking-wider",
        active
          ? "border-brass bg-brass/15 text-cream shadow-brass-glow"
          : "border-brass/15 bg-brass/5 text-cream-muted hover:border-brass/40 hover:bg-brass/10",
      )}
    >
      {label}
      {count != null ? (
        <span className="ml-1.5 opacity-60 normal-case tracking-normal">·&nbsp;{count}</span>
      ) : null}
    </button>
  );
}

function StyleCard({ option }: { option: StyleOption }) {
  const upcharge = STYLE_UPCHARGE[option.name];
  return (
    <GlassCard className="p-4 group transition-all hover:border-brass/35">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-cream font-medium leading-snug">{option.name}</div>
        {upcharge ? (
          <span className="font-mono text-[11px] text-brass-light shrink-0">
            +{formatUSD(upcharge)}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-cream-dim shrink-0">included</span>
        )}
      </div>
      {option.description ? (
        <div className="text-[11px] text-cream-muted italic leading-relaxed line-clamp-2">
          {option.description}
        </div>
      ) : null}
    </GlassCard>
  );
}
