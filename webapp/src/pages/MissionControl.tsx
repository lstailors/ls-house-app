import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock, Eye,
  Bot, ChevronDown, ChevronUp, Send, Cpu, Wifi, WifiOff,
  DollarSign, Calendar, ListTodo, Shield, Radio, Play,
  RefreshCw, Filter, Bell, Zap, Server, Cloud,
  TrendingUp, ToggleLeft, ToggleRight, MessageSquare,
  Scissors, ChevronRight, Circle,
} from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import {
  useAgents, usePendingApprovals, useApproveAction,
  useAgentCosts, useCronJobs, useToggleCronJob,
  useAuditLog, useLiveFeed, useSofiaConversations,
  useAgentBriefs,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = "active" | "idle" | "error" | "offline" | "paused";
type Tab = "fleet" | "approvals" | "live" | "sofia" | "costs" | "cron" | "audit";

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_DOT: Record<AgentStatus, string> = {
  active:  "bg-signal-emerald shadow-[0_0_6px_rgba(79,191,142,0.8)] animate-pulse",
  idle:    "bg-cream/30",
  error:   "bg-signal-rose shadow-[0_0_6px_rgba(255,80,80,0.7)]",
  offline: "bg-cream/10",
  paused:  "bg-signal-amber shadow-[0_0_6px_rgba(255,180,50,0.7)]",
};

const AGENT_STATUS_TEXT: Record<AgentStatus, string> = {
  active:  "text-signal-emerald",
  idle:    "text-cream-dim",
  error:   "text-signal-rose",
  offline: "text-cream-dim/50",
  paused:  "text-signal-amber",
};

const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  active:  "Active",
  idle:    "Idle",
  error:   "Error",
  offline: "Offline",
  paused:  "Paused",
};

const AGENT_GLOW: Record<string, string> = {
  maestro: "hover:shadow-[0_0_30px_rgba(180,140,60,0.12)] hover:border-brass/40",
  sofia:   "hover:shadow-[0_0_30px_rgba(79,191,142,0.10)] hover:border-emerald-500/30",
  mia:     "hover:shadow-[0_0_30px_rgba(100,150,255,0.10)] hover:border-blue-400/30",
  rocco:   "hover:shadow-[0_0_30px_rgba(180,140,60,0.10)] hover:border-amber-500/30",
  melena:  "hover:shadow-[0_0_30px_rgba(255,100,100,0.08)] hover:border-rose-400/20",
  filo:    "hover:shadow-[0_0_30px_rgba(150,80,255,0.10)] hover:border-purple-400/30",
};

const AGENT_PHOTO: Record<string, string> = {
  maestro: "/agents/maestro.jpg",
  sofia:   "/agents/sofia.jpg",
  mia:     "/agents/mia.jpg",
  rocco:   "/agents/rocco.jpg",
  melena:  "/agents/melena.jpg",
  filo:    "/agents/filo.jpg",
};

const APPROVAL_STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:         { label: "Awaiting",    color: "text-signal-amber",   icon: <Clock className="h-3 w-3" /> },
  awaiting_second: { label: "Needs 2nd",  color: "text-signal-amber",   icon: <Clock className="h-3 w-3" /> },
  shadow_review:   { label: "Observation",color: "text-cream-dim",       icon: <Eye className="h-3 w-3" /> },
  approved:        { label: "Approved",   color: "text-signal-emerald",  icon: <CheckCircle2 className="h-3 w-3" /> },
  denied:          { label: "Denied",     color: "text-signal-rose",     icon: <XCircle className="h-3 w-3" /> },
};

const SEVERITY_RING: Record<string, string> = {
  critical: "border-l-2 border-l-signal-rose",
  high:     "border-l-2 border-l-signal-amber",
  medium:   "border-l-2 border-l-brass/50",
  low:      "",
  info:     "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLocal(agent: any) {
  return agent?.settings?.local === true;
}

function isSofia(agent: any) {
  return agent?.slug === "sofia";
}

function alertThreshold(agent: any): number {
  return agent?.settings?.cost_alert_threshold_usd ?? 5;
}

function healthColor(score: number | undefined) {
  if (score == null) return "bg-cream/10";
  if (score >= 70) return "bg-signal-emerald";
  if (score >= 40) return "bg-signal-amber";
  return "bg-signal-rose";
}

function fmtCost(n: number) {
  return `$${n.toFixed(2)}`;
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ id, label, icon: Icon, active, badge, onClick }: {
  id: Tab; label: string; icon: any; active: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all",
        active
          ? "bg-brass/15 text-cream border border-brass/30"
          : "text-cream-dim hover:text-cream hover:bg-brass/5"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
      {(badge ?? 0) > 0 && (
        <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-signal-amber text-[9px] font-bold text-forest-deep flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Agent status card ────────────────────────────────────────────────────────

function AgentStatusCard({ agent, costToday, onClick }: {
  agent: any; costToday: number; onClick: () => void;
}) {
  const navigate = useNavigate();
  const status = (agent.status ?? "offline") as AgentStatus;
  const dot = AGENT_DOT[status] ?? AGENT_DOT.offline;
  const statusText = AGENT_STATUS_TEXT[status] ?? "text-cream-dim";
  const glow = AGENT_GLOW[agent.slug] ?? "";
  const photo = AGENT_PHOTO[agent.slug];
  const local = isLocal(agent);
  const sofia = isSofia(agent);
  const threshold = alertThreshold(agent);
  const overBudget = !local && costToday >= threshold;

  return (
    <div
      onClick={() => navigate(`/mission-control/agents/${agent.slug}`)}
      className={cn(
        "glass-panel rounded-2xl p-4 cursor-pointer border border-brass/10 transition-all duration-200 group",
        glow,
        overBudget && "border-signal-amber/40 shadow-[0_0_16px_rgba(255,180,50,0.08)]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar + status dot */}
        <div className="relative shrink-0">
          {photo ? (
            <img src={photo} alt={agent.name} className="h-11 w-11 rounded-full object-cover border border-brass/20" />
          ) : (
            <div className="h-11 w-11 rounded-full bg-brass/10 border border-brass/20 flex items-center justify-center">
              <Bot className="h-5 w-5 text-brass-light" />
            </div>
          )}
          <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0D1A10]", dot)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-display italic text-lg leading-none text-cream">{agent.name}</span>
            {local && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase border border-purple-400/40 text-purple-300 bg-purple-900/20">
                <Server className="h-2 w-2" /> LOCAL
              </span>
            )}
            {sofia && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase border border-emerald-500/30 text-emerald-400 bg-emerald-900/15">
                <MessageSquare className="h-2 w-2" /> CLIENT
              </span>
            )}
          </div>
          <div className="text-[10px] text-cream-dim truncate">{agent.role}</div>
        </div>
      </div>

      {/* Health bar */}
      <div className="mt-3 mb-2">
        <div className="flex justify-between items-center mb-1">
          <span className="ui-label text-[9px]">Health</span>
          <span className={cn("text-[10px] font-medium", statusText)}>
            {AGENT_STATUS_LABEL[status]}
          </span>
        </div>
        <div className="h-1 w-full bg-cream/5 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", healthColor(agent.health_score))}
            style={{ width: `${agent.health_score ?? 0}%` }}
          />
        </div>
      </div>

      {/* Current task */}
      {agent.current_task ? (
        <p className="text-[10px] text-cream-dim italic line-clamp-1 mb-2">{agent.current_task}</p>
      ) : (
        <p className="text-[10px] text-cream/20 italic mb-2">—</p>
      )}

      {/* Cost / local indicator */}
      <div className="flex items-center justify-between">
        {local ? (
          <span className="flex items-center gap-1 text-[10px] text-purple-300">
            <Cpu className="h-2.5 w-2.5" />
            <span className="font-mono">$0.00 today</span>
          </span>
        ) : (
          <span className={cn(
            "flex items-center gap-1 text-[10px] font-mono",
            overBudget ? "text-signal-amber" : "text-cream-dim"
          )}>
            {overBudget && <AlertTriangle className="h-2.5 w-2.5" />}
            {fmtCost(costToday)} today
          </span>
        )}
        <span className="text-[9px] text-cream/20 group-hover:text-cream-dim transition-colors">
          View →
        </span>
      </div>

      {/* Model badge */}
      <div className="mt-2 flex items-center gap-1">
        {local ? (
          <span className="px-1.5 py-0.5 text-[8px] rounded bg-purple-900/20 border border-purple-400/20 text-purple-300 truncate max-w-full">
            {agent.model}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 text-[8px] rounded bg-brass/5 border border-brass/10 text-cream-dim flex items-center gap-1 truncate max-w-full">
            <Cloud className="h-2 w-2" /> {agent.model}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Panel 1 — Fleet ──────────────────────────────────────────────────────────

function FleetPanel({ agents, costs }: { agents: any[]; costs: any }) {
  const navigate = useNavigate();
  const costsData = (costs as any)?.data ?? costs ?? {};

  const getCostToday = (slug: string): number => {
    const agentCosts = costsData[slug];
    if (!agentCosts) return 0;
    const today = new Date().toISOString().split("T")[0];
    return (agentCosts.daily ?? [])
      .filter((d: any) => d.day === today)
      .reduce((s: number, d: any) => s + Number(d.cost_usd ?? 0), 0);
  };

  const internal = agents.filter(a => !isSofia(a));
  const sofia = agents.find(isSofia);

  return (
    <div className="space-y-6">
      {/* Internal fleet */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Server className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">INTERNAL FLEET · MAC STUDIO</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {internal.map(a => (
            <AgentStatusCard key={a.id} agent={a} costToday={getCostToday(a.slug)} onClick={() => navigate(`/mission-control/agents/${a.slug}`)} />
          ))}
        </div>
      </div>

      {/* Sofia lane */}
      {sofia && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-3.5 w-3.5 text-signal-emerald/70" />
            <span className="ui-label text-[10px] tracking-widest">CLIENT CONCIERGE · N8N CLOUD · TWILIO</span>
          </div>
          <div className="glass-panel rounded-2xl p-4 border border-emerald-500/15">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img src={AGENT_PHOTO.sofia} alt="Sofia" className="h-12 w-12 rounded-full object-cover border border-emerald-500/30" />
                  <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0D1A10]", AGENT_DOT[sofia.status as AgentStatus] ?? AGENT_DOT.offline)} />
                </div>
                <div>
                  <div className="font-display italic text-xl text-cream">Sofia</div>
                  <div className="text-[10px] text-cream-dim">Client Concierge · Grok · n8n</div>
                </div>
              </div>
              <div className="flex gap-6">
                <div className="text-center">
                  <div className="kpi-number text-lg">{sofia.stats?.sms_today ?? 0}</div>
                  <div className="ui-label text-[9px]">SMS Today</div>
                </div>
                <div className="text-center">
                  <div className="kpi-number text-lg">{sofia.stats?.bookings_today ?? 0}</div>
                  <div className="ui-label text-[9px]">Booked</div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-lg text-cream">{fmtCost(getCostToday("sofia"))}</div>
                  <div className="ui-label text-[9px]">Grok Cost</div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/mission-control/agents/sofia")}
                className="ml-auto border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/20"
              >
                Sofia Detail →
              </Button>
            </div>
            {sofia.current_task && (
              <p className="text-xs text-cream-dim italic mt-3 border-t border-emerald-500/10 pt-3">
                {sofia.current_task}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel 2 — Approvals ──────────────────────────────────────────────────────

function ApprovalCard({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const [denying, setDenying] = useState(false);
  const [denyNote, setDenyNote] = useState("");
  const approve = useApproveAction();

  const meta = APPROVAL_STATUS_META[item.status] ?? APPROVAL_STATUS_META.pending;
  const isActionable = item.status === "pending" || item.status === "awaiting_second";
  const isResolved = ["approved", "denied", "expired", "cancelled", "revised"].includes(item.status);
  const severity = SEVERITY_RING[item.priority ?? "medium"] ?? "";

  const handleApprove = async () => {
    try {
      await approve.mutateAsync({ id: item.id, action: "approve" });
      toast.success("Approved — agent released.");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const handleDeny = async () => {
    try {
      await approve.mutateAsync({ id: item.id, action: "deny", notes: denyNote || undefined });
      toast.success("Denied.");
      setDenying(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  return (
    <div className={cn(
      "glass-panel rounded-xl p-4 border border-brass/10 transition-all",
      isResolved && "opacity-40",
      severity
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brass/10 border border-brass/20 text-[10px] text-brass-light">
              <Bot className="h-2.5 w-2.5" />
              {(item.source_agent ?? "agent").charAt(0).toUpperCase() + (item.source_agent ?? "agent").slice(1)}
            </span>
            <span className={cn("inline-flex items-center gap-1 text-[10px]", meta.color)}>
              {meta.icon} {meta.label}
            </span>
            {item.category && (
              <span className="text-[10px] text-cream-dim border border-brass/15 rounded px-1.5 py-0.5 capitalize">
                {String(item.category).replace(/_/g, " ")}
              </span>
            )}
          </div>
          <p className="text-sm text-cream font-medium leading-snug">{item.title ?? "(untitled)"}</p>
          {item.summary && (
            <p className="text-xs text-cream-muted mt-1 line-clamp-2">{String(item.summary)}</p>
          )}
          {item.created_at && (
            <p className="text-[10px] text-cream-dim mt-1">{formatRelative(item.created_at)}</p>
          )}
        </div>
        {(item.proposed_action || item.payload) && (
          <button onClick={() => setExpanded(e => !e)} className="text-cream-dim hover:text-cream shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {expanded && item.proposed_action && (
        <div className="mt-3 pt-3 border-t border-brass/10">
          <span className="ui-label text-[9px] block mb-1">Proposed action</span>
          <p className="text-xs text-cream">{String(item.proposed_action)}</p>
        </div>
      )}

      {item.status === "shadow_review" && (
        <div className="mt-3 pt-2 border-t border-brass/10 flex items-center gap-1.5 text-[10px] text-cream-dim">
          <Eye className="h-3 w-3" /> Observation only
        </div>
      )}

      {isActionable && (
        <div className="mt-3 pt-3 border-t border-brass/10">
          {denying ? (
            <div className="space-y-2">
              <textarea
                value={denyNote}
                onChange={e => setDenyNote(e.target.value)}
                placeholder="Reason for denial (optional)"
                className="w-full text-xs bg-forest-raised/50 border border-brass/15 rounded-lg p-2 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 resize-none h-14"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleDeny} disabled={approve.isPending}>
                  Confirm Deny
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs border-brass/20" onClick={() => setDenying(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" className="btn-brass h-9 text-xs flex-1" onClick={handleApprove} disabled={approve.isPending}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Approve & Release
              </Button>
              <Button size="sm" variant="outline" className="h-9 text-xs border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10" onClick={() => setDenying(true)} disabled={approve.isPending}>
                Deny
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalsPanel() {
  const { data: pending, isLoading } = usePendingApprovals();
  const items: any[] = (pending as any)?.byAgent
    ? Object.values((pending as any).byAgent).flat()
    : Array.isArray(pending) ? pending : [];

  const active = items.filter(i => i.status === "pending" || i.status === "awaiting_second");
  const resolved = items.filter(i => !["pending", "awaiting_second"].includes(i.status));

  if (isLoading) return <div className="text-cream-muted text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center border border-dashed border-brass/15">
          <CheckCircle2 className="h-8 w-8 text-signal-emerald/50 mx-auto mb-3" />
          <p className="text-cream-muted text-sm">Queue clear. All agents running freely.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="ui-label text-[10px]">AWAITING YOUR DECISION</span>
            <span className="h-4 min-w-4 px-1 rounded-full bg-signal-amber text-[9px] font-bold text-forest-deep flex items-center justify-center">{active.length}</span>
          </div>
          {active.map((item: any) => <ApprovalCard key={item.id} item={item} />)}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="space-y-2">
          <span className="ui-label text-[10px] text-cream-dim/60">RECENTLY RESOLVED</span>
          {resolved.slice(0, 5).map((item: any) => <ApprovalCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}

// ─── Panel 3 — Live Feed ──────────────────────────────────────────────────────

function LiveFeedPanel() {
  const { data: events = [], isLoading, refetch, isFetching } = useLiveFeed();
  const evts = Array.isArray(events) ? events : (events as any)?.data ?? [];

  const SEVERITY_DOT: Record<string, string> = {
    error:   "bg-signal-rose",
    warning: "bg-signal-amber",
    success: "bg-signal-emerald",
    info:    "bg-brass/60",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-signal-emerald animate-pulse" />
          <span className="ui-label text-[10px]">LIVE · LAST 2H</span>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className={cn("text-cream-dim hover:text-cream", isFetching && "animate-spin")}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="glass-panel rounded-xl h-12 animate-pulse" />)}</div>
      ) : evts.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center border border-dashed border-brass/15">
          <Activity className="h-6 w-6 text-cream-dim/40 mx-auto mb-2" />
          <p className="text-cream-dim text-xs">No activity in the last 2 hours.</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {evts.map((ev: any, i: number) => (
            <div key={ev.id ?? i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-cream/[0.02] border border-brass/8 hover:bg-cream/[0.04] transition-colors group">
              <span className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", SEVERITY_DOT[ev.severity] ?? SEVERITY_DOT.info)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-brass-light/60 uppercase tracking-wider font-medium">
                    {ev.agent_slug}
                  </span>
                  <span className="text-[9px] text-cream-dim">
                    {String(ev.event_type ?? "").replace(/_/g, " ")}
                  </span>
                  <span className="ml-auto text-[9px] text-cream/20 shrink-0">
                    {formatRelative(ev.created_at)}
                  </span>
                </div>
                {(ev.summary || ev.message) && (
                  <p className="text-xs text-cream-muted mt-0.5 line-clamp-2">
                    {String(ev.summary ?? ev.message)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel 4 — Sofia Lane ─────────────────────────────────────────────────────

function SofiaPanel() {
  const { data: convos = [], isLoading } = useSofiaConversations();
  const threads = Array.isArray(convos) ? convos : (convos as any)?.data ?? [];

  const STATUS_DOT: Record<string, string> = {
    open: "bg-signal-emerald",
    waiting: "bg-signal-amber",
    closed: "bg-cream/20",
    escalated: "bg-signal-rose",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-3.5 w-3.5 text-signal-emerald/70" />
        <span className="ui-label text-[10px] tracking-widest">SOFIA · CLIENT SMS THREADS</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="glass-panel rounded-xl h-16 animate-pulse" />)}</div>
      ) : threads.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center border border-dashed border-brass/15 border-emerald-500/10">
          <MessageSquare className="h-6 w-6 text-emerald-500/30 mx-auto mb-2" />
          <p className="text-cream-dim text-xs">No active client threads.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {threads.map((t: any, i: number) => (
            <div key={t.id ?? i} className="glass-panel rounded-xl p-3.5 border border-brass/10 hover:border-emerald-500/20 transition-colors">
              <div className="flex items-start gap-3">
                <span className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", STATUS_DOT[t.status] ?? STATUS_DOT.open)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-cream font-medium truncate">{t.customer_name ?? t.phone}</span>
                    <span className="text-[10px] text-cream-dim ml-auto shrink-0">{formatRelative(t.last_message_at ?? t.updated_at)}</span>
                  </div>
                  {t.last_message && (
                    <p className="text-xs text-cream-muted mt-0.5 line-clamp-1">{String(t.last_message)}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {t.status && <span className="text-[9px] text-cream-dim capitalize border border-brass/10 rounded px-1.5 py-0.5">{t.status}</span>}
                    {t.appointment_booked && <span className="text-[9px] text-signal-emerald border border-signal-emerald/20 rounded px-1.5 py-0.5">Appointment booked</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel 5 — Cost Intelligence ──────────────────────────────────────────────

function CostsPanel({ agents }: { agents: any[] }) {
  const [days, setDays] = useState(7);
  const { data: costs, isLoading } = useAgentCosts(days);
  const costsData = (costs as any)?.data ?? costs ?? {};

  const totalCost = Object.values(costsData).reduce((s: number, a: any) => s + (a.totalCost ?? 0), 0);
  const today = new Date().toISOString().split("T")[0];

  const todayCost = Object.entries(costsData).reduce((s: number, [, a]: [string, any]) => {
    return s + (a.daily ?? []).filter((d: any) => d.day === today).reduce((ss: number, d: any) => ss + Number(d.cost_usd ?? 0), 0);
  }, 0);

  return (
    <div className="space-y-5">
      {/* KPI bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Today", value: fmtCost(todayCost), mono: true },
          { label: `Last ${days} days`, value: fmtCost(totalCost), mono: true },
          { label: "Alert threshold", value: "$5.00 / agent / day", mono: false },
        ].map(k => (
          <div key={k.label} className="glass-panel rounded-xl p-4">
            <div className="ui-label mb-1">{k.label}</div>
            <div className={cn("kpi-number text-lg", k.mono ? "text-brass-shimmer font-mono" : "text-cream")}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Day range picker */}
      <div className="flex gap-1.5">
        {[7, 14, 30].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={cn(
              "px-3 py-1 rounded-lg border text-xs transition-all",
              days === d ? "bg-brass/15 border-brass/30 text-cream" : "border-brass/10 text-cream-dim hover:border-brass/20"
            )}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Per-agent breakdown */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="glass-panel rounded-xl h-14 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {agents.map(agent => {
            const aData = costsData[agent.slug];
            const agentTotal = aData?.totalCost ?? 0;
            const agentTokens = aData?.totalTokens ?? 0;
            const agentToday = (aData?.daily ?? [])
              .filter((d: any) => d.day === today)
              .reduce((s: number, d: any) => s + Number(d.cost_usd ?? 0), 0);
            const local = isLocal(agent);
            const overBudget = !local && agentToday >= 5;
            const maxCost = Math.max(...agents.map(a => costsData[a.slug]?.totalCost ?? 0), 1);

            return (
              <div key={agent.id} className={cn(
                "glass-panel rounded-xl p-4 border border-brass/10",
                overBudget && "border-signal-amber/30"
              )}>
                <div className="flex items-center gap-3 mb-2">
                  {AGENT_PHOTO[agent.slug] ? (
                    <img src={AGENT_PHOTO[agent.slug]} alt={agent.name} className="h-7 w-7 rounded-full object-cover border border-brass/15 shrink-0" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-brass/10 border border-brass/15 flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-brass-light" />
                    </div>
                  )}
                  <span className="font-display italic text-base text-cream">{agent.name}</span>
                  {local && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-purple-400/30 text-purple-300 bg-purple-900/15">
                      <Server className="h-2 w-2" /> LOCAL · $0
                    </span>
                  )}
                  {overBudget && (
                    <span className="flex items-center gap-1 text-[10px] text-signal-amber ml-auto">
                      <AlertTriangle className="h-3 w-3" /> Over daily limit
                    </span>
                  )}
                  <div className="ml-auto text-right">
                    <div className={cn("font-mono text-sm", local ? "text-purple-300" : overBudget ? "text-signal-amber" : "text-cream")}>
                      {local ? "$0.00" : fmtCost(agentTotal)}
                    </div>
                    <div className="text-[9px] text-cream-dim">{local ? "local compute" : `${(agentTokens/1000).toFixed(0)}k tokens`}</div>
                  </div>
                </div>
                {!local && (
                  <div className="h-1 w-full bg-cream/5 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", overBudget ? "bg-signal-amber" : "bg-brass/60")}
                      style={{ width: `${Math.min((agentTotal / maxCost) * 100, 100)}%` }}
                    />
                  </div>
                )}
                {local && (
                  <div className="text-[10px] text-purple-300/60 italic">
                    Qwen2.5-VL · Ollama · Mac Studio · no API cost
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Panel 6 — Cron Manifest ──────────────────────────────────────────────────

function CronPanel() {
  const { data: jobs = [], isLoading } = useCronJobs();
  const toggle = useToggleCronJob();
  const crons = Array.isArray(jobs) ? jobs : (jobs as any)?.data ?? [];

  const STATUS_DOT: Record<string, string> = {
    success: "bg-signal-emerald",
    error:   "bg-signal-rose",
    running: "bg-signal-amber animate-pulse",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Calendar className="h-3.5 w-3.5 text-brass-light" />
        <span className="ui-label text-[10px] tracking-widest">SCHEDULED JOBS</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="glass-panel rounded-xl h-16 animate-pulse" />)}</div>
      ) : crons.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center border border-dashed border-brass/15">
          <Calendar className="h-6 w-6 text-cream-dim/40 mx-auto mb-2" />
          <p className="text-cream-dim text-xs">No scheduled jobs configured.</p>
        </div>
      ) : (
        crons.map((job: any) => (
          <div key={job.id} className={cn(
            "glass-panel rounded-xl p-4 border border-brass/10 transition-all",
            !job.enabled && "opacity-50"
          )}>
            <div className="flex items-start gap-3">
              <span className={cn(
                "h-2 w-2 rounded-full mt-1.5 shrink-0",
                job.last_run_status ? STATUS_DOT[job.last_run_status] ?? "bg-cream/20" : "bg-cream/20"
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-cream font-medium">{job.name}</span>
                  {job.agent_slug && (
                    <span className="text-[9px] text-cream-dim border border-brass/10 rounded px-1.5 py-0.5">
                      {job.agent_slug}
                    </span>
                  )}
                </div>
                {job.description && <p className="text-xs text-cream-muted mt-0.5">{job.description}</p>}
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="text-[10px] text-cream-dim font-mono bg-forest-deep/50 border border-brass/10 rounded px-1.5 py-0.5">
                    {job.schedule}
                  </span>
                  {job.last_run_at && (
                    <span className="text-[10px] text-cream-dim">
                      Last: {formatRelative(job.last_run_at)}
                      {job.last_run_ms && ` · ${job.last_run_ms}ms`}
                    </span>
                  )}
                  {job.next_run_at && (
                    <span className="text-[10px] text-cream-dim">
                      Next: {formatRelative(job.next_run_at)}
                    </span>
                  )}
                  <span className="text-[10px] text-cream-dim/50">
                    Runs: {job.run_count ?? 0} · Errors: {job.error_count ?? 0}
                  </span>
                </div>
              </div>
              <button
                onClick={() => toggle.mutate({ id: job.id, enabled: !job.enabled })}
                disabled={toggle.isPending}
                className="shrink-0 text-cream-dim hover:text-cream transition-colors"
                title={job.enabled ? "Pause job" : "Enable job"}
              >
                {job.enabled ? (
                  <ToggleRight className="h-5 w-5 text-signal-emerald" />
                ) : (
                  <ToggleLeft className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Panel 7 — Audit Log ─────────────────────────────────────────────────────

function AuditPanel() {
  const [agentFilter, setAgentFilter] = useState("");
  const { data: entries = [], isLoading } = useAuditLog(agentFilter || undefined, 100);
  const log = Array.isArray(entries) ? entries : (entries as any)?.data ?? [];

  const AGENTS = ["", "maestro", "sofia", "mia", "rocco", "melena", "filo"];

  const SEV_STYLE: Record<string, string> = {
    critical: "text-signal-rose bg-signal-rose/10 border-signal-rose/30",
    error:    "text-signal-rose bg-signal-rose/5 border-signal-rose/20",
    warning:  "text-signal-amber bg-signal-amber/5 border-signal-amber/20",
    info:     "text-brass-light bg-brass/5 border-brass/15",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">AUDIT LOG · FORENSIC RECORD</span>
        </div>
        <div className="flex gap-1 ml-auto flex-wrap">
          {AGENTS.map(slug => (
            <button
              key={slug || "all"}
              onClick={() => setAgentFilter(slug)}
              className={cn(
                "px-2.5 py-1 rounded-lg border text-[10px] transition-all capitalize",
                agentFilter === slug
                  ? "bg-brass/15 border-brass/30 text-cream"
                  : "border-brass/10 text-cream-dim hover:border-brass/20"
              )}
            >
              {slug || "All"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">{[1,2,3,4,5].map(i => <div key={i} className="glass-panel rounded-xl h-14 animate-pulse" />)}</div>
      ) : log.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center border border-dashed border-brass/15">
          <Shield className="h-6 w-6 text-cream-dim/40 mx-auto mb-2" />
          <p className="text-cream-dim text-xs">No audit entries yet.</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
          {log.map((entry: any, i: number) => (
            <div key={entry.id ?? i} className="glass-panel rounded-xl p-3.5 border border-brass/8 hover:border-brass/20 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {entry.agent_slug && (
                      <span className="text-[9px] text-brass-light/70 uppercase tracking-wider font-semibold">
                        {entry.agent_slug}
                      </span>
                    )}
                    <span className="text-[9px] text-cream-dim capitalize">
                      {String(entry.event_type ?? "").replace(/_/g, " ")}
                    </span>
                    {entry.severity && entry.severity !== "info" && (
                      <span className={cn("text-[9px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-wider", SEV_STYLE[entry.severity] ?? SEV_STYLE.info)}>
                        {entry.severity}
                      </span>
                    )}
                    <span className="ml-auto text-[9px] text-cream/20 shrink-0">
                      {formatRelative(entry.created_at)}
                    </span>
                  </div>
                  {entry.intent && (
                    <p className="text-xs text-cream-muted italic">"{entry.intent}"</p>
                  )}
                  {entry.tool_called && (
                    <p className="text-[10px] text-cream-dim mt-0.5">
                      <span className="font-mono bg-forest-deep/50 border border-brass/10 rounded px-1 py-0.5">{entry.tool_called}</span>
                      {entry.side_effect && <span className="ml-1.5">→ {entry.side_effect}</span>}
                    </p>
                  )}
                  {entry.policy_applied && (
                    <p className="text-[9px] text-cream-dim/60 mt-0.5">Policy: {entry.policy_applied}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MissionControl() {
  const [tab, setTab] = useState<Tab>("fleet");
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: pending } = usePendingApprovals();
  const { data: costs } = useAgentCosts(7);
  const agentList = Array.isArray(agents) ? agents : (agents as any)?.data ?? [];

  const pendingItems: any[] = (pending as any)?.byAgent
    ? Object.values((pending as any).byAgent).flat()
    : Array.isArray(pending) ? pending : [];
  const pendingCount = pendingItems.filter(i => i.status === "pending" || i.status === "awaiting_second").length;

  const TABS: { id: Tab; label: string; icon: any; badge?: number }[] = [
    { id: "fleet",     label: "Fleet",     icon: Radio },
    { id: "approvals", label: "Approvals", icon: Shield, badge: pendingCount },
    { id: "live",      label: "Live Feed", icon: Activity },
    { id: "sofia",     label: "Sofia",     icon: MessageSquare },
    { id: "costs",     label: "Costs",     icon: DollarSign },
    { id: "cron",      label: "Schedule",  icon: Calendar },
    { id: "audit",     label: "Audit",     icon: ListTodo },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Mission Control"
        title={
          <>
            The <span className="text-brass-shimmer">conductor's</span> stand.
          </>
        }
        description="Every agent, every task, every decision — one pane of glass."
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-wrap border border-brass/10 rounded-xl p-1 bg-forest-raised/20 backdrop-blur-xl">
        {TABS.map(t => (
          <TabBtn
            key={t.id}
            id={t.id}
            label={t.label}
            icon={t.icon}
            active={tab === t.id}
            badge={t.badge}
            onClick={() => setTab(t.id)}
          />
        ))}
      </div>

      {/* Panel content */}
      <div className="min-h-[400px]">
        {agentsLoading && tab === "fleet" ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="glass-panel rounded-2xl p-4 animate-pulse h-44" />
            ))}
          </div>
        ) : (
          <>
            {tab === "fleet"     && <FleetPanel agents={agentList} costs={costs} />}
            {tab === "approvals" && <ApprovalsPanel />}
            {tab === "live"      && <LiveFeedPanel />}
            {tab === "sofia"     && <SofiaPanel />}
            {tab === "costs"     && <CostsPanel agents={agentList} />}
            {tab === "cron"      && <CronPanel />}
            {tab === "audit"     && <AuditPanel />}
          </>
        )}
      </div>
    </div>
  );
}
