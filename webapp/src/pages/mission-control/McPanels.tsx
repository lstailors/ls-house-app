import { useMemo, useState } from "react";
import {
  AlertTriangle, LayoutGrid, RefreshCw, Search, X,
  Activity, CalendarClock,
} from "lucide-react";
import { cn } from "@ls/design/utils";
import { formatRelative } from "@ls/design/format";
import { Button } from "@ls/design/ui/button";
import {
  useMissionControlBoard,
  useMissionControlBoardTask,
  useMissionControlCrons,
  useMissionControlHistory,
  useMissionControlBoardAction,
  useToggleCronJob,
} from "@/lib/queries";
import type { KanbanTask } from "@ls/types";
import { toast } from "sonner";

const BOARD_COLS: { key: string; label: string; dot: string }[] = [
  { key: "todo", label: "Todo", dot: "bg-cream/40" },
  { key: "ready", label: "Ready", dot: "bg-signal-amber" },
  { key: "running", label: "Running", dot: "bg-signal-emerald animate-pulse" },
  { key: "blocked", label: "Blocked", dot: "bg-signal-rose" },
  { key: "done", label: "Done", dot: "bg-cream/25" },
];

const HIDDEN_COLS = ["triage", "scheduled"];

function initials(slug: string | null | undefined) {
  const s = (slug || "?").replace(/[^a-zA-Z]/g, "");
  return (s.slice(0, 2) || "??").toUpperCase();
}

function isFailing(t: KanbanTask) {
  return (t.consecutive_failures ?? 0) > 0 || !!t.last_failure_error;
}

function ageLabel(t: KanbanTask) {
  if (t.created_at) return formatRelative(t.created_at);
  if (t.age_days != null) return `${Math.round(t.age_days)}d`;
  return "";
}

// ─── Board ───────────────────────────────────────────────────────────────────

export function BoardPanel() {
  const [assignee, setAssignee] = useState<string | null>(null);
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();

  const { data, isLoading, isFetching, refetch, isError, error } = useMissionControlBoard({
    assignee,
    blockedOnly,
    q: q.trim() || undefined,
  });

  const tasks: KanbanTask[] = (data as any)?.tasks ?? (data as any)?.data?.tasks ?? [];
  const warning = (data as any)?.warning ?? (data as any)?.data?.warning;

  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.assignee) set.add(t.assignee);
    return Array.from(set).sort();
  }, [tasks]);

  const failCount = tasks.filter(isFailing).length;

  const byStatus = useMemo(() => {
    const m: Record<string, KanbanTask[]> = {};
    for (const t of tasks) {
      const s = t.status || "todo";
      (m[s] ||= []).push(t);
    }
    return m;
  }, [tasks]);

  const hiddenEmpty = HIDDEN_COLS.filter((c) => !(byStatus[c]?.length));
  const cols = [
    ...(showHidden || hiddenEmpty.length < HIDDEN_COLS.length
      ? [
          { key: "triage", label: "Triage", dot: "bg-cream/30" },
          { key: "todo", label: "Todo", dot: "bg-cream/40" },
          { key: "scheduled", label: "Scheduled", dot: "bg-brass/50" },
          ...BOARD_COLS.filter((c) => c.key !== "todo"),
        ]
      : BOARD_COLS),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAssignee(null)}
          className={cn(
            "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors",
            !assignee ? "border-brass/40 bg-brass/15 text-brass-light" : "border-brass/10 text-cream-dim hover:border-brass/25"
          )}
        >
          All assignees
        </button>
        {assignees.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAssignee(a === assignee ? null : a)}
            className={cn(
              "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors",
              assignee === a ? "border-brass/40 bg-brass/15 text-brass-light" : "border-brass/10 text-cream-dim hover:border-brass/25"
            )}
          >
            {a}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setBlockedOnly((v) => !v)}
          className={cn(
            "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors ml-1",
            blockedOnly
              ? "border-signal-rose/40 bg-signal-rose/10 text-signal-rose"
              : "border-signal-rose/20 text-signal-rose/70 hover:border-signal-rose/35"
          )}
        >
          Blocked only
        </button>
        <div className="relative ml-auto flex items-center gap-2">
          <Search className="absolute left-2 w-3 h-3 text-cream-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search cards…"
            className="pl-7 pr-2 py-1.5 text-xs rounded-lg bg-forest-deep/40 border border-brass/15 text-cream placeholder:text-cream-dim/50 w-44 focus:outline-none focus:border-brass/40"
          />
          <button
            type="button"
            onClick={() => refetch()}
            className="p-1.5 rounded-lg border border-brass/15 text-cream-dim hover:text-cream hover:border-brass/30"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {failCount > 0 && (
        <div className="text-[10px] text-signal-rose flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          {failCount} card{failCount === 1 ? "" : "s"} with failures
        </div>
      )}

      {warning && (
        <div className="text-[11px] text-signal-amber border border-signal-amber/25 bg-signal-amber/5 rounded-xl px-3 py-2">
          Snapshot: {warning === "table_missing" ? "tables not applied yet — empty board until migration + writers run" : warning}
        </div>
      )}

      {!showHidden && hiddenEmpty.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden(true)}
          className="w-full text-left text-[10px] text-cream-dim border border-dashed border-brass/15 rounded-xl px-3 py-2 hover:border-brass/30"
        >
          ⌄ {hiddenEmpty.length} empty stage{hiddenEmpty.length === 1 ? "" : "s"} hidden —{" "}
          {hiddenEmpty.map((c) => `${c[0]!.toUpperCase()}${c.slice(1)} (0)`).join(", ")}. Tap to expand.
        </button>
      )}

      {isError && (
        <div className="border border-signal-rose/30 bg-signal-rose/5 rounded-xl px-4 py-3 text-sm text-signal-rose flex items-center justify-between">
          <span>{(error as Error)?.message || "Failed to load board"}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLS.map((c) => (
            <div key={c.key} className="min-w-[280px] space-y-2">
              <div className="h-4 w-20 bg-cream/10 rounded animate-pulse" />
              <div className="glass-panel rounded-xl h-24 animate-pulse" />
              <div className="glass-panel rounded-xl h-24 animate-pulse" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-12 text-center text-sm text-cream-dim">
          No open work on this board. Cards will appear here as agents pick up tasks.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {cols.map((col) => {
            const list = byStatus[col.key] || [];
            if (!showHidden && HIDDEN_COLS.includes(col.key) && list.length === 0) return null;
            return (
              <div key={col.key} className="min-w-[280px] max-w-[300px] flex-shrink-0 space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className={cn("w-1.5 h-1.5 rounded-full", col.dot)} />
                  <span className="ui-label text-cream-dim">{col.label}</span>
                  <span className="ml-auto text-[10px] font-mono text-cream-dim/70 bg-forest-deep/50 border border-brass/10 rounded px-1.5">
                    {list.length}
                  </span>
                </div>
                {list.length === 0 ? (
                  <div className="border border-dashed border-brass/15 rounded-xl px-3 py-6 text-[11px] text-cream-dim/70 text-center">
                    {col.key === "ready"
                      ? "Promotes automatically once parent tasks complete"
                      : col.key === "running"
                        ? "No workers in flight"
                        : "Empty"}
                  </div>
                ) : (
                  list.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected(t.id)}
                      className={cn(
                        "w-full text-left glass-panel rounded-xl p-3 space-y-1.5 hover:border-brass/30 transition-colors border border-transparent",
                        t.status === "blocked" && "border-l-2 border-l-signal-rose",
                        selected === t.id && "ring-1 ring-brass/40"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <p className="text-sm text-cream font-medium line-clamp-2 flex-1">{t.title}</p>
                        {isFailing(t) && <AlertTriangle className="w-3.5 h-3.5 text-signal-rose shrink-0 mt-0.5" />}
                      </div>
                      <p className="text-[10px] font-mono text-cream-dim/60">{t.id}</p>
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="w-5 h-5 rounded-full bg-brass/20 text-brass-light text-[9px] font-bold flex items-center justify-center">
                          {initials(t.assignee)}
                        </span>
                        <span className="text-[10px] text-cream-dim">{t.assignee || "unassigned"}</span>
                        <span className="ml-auto text-[10px] text-cream-dim/50">{ageLabel(t)}</span>
                      </div>
                      {isFailing(t) && (
                        <p className="text-[10px] text-signal-rose/90 border-t border-signal-rose/15 pt-1.5 mt-1">
                          ⚠ {(t.consecutive_failures ?? 0) > 0 ? `${t.consecutive_failures} consecutive failures` : "failure"}
                          {t.last_failure_error ? ` — ${String(t.last_failure_error).slice(0, 80)}` : ""}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && <BoardDrawer taskId={selected} onClose={() => setSelected(undefined)} />}
    </div>
  );
}

function BoardDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data, isLoading, refetch } = useMissionControlBoardTask(taskId);
  const action = useMissionControlBoardAction();
  const payload = (data as any)?.data ?? data;
  const task: KanbanTask | null = payload?.task ?? null;
  const comments = payload?.comments ?? [];
  const parents = payload?.parents ?? [];
  const children = payload?.children ?? [];

  const run = async (act: string, extra?: { reason?: string }) => {
    try {
      await action.mutateAsync({ id: taskId, action: act, ...extra });
      toast.success(`Queued ${act} — applying on Studio`);
      refetch();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${act}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-forest-deep border-l border-brass/20 shadow-2xl overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="ui-label text-brass-light mb-1">Board card</p>
            <h2 className="font-display text-2xl italic text-cream leading-tight">
              {task?.title || taskId}
            </h2>
            <p className="text-[10px] font-mono text-cream-dim mt-1">{taskId}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg border border-brass/20 text-cream-dim hover:text-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading || !task ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-cream/10 rounded w-1/3" />
            <div className="h-20 bg-cream/10 rounded" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span className="px-2 py-0.5 rounded-full border border-brass/20 text-cream-dim uppercase tracking-wider">
                {task.status}
              </span>
              {task.assignee && (
                <span className="px-2 py-0.5 rounded-full border border-brass/20 text-brass-light">{task.assignee}</span>
              )}
              {isFailing(task) && (
                <span className="px-2 py-0.5 rounded-full border border-signal-rose/30 text-signal-rose">failing</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {task.status !== "ready" && task.status !== "running" && task.status !== "done" && (
                <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => run("promote")}>
                  Promote → ready
                </Button>
              )}
              {task.status !== "blocked" && (
                <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => run("block", { reason: "blocked from Mission Control" })}>
                  Block
                </Button>
              )}
              {task.status === "blocked" && (
                <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => run("unblock")}>
                  Unblock
                </Button>
              )}
              {task.status !== "done" && (
                <Button size="sm" disabled={action.isPending} onClick={() => run("complete")}>
                  Complete
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => run("archive")}>
                Archive
              </Button>
            </div>
            <p className="text-[10px] text-cream-dim">
              Moves queue to Studio and apply to Hermes kanban within ~1 min. Snapshot updates immediately.
            </p>

            {task.body && (
              <div className="glass-panel rounded-xl p-3 text-sm text-cream-muted whitespace-pre-wrap max-h-64 overflow-y-auto">
                {task.body}
              </div>
            )}
            {task.result_summary && (
              <div>
                <p className="ui-label text-cream-dim mb-1">Result</p>
                <p className="text-sm text-cream-muted">{task.result_summary}</p>
              </div>
            )}
            {(parents.length > 0 || children.length > 0) && (
              <div className="text-[11px] text-cream-dim space-y-1">
                {parents.length > 0 && <p>Parents: {parents.join(", ")}</p>}
                {children.length > 0 && <p>Children: {children.join(", ")}</p>}
              </div>
            )}
            <div>
              <p className="ui-label text-cream-dim mb-2">Comments ({task.comment_count ?? comments.length})</p>
              {comments.length === 0 ? (
                <p className="text-xs text-cream-dim/60">No comment preview in snapshot.</p>
              ) : (
                comments.map((c: any, i: number) => (
                  <div key={i} className="glass-panel rounded-lg p-2.5 mb-2 text-xs">
                    <div className="flex justify-between text-cream-dim mb-1">
                      <span>{c.author}</span>
                      <span>{c.created_at ? formatRelative(c.created_at) : ""}</span>
                    </div>
                    <p className="text-cream-muted whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Crons ───────────────────────────────────────────────────────────────────

const COLOR_PILL: Record<string, string> = {
  green: "bg-signal-emerald/15 text-signal-emerald border-signal-emerald/30",
  amber: "bg-signal-amber/15 text-signal-amber border-signal-amber/30",
  red: "bg-signal-rose/15 text-signal-rose border-signal-rose/30",
};

export function FleetCronsPanel() {
  const [profile, setProfile] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const { data, isLoading, refetch, isFetching, isError, error } = useMissionControlCrons({
    profile,
    status: color,
  });

  const payload = (data as any)?.data ?? data;
  const crons = payload?.crons ?? [];
  const summary = payload?.summary ?? { green: 0, amber: 0, red: 0, total: 0 };
  const warning = payload?.warning;

  const profiles = useMemo(() => {
    const s = new Set<string>();
    for (const c of crons) s.add(c.profile || c.agent_slug);
    return Array.from(s).sort();
  }, [crons]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {(["green", "amber", "red"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(color === c ? null : c)}
            className={cn(
              "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border",
              color === c ? COLOR_PILL[c] : "border-brass/10 text-cream-dim"
            )}
          >
            {c} {summary[c] ?? 0}
          </button>
        ))}
        <span className="text-[10px] text-cream-dim ml-1">total {summary.total}</span>
        <button type="button" onClick={() => refetch()} className="ml-auto p-1.5 rounded-lg border border-brass/15 text-cream-dim">
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setProfile(null)}
          className={cn(
            "text-[10px] px-2 py-1 rounded-full border",
            !profile ? "border-brass/40 bg-brass/15 text-brass-light" : "border-brass/10 text-cream-dim"
          )}
        >
          All agents
        </button>
        {profiles.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProfile(p === profile ? null : p)}
            className={cn(
              "text-[10px] px-2 py-1 rounded-full border",
              profile === p ? "border-brass/40 bg-brass/15 text-brass-light" : "border-brass/10 text-cream-dim"
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {warning && (
        <div className="text-[11px] text-signal-amber border border-signal-amber/25 bg-signal-amber/5 rounded-xl px-3 py-2">
          {warning === "table_missing" ? "cron_health table not applied yet" : warning}
        </div>
      )}

      {isError && (
        <div className="text-sm text-signal-rose border border-signal-rose/25 rounded-xl px-3 py-2">
          {(error as Error)?.message || "Failed to load crons"}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : crons.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          No cron health rows yet. Apply migration + unpause Studio snapshot writer.
        </div>
      ) : (
        <div className="space-y-1.5">
          {crons.map((job: any) => {
            const err = job.last_error || job.last_delivery_error;
            const open = openErr === job.id;
            return (
              <div key={job.id} className="glass-panel rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", COLOR_PILL[job.status])}>
                    {job.status}
                  </span>
                  <span className="text-[10px] text-brass-light font-medium">{job.profile || job.agent_slug}</span>
                  <span className="text-sm text-cream truncate flex-1">{job.job_name}</span>
                  {job.model_drift && (
                    <span className="text-[9px] text-signal-amber border border-signal-amber/30 rounded px-1.5">model drift</span>
                  )}
                  <span className="text-[10px] font-mono text-cream-dim/60">
                    {job.last_run_at ? formatRelative(job.last_run_at) : "never"}
                  </span>
                </div>
                {err && (
                  <button
                    type="button"
                    onClick={() => setOpenErr(open ? null : job.id)}
                    className="mt-1 text-[10px] text-signal-rose/90 text-left w-full"
                  >
                    {open ? err : `${String(err).slice(0, 100)}${String(err).length > 100 ? "…" : ""}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

export function HistoryPanel() {
  const [agent, setAgent] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const { data, isLoading, refetch, isFetching, isError, error } = useMissionControlHistory({
    agent,
    q: q.trim() || undefined,
    limit: 100,
  });

  const payload = (data as any)?.data ?? data;
  const entries = payload?.entries ?? [];

  const agents = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.agent_slug) s.add(e.agent_slug);
    return Array.from(s).sort();
  }, [entries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => setAgent(null)}
          className={cn(
            "text-[10px] px-2 py-1 rounded-full border",
            !agent ? "border-brass/40 bg-brass/15 text-brass-light" : "border-brass/10 text-cream-dim"
          )}
        >
          All agents
        </button>
        {agents.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAgent(a === agent ? null : a)}
            className={cn(
              "text-[10px] px-2 py-1 rounded-full border",
              agent === a ? "border-brass/40 bg-brass/15 text-brass-light" : "border-brass/10 text-cream-dim"
            )}
          >
            {a}
          </button>
        ))}
        <div className="relative ml-auto flex items-center gap-2">
          <Search className="absolute left-2 w-3 h-3 text-cream-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search history…"
            className="pl-7 pr-2 py-1.5 text-xs rounded-lg bg-forest-deep/40 border border-brass/15 text-cream placeholder:text-cream-dim/50 w-44 focus:outline-none focus:border-brass/40"
          />
          <button type="button" onClick={() => refetch()} className="p-1.5 rounded-lg border border-brass/15 text-cream-dim">
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {isError && (
        <div className="text-sm text-signal-rose border border-signal-rose/25 rounded-xl px-3 py-2">
          {(error as Error)?.message || "Failed to load history"}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          No history entries for this filter.
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e: any) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelected(e)}
              className="w-full text-left glass-panel rounded-xl px-3 py-2.5 flex gap-3 hover:border-brass/30 border border-transparent"
            >
              <div className="pt-0.5">
                {e.kind === "brief" ? (
                  <CalendarClock className="w-3.5 h-3.5 text-brass-light" />
                ) : e.kind === "kanban_done" ? (
                  <LayoutGrid className="w-3.5 h-3.5 text-signal-emerald" />
                ) : (
                  <Activity className="w-3.5 h-3.5 text-cream-dim" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] uppercase tracking-wider text-cream-dim/70 border border-brass/10 rounded px-1.5">
                    {String(e.kind).replace(/_/g, " ")}
                  </span>
                  {e.agent_slug && <span className="text-[10px] text-brass-light">{e.agent_slug}</span>}
                  <span className="ml-auto text-[10px] text-cream-dim/50 shrink-0">
                    {e.ts ? formatRelative(e.ts) : ""}
                  </span>
                </div>
                <p className="text-sm text-cream mt-0.5 truncate">{e.title}</p>
                {e.snippet && <p className="text-[11px] text-cream-muted line-clamp-2 mt-0.5">{e.snippet}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-md h-full bg-forest-deep border-l border-brass/20 shadow-2xl overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <p className="ui-label text-brass-light mb-1">{String(selected.kind).replace(/_/g, " ")}</p>
                <h2 className="font-display text-2xl italic text-cream leading-tight">{selected.title}</h2>
                <p className="text-[10px] text-cream-dim mt-1">
                  {selected.agent_slug || "—"} · {selected.ts ? formatRelative(selected.ts) : ""}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-1.5 rounded-lg border border-brass/20 text-cream-dim">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="glass-panel rounded-xl p-3 text-sm text-cream-muted whitespace-pre-wrap">
              {selected.body || selected.snippet || "No body."}
            </div>
            {selected.doc_ref && (
              <p className="text-[11px] font-mono text-cream-dim">ref: {selected.doc_ref}</p>
            )}
            {selected.source && (
              <p className="text-[11px] text-cream-dim">source: {selected.source}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
