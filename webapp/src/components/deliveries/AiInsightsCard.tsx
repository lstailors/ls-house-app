import { useState } from "react";
import { Sparkles, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { useDeliveryAiSuggest, useDeliveryAiSummary } from "@/lib/queries";

// Maps ERP-side status labels to UI colors
const STATUS_COLOR: Record<string, string> = {
  "Out for Delivery": "text-signal-amber",
  "Delivered":        "text-signal-emerald",
  "Failed":           "text-signal-rose",
  "Cancelled":        "text-cream-dim",
  "Queued":           "text-cream-muted",
};

interface Props {
  deliveryId: string;
}

export function AiInsightsCard({ deliveryId }: Props) {
  const [active, setActive] = useState(false);

  const suggest = useDeliveryAiSuggest(deliveryId, active);
  const summary = useDeliveryAiSummary(deliveryId, active);

  const loading = suggest.isFetching || summary.isFetching;
  const hasData = suggest.data ?? summary.data;
  const error   = suggest.error ?? summary.error;

  const handleRefresh = () => {
    suggest.refetch();
    summary.refetch();
  };

  return (
    <GlassCard className="p-4 space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-brass-light/70" />
          AI Insights
        </div>
        {hasData ? (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1 text-[10px] text-brass-light/60 hover:text-brass-light transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </div>

      {/* Idle — prompt user to run analysis */}
      {!active ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActive(true)}
          className="border-brass/20 hover:bg-brass/10 text-cream-muted text-xs h-8 w-full gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5 text-brass-light/60" />
          Analyze with AI
        </Button>
      ) : loading && !hasData ? (
        /* Loading state */
        <div className="flex items-center gap-2 text-xs text-cream-muted py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Analyzing delivery…
        </div>
      ) : error ? (
        /* Error state */
        <div className="flex items-start gap-2 text-xs text-signal-rose py-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>AI unavailable — make sure AI_GATEWAY_API_KEY is set.</span>
        </div>
      ) : (
        /* Results */
        <div className="space-y-4">

          {suggest.data ? (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-cream-dim">
                Suggested next status
              </div>
              <div className={`text-sm font-semibold ${STATUS_COLOR[suggest.data.status] ?? "text-cream"}`}>
                {suggest.data.status}
              </div>
              <div className="text-xs text-cream-muted leading-relaxed">
                {suggest.data.reason}
              </div>
            </div>
          ) : null}

          {summary.data?.summary ? (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-cream-dim">
                Timeline summary
              </div>
              <div className="text-xs text-cream-muted leading-relaxed">
                {summary.data.summary}
              </div>
            </div>
          ) : null}

          {suggest.data ? (
            <div className="text-[9px] text-cream-dim/50 font-mono">
              {suggest.data.model}
            </div>
          ) : null}

        </div>
      )}

    </GlassCard>
  );
}
