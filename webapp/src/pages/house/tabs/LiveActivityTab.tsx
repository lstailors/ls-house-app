import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio, Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { SkeletonRows, agentAccent } from "../components/shared";

interface ActivityItem {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  type: "sms" | "task" | "brain" | "approval";
}

const TYPE_LABEL: Record<string, string> = {
  sms: "SMS",
  task: "Task",
  brain: "Brain",
  approval: "Approval",
};

function IdleHero() {
  return (
    <div className="glass-panel-strong rounded-2xl border border-brass/15 p-10 flex flex-col items-center justify-center text-center">
      <div className="relative mb-5">
        <span className="absolute inset-0 rounded-full bg-brass/10 blur-xl animate-glow-pulse" />
        <div className="relative h-20 w-20 rounded-full border border-brass/25 bg-gradient-to-br from-forest-raised to-forest-deep flex items-center justify-center shadow-glass">
          <Radio className="h-8 w-8 text-brass-light" />
        </div>
        <span className="absolute -inset-2 rounded-full border border-brass/10 animate-ping" style={{ animationDuration: "3s" }} />
      </div>
      <div className="font-display italic text-2xl text-cream">No recent activity</div>
      <p className="text-sm text-cream-dim mt-1">Maestro is standing by</p>
    </div>
  );
}

function ActivityRow({ item, isNew }: { item: ActivityItem; isNew: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-xl bg-cream/[0.02] border border-brass/10 hover:bg-cream/[0.04] transition-all",
        isNew && "border-brass/25 bg-brass/[0.04] animate-[slideDown_0.3s_ease-out]",
      )}
    >
      <span className="font-mono text-[10px] text-cream-dim shrink-0 w-10">{item.timestamp}</span>
      <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-medium border shrink-0", agentAccent(item.agent))}>
        {item.agent}
      </span>
      <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-cream/5 border border-brass/10 text-cream-dim shrink-0">
        {TYPE_LABEL[item.type] ?? item.type}
      </span>
      <span className="text-xs text-cream-muted leading-snug min-w-0 flex-1 truncate">{item.action}</span>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-panel rounded-2xl p-8 border border-brass/10 flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-cream-dim">Could not load activity feed.</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
      </Button>
    </div>
  );
}

export default function LiveActivityTab() {
  const [liveItems, setLiveItems] = useState<ActivityItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const sseRef = useRef<EventSource | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // Initial data load via REST (works on Vercel where SSE has timeout limits)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["house-activity"],
    queryFn: () => api.get<{ items: ActivityItem[] }>("/api/house/activity"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // Sync query data into liveItems
  useEffect(() => {
    if (!data?.items) return;
    const newFromQuery = data.items.filter((item) => !seenIds.current.has(item.id));
    if (newFromQuery.length === 0) return;

    for (const i of newFromQuery) seenIds.current.add(i.id);

    setLiveItems((prev) => {
      const merged = [...newFromQuery, ...prev];
      const unique = Array.from(new Map(merged.map((i) => [i.id, i])).values());
      return unique.slice(0, 50);
    });
  }, [data]);

  // SSE connection (gracefully no-ops if Vercel times it out)
  useEffect(() => {
    const apiBase = (import.meta.env.VITE_BACKEND_URL as string) || "";
    const url = `${apiBase}/api/house/activity/live`;

    const connect = () => {
      const es = new EventSource(url);
      sseRef.current = es;

      es.onmessage = (e) => {
        try {
          const item: ActivityItem = JSON.parse(e.data);
          if (seenIds.current.has(item.id)) return;
          seenIds.current.add(item.id);

          setLiveItems((prev) => {
            const next = [item, ...prev].slice(0, 50);
            return next;
          });
          setNewIds((s) => {
            const n = new Set(s);
            n.add(item.id);
            setTimeout(() => setNewIds((s2) => { const n2 = new Set(s2); n2.delete(item.id); return n2; }), 3000);
            return n;
          });
        } catch {
          // bad JSON — ignore
        }
      };

      es.onerror = () => {
        es.close();
        // Reconnect after 5s if SSE fails (e.g. Vercel timeout)
        setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      sseRef.current?.close();
    };
  }, []);

  const isIdle =
    liveItems.length === 0 ||
    (liveItems[0] &&
      Date.now() - parseTimestamp(liveItems[0].timestamp) > 5 * 60_000);

  if (isLoading && liveItems.length === 0) {
    return (
      <div className="space-y-4">
        <div className="glass-panel rounded-2xl h-40 animate-pulse" />
        <SkeletonRows count={6} h="h-12" />
      </div>
    );
  }

  if (isError && liveItems.length === 0) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      {isIdle ? <IdleHero /> : null}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">RECENT ACTIVITY</span>
          <span className="ml-auto flex items-center gap-1.5 text-[9px] text-cream-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-emerald animate-pulse" /> LIVE
          </span>
        </div>
        <div className="space-y-1.5">
          {liveItems.map((item) => (
            <ActivityRow key={item.id} item={item} isNew={newIds.has(item.id)} />
          ))}
          {liveItems.length === 0 ? (
            <div className="text-center py-8 text-sm text-cream-dim">
              No recent activity.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function parseTimestamp(ts: string): number {
  // ts is "HH:MM" — convert to today's date for comparison
  try {
    const [h, m] = ts.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  } catch {
    return 0;
  }
}
