import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, RotateCcw, Briefcase } from "lucide-react";
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

interface BriefData {
  brief: string;
  period: string;
  generatedAt: string;
}

interface Props {
  kpis: AlterationKpis | undefined | null;
}

function getCurrentPeriod(): string {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const totalMins = h * 60 + m;
  if (totalMins < 12 * 60 + 30) return "morning";
  if (totalMins < 17 * 60) return "midday";
  return "eod";
}

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isBusinessHours(): boolean {
  const h = new Date().getHours();
  return h >= 7 && h < 18;
}

const PERIOD_BADGE: Record<string, string> = {
  morning: "text-brass-shimmer bg-brass/15 border-brass/30",
  midday: "text-amber-400 bg-amber-900/20 border-amber-500/30",
  eod: "text-blue-400 bg-blue-900/20 border-blue-500/30",
};

const PERIOD_LABEL: Record<string, string> = {
  morning: "MORNING",
  midday: "MIDDAY",
  eod: "EOD",
};

export function AlterationDailyBrief({ kpis }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [period] = useState(getCurrentPeriod);

  const cacheKey = `alteration-brief-${getTodayStr()}-${period}`;

  const fetchBrief = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        localStorage.removeItem(cacheKey);
      }

      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed: BriefData = JSON.parse(cached);
          setBrief(parsed.brief);
          setLastUpdated(new Date(parsed.generatedAt));
          return;
        } catch {
          localStorage.removeItem(cacheKey);
        }
      }

      if (!isBusinessHours() && !forceRefresh) return;

      setIsLoading(true);
      try {
        const result = await api.post<BriefData>("/api/alterations/brief", {
          period,
          kpis,
        });
        if (result) {
          setBrief(result.brief);
          const now = new Date();
          setLastUpdated(now);
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ ...result, generatedAt: now.toISOString() }),
          );
        }
      } catch {
        setBrief("Brief unavailable at this time.");
      } finally {
        setIsLoading(false);
      }
    },
    [cacheKey, period, kpis],
  );

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    fetchBrief(true);
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left min-h-[48px]"
        onClick={() => setIsOpen((o) => !o)}
      >
        <Briefcase className="h-4 w-4 text-brass shrink-0" />
        <span className="text-cream font-medium flex-1 text-sm">
          Today's Production Brief
        </span>
        <span
          className={cn(
            "px-2 py-0.5 text-[9px] font-bold tracking-widest border rounded",
            PERIOD_BADGE[period] ?? PERIOD_BADGE.morning,
          )}
        >
          {PERIOD_LABEL[period] ?? period.toUpperCase()}
        </span>
        <button
          onClick={handleRefresh}
          className="p-1.5 rounded-lg hover:bg-brass/10 transition-colors text-cream-dim hover:text-brass ml-1"
          aria-label="Refresh brief"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-cream-dim" />
        ) : (
          <ChevronDown className="h-4 w-4 text-cream-dim" />
        )}
      </button>

      {/* Content */}
      {isOpen ? (
        <div className="px-4 pb-4 pt-0 border-t border-brass/10">
          {isLoading ? (
            <div className="space-y-2 mt-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-4 bg-brass/10 rounded animate-pulse"
                  style={{ width: i === 3 ? "60%" : "100%" }}
                />
              ))}
            </div>
          ) : brief ? (
            <div className="mt-3">
              <p className="font-display italic text-base leading-relaxed text-cream">
                {brief}
              </p>
              {lastUpdated ? (
                <p className="text-[10px] text-cream-dim mt-2">
                  Last updated at {formatTime(lastUpdated)}
                  {!isBusinessHours() ? " · Outside business hours" : ""}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-cream-dim text-sm mt-3 italic">
              No brief available.
            </p>
          )}
        </div>
      ) : null}
    </GlassCard>
  );
}
