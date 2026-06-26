import { Ruler } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import type { GarmentMeasurement } from "../../../../backend/src/types";

interface Props {
  measurements?: GarmentMeasurement[] | null;
}

export function MeasurementsList({ measurements }: Props) {
  const rows = (measurements ?? []).filter(
    (m) => m.value !== null && m.value !== undefined && String(m.value).length > 0,
  );

  if (rows.length === 0) return null;

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4 text-brass-light/70" />
        <h3 className="ui-label !text-xs">Measurements</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((m, i) => (
          <div
            key={i}
            className="rounded-xl border border-brass/10 bg-forest-deep/40 px-3 py-2"
          >
            <div className="ui-label !text-[9px] truncate">{m.type ?? "—"}</div>
            <div className="text-sm font-mono text-cream mt-0.5">
              {String(m.value)}
              {m.unit ? <span className="text-cream-dim ml-1 text-xs">{m.unit}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
