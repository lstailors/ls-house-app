import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, AlertTriangle, CheckCircle2, XCircle, Clock, Eye, Bot,
  ChevronDown, ChevronUp, Activity, Play, Send, Info, Users, FileText,
  ListTodo, Filter,
} from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { Button } from "@/components/ui/button";
import {
  useMaestroBrief,
  useMaestroApprovals,
  useApproveAction,
  useAgents,
  usePendingApprovals,
  useAgentBriefs,
  useDelegateTask,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { useMe } from "@/lib/session";
import { canSeeFinancials } from "@/lib/scope";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = "active" | "idle" | "error" | "offline" | "paused";

interface Agent {
  id: string;
  slug: string;
  name: string;
  role: string;
  description?: string;
  status: AgentStatus;
  model?: string;
  platform?: string;
  color?: string;
  icon?: string;
  current_task?: string;
  current_task_since?: string;
  last_action_at?: string;
  last_action_summary?: string;
  last_heartbeat_at?: string;
  health_score?: number;
  settings?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  enabled?: boolean;
  pendingApprovals?: number;
  recentTaskCount?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_COLOR_CLASS: Record<string, string> = {
  maestro: "shadow-[0_0_24px_theme(colors.amber.500/15%)]  border-amber-500/20",
  sofia:   "shadow-[0_0_24px_theme(colors.emerald.500/15%)] border-emerald-500/20",
  mia:     "shadow-[0_0_24px_theme(colors.blue.500/15%)]    border-blue-500/20",
  rocco:   "shadow-[0_0_24px_theme(colors.amber.500/15%)]   border-amber-500/20",
  melena:  "shadow-[0_0_24px_theme(colors.rose.500/15%)]    border-rose-500/20",
  filo:    "shadow-[0_0_24px_theme(colors.purple.500/15%)]  border-purple-500/20",
};

const AGENT_PHOTO: Record<string, string> = {
  maestro: "/agents/maestro.jpg",
  sofia:   "/agents/sofia.jpg",
  mia:     "/agents/mia.jpg",
  rocco:   "/agents/rocco.jpg",
  melena:  "/agents/melena.jpg",
  filo:    "/agents/filo.jpg",
};

const AGENT_DOT_CLASS: Record<AgentStatus, string> = {
  active:  "bg-signal-emerald animate-pulse",
  idle:    "bg-cream-dim",
  error:   "bg-signal-rose",
  offline: "bg-cream-dim/40",
  paused:  "bg-signal-amber",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  active:  "Active",
  idle:    "Idle",
  error:   "Error",
  offline: "Offline",
  paused:  "Paused",
};

const STATUS_TEXT: Record<AgentStatus, string> = {
  active:  "text-signal-emerald",
  idle:    "text-cream-dim",
  error:   "text-signal-rose",
  offline: "text-cream-dim/60",
  paused:  "text-signal-amber",
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:         { label: "Pending",     color: "text-signal-amber", icon: <Clock className="h-3 w-3" /> },
  awaiting_second: { label: "Awaiting 2nd", color: "text-signal-amber", icon: <Clock className="h-3 w-3" /> },
  shadow_review:   { label: "Observation", color: "text-cream-dim",    icon: <Eye className="h-3 w-3" /> },
  approved:        { label: "Approved",    color: "text-signal-emerald", icon: <CheckCircle2 className="h-3 w-3" /> },
  denied:          { label: "Denied",      color: "text-signal-rose",   icon: <XCircle className="h-3 w-3" /> },
  revised:         { label: "Revised",     color: "text-cream-muted",   icon: <Clock className="h-3 w-3" /> },
  expired:         { label: "Expired",     color: "text-cream-dim",     icon: <Clock className="h-3 w-3" /> },
  cancelled:       { label: "Cancelled",   color: "text-cream-dim",     icon: <XCircle className="h-3 w-3" /> },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-signal-rose/40 bg-signal-rose/5  text-signal-rose",
  high:     "border-signal-amber/40 bg-signal-amber/5 text-signal-amber",
  medium:   "border-brass/20 bg-brass/5 text-brass-light",
  low:      "border-brass/10 bg-transparent text-cream-muted",
  info:     "border-brass/10 bg-transparent text-cream-dim",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(score: number | undefined): string {
  if (score == null) return "bg-cream-dim/30";
  if (score >= 70) return "bg-signal-emerald";
  if (score >= 40) return "bg-signal-amber";
  return "bg-signal-rose";
}

function AgentBadge({ name }: { name: string }) {
  const display = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brass/10 border border-brass/20 text-[10px] text-brass-light">
      <Bot className="h-2.5 w-2.5" />
      {display}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="glass-panel p-5 rounded-2xl animate-pulse space-y-3">
      <div className="h-4 w-1/2 bg-cream/5 rounded" />
      <div className="h-3 w-3/4 bg-cream/5 rounded" />
      <div className="h-2 w-full bg-cream/5 rounded-full" />
    </div>
  );
}

// ─── Approval Card ────────────────────────────────────────────────────────────

function ApprovalCard({ item, showFinancials }: { item: any; showFinancials: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [denyNote, setDenyNote] = useState("");
  const [denying, setDenying] = useState(false);
  const approve = useApproveAction();

  if (item.category === "financial" && !showFinancials) return null;

  const statusMeta = STATUS_META[item.status] ?? STATUS_META.pending;
  const isActionable = item.status === "pending" || item.status === "awaiting_second";
  const isShadow = item.status === "shadow_review";
  const isResolved = ["approved", "denied", "expired", "cancelled", "revised"].includes(item.status);
  const isFinancial = item.category === "financial";

  const handleApprove = async () => {
    try {
      await approve.mutateAsync({ id: item.id, action: "approve" });
      toast.success("Action approved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to approve");
    }
  };

  const handleDeny = async () => {
    try {
      await approve.mutateAsync({ id: item.id, action: "deny", notes: denyNote || undefined });
      toast.success("Action denied");
      setDenying(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to deny");
    }
  };

  return (
    <GlassCard
      className={cn(
        "p-4 transition-opacity",
        isResolved && "opacity-50",
        isFinancial && "border-signal-amber/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <AgentBadge name={item.source_agent ?? "unknown"} />
            <span className={cn("inline-flex items-center gap-1 text-[10px]", statusMeta.color)}>
              {statusMeta.icon}
              {statusMeta.label}
            </span>
            {item.category ? (
              <span className="text-[10px] text-cream-dim border border-brass/15 rounded px-1.5 py-0.5 capitalize">
                {item.category.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>
          <div className="text-sm text-cream font-medium leading-snug">
            {item.title ?? "(untitled)"}
          </div>
          {item.summary ? (
            <div className="text-xs text-cream-muted mt-1 leading-relaxed line-clamp-2">
              {String(item.summary)}
            </div>
          ) : null}
          {item.created_at ? (
            <div className="text-[10px] text-cream-dim mt-1">{formatRelative(item.created_at)}</div>
          ) : null}
        </div>
        {(item.proposed_action || item.payload) ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-cream-dim hover:text-cream shrink-0 mt-0.5"
            aria-label="Toggle details"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-3 pt-3 border-t border-brass/10">
          {item.proposed_action ? (
            <div className="text-xs text-cream-muted mb-2">
              <span className="ui-label text-[9px] block mb-1">Proposed action</span>
              <span className="text-cream">{String(item.proposed_action)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {isShadow ? (
        <div className="mt-3 pt-2 border-t border-brass/10 flex items-center gap-1.5 text-[10px] text-cream-dim">
          <Eye className="h-3 w-3" />
          Observation only — no action available
        </div>
      ) : null}

      {isActionable && !isShadow ? (
        <div className="mt-3 pt-3 border-t border-brass/10">
          {denying ? (
            <div className="space-y-2">
              <textarea
                value={denyNote}
                onChange={(e) => setDenyNote(e.target.value)}
                placeholder="Reason for denial (optional)"
                className="w-full text-xs bg-forest-raised/50 border border-brass/15 rounded p-2 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 resize-none h-16"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleDeny} disabled={approve.isPending}>
                  Confirm Deny
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDenying(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" className="btn-brass h-7 text-xs" onClick={handleApprove} disabled={approve.isPending}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10 hover:text-signal-rose"
                onClick={() => setDenying(true)}
                disabled={approve.isPending}
              >
                Deny
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </GlassCard>
  );
}

// ─── Agent Card (Overview/Agents tab) ─────────────────────────────────────────

function AgentCard({ agent, large = false, onDelegate }: { agent: Agent; large?: boolean; onDelegate?: (slug: string) => void }) {
  const navigate = useNavigate();
  const colorClass = AGENT_COLOR_CLASS[agent.slug] ?? "";
  const dotClass = AGENT_DOT_CLASS[agent.status] ?? "bg-cream-dim/30";
  const statusText = STATUS_TEXT[agent.status] ?? "text-cream-dim";
  const health = agent.health_score ?? 0;
  const statEntries = agent.stats ? Object.entries(agent.stats).slice(0, 3) : [];

  return (
    <div
      onClick={() => navigate(`/mission-control/agents/${agent.slug}`)}
      className={cn(
        "glass-panel rounded-2xl p-5 cursor-pointer relative transition-all duration-200",
        "hover:glass-panel-hover",
        colorClass,
        large && "p-6",
      )}
    >
      {/* Pending badge */}
      {(agent.pendingApprovals ?? 0) > 0 && (
        <span className="absolute top-3 right-3 h-5 min-w-5 px-1.5 rounded-full bg-signal-amber/20 border border-signal-amber/30 text-signal-amber text-[10px] flex items-center justify-center font-medium">
          {agent.pendingApprovals}
        </span>
      )}

      <div className="flex items-start gap-3 mb-3">
        {/* Avatar */}
        <div className="relative shrink-0">
          {AGENT_PHOTO[agent.slug] ? (
            <img
              src={AGENT_PHOTO[agent.slug]}
              alt={agent.name}
              className="h-12 w-12 rounded-full object-cover border border-brass/20"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-cream/10 border border-brass/20 flex items-center justify-center">
              <Bot className="h-5 w-5 text-brass-light" />
            </div>
          )}
          <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0D1A10]", dotClass)} />
        </div>
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div className="min-w-0">
            <div className="display-heading text-xl leading-tight truncate">{agent.name}</div>
            <div className="text-xs text-cream-muted truncate">{agent.role}</div>
          </div>
        </div>
      </div>

      {/* Health bar */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="ui-label text-[9px]">Health</span>
          <span className={cn("text-[10px] font-medium", statusText)}>{STATUS_LABEL[agent.status]}</span>
        </div>
        <div className="h-1.5 w-full bg-cream/5 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", healthColor(agent.health_score))}
            style={{ width: `${health}%` }}
          />
        </div>
        <span className="text-[9px] text-cream-dim mt-0.5 block">{health}/100</span>
      </div>

      {/* Current task */}
      {agent.current_task ? (
        <div className="mb-2">
          <span className="ui-label text-[9px] block mb-0.5">Working on</span>
          <p className="text-xs italic text-cream-dim line-clamp-2">{agent.current_task}</p>
        </div>
      ) : null}

      {/* Last action */}
      {agent.last_action_summary ? (
        <div className="mb-3">
          <span className="ui-label text-[9px] block mb-0.5">Last action</span>
          <p className="text-xs text-cream-muted line-clamp-2">{agent.last_action_summary}</p>
          {agent.last_action_at ? (
            <span className="text-[9px] text-cream-dim">{formatRelative(agent.last_action_at)}</span>
          ) : null}
        </div>
      ) : null}

      {/* Model + platform badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {agent.model ? (
          <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-brass/10 border border-brass/15 text-brass-light">
            {agent.model}
          </span>
        ) : null}
        {agent.platform ? (
          <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-cream/5 border border-brass/10 text-cream-dim">
            {agent.platform}
          </span>
        ) : null}
        {!agent.enabled && (
          <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-signal-rose/10 border border-signal-rose/20 text-signal-rose">
            Disabled
          </span>
        )}
      </div>

      {/* Stats */}
      {statEntries.length > 0 && (
        <div className="flex gap-3 border-t border-brass/10 pt-3 mb-3">
          {statEntries.map(([key, val]) => (
            <div key={key} className="text-center">
              <div className="kpi-number text-sm leading-none">{String(val)}</div>
              <div className="ui-label text-[8px] mt-0.5 capitalize">{key.replace(/_/g, " ")}</div>
            </div>
          ))}
        </div>
      )}

      {/* Delegate button if large mode */}
      {large && onDelegate && (
        <Button
          size="sm"
          className="btn-brass h-7 text-xs w-full mt-1"
          onClick={(e) => { e.stopPropagation(); onDelegate(agent.slug); }}
        >
          <Send className="h-3 w-3 mr-1.5" />
          Delegate Task
        </Button>
      )}
    </div>
  );
}

// ─── Delegate Task Modal ──────────────────────────────────────────────────────

function DelegateTaskModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const delegate = useDelegateTask(slug);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Title is required"); return; }
    try {
      await delegate.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_at: dueAt || undefined,
      });
      toast.success(`Task delegated to ${slug}`);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delegate task");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-forest-deep/80 backdrop-blur-xl">
      <GlassCard variant="strong" className="w-full max-w-md p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="ui-label mb-0.5">Delegate Task</div>
            <h2 className="display-heading text-2xl leading-tight">
              Assign to <span className="text-brass-light capitalize">{slug}</span>
            </h2>
          </div>
          <button onClick={onClose} className="text-cream-dim hover:text-cream p-1">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="delegate-title" className="ui-label block mb-1.5">
              Title <span className="text-signal-rose">*</span>
            </label>
            <input
              id="delegate-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should the agent do?"
              required
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 focus:ring-1 focus:ring-brass/30"
            />
          </div>

          <div>
            <label htmlFor="delegate-desc" className="ui-label block mb-1.5">Description</label>
            <textarea
              id="delegate-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context or instructions..."
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 focus:ring-1 focus:ring-brass/30 resize-none h-20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="delegate-priority" className="ui-label block mb-1.5">Priority</label>
              <select
                id="delegate-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream focus:outline-none focus:border-brass/50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="delegate-due" className="ui-label block mb-1.5">Due Date</label>
              <input
                id="delegate-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream focus:outline-none focus:border-brass/50"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="submit" className="btn-brass flex-1" disabled={delegate.isPending}>
              <Send className="h-4 w-4 mr-2" />
              {delegate.isPending ? "Delegating…" : "Delegate Task"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ agents, approvalTotal, briefs, onTabChange }: {
  agents: Agent[];
  approvalTotal: number;
  briefs: any[];
  onTabChange: (tab: string) => void;
}) {
  const activeCount = agents.filter((a) => a.status === "active").length;
  const tasksInProgress = agents.filter((a) => a.current_task).length;
  const briefsToday = briefs.filter((b) => {
    if (!b.created_at) return false;
    const d = new Date(b.created_at);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  // Aggregate recent events from agent last actions as a mini timeline
  const recentActions = agents
    .filter((a) => a.last_action_at)
    .sort((a, b) => new Date(b.last_action_at!).getTime() - new Date(a.last_action_at!).getTime())
    .slice(0, 5);

  const latestBrief = briefs[0];

  return (
    <div className="space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Active Agents" value={String(activeCount)} hint={`of ${agents.length} total`} accent="emerald" icon={<Activity className="h-4 w-4" />} />
        <KpiCard label="Pending Approvals" value={String(approvalTotal)} hint="across all agents" accent={approvalTotal > 0 ? "amber" : "default"} icon={<Clock className="h-4 w-4" />} />
        <KpiCard label="Briefs Today" value={String(briefsToday)} hint={`${briefs.length} total`} icon={<FileText className="h-4 w-4" />} />
        <KpiCard label="Tasks In Progress" value={String(tasksInProgress)} hint="agents with active tasks" accent={tasksInProgress > 0 ? "emerald" : "default"} icon={<ListTodo className="h-4 w-4" />} />
      </div>

      {/* Agent Roster */}
      <div>
        <div className="ui-label mb-4">Agent Roster</div>
        {agents.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <Bot className="h-8 w-8 text-cream-dim mx-auto mb-2" />
            <div className="text-cream-dim text-sm">No agents configured yet.</div>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      {/* Latest brief snippet */}
      {latestBrief && (
        <GlassCard variant="strong" className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-brass-light" />
            <span className="ui-label">Latest Brief</span>
            {latestBrief.created_at && (
              <span className="text-[10px] text-cream-dim ml-auto">{formatRelative(latestBrief.created_at)}</span>
            )}
            <button
              onClick={() => onTabChange("briefs")}
              className="text-[10px] text-brass-light hover:text-brass-light/80 underline ml-1"
            >
              View all
            </button>
          </div>
          {latestBrief.title && (
            <div className="text-sm text-cream font-medium mb-1">{String(latestBrief.title)}</div>
          )}
          {latestBrief.body && (
            <p className="text-sm text-cream-muted line-clamp-3 leading-relaxed">
              {String(latestBrief.body)}
            </p>
          )}
        </GlassCard>
      )}

      {/* Recent events timeline */}
      {recentActions.length > 0 && (
        <div>
          <div className="ui-label mb-3">Recent Activity</div>
          <GlassCard className="p-4 space-y-3">
            {recentActions.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 text-sm">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", AGENT_DOT_CLASS[agent.status])} />
                <AgentBadge name={agent.name} />
                <p className="text-cream-muted text-xs flex-1 min-w-0 line-clamp-1">
                  {agent.last_action_summary ?? "No summary"}
                </p>
                <span className="text-[10px] text-cream-dim shrink-0">{formatRelative(agent.last_action_at)}</span>
              </div>
            ))}
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// ─── Agents Tab ───────────────────────────────────────────────────────────────

function AgentsTab({ agents }: { agents: Agent[] }) {
  const [delegateSlug, setDelegateSlug] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {delegateSlug && (
        <DelegateTaskModal slug={delegateSlug} onClose={() => setDelegateSlug(null)} />
      )}
      {agents.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <Bot className="h-8 w-8 text-cream-dim mx-auto mb-2" />
          <div className="text-cream-dim text-sm">No agents found.</div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} large onDelegate={(slug) => setDelegateSlug(slug)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Approvals Tab ────────────────────────────────────────────────────────────

function ApprovalsTab({ showFinancials }: { showFinancials: boolean }) {
  const { data: approvals = [], isLoading } = useMaestroApprovals();

  const pending = approvals.filter((i) => i.status === "pending" || i.status === "awaiting_second");
  const resolved = approvals.filter((i) => ["approved", "denied", "expired", "cancelled", "revised"].includes(i.status));

  // Group pending by source_agent
  const byAgent: Record<string, any[]> = {};
  for (const item of pending) {
    const key = item.source_agent ?? "unknown";
    if (!byAgent[key]) byAgent[key] = [];
    byAgent[key].push(item);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending section */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="ui-label">Pending Approvals</div>
          {pending.length > 0 && (
            <span className="h-5 min-w-5 px-1.5 rounded-full bg-signal-amber/20 border border-signal-amber/30 text-signal-amber text-[10px] flex items-center justify-center">
              {pending.length}
            </span>
          )}
        </div>

        {pending.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-signal-emerald mx-auto mb-2" />
            <div className="text-cream-muted text-sm">All clear — no pending actions.</div>
          </GlassCard>
        ) : (
          <div className="space-y-6">
            {Object.entries(byAgent).map(([agent, items]) => (
              <CollapsibleAgentGroup key={agent} agentName={agent} items={items} showFinancials={showFinancials} />
            ))}
          </div>
        )}
      </div>

      {/* Resolved section */}
      {resolved.length > 0 && (
        <div>
          <div className="ui-label mb-4 opacity-60">Resolved</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 opacity-60">
            {resolved.map((item) => (
              <ApprovalCard key={item.id} item={item} showFinancials={showFinancials} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CollapsibleAgentGroup({ agentName, items, showFinancials }: {
  agentName: string;
  items: any[];
  showFinancials: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 mb-3 group"
      >
        <AgentBadge name={agentName} />
        <span className="text-xs text-cream-dim">({items.length})</span>
        {collapsed ? (
          <ChevronDown className="h-3 w-3 text-cream-dim group-hover:text-cream" />
        ) : (
          <ChevronUp className="h-3 w-3 text-cream-dim group-hover:text-cream" />
        )}
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pl-2">
          {items.map((item) => (
            <ApprovalCard key={item.id} item={item} showFinancials={showFinancials} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Briefs Tab ───────────────────────────────────────────────────────────────

function BriefsTab() {
  const { data: briefs = [], isLoading } = useAgentBriefs(30);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const severities = ["all", "critical", "high", "medium", "low", "info"];
  const filtered = severityFilter === "all"
    ? briefs
    : briefs.filter((b) => b.severity === severityFilter);

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>;
  }

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-cream-dim" />
        {severities.map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={cn(
              "px-3 py-1 rounded-full text-[11px] border transition-all",
              severityFilter === s
                ? "bg-brass/20 border-brass/40 text-brass-light"
                : "bg-cream/5 border-brass/10 text-cream-dim hover:text-cream",
            )}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <FileText className="h-6 w-6 text-cream-dim mx-auto mb-2" />
          <div className="text-cream-dim text-sm">No briefs found.</div>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((brief, i) => {
            const isExpanded = expandedId === (brief.id ?? String(i));
            const sevClass = SEVERITY_COLORS[brief.severity ?? "info"] ?? SEVERITY_COLORS.info;
            return (
              <GlassCard
                key={brief.id ?? i}
                className={cn("p-4 border transition-all", brief.severity === "critical" && "shadow-[0_0_16px_theme(colors.rose.500/15%)]")}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      {brief.source && (
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-brass/10 border border-brass/15 text-brass-light capitalize">
                          {String(brief.source)}
                        </span>
                      )}
                      {brief.severity && (
                        <span className={cn("px-2 py-0.5 text-[10px] rounded-full border font-medium", sevClass)}>
                          {String(brief.severity).toUpperCase()}
                        </span>
                      )}
                      {brief.created_at && (
                        <span className="text-[10px] text-cream-dim ml-auto">{formatRelative(brief.created_at)}</span>
                      )}
                    </div>
                    {brief.title && (
                      <div className="text-sm text-cream font-medium mb-1">{String(brief.title)}</div>
                    )}
                    {brief.body && (
                      <p className={cn("text-xs text-cream-muted leading-relaxed", !isExpanded && "line-clamp-2")}>
                        {String(brief.body)}
                      </p>
                    )}
                    {brief.body && String(brief.body).length > 120 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : (brief.id ?? String(i)))}
                        className="text-[10px] text-brass-light mt-1 hover:underline"
                      >
                        {isExpanded ? "Show less" : "Read more"}
                      </button>
                    )}
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = ["overview", "agents", "approvals", "briefs"] as const;
type TabId = typeof TABS[number];

const TAB_LABELS: Record<TabId, string> = {
  overview:  "Overview",
  agents:    "Agents",
  approvals: "Approvals",
  briefs:    "Briefs",
};

export default function MissionControl() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: me } = useMe();
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: pendingData } = usePendingApprovals();
  const { data: briefs = [] } = useAgentBriefs(20);
  const { data: legacyApprovals = [] } = useMaestroApprovals();

  const approvalTotal = pendingData?.total
    ?? legacyApprovals.filter((i: any) => i.status === "pending" || i.status === "awaiting_second").length;

  const showFinancials = canSeeFinancials(me?.role);

  const pendingCount = legacyApprovals.filter((i: any) => i.status === "pending" || i.status === "awaiting_second").length;

  return (
    <div className="space-y-8 animate-fade-up">
      <SectionHeader
        eyebrow="Mission Control"
        title={
          <>
            The <span className="text-brass-shimmer">command</span> centre.
          </>
        }
        description="Live intelligence, agent roster, approvals queue, and daily briefs."
      />

      {/* Tab bar */}
      <div className="flex gap-1 p-1 glass-panel rounded-2xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-all",
              activeTab === tab
                ? "bg-brass/20 text-brass-light border border-brass/30"
                : "text-cream-dim hover:text-cream",
            )}
          >
            {TAB_LABELS[tab]}
            {tab === "approvals" && pendingCount > 0 && (
              <span className="ml-1.5 h-4 w-4 inline-flex items-center justify-center rounded-full bg-signal-amber/25 text-signal-amber text-[9px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        agentsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <OverviewTab
            agents={agents as Agent[]}
            approvalTotal={approvalTotal}
            briefs={briefs}
            onTabChange={(t) => setActiveTab(t as TabId)}
          />
        )
      )}

      {activeTab === "agents" && (
        agentsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <AgentsTab agents={agents as Agent[]} />
        )
      )}

      {activeTab === "approvals" && <ApprovalsTab showFinancials={showFinancials} />}

      {activeTab === "briefs" && <BriefsTab />}
    </div>
  );
}
