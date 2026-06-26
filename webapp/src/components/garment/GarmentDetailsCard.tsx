import { Shirt, MapPin, CheckCircle2, User } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import type { GarmentDetail } from "../../../../backend/src/types";
import { statusVariant, formatDateTime } from "./garmentFormat";

interface Props {
  garment?: GarmentDetail | null;
  fallbackId?: string;
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-brass/10 last:border-b-0">
      <span className="ui-label shrink-0">{label}</span>
      <span className="text-sm text-cream text-right">{value}</span>
    </div>
  );
}

export function GarmentDetailsCard({ garment, fallbackId }: Props) {
  const id = garment?.id ?? fallbackId ?? "—";
  const status = garment?.status ?? null;

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brass/30 bg-brass/10">
          <Shirt className="h-5 w-5 text-brass-light" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="display-heading text-2xl leading-tight">
            {garment?.type ?? "Garment"}
          </h2>
          <p className="text-xs font-mono text-brass-light/70 mt-0.5">{id}</p>
        </div>
        <StatusPill status={status ?? "—"} variant={statusVariant(status)} label={status ?? "—"} />
      </div>

      <div className="rounded-xl bg-forest-deep/40 border border-brass/10 px-3 py-1">
        <DetailRow label="Color" value={garment?.color} />
        <DetailRow label="Fabric" value={garment?.fabric} />
        <DetailRow label="Condition" value={garment?.condition} />
        <DetailRow label="Fit Area" value={garment?.fit_area} />
      </div>

      <div className="grid grid-cols-1 gap-2">
        {garment?.location ? (
          <div className="flex items-center gap-2 text-sm text-cream-muted">
            <MapPin className="h-4 w-4 text-brass-light/60 shrink-0" />
            <span className="ui-label">Location</span>
            <span className="ml-auto text-cream">{garment.location}</span>
          </div>
        ) : null}

        {garment?.completed_by ? (
          <div className="flex items-center gap-2 text-sm text-cream-muted">
            <User className="h-4 w-4 text-signal-emerald/70 shrink-0" />
            <span className="ui-label">Completed by</span>
            <span className="ml-auto text-cream">{garment.completed_by}</span>
          </div>
        ) : null}

        {garment?.completed_at ? (
          <div className="flex items-center gap-2 text-sm text-cream-muted">
            <CheckCircle2 className="h-4 w-4 text-signal-emerald/70 shrink-0" />
            <span className="ui-label">Completed at</span>
            <span className="ml-auto text-cream">{formatDateTime(garment.completed_at)}</span>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}
