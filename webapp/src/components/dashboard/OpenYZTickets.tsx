import { LifeBuoy, AlertTriangle, ExternalLink, Inbox } from "lucide-react";
import { GlassCard } from "@ls/design";
import type { YZTicket } from "@ls/types";

interface Props {
  data: YZTicket[];
}

// Tailwind classes per ticket status for the mini-breakdown chips.
const STATUS_STYLES: Record<string, string> = {
  Open: "text-signal-amber bg-signal-amber/10 border-signal-amber/25",
  Replied: "text-brass-light bg-brass/10 border-brass/20",
  Resolved: "text-signal-emerald bg-signal-emerald/10 border-signal-emerald/25",
};

function statusStyle(status: string | null): string {
  return STATUS_STYLES[status ?? ""] ?? "text-cream-muted bg-cream-muted/10 border-cream-muted/20";
}

export function OpenYZTickets({ data }: Props) {
  if (!data?.length) {
    return (
      <GlassCard variant="strong" className="p-6">
        <div className="ui-label flex items-center gap-2 mb-5">
          <LifeBuoy className="h-3.5 w-3.5 text-brass-light" />
          Open YZ Tickets
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center text-cream-dim">
          <Inbox className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-xs">No open YongZheng tickets</p>
        </div>
      </GlassCard>
    );
  }

  const total = data.length;
  const escalated = data.filter((t) => t.escalate).length;

  // Per-status breakdown
  const byStatus = new Map<string, number>();
  for (const t of data) {
    const key = t.status ?? "Unknown";
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  const statusEntries = [...byStatus.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <GlassCard variant="strong" className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="ui-label flex items-center gap-2">
          <LifeBuoy className="h-3.5 w-3.5 text-brass-light" />
          Open YZ Tickets
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="kpi-number text-2xl leading-none">{total}</span>
          <span className="text-[10px] text-cream-dim uppercase tracking-widest">open</span>
        </div>
      </div>

      {/* Per-status mini breakdown */}
      <div className="flex flex-wrap gap-2 mb-4">
        {statusEntries.map(([status, count]) => (
          <span
            key={status}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${statusStyle(status)}`}
          >
            {status}
            <span className="font-semibold">{count}</span>
          </span>
        ))}
      </div>

      {/* Escalation banner */}
      {escalated > 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-signal-rose/10 border border-signal-rose/30 text-xs text-signal-rose">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {escalated} ticket{escalated !== 1 ? "s" : ""} open 3+ days — needs follow-up
          </span>
        </div>
      ) : null}

      {/* Compact ticket list */}
      <div className="space-y-1.5">
        {data.map((t) => {
          const orderId = t.proOrder || t.yzOrderNo || "—";
          return (
            <a
              key={t.name}
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-brass/5 transition-colors"
            >
              <span
                className={`text-[10px] font-semibold w-20 shrink-0 truncate ${t.escalate ? "text-signal-rose" : "text-brass-light"}`}
                title={orderId}
              >
                {orderId}
              </span>
              <span className="flex-1 min-w-0 text-xs text-cream truncate">
                {t.subject ?? "(no subject)"}
              </span>
              <span className={`text-[10px] shrink-0 tabular-nums ${t.escalate ? "text-signal-rose font-semibold" : "text-cream-dim"}`}>
                {t.daysOpen}d
              </span>
              <span
                className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded border ${statusStyle(t.status)}`}
              >
                {t.status ?? "—"}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0 text-cream-dim opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          );
        })}
      </div>
    </GlassCard>
  );
}
