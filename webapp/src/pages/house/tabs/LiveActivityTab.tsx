import { Radio, GitBranch, Activity } from "lucide-react";
import { cn } from "@ls/design/utils";
import { ACTIVITY_LOG } from "../mockData";
import { SkeletonRows, useFakeLoading, agentAccent } from "../components/shared";

// Idle "Maestro standing by" hero. When tasks are live this swaps for the
// sub-agent tree below — the shell is built so wiring is drop-in.
function IdleHero() {
  return (
    <div className="glass-panel-strong rounded-2xl border border-brass/15 p-10 flex flex-col items-center justify-center text-center">
      <div className="relative mb-5">
        <span className="absolute inset-0 rounded-full bg-brass/10 blur-xl animate-glow-pulse" />
        <div className="relative h-20 w-20 rounded-full border border-brass/25 bg-gradient-to-br from-forest-raised to-forest-deep flex items-center justify-center shadow-glass">
          <Radio className="h-8 w-8 text-brass-light" />
        </div>
        {/* idle ring */}
        <span className="absolute -inset-2 rounded-full border border-brass/10 animate-ping" style={{ animationDuration: "3s" }} />
      </div>
      <div className="font-display italic text-2xl text-cream">No active tasks</div>
      <p className="text-sm text-cream-dim mt-1">Maestro is standing by</p>
    </div>
  );
}

// Future-state shell: when Maestro spawns sub-agents this renders the live tree.
// Kept collapsed/empty for now, styled and ready to wire.
function SubAgentTreeShell() {
  return (
    <div className="glass-panel rounded-2xl border border-dashed border-brass/15 p-5">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="h-3.5 w-3.5 text-cream-dim" />
        <span className="ui-label text-[10px] tracking-widest">SUB-AGENT TREE</span>
        <span className="ml-auto text-[9px] text-cream-dim/60 uppercase tracking-wider">Idle</span>
      </div>
      <div className="relative pl-4">
        <span className="absolute left-1 top-1.5 bottom-1.5 w-px bg-brass/15" />
        <div className="flex items-center gap-2 py-1.5">
          <span className="h-2 w-2 rounded-full bg-brass/40 -ml-[3px]" />
          <span className="text-xs text-cream-dim">Maestro · root</span>
          <span className="text-[9px] text-cream-dim/50">waiting for work</span>
        </div>
      </div>
      <p className="text-[10px] text-cream-dim/60 mt-3 leading-relaxed">
        When Maestro runs parallel tasks, spawned sub-agents appear here as a live tree —
        each with its current tool call and status.
      </p>
    </div>
  );
}

function ActivityLog() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-3.5 w-3.5 text-brass-light" />
        <span className="ui-label text-[10px] tracking-widest">RECENT ACTIVITY</span>
        <span className="ml-auto flex items-center gap-1.5 text-[9px] text-cream-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-signal-emerald animate-pulse" /> LIVE
        </span>
      </div>
      <div className="space-y-1.5">
        {ACTIVITY_LOG.map((e, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-cream/[0.02] border border-brass/10 hover:bg-cream/[0.04] transition-colors">
            <span className="font-mono text-[10px] text-cream-dim shrink-0 w-10">{e.time}</span>
            <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-medium border shrink-0", agentAccent(e.agent))}>
              {e.agent}
            </span>
            <span className="text-xs text-cream-muted leading-snug min-w-0 flex-1 truncate">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LiveActivityTab() {
  const loading = useFakeLoading();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="glass-panel rounded-2xl h-40 animate-pulse" />
        <SkeletonRows count={6} h="h-12" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <IdleHero />
      <SubAgentTreeShell />
      <ActivityLog />
    </div>
  );
}
