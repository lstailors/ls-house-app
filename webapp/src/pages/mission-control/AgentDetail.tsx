import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Activity, Play, CheckCircle2, Send, Sparkles, Clock,
  AlertTriangle, Info, ChevronDown, ChevronUp, XCircle, Eye, Bot,
  ToggleLeft, ToggleRight, RefreshCw, ListTodo,
} from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { Button } from "@/components/ui/button";
import {
  useAgent,
  useAgentEvents,
  useAgentTasks,
  useDelegateTask,
  useUpdateAgent,
  useApproveAction,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatRelative, formatDateTime } from "@/lib/format";
import { useMe } from "@/lib/session";
import { canSeeFinancials } from "@/lib/scope";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = "active" | "idle" | "error" | "offline" | "paused";

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_DOT_CLASS: Record<AgentStatus, string> = {
  active:  "bg-signal-emerald animate-pulse",
  idle:    "bg-cream-dim",
  error:   "bg-signal-rose",
  offline: "bg-cream-dim/40",
  paused:  "bg-signal-amber",
};

const STATUS_TEXT: Record<AgentStatus, string> = {
  active:  "text-signal-emerald",
  idle:    "text-cream-dim",
  error:   "text-signal-rose",
  offline: "text-cream-dim/60",
  paused:  "text-signal-amber",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  active:  "Active",
  idle:    "Idle",
  error:   "Error",
  offline: "Offline",
  paused:  "Paused",
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  task_started:     <Play className="h-3.5 w-3.5" />,
  task_completed:   <CheckCircle2 className="h-3.5 w-3.5" />,
  task_delegated:   <Send className="h-3.5 w-3.5" />,
  brief_posted:     <Sparkles className="h-3.5 w-3.5" />,
  approval_queued:  <Clock className="h-3.5 w-3.5" />,
  heartbeat:        <Activity className="h-3.5 w-3.5" />,
  error:            <AlertTriangle className="h-3.5 w-3.5" />,
  warning:          <AlertTriangle className="h-3.5 w-3.5" />,
  info:             <Info className="h-3.5 w-3.5" />,
};

const EVENT_SEVERITY_CLASS: Record<string, string> = {
  error:   "text-signal-rose bg-signal-rose/10",
  warning: "text-signal-amber bg-signal-amber/10",
  success: "text-signal-emerald bg-signal-emerald/10",
  info:    "text-brass-light bg-brass/10",
};

const PRIORITY_COLORS: Record<string, string> = {
  low:    "text-cream-dim border-brass/15 bg-cream/5",
  medium: "text-brass-light border-brass/25 bg-brass/10",
  high:   "text-signal-amber border-signal-amber/30 bg-signal-amber/10",
  urgent: "text-signal-rose border-signal-rose/30 bg-signal-rose/10",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  pending:    "text-cream-dim border-brass/10",
  active:     "text-signal-emerald border-signal-emerald/20 bg-signal-emerald/5",
  completed:  "text-cream-dim border-brass/10 opacity-60",
  failed:     "text-signal-rose border-signal-rose/20 bg-signal-rose/5",
  cancelled:  "text-cream-dim border-brass/10 opacity-50",
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(score: number | undefined): string {
  if (score == null) return "bg-cream-dim/30";
  if (score >= 70) return "bg-signal-emerald";
  if (score >= 40) return "bg-signal-amber";
  return "bg-signal-rose";
}

function SkeletonBlock({ h = "h-24" }: { h?: string }) {
  return <div className={cn("glass-panel rounded-2xl animate-pulse", h)} />;
}

// ─── Event Feed ───────────────────────────────────────────────────────────────

function EventFeed({ slug }: { slug: string }) {
  const { data: events = [], isLoading, refetch, isFetching } = useAgentEvents(slug, 50);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <div className="ui-label">Live Activity</div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className={cn(
            "text-cream-dim hover:text-cream transition-colors",
            isFetching && "animate-spin",
          )}
          aria-label="Refresh events"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel rounded-xl animate-pulse h-12" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-cream-dim text-xs text-center py-6 border border-dashed border-brass/15 rounded-xl">
          No events yet.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
          {events.map((ev: any, i: number) => {
            const icon = EVENT_ICONS[ev.event_type] ?? EVENT_ICONS.info;
            const sevClass = EVENT_SEVERITY_CLASS[ev.severity ?? ev.event_type] ?? EVENT_SEVERITY_CLASS.info;
            return (
              <div key={ev.id ?? i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-cream/3 border border-brass/8 hover:bg-cream/5 transition-colors">
                <span className={cn("shrink-0 p-1 rounded-lg mt-0.5", sevClass)}>
                  {icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {ev.event_type && (
                      <span className="text-[9px] text-cream-dim capitalize">
                        {String(ev.event_type).replace(/_/g, " ")}
                      </span>
                    )}
                    <span className="text-[9px] text-cream-dim ml-auto shrink-0">
                      {formatRelative(ev.created_at ?? ev.timestamp)}
                    </span>
                  </div>
                  {ev.summary || ev.message ? (
                    <p className="text-xs text-cream-muted leading-snug mt-0.5 line-clamp-2">
                      {String(ev.summary ?? ev.message)}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tasks List ───────────────────────────────────────────────────────────────

function TasksList({ slug }: { slug: string }) {
  const { data: tasks = [], isLoading } = useAgentTasks(slug);

  if (isLoading) {
    return <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="glass-panel rounded-xl animate-pulse h-14" />)}</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="text-cream-dim text-xs text-center py-5 border border-dashed border-brass/15 rounded-xl">
        No tasks assigned.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
      {tasks.map((task: any, i: number) => {
        const statusClass = TASK_STATUS_COLORS[task.status ?? "pending"] ?? TASK_STATUS_COLORS.pending;
        const priorityClass = PRIORITY_COLORS[task.priority ?? "medium"] ?? PRIORITY_COLORS.medium;
        return (
          <div key={task.id ?? i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-brass/10 bg-cream/3">
            <ListTodo className="h-3.5 w-3.5 text-cream-dim shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-cream font-medium line-clamp-1">{task.title ?? "(untitled)"}</div>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {task.status && (
                  <span className={cn("px-1.5 py-0.5 text-[9px] rounded border", statusClass)}>
                    {task.status}
                  </span>
                )}
                {task.priority && (
                  <span className={cn("px-1.5 py-0.5 text-[9px] rounded border", priorityClass)}>
                    {task.priority}
                  </span>
                )}
                {task.due_at && (
                  <span className="text-[9px] text-cream-dim">{formatRelative(task.due_at)}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Delegate Task Form ───────────────────────────────────────────────────────

function DelegateTaskPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
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
      toast.success("Task delegated successfully");
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueAt("");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delegate task");
    }
  };

  return (
    <GlassCard variant="strong" className="p-5 rounded-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="ui-label">Delegate Task</div>
        <button onClick={onClose} className="text-cream-dim hover:text-cream" aria-label="Close">
          <XCircle className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="dtask-title" className="ui-label block mb-1.5">
            Title <span className="text-signal-rose">*</span>
          </label>
          <input
            id="dtask-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What should the agent do?"
            required
            className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 focus:ring-1 focus:ring-brass/30"
          />
        </div>
        <div>
          <label htmlFor="dtask-desc" className="ui-label block mb-1.5">Description</label>
          <textarea
            id="dtask-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Additional context..."
            className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 resize-none h-20"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dtask-priority" className="ui-label block mb-1.5">Priority</label>
            <select
              id="dtask-priority"
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
            <label htmlFor="dtask-due" className="ui-label block mb-1.5">Due Date</label>
            <input
              id="dtask-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream focus:outline-none focus:border-brass/50"
            />
          </div>
        </div>
        <Button type="submit" className="btn-brass w-full" disabled={delegate.isPending}>
          <Send className="h-4 w-4 mr-2" />
          {delegate.isPending ? "Delegating…" : "Delegate Task"}
        </Button>
      </form>
    </GlassCard>
  );
}

// ─── Approval Section ─────────────────────────────────────────────────────────

function AgentApprovals({ agent, showFinancials }: { agent: any; showFinancials: boolean }) {
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const approve = useApproveAction();

  // Approvals embedded in agent detail response
  const approvals: any[] = agent.pendingApprovalItems ?? [];
  if (approvals.length === 0) return null;

  const handleApprove = async (id: string) => {
    try {
      await approve.mutateAsync({ id, action: "approve" });
      toast.success("Approved");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const handleDeny = async (id: string) => {
    try {
      await approve.mutateAsync({ id, action: "deny", notes: denyNote || undefined });
      toast.success("Denied");
      setDenyingId(null);
      setDenyNote("");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="ui-label">Pending Approvals</div>
        <span className="h-4 min-w-4 px-1 rounded-full bg-signal-amber/20 border border-signal-amber/30 text-signal-amber text-[9px] flex items-center justify-center">
          {approvals.length}
        </span>
      </div>
      <div className="space-y-2">
        {approvals.map((item: any) => {
          if (item.category === "financial" && !showFinancials) return null;
          const statusMeta = STATUS_META[item.status] ?? STATUS_META.pending;
          const isActionable = item.status === "pending" || item.status === "awaiting_second";
          return (
            <GlassCard key={item.id} className={cn("p-4", item.category === "financial" && "border-signal-amber/30")}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className={cn("inline-flex items-center gap-1 text-[10px]", statusMeta.color)}>
                  {statusMeta.icon} {statusMeta.label}
                </span>
                {item.category && (
                  <span className="text-[10px] text-cream-dim border border-brass/15 rounded px-1.5 capitalize">
                    {String(item.category).replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <div className="text-sm text-cream font-medium">{item.title ?? "(untitled)"}</div>
              {item.summary && (
                <p className="text-xs text-cream-muted mt-1 line-clamp-2">{String(item.summary)}</p>
              )}
              {isActionable && (
                denyingId === item.id ? (
                  <div className="mt-3 pt-3 border-t border-brass/10 space-y-2">
                    <textarea
                      value={denyNote}
                      onChange={(e) => setDenyNote(e.target.value)}
                      placeholder="Reason for denial (optional)"
                      className="w-full text-xs bg-forest-raised/50 border border-brass/15 rounded p-2 text-cream placeholder:text-cream-dim focus:outline-none resize-none h-14"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleDeny(item.id)} disabled={approve.isPending}>
                        Confirm Deny
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDenyingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-brass/10">
                    <Button size="sm" className="btn-brass h-7 text-xs" onClick={() => handleApprove(item.id)} disabled={approve.isPending}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10 hover:text-signal-rose"
                      onClick={() => { setDenyingId(item.id); setDenyNote(""); }}
                      disabled={approve.isPending}
                    >
                      Deny
                    </Button>
                  </div>
                )
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ agent, slug }: { agent: any; slug: string }) {
  const [settingsStr, setSettingsStr] = useState(() => JSON.stringify(agent.settings ?? {}, null, 2));
  const [parseError, setParseError] = useState("");
  const updateAgent = useUpdateAgent(slug);

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(settingsStr);
      setParseError("");
      await updateAgent.mutateAsync({ settings: parsed });
      toast.success("Settings saved");
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setParseError("Invalid JSON — please fix before saving.");
      } else {
        toast.error(err?.message ?? "Failed to save");
      }
    }
  };

  return (
    <GlassCard variant="strong" className="p-5 rounded-2xl">
      <div className="ui-label mb-3">Agent Settings</div>
      <textarea
        value={settingsStr}
        onChange={(e) => { setSettingsStr(e.target.value); setParseError(""); }}
        className={cn(
          "w-full font-mono text-xs bg-forest-raised/60 border rounded-xl p-3 text-cream focus:outline-none focus:border-brass/50 resize-none h-40",
          parseError ? "border-signal-rose/40" : "border-brass/20",
        )}
        aria-label="Agent settings JSON"
        spellCheck={false}
      />
      {parseError && <p className="text-signal-rose text-xs mt-1">{parseError}</p>}
      <Button size="sm" className="btn-brass mt-3" onClick={handleSave} disabled={updateAgent.isPending}>
        {updateAgent.isPending ? "Saving…" : "Save Settings"}
      </Button>
    </GlassCard>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: agent, isLoading } = useAgent(slug);
  const [showDelegate, setShowDelegate] = useState(false);
  const updateAgent = useUpdateAgent(slug);

  const showFinancials = canSeeFinancials(me?.role);
  const isSuperAdmin = me?.role === "super_admin";

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-up">
        <SkeletonBlock h="h-8 w-32" />
        <SkeletonBlock h="h-28" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonBlock key={i} h="h-20" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SkeletonBlock h="h-64" />
          <div className="lg:col-span-2 space-y-4">
            <SkeletonBlock h="h-48" />
            <SkeletonBlock h="h-40" />
          </div>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4 animate-fade-up">
        <Bot className="h-12 w-12 text-cream-dim" />
        <div className="text-cream-muted text-sm">Agent not found.</div>
        <Button variant="outline" onClick={() => navigate("/mission-control")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Mission Control
        </Button>
      </div>
    );
  }

  const status: AgentStatus = agent.status ?? "offline";
  const health = agent.health_score ?? 0;
  const dotClass = AGENT_DOT_CLASS[status] ?? "bg-cream-dim/30";
  const statusText = STATUS_TEXT[status] ?? "text-cream-dim";
  const statsEntries = agent.stats ? Object.entries(agent.stats) : [];

  const handleToggleEnabled = async () => {
    try {
      await updateAgent.mutateAsync({ enabled: !agent.enabled });
      toast.success(agent.enabled ? "Agent disabled" : "Agent enabled");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update agent");
    }
  };

  return (
    <div className="space-y-8 animate-fade-up">
      {/* Back */}
      <button
        onClick={() => navigate("/mission-control")}
        className="flex items-center gap-1.5 text-sm text-cream-dim hover:text-cream transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Mission Control
      </button>

      {/* Hero */}
      <div className="glass-panel-strong rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={cn("h-3 w-3 rounded-full shrink-0 mt-2", dotClass)} />
            <div>
              <h1 className="display-heading text-4xl md:text-5xl leading-tight">{agent.name}</h1>
              <p className="text-cream-muted mt-1">{agent.role}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Enabled toggle */}
            <button
              onClick={handleToggleEnabled}
              disabled={updateAgent.isPending}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all",
                agent.enabled
                  ? "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10 hover:bg-signal-emerald/15"
                  : "text-cream-dim border-brass/20 bg-cream/5 hover:bg-cream/10",
              )}
            >
              {agent.enabled
                ? <ToggleRight className="h-4 w-4" />
                : <ToggleLeft className="h-4 w-4" />
              }
              {agent.enabled ? "Enabled" : "Disabled"}
            </button>
            <Button className="btn-brass" onClick={() => setShowDelegate((v) => !v)}>
              <Send className="h-4 w-4 mr-2" />
              Delegate Task
            </Button>
          </div>
        </div>

        {/* Health bar */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="ui-label text-[10px]">Health Score</span>
            <span className={cn("text-xs font-medium", statusText)}>
              {STATUS_LABEL[status]} · {health}/100
            </span>
          </div>
          <div className="h-2 w-full bg-cream/5 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-700", healthColor(agent.health_score))}
              style={{ width: `${health}%` }}
            />
          </div>
        </div>

        {/* Model + platform + last heartbeat */}
        <div className="flex flex-wrap gap-2">
          {agent.model && (
            <span className="px-2 py-1 text-[10px] rounded-full bg-brass/10 border border-brass/20 text-brass-light">
              {agent.model}
            </span>
          )}
          {agent.platform && (
            <span className="px-2 py-1 text-[10px] rounded-full bg-cream/5 border border-brass/10 text-cream-dim">
              {agent.platform}
            </span>
          )}
          {agent.last_heartbeat_at && (
            <span className="px-2 py-1 text-[10px] rounded-full bg-cream/5 border border-brass/10 text-cream-dim flex items-center gap-1">
              <Activity className="h-2.5 w-2.5" />
              Heartbeat {formatRelative(agent.last_heartbeat_at)}
            </span>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Health Score"
          value={`${health}`}
          hint="/100"
          accent={health >= 70 ? "emerald" : health >= 40 ? "amber" : "rose"}
          icon={<Activity className="h-4 w-4" />}
        />
        <KpiCard
          label="Tasks Today"
          value={String(agent.recentTaskCount ?? agent.stats?.tasks_today ?? "—")}
          hint="delegated tasks"
          icon={<ListTodo className="h-4 w-4" />}
        />
        <KpiCard
          label="Pending Approvals"
          value={String(agent.pendingApprovals ?? 0)}
          hint="awaiting review"
          accent={(agent.pendingApprovals ?? 0) > 0 ? "amber" : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <KpiCard
          label="Events (24h)"
          value={String(agent.stats?.events_24h ?? "—")}
          hint="logged events"
          icon={<Sparkles className="h-4 w-4" />}
        />
      </div>

      {/* Delegate panel (slide-in style, shown inline above main layout when open) */}
      {showDelegate && (
        <DelegateTaskPanel slug={slug!} onClose={() => setShowDelegate(false)} />
      )}

      {/* Main 3-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Agent info */}
        <div className="space-y-4">
          <GlassCard className="p-5 rounded-2xl space-y-4">
            <div className="ui-label">About</div>
            {agent.description && (
              <p className="text-sm text-cream-muted leading-relaxed">{String(agent.description)}</p>
            )}

            {agent.current_task && (
              <div>
                <div className="ui-label text-[9px] mb-1">Current Task</div>
                <p className="text-xs italic text-cream-dim leading-relaxed">{agent.current_task}</p>
                {agent.current_task_since && (
                  <span className="text-[9px] text-cream-dim/60">{formatRelative(agent.current_task_since)}</span>
                )}
              </div>
            )}

            {statsEntries.length > 0 && (
              <div>
                <div className="ui-label text-[9px] mb-2">Stats</div>
                <div className="grid grid-cols-2 gap-2">
                  {statsEntries.map(([key, val]) => (
                    <div key={key} className="glass-panel rounded-xl p-2.5">
                      <div className="kpi-number text-base leading-none">{String(val)}</div>
                      <div className="ui-label text-[8px] mt-1 capitalize">{key.replace(/_/g, " ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agent.last_action_summary && (
              <div>
                <div className="ui-label text-[9px] mb-1">Last Action</div>
                <p className="text-xs text-cream-muted leading-relaxed">{String(agent.last_action_summary)}</p>
                {agent.last_action_at && (
                  <span className="text-[9px] text-cream-dim">{formatDateTime(agent.last_action_at)}</span>
                )}
              </div>
            )}
          </GlassCard>

          {/* Settings (super_admin only) */}
          {isSuperAdmin && <SettingsPanel agent={agent} slug={slug!} />}
        </div>

        {/* Center columns: Activity + Tasks */}
        <div className="lg:col-span-2 space-y-5">
          <GlassCard className="p-5 rounded-2xl">
            <EventFeed slug={slug!} />
          </GlassCard>

          <GlassCard className="p-5 rounded-2xl">
            <div className="ui-label mb-3">Tasks</div>
            <TasksList slug={slug!} />
          </GlassCard>

          {/* Pending approvals for this agent */}
          {(agent.pendingApprovals ?? 0) > 0 && (
            <GlassCard className="p-5 rounded-2xl">
              <AgentApprovals agent={agent} showFinancials={showFinancials} />
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
