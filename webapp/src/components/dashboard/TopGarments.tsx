import { Scissors } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { formatUSD } from "@/lib/format";

interface Garment { type: string; units: number; revenue: number; avgPrice: number }
interface Props { data: Garment[] }

export function TopGarments({ data }: Props) {
  if (!data?.length) return null;
  const maxUnits = Math.max(...data.map(d => d.units), 1);

  return (
    <GlassCard variant="strong" className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="ui-label flex items-center gap-2">
          <Scissors className="h-3.5 w-3.5 text-brass-light" />
          Top Garments
        </div>
        <span className="text-[10px] text-cream-dim uppercase tracking-widest">By volume</span>
      </div>

      <div className="space-y-3">
        {data.slice(0, 7).map((g, i) => {
          const pct = Math.round((g.units / maxUnits) * 100);
          return (
            <div key={g.type}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-cream leading-tight truncate max-w-[160px]">{g.type}</span>
                <div className="flex items-center gap-3 text-[10px] shrink-0 ml-2">
                  <span className="text-cream-muted">{g.units} units</span>
                  <span className="text-brass-light font-semibold">{formatUSD(g.avgPrice)}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-forest-highlight/60 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: i < 3
                      ? "linear-gradient(90deg, rgba(176,141,87,0.5), #B08D57)"
                      : "linear-gradient(90deg, rgba(176,141,87,0.2), rgba(176,141,87,0.45))",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
