import { useState } from "react";
import { Bot, Clock, ListTodo, Cloud, Activity, Sparkles, Brain } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENTS, type HouseAgent } from "../mockData";
import {
  AgentAvatar, StatusDot, STATUS_TEXT, STATUS_LABEL,
  SkeletonGrid, useFakeLoading, comingSoon,
} from "../components/shared";

function AgentCard({ agent, onView }: { agent: HouseAgent; onView: () => void }) {
  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-4 border border-brass/10 group flex flex-col">
      <div className="flex items-start gap-3">
        <div className="relative">
          <AgentAvatar name={agent.name} photo={agent.photo} size="md" />
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0D1A10]">
            <StatusDot status={agent.status} />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display italic text-lg leading-none text-cream">{agent.name}</div>
          <div className="text-[10px] text-cream-dim mt-1 truncate">{agent.role}</div>
        </div>
        <span className={cn("text-[10px] font-medium shrink-0", STATUS_TEXT[agent.status])}>
          {STATUS_LABEL[agent.status]}
        </span>
      </div>

      {/* Model */}
      <div className="mt-3 flex items-center gap-1">
        <span className="px-1.5 py-0.5 text-[9px] rounded bg-brass/5 border border-brass/10 text-cream-dim flex items-center gap-1 truncate max-w-full">
          <Cloud className="h-2.5 w-2.5 shrink-0" /> {agent.model}
        </span>
      </div>

      {/* Last active */}
      <div className="mt-2.5 text-[10px] text-cream-dim flex items-center gap-1">
        <Activity className="h-2.5 w-2.5" /> Last active: {agent.lastActive}
      </div>

      {/* Badges */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] border",
          agent.pending > 0
            ? "text-signal-amber border-signal-amber/30 bg-signal-amber/10"
            : "text-cream-dim border-brass/10 bg-cream/5",
        )}>
          <Clock className="h-2.5 w-2.5" /> {agent.pending} pending
        </span>
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] border",
          agent.activeTasks > 0
            ? "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10"
            : "text-cream-dim border-brass/10 bg-cream/5",
        )}>
          <ListTodo className="h-2.5 w-2.5" /> {agent.activeTasks} active
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

function AgentDrawer({ agent, onClose }: { agent: HouseAgent | null; onClose: () => void }) {
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
                  <AgentAvatar name={agent.name} photo={agent.photo} size="lg" />
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
                    <span className="text-[10px] text-cream-dim">{agent.lastActive}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 flex-wrap">
                <span className="px-1.5 py-0.5 text-[9px] rounded bg-brass/5 border border-brass/10 text-cream-dim flex items-center gap-1">
                  <Cloud className="h-2.5 w-2.5" /> {agent.model}
                </span>
                <span className="px-1.5 py-0.5 text-[9px] rounded-full text-signal-amber border border-signal-amber/30 bg-signal-amber/10 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> {agent.pending} pending
                </span>
                <span className="px-1.5 py-0.5 text-[9px] rounded-full text-signal-emerald border border-signal-emerald/30 bg-signal-emerald/10 flex items-center gap-1">
                  <ListTodo className="h-2.5 w-2.5" /> {agent.activeTasks} active
                </span>
              </div>
            </SheetHeader>

            <div className="p-5 space-y-6">
              {/* Description */}
              <section>
                <div className="ui-label mb-2">What {agent.name} does</div>
                <p className="text-sm text-cream-muted leading-relaxed">{agent.description}</p>
              </section>

              {/* Skills */}
              <section>
                <div className="ui-label mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> Assigned skills
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agent.skills.map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-brass/5 border border-brass/15 text-brass-light">
                      {s}
                    </span>
                  ))}
                </div>
              </section>

              {/* Recent activity */}
              <section>
                <div className="ui-label mb-2 flex items-center gap-1.5">
                  <Activity className="h-3 w-3" /> Recent activity
                </div>
                <div className="space-y-1.5">
                  {agent.activity.map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl bg-cream/[0.02] border border-brass/10">
                      <span className="h-1.5 w-1.5 rounded-full bg-brass/50 mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-cream-muted leading-snug">{a.text}</p>
                        <span className="text-[9px] text-cream-dim/60">{a.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Memory snapshot */}
              <section>
                <div className="ui-label mb-2 flex items-center gap-1.5">
                  <Brain className="h-3 w-3" /> Memory snapshot
                </div>
                <div className="space-y-1.5">
                  {agent.memory.map((m, i) => (
                    <div key={i} className="px-3 py-2 rounded-xl bg-forest-raised/40 border border-brass/10 text-xs text-cream-muted leading-snug">
                      {m}
                    </div>
                  ))}
                </div>
              </section>

              {/* Message — disabled */}
              <Button
                disabled
                onClick={comingSoon}
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

export default function AgentsTab() {
  const loading = useFakeLoading();
  const [selected, setSelected] = useState<HouseAgent | null>(null);

  if (loading) return <SkeletonGrid count={7} h="h-48" />;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {AGENTS.map((a) => (
          <AgentCard key={a.slug} agent={a} onView={() => setSelected(a)} />
        ))}
      </div>
      <AgentDrawer agent={selected} onClose={() => setSelected(null)} />
    </>
  );
}
