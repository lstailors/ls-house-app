import { useState } from "react";
import { ShieldAlert, RefreshCw, Loader2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { useDeliveryAnomalies } from "@/lib/queries";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES = {
  high:   { dot: "bg-signal-rose",  text: "text-signal-rose",  badge: "bg-signal-rose/10 text-signal-rose border-signal-rose/20" },
  medium: { dot: "bg-signal-amber", text: "text-signal-amber", badge: "bg-signal-amber/10 text-signal-amber border-signal-amber/20" },
  low:    { dot: "bg-cream-dim",    text: "text-cream-muted",  badge: "bg-forest-raised/40 text-cream-dim border-brass/10" },
};

export function AnomaliesCard() {
  const [active, setActive] = useState(false);
  const navigate = useNavigate();

  const { data: anomalies = [], isFetching, error, refetch } = useDeliveryAnomalies(active);

  const high   = anomalies.filter((a) => a.severity === "high").length;
  const medium = anomalies.filter((a) => a.severity === "medium").length;

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-brass-light/70" />
          Anomaly Detection
          {active && anomalies.length > 0 ? (
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
              high > 0 ? "bg-signal-rose/10 text-signal-rose border-signal-rose/20" : "bg-signal-amber/10 text-signal-amber border-signal-amber/20"
            )}>
              {anomalies.length}
            </span>
          ) : null}
        </div>
        {active ? (
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 text-[10px] text-brass-light/60 hover:text-brass-light transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </div>

      {!active ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActive(true)}
          className="border-brass/20 hover:bg-brass/10 text-cream-muted text-xs h-8 w-full gap-1.5"
        >
          <ShieldAlert className="h-3.5 w-3.5 text-brass-light/60" />
          Scan for issues
        </Button>
      ) : isFetching && !anomalies.length ? (
        <div className="flex items-center gap-2 text-xs text-cream-muted py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Scanning active deliveries…
        </div>
      ) : error ? (
        <div className="text-xs text-signal-rose py-1">Scan failed — check AI_GATEWAY_API_KEY.</div>
      ) : anomalies.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-signal-emerald py-1">
          <span className="h-2 w-2 rounded-full bg-signal-emerald shrink-0" />
          All clear — no anomalies detected.
        </div>
      ) : (
        <div className="space-y-2">
          {high > 0 || medium > 0 ? (
            <div className="flex items-center gap-2 text-xs text-cream-muted">
              {high > 0 ? <span className="text-signal-rose font-semibold">{high} critical</span> : null}
              {medium > 0 ? <span className="text-signal-amber font-semibold">{medium} warning{medium > 1 ? "s" : ""}</span> : null}
            </div>
          ) : null}
          {anomalies.map((a) => {
            const s = SEVERITY_STYLES[a.severity];
            return (
              <button
                key={a.deliveryId}
                type="button"
                onClick={() => navigate(`/deliveries/${a.deliveryId}`)}
                className="w-full text-left rounded-lg border border-brass/15 bg-forest-raised/20 p-3 hover:bg-brass/5 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 mt-0.5 ${s.dot}`} />
                    <div className="min-w-0">
                      <div className="text-xs text-cream font-medium font-mono truncate">{a.deliveryId}</div>
                      <div className="text-[10px] text-cream-dim truncate">{a.customer}</div>
                    </div>
                  </div>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0", s.badge)}>
                    {a.severity}
                  </span>
                </div>
                <div className="text-xs text-cream-muted mt-1.5 leading-snug">{a.issue}</div>
                <div className="flex items-center gap-1 text-[10px] text-brass-light/60 mt-1 group-hover:text-brass-light transition-colors">
                  → {a.recommendation}
                  <ChevronRight className="h-3 w-3 ml-auto" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
