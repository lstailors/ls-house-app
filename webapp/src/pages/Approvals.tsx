/**
 * SPEC 067 — Dedicated Approvals route (/approvals)
 * Queue + History, risk_level/amount/payload, Edit & Approve, Reject.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Shield,
  Bot,
  AlertTriangle,
  Search,
  ExternalLink,
} from "lucide-react";
import { SectionHeader } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import { formatRelative } from "@ls/design/format";
import { toast } from "sonner";
import {
  useMissionControlApprovals,
  useMissionControlApprovalDecide,
} from "@/lib/queries";

type McApproval = {
  id: string;
  source: "agent_approval" | "queue";
  agent: string;
  action_type: string;
  summary: string;
  status: string;
  risk_level: "Low" | "Medium" | "High" | null;
  amount: number | null;
  short_code?: string | null;
  requested_at: string | null;
  expires_at: string | null;
  decided_at?: string | null;
  decided_by?: string | null;
  decision_channel?: string | null;
  decision_note?: string | null;
  payload: unknown;
  reference_doctype?: string | null;
  reference_name?: string | null;
};

const AGENTS = ["All", "Hermes", "Sofia", "Mia", "Simone", "La Penna", "Marco", "Paperclip", "Other"];
const RISKS = ["All", "Low", "Medium", "High"] as const;
const OUTCOMES = ["All", "Approved", "Denied", "Expired", "Executed"] as const;
const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 3650 },
];

function fmtCost(n: number) {
  return `$${n.toFixed(2)}`;
}

function prettyPayload(p: unknown): string {
  if (p == null) return "";
  if (typeof p === "string") {
    try {
      return JSON.stringify(JSON.parse(p), null, 2);
    } catch {
      return p;
    }
  }
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return String(p);
  }
}

function expiryLabel(expiresAt: string | null | undefined): { text: string; tone: string } | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms < 0) {
    const ago = formatRelative(expiresAt);
    return { text: `expired ${ago} — awaiting sweep`, tone: "text-signal-rose" };
  }
  const hours = ms / 3_600_000;
  if (hours < 1) {
    const m = Math.max(1, Math.round(ms / 60_000));
    return { text: `expires in ${m}m`, tone: "text-signal-amber" };
  }
  if (hours < 48) {
    return { text: `expires in ${Math.round(hours)}h`, tone: "text-cream-dim" };
  }
  return { text: `expires ${formatRelative(expiresAt)}`, tone: "text-cream-dim" };
}

function Chip({
  active,
  onClick,
  children,
  danger,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-[10px] border transition-colors whitespace-nowrap",
        active
          ? "border-brass/40 bg-brass/15 text-brass-light"
          : danger
            ? "border-signal-rose/25 text-cream-dim hover:border-signal-rose/40"
            : "border-brass/10 text-cream-dim hover:border-brass/25"
      )}
    >
      {children}
    </button>
  );
}

function ApprovalQueueCard({ item }: { item: McApproval }) {
  const decide = useMissionControlApprovalDecide();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  const risk = item.risk_level || "Medium";
  const exp = expiryLabel(item.expires_at);
  const hasPayload = item.payload != null && prettyPayload(item.payload).trim().length > 0;

  const run = async (action: "approve" | "reject" | "edit_approve", payload?: unknown) => {
    try {
      await decide.mutateAsync({
        id: item.id,
        action,
        notes: note || undefined,
        payload,
      });
      toast.success(action === "reject" ? "Rejected." : "Approved.");
      setRejecting(false);
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  const startEdit = () => {
    setEditing(true);
    setExpanded(true);
    setEditText(prettyPayload(item.payload) || "{\n  \n}");
    setEditError(null);
  };

  const confirmEditApprove = () => {
    try {
      const parsed = JSON.parse(editText);
      setEditError(null);
      void run("edit_approve", parsed);
    } catch {
      setEditError("Invalid JSON — fix before approving");
    }
  };

  return (
    <div
      id={`approval-${item.id}`}
      className={cn(
        "glass-panel rounded-[14px] p-4 border border-brass/10",
        risk === "High" && "border-l-2 border-l-signal-rose"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brass/10 border border-brass/20 text-[10px] text-brass-light">
              <Bot className="h-2.5 w-2.5" />
              {item.agent}
            </span>
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border",
                risk === "High" && "border-signal-rose/40 text-signal-rose",
                risk === "Medium" && "border-signal-amber/40 text-signal-amber",
                risk === "Low" && "border-brass/15 text-cream-dim"
              )}
            >
              {risk} risk
            </span>
            {item.amount != null && Number(item.amount) !== 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-brass/30 text-brass-light font-mono">
                {fmtCost(Number(item.amount))}
              </span>
            )}
            <span className="text-[9px] text-cream-dim/60 ml-auto font-mono">{item.source}</span>
          </div>
          <p className="ui-label text-[9px] tracking-wider text-cream-dim uppercase">
            {item.action_type.replace(/_/g, " ")}
          </p>
          <p className="text-sm text-cream font-medium leading-snug font-display italic">
            {item.summary || "(no summary)"}
          </p>
          <p className="text-[10px] text-cream-dim flex flex-wrap gap-x-2">
            <span>Requested {item.requested_at ? formatRelative(item.requested_at) : "—"}</span>
            {exp && <span className={exp.tone}>· {exp.text}</span>}
            {item.short_code && <span className="font-mono">· code {item.short_code}</span>}
          </p>
          {item.reference_doctype && item.reference_name && (
            <p className="text-[10px] text-brass-light/70 inline-flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" />
              {item.reference_doctype} {item.reference_name}
            </p>
          )}
        </div>
      </div>

      {hasPayload && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 text-[11px] text-cream-dim hover:text-cream inline-flex items-center gap-1"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          View payload
        </button>
      )}

      {expanded && (
        <div className="mt-2">
          {editing ? (
            <>
              <textarea
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                  setEditError(null);
                }}
                className="w-full max-h-[240px] min-h-[120px] font-mono text-[11px] bg-forest-deep/50 border border-brass/20 rounded-lg p-3 text-cream focus:outline-none focus:border-brass/40 resize-y"
                spellCheck={false}
              />
              {editError && <p className="text-[11px] text-signal-rose mt-1">{editError}</p>}
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  className="btn-brass h-8 text-xs"
                  disabled={decide.isPending || !!editError}
                  onClick={confirmEditApprove}
                >
                  Confirm edit & approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-brass/20"
                  onClick={() => setEditing(false)}
                >
                  Cancel edit
                </Button>
              </div>
            </>
          ) : (
            <pre className="max-h-[240px] overflow-auto font-mono text-[11px] bg-forest-deep/50 border border-brass/10 rounded-lg p-3 text-cream-muted whitespace-pre-wrap">
              {prettyPayload(item.payload)}
            </pre>
          )}
        </div>
      )}

      {!editing && (
        <div className="mt-3 pt-3 border-t border-brass/10">
          {rejecting ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for rejection (optional)"
                className="w-full text-xs bg-forest-raised/50 border border-brass/15 rounded-lg p-2 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 resize-none h-14"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs"
                  disabled={decide.isPending}
                  onClick={() => run("reject")}
                >
                  Confirm Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-brass/20"
                  onClick={() => setRejecting(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="btn-brass h-9 text-xs flex-1 min-w-[100px]"
                disabled={decide.isPending}
                onClick={() => run("approve")}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs border-brass/30 text-brass-light"
                disabled={decide.isPending}
                onClick={startEdit}
              >
                Edit & Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10"
                disabled={decide.isPending}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: McApproval }) {
  const [open, setOpen] = useState(false);
  const tone =
    item.status === "Denied" || item.status === "Expired"
      ? "bg-signal-rose"
      : item.status === "Approved" || item.status === "Executed"
        ? "bg-signal-emerald"
        : "bg-cream/30";

  return (
    <div className="border-b border-brass/8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 py-2.5 px-1 text-left hover:bg-cream/[0.03]"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", tone)} />
        <span className="text-[11px] text-cream-muted min-w-[72px]">{item.status}</span>
        <span className="text-[11px] text-brass-light">{item.agent}</span>
        <span className="text-[11px] text-cream-dim truncate">{item.action_type}</span>
        {item.amount != null && Number(item.amount) !== 0 && (
          <span className="text-[11px] font-mono text-cream">{fmtCost(Number(item.amount))}</span>
        )}
        <span className="text-[10px] text-cream-dim ml-auto shrink-0">
          {item.decided_by ? `by ${item.decided_by}` : ""}
          {item.decision_channel ? ` · ${item.decision_channel}` : ""}
          {" · "}
          {item.decided_at ? formatRelative(item.decided_at) : formatRelative(item.requested_at)}
        </span>
        {open ? <ChevronUp className="h-3 w-3 text-cream-dim" /> : <ChevronDown className="h-3 w-3 text-cream-dim" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1">
          <p className="text-xs text-cream">{item.summary}</p>
          {item.decision_note && (
            <p className="text-[11px] text-cream-dim">Note: {item.decision_note}</p>
          )}
          {item.payload != null && (
            <pre className="max-h-40 overflow-auto font-mono text-[10px] bg-forest-deep/40 rounded-lg p-2 text-cream-muted">
              {prettyPayload(item.payload)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") === "history" ? "history" : "queue") as "queue" | "history";
  const [risk, setRisk] = useState<string>("All");
  const [agent, setAgent] = useState<string>("All");
  const [financialOnly, setFinancialOnly] = useState(false);
  const [outcome, setOutcome] = useState<string>("All");
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");

  const { data, isLoading, isFetching, isError, error, refetch } = useMissionControlApprovals({
    view,
    risk: risk === "All" ? null : risk,
    agent: agent === "All" ? null : agent,
    financialOnly: view === "queue" ? financialOnly : false,
    q: q.trim() || null,
    days: view === "history" ? days : undefined,
    outcome: view === "history" && outcome !== "All" ? outcome : null,
  });

  const items: McApproval[] = (data as any)?.items ?? [];
  const emptyHint = (data as any)?.empty_hint as string | null;

  const setView = (v: "queue" | "history") => {
    const next = new URLSearchParams(params);
    if (v === "history") next.set("view", "history");
    else next.delete("view");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const id = params.get("id");
    if (!id) return;
    const el = document.getElementById(`approval-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [params, items.length]);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <SectionHeader
          eyebrow="L&S House · Mission Control"
          title={
            <>
              What&apos;s <span className="text-brass-shimmer">waiting</span> on you.
            </>
          }
          description="Dual-control gates — money, client sends, production releases. Decide here."
        />
        <Button
          size="sm"
          variant="outline"
          className="border-brass/20 text-cream-dim"
          onClick={() => navigate("/admin/mission-control?tab=fleet")}
        >
          ← Mission Control
        </Button>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-6 border-b border-brass/10">
        <button
          type="button"
          onClick={() => setView("queue")}
          className={cn(
            "pb-2 text-sm border-b-2 -mb-px transition-colors",
            view === "queue"
              ? "border-brass text-cream"
              : "border-transparent text-cream-dim hover:text-cream"
          )}
        >
          Queue
          {view === "queue" && items.length > 0 && (
            <span className="ml-2 h-4 min-w-4 px-1 rounded-full bg-signal-amber text-[9px] font-bold text-forest-deep inline-flex items-center justify-center">
              {items.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setView("history")}
          className={cn(
            "pb-2 text-sm border-b-2 -mb-px transition-colors",
            view === "history"
              ? "border-brass text-cream"
              : "border-transparent text-cream-dim hover:text-cream"
          )}
        >
          History
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          className={cn("ml-auto text-cream-dim hover:text-cream mb-2", isFetching && "animate-spin")}
          aria-label="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="ui-label text-[9px] mr-1">RISK</span>
          {RISKS.map((r) => (
            <Chip key={r} active={risk === r} danger={r === "High"} onClick={() => setRisk(r)}>
              {r}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="ui-label text-[9px] mr-1">AGENT</span>
          {AGENTS.map((a) => (
            <Chip key={a} active={agent === a} onClick={() => setAgent(a)}>
              {a}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {view === "queue" ? (
            <Chip active={financialOnly} onClick={() => setFinancialOnly((f) => !f)}>
              $ Financial only
            </Chip>
          ) : (
            <>
              <span className="ui-label text-[9px]">OUTCOME</span>
              {OUTCOMES.map((o) => (
                <Chip key={o} active={outcome === o} onClick={() => setOutcome(o)}>
                  {o}
                </Chip>
              ))}
              <span className="ui-label text-[9px] ml-2">RANGE</span>
              {RANGES.map((r) => (
                <Chip key={r.label} active={days === r.days} onClick={() => setDays(r.days)}>
                  {r.label}
                </Chip>
              ))}
            </>
          )}
          <div className="relative ml-auto">
            <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-dim" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search approvals…"
              className="pl-7 pr-3 py-1.5 text-xs rounded-lg bg-forest-raised/40 border border-brass/15 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 w-48"
            />
          </div>
        </div>
      </div>

      {isError && (
        <div className="glass-panel rounded-xl p-4 border border-signal-rose/30 text-signal-rose text-sm flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {(error as any)?.message || "Failed to load approvals"}
          </span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel rounded-xl h-28 animate-pulse" />
          ))}
        </div>
      ) : view === "queue" ? (
        items.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center border border-dashed border-brass/15">
            <CheckCircle2 className="h-8 w-8 text-signal-emerald/50 mx-auto mb-3" />
            <p className="text-cream-muted text-sm">Queue clear — no dual-control items waiting.</p>
            <p className="text-cream-dim text-[11px] mt-2 max-w-md mx-auto">
              {emptyHint ||
                "Approvals light up when an agent escalates a gated action. Empty here means nothing is blocked on C — not a missing wire."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <ApprovalQueueCard key={`${item.source}-${item.id}`} item={item} />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center border border-dashed border-brass/15">
          <Shield className="h-6 w-6 text-cream-dim/40 mx-auto mb-2" />
          <p className="text-cream-dim text-xs">
            No {outcome !== "All" ? outcome.toLowerCase() + " " : ""}approvals in the last{" "}
            {days >= 3650 ? "all time" : `${days} days`}.
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-xl px-3 py-1">
          {items.map((item) => (
            <HistoryRow key={`${item.source}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
