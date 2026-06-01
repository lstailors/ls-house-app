import { Sparkles, Search } from "lucide-react";
import { useState, useMemo } from "react";
import type { FabricPricing } from "@/lib/types";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface Props {
  fabrics: FabricPricing[];
  value: string | undefined;
  onChange: (id: string) => void;
}

const TIER_ACCENT: Record<string, string> = {
  Standard: "border-cream-dim/30 text-cream-muted",
  Premium: "border-signal-amber/40 text-signal-amber",
  Signature: "border-brass/50 text-brass-light",
  Bespoke: "border-signal-emerald/40 text-signal-emerald",
};

export function FabricTiles({ fabrics, value, onChange }: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q) return fabrics;
    const s = q.toLowerCase();
    return fabrics.filter(
      (f) =>
        f.fabricName.toLowerCase().includes(s) ||
        (f.mill ?? "").toLowerCase().includes(s) ||
        (f.tier ?? "").toLowerCase().includes(s),
    );
  }, [fabrics, q]);

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by mill, name, or tier…"
          className="pl-9 h-11 sm:h-9 bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-base sm:text-sm text-cream"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1 -webkit-overflow-scrolling-touch">
        {filtered.map((f) => {
          const active = value === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange(f.id)}
              aria-pressed={active}
              className={cn(
                "group relative rounded-lg border p-3 text-left transition-all min-h-[72px] sm:min-h-0",
                active
                  ? "border-brass bg-brass/15 shadow-brass-glow"
                  : "border-brass/15 bg-forest-raised/30 hover:border-brass/40 hover:bg-brass/5 active:bg-brass/10",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={cn("font-medium text-sm leading-tight truncate", active ? "text-cream" : "text-cream-muted")}>
                    {f.fabricName}
                  </div>
                  <div className="text-[10px] text-cream-dim mt-0.5 truncate">
                    {f.mill} · {f.composition}
                  </div>
                </div>
                {active ? <Sparkles className="h-3.5 w-3.5 text-brass shrink-0" /> : null}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={cn(
                    "text-[9px] uppercase tracking-widerer px-1.5 py-0.5 rounded border",
                    TIER_ACCENT[f.tier ?? "Standard"] ?? TIER_ACCENT.Standard,
                  )}
                >
                  {f.tier}
                </span>
                <span className={cn("font-display italic text-base", active ? "text-brass-shimmer" : "text-cream-muted")}>
                  {formatUSD(f.price, { compact: f.price >= 1000 })}
                </span>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="col-span-full p-6 text-center text-sm text-cream-muted">
            No fabrics match.
          </div>
        ) : null}
      </div>
    </div>
  );
}
