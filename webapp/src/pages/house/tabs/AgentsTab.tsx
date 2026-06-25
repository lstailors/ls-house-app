import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Clock, ListTodo, Cloud, Activity, Sparkles, Brain, ExternalLink, RefreshCw } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  AgentAvatar, StatusDot, STATUS_TEXT, STATUS_LABEL,
  SkeletonGrid, agentAccent,
} from "../components/shared";
import type { AgentStatus } from "../mockData";

interface LiveAgent {
  slug: string;
  name: string;
  role: string;
  model: string;
  status: AgentStatus;
  last_active: string;
  pending_approvals: number;
  active_tasks: number;
  health_ok: boolean;
  dashboard_url: string | null;
  description: string;
}

function AgentCard({ agent, onView }: { agent: LiveAgent; onView: () => void }) {
  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-4 border border-brass/10 group flex flex-col">
      <div className="flex items-start gap-3">
        <div className="relative">
          <AgentAvatar name={agent.name} size="md" />
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0D1A10]">
            <StatusDot status={agent.status} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display italic text-lg leading-none text-cream flex items-center gap-1.5">
            {agent.name}
            {agent.dashboard_url ? (
              <a
                href={agent.dashboard_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-brass-light/60 hover:text-brass-light transition-colors"
                title="Open Dashboard"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          <div className="text-[10px] text-cream-dim mt-1 truncate">{agent.role}</div>
        </div>
        <span className={cn("text-[10px] font-medium shrink-0", STATUS_TEXT[agent.status])}>
          {STATUS_LABEL[agent.status]}
        </span>
      </div>

      {/* Model */}
      <div className="mt-3 flex items-center gap-1">
        <span className="px-1.5 py-0.5 text-[9px] rounded bg-brass/5 border border-brass/10 text-cream-dim flex items-center gap-1 truncate max-w-full">
          <Cloud className="h-2.5 w-2.5 shrink-0" /> {agent.model || "—"}
        </span>
      </div>

      {/* Last active */}
      <div className="mt-2.5 text-[10px] text-cream-dim flex items-center gap-1">
        <Activity className="h-2.5 w-2.5" /> Last active: {agent.last_active}
      </div>

      {/* Badges */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] border",
          agent.pending_approvals > 0
            ? "text-signal-amber border-signal-amber/30 bg-signal-amber/10"
            : "text-cream-dim border-brass/10 bg-cream/5",
        )}>
          <Clock className="h-2.5 w-2.5" /> {agent.pending_approvals} pending
        </span>
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] border",
          agent.active_tasks > 0
            ? "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10"
            : "text-cream-dim border-brass/10 bg-cream/5",
        )}>
          <ListTodo className="h-2.5 w-2.5" /> {agent.active_tasks} active
        </span>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onView}
        className="mt-4 w-full border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
      >
        View
      </Button>
    </div>
  );
}

function AgentDrawer({ agent, onClose }: { agent: LiveAgent | null; onClose: () => void }) {
  return (
    <Sheet open={!!agent} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-forest-deep/95 backdrop-blur-2xl border-l border-brass/20 text-cream overflow-y-auto p-0"
      >
        {agent ? (
          <>
            <SheetHeader className="p-5 border-b border-brass/10 text-left space-y-0">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <AgentAvatar name={agent.name} size="lg" />
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0D1A10]">
                    <StatusDot status={agent.status} />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="font-display italic text-2xl text-cream font-medium">
                    {agent.name}
                  </SheetTitle>
                  <div className="text-xs text-cream-dim mt-0.5">{agent.role}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={cn("text-[10px] font-medium", STATUS_TEXT[agent.status])}>
                      {STATUS_LABEL[agent.status]}
                    </span>
                    <span className="text-cream-dim/40 text-[10px]">·</span>
                    <span className="text-[10px] text-cream-dim">{agent.last_active}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 flex-wrap">
                <span className="px-1.5 py-0.5 text-[9px] rounded bg-brass/5 border border-brass/10 text-cream-dim flex items-center gap-1">
                  <Cloud className="h-2.5 w-2.5" /> {agent.model || "—"}
                </span>
                <span className="px-1.5 py-0.5 text-[9px] rounded-full text-signal-amber border border-signal-amber/30 bg-signal-amber/10 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> {agent.pending_approvals} pending
                </span>
                <span className="px-1.5 py-0.5 text-[9px] rounded-full text-signal-emerald border border-signal-emerald/30 bg-signal-emerald/10 flex items-center gap-1">
                  <ListTodo className="h-2.5 w-2.5" /> {agent.active_tasks} active
                </span>
              </div>
            </SheetHeader>

            <div className="p-5 space-y-6">
              {agent.description ? (
                <section>
                  <div className="ui-label mb-2">What {agent.name} does</div>
                  <p className="text-sm text-cream-muted leading-relaxed">{agent.description}</p>
                </section>
              ) : null}

              {agent.dashboard_url ? (
                <a
                  href={agent.dashboard_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brass/20 bg-brass/5 text-brass-light text-sm hover:bg-brass/10 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Dashboard →
                </a>
              ) : null}

              <Button
                disabled
                className="w-full bg-cream/5 border border-brass/15 text-cream-dim cursor-not-allowed hover:bg-cream/5"
              >
                Message — Coming soon
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-panel rounded-2xl p-8 border border-brass/10 flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-cream-dim">Could not load agents. Check the ERP connection.</p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
      >
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
      </Button>
    </div>
  );
}

export default function AgentsTab() {
  const [selected, setSelected] = useState<LiveAgent | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["house-agents"],
    queryFn: () => api.get<{ agents: LiveAgent[] }>("/api/house/agents"),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  if (isLoading) return <SkeletonGrid count={7} h="h-48" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const agents = data?.agents ?? [];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {agents.map((a) => (
          <AgentCard key={a.slug} agent={a} onView={() => setSelected(a)} />
        ))}
        {agents.length === 0 ? (
          <div className="col-span-full glass-panel rounded-2xl p-8 border border-brass/10 text-center">
            <p className="text-sm text-cream-dim">No agents found in ERP.</p>
          </div>
        ) : null}
      </div>
      <AgentDrawer agent={selected} onClose={() => setSelected(null)} />
    </>
  );
}
