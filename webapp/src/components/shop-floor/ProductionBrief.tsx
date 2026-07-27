import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, RefreshCw, AlertTriangle } from "lucide-react";
import { GlassCard } from "@ls/design";
import { useYzProductionBrief } from "@/lib/queries";
import { cn } from "@ls/design/utils";

interface Props {
  onOpenOrder: (orderNo: string) => void;
}

const SEV_DOT: Record<string, string> = {
  high: "#FF5722",
  medium: "#FF9800",
};

export function ProductionBrief({ onOpenOrder }: Props) {
  const { data, isLoading, isFetching, refetch } = useYzProductionBrief();
  const [open, setOpen] = useState(true);

  // Nothing flagged and no headline → keep the page clean, render nothing.
  if (!isLoading && data && data.items.length === 0 && !data.headline) return null;

  return (
    <GlassCard variant="strong" className="overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass/30 bg-brass/10">
          <Sparkles className="h-4 w-4 text-brass-light" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="ui-label text-brass-light/80">Production Brief</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="rounded-md p-1 text-cream-dim transition-colors hover:text-cream"
                aria-label="Refresh brief"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              </button>
              {data && data.items.length > 0 ? (
                <button
                  onClick={() => setOpen((v) => !v)}
                  className="rounded-md p-1 text-cream-dim transition-colors hover:text-cream"
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              ) : null}
            </div>
          </div>

          {/* Headline */}
          {isLoading ? (
            <div className="mt-2 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-brass/10" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-brass/10" />
            </div>
          ) : (
            <p className="mt-1 text-base leading-relaxed text-cream">
              {data?.headline || "All caught up — nothing flagged on the floor right now."}
            </p>
          )}

          {/* Attention items */}
          {open && data && data.items.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {data.items.slice(0, 6).map((item) => (
                <button
                  key={item.order_no}
                  onClick={() => onOpenOrder(item.order_no)}
                  className="group flex items-center gap-2.5 rounded-lg border border-brass/10 bg-forest-deep/40 px-3 py-2 text-left transition-colors hover:border-brass/30"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: SEV_DOT[item.severity] ?? "#FF9800",
                      boxShadow: `0 0 6px 1px ${SEV_DOT[item.severity] ?? "#FF9800"}`,
                    }}
                  />
                  <span className="font-mono text-sm font-semibold text-brass-light">{item.order_no}</span>
                  <span className="truncate text-sm text-cream">{item.customer_name ?? "—"}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-cream-muted">
                    <AlertTriangle className="h-3 w-3" />
                    {item.reason}
                  </span>
                </button>
              ))}
              {data.items.length > 6 ? (
                <div className="px-1 pt-0.5 text-xs text-cream-dim">
                  +{data.items.length - 6} more need attention — use the Attention filter below.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}
