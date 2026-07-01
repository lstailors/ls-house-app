import { Layers, Flame, Truck, AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/glass/KpiCard";
import type { ShopFloorStats } from "@/lib/shopFloor";

interface Props {
  stats: ShopFloorStats;
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <KpiCard
        label="Active Orders"
        value={stats.active}
        icon={<Layers className="h-4 w-4" />}
        hint="In production, rush, paused or awaiting fabric"
      />
      <KpiCard
        label="Rush"
        value={stats.rush}
        icon={<Flame className="h-4 w-4" />}
        accent={stats.rush > 0 ? "amber" : "default"}
        hint={stats.rush > 0 ? "Expedited orders on the floor" : "None rushing"}
      />
      <KpiCard
        label="Shipping This Week"
        value={stats.shippingThisWeek}
        icon={<Truck className="h-4 w-4" />}
        hint="Planned to ship in the next 7 days"
      />
      <KpiCard
        label="Overdue"
        value={stats.overdue}
        icon={<AlertTriangle className="h-4 w-4" />}
        accent={stats.overdue > 0 ? "rose" : "default"}
        hint={stats.overdue > 0 ? "Past ship date, not yet shipped" : "On schedule"}
      />
    </div>
  );
}
