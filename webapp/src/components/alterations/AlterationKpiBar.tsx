import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { cn } from "@/lib/utils";

interface AlterationKpis {
  active: number;
  dueToday: number;
  overdue: number;
  rush: number;
  unassigned: number;
  stellaWip: number;
  hugoWip: number;
  readyForPickup: number;
}

interface Props {
  activeFilter: string;
  onFilter: (f: string) => void;
}

interface TileConfig {
  key: keyof AlterationKpis;
  filterKey: string;
  label: string;
  getValueClass: (v: number) => string;
  pulse?: (v: number) => boolean;
}

const TILES: TileConfig[] = [
  {
    key: "active",
    filterKey: "active",
    label: "Active",
    getValueClass: () => "text-brass-shimmer",
  },
  {
    key: "dueToday",
    filterKey: "dueToday",
    label: "Due Today",
    getValueClass: (v) => (v > 0 ? "text-signal-amber" : "text-brass-shimmer"),
  },
  {
    key: "overdue",
    filterKey: "overdue",
    label: "Overdue",
    getValueClass: (v) => (v > 0 ? "text-red-400" : "text-brass-shimmer"),
    pulse: (v) => v > 0,
  },
  {
    key: "rush",
    filterKey: "rush",
    label: "Rush",
    getValueClass: (v) => (v > 0 ? "text-red-400" : "text-brass-shimmer"),
    pulse: (v) => v > 0,
  },
  {
    key: "unassigned",
    filterKey: "unassigned",
    label: "Unassigned",
    getValueClass: (v) => (v > 0 ? "text-signal-amber" : "text-brass-shimmer"),
  },
  {
    key: "stellaWip",
    filterKey: "stellaWip",
    label: "Stella WIP",
    getValueClass: () => "text-brass-shimmer",
  },
  {
    key: "hugoWip",
    filterKey: "hugoWip",
    label: "Hugo WIP",
    getValueClass: () => "text-brass-shimmer",
  },
  {
    key: "readyForPickup",
    filterKey: "readyForPickup",
    label: "Ready for Pickup",
    getValueClass: (v) => (v > 0 ? "text-emerald-400" : "text-brass-shimmer"),
  },
];

export function AlterationKpiBar({ activeFilter, onFilter }: Props) {
  const { data: kpis, isLoading } = useQuery({
    queryKey: ["alteration-kpis"],
    queryFn: () => api.get<AlterationKpis>("/api/alterations/kpis"),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: "max-content" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse bg-brass/10 rounded-xl"
              style={{ minWidth: 80, height: 80 }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3" style={{ minWidth: "max-content" }}>
        {TILES.map((tile) => {
          const value = kpis ? kpis[tile.key] : 0;
          const isActive = activeFilter === tile.filterKey;
          const isPulsing = tile.pulse ? tile.pulse(value) : false;
          const valueClass = tile.getValueClass(value);

          return (
            <button
              key={tile.filterKey}
              onClick={() => onFilter(tile.filterKey)}
              className="focus:outline-none"
              style={{ minWidth: 80 }}
            >
              <GlassCard
                hover
                className={cn(
                  "p-4 transition-all duration-200 border",
                  isActive
                    ? "border-brass/60 bg-brass/10"
                    : "border-transparent hover:border-brass/40",
                )}
              >
                <div
                  className={cn(
                    "text-3xl font-bold leading-none",
                    valueClass,
                    isPulsing && "animate-pulse",
                  )}
                >
                  {value}
                </div>
                <div className="ui-label text-[9px] mt-1.5 text-cream-muted whitespace-nowrap">
                  {tile.label}
                </div>
              </GlassCard>
            </button>
          );
        })}
      </div>
    </div>
  );
}
