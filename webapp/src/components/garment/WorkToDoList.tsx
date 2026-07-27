import { Scissors, Clock, User } from "lucide-react";
import { GlassCard } from "@ls/design";
import { StatusPill } from "@ls/design";
import type { GarmentJobLine } from "@ls/types";
import { formatCurrency, statusVariant } from "./garmentFormat";

interface Props {
  lines?: GarmentJobLine[] | null;
}

function MinutesBadge({ est, actual }: { est?: number | null; actual?: number | null }) {
  if (est === null || est === undefined) {
    if (actual === null || actual === undefined) return null;
  }
  return (
    <div className="flex items-center gap-1 text-[11px] text-cream-dim">
      <Clock className="h-3 w-3 text-brass-light/50" />
      {est !== null && est !== undefined ? <span>est {est}m</span> : null}
      {actual !== null && actual !== undefined ? (
        <span className="text-signal-emerald">· actual {actual}m</span>
      ) : null}
    </div>
  );
}

export function WorkToDoList({ lines }: Props) {
  const rows = lines ?? [];

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Scissors className="h-4 w-4 text-brass-light/70" />
        <h3 className="ui-label !text-xs">Work To Do</h3>
        <span className="ml-auto text-xs text-cream-dim">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-cream-dim/60 italic">No work lines on this garment.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((line, i) => (
            <div
              key={i}
              className="rounded-xl border border-brass/10 bg-forest-deep/40 px-3.5 py-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-cream leading-snug">
                    {line.description ?? "—"}
                  </p>
                  {line.preset ? (
                    <p className="text-[11px] text-brass-light/60 mt-0.5">{line.preset}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-semibold text-brass-light">
                  {formatCurrency(line.amount)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {line.status ? (
                  <StatusPill status={line.status} variant={statusVariant(line.status)} label={line.status} />
                ) : null}
                {line.tailor ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-cream-muted">
                    <User className="h-3 w-3 text-brass-light/50" />
                    {line.tailor}
                  </span>
                ) : null}
                <MinutesBadge est={line.est_minutes} actual={line.actual_minutes} />
              </div>

              {line.notes ? (
                <p className="text-xs text-cream-dim bg-forest-deep/60 rounded-lg px-2.5 py-1.5 leading-relaxed">
                  {line.notes}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
