import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import { syncLabel } from "@alts/lib/ticketDisplay";
import { withShowTest } from "@alts/lib/showTestData";
import "@alts/styles/alts-pos.css";

type Todo = {
  name: string;
  description: string;
  status: "Open" | "Closed" | "Cancelled" | string;
  priority: "High" | "Medium" | "Low" | string;
  date: string | null;
  allocated_to: string | null;
  assigned_by_full_name: string | null;
  reference_type: string | null;
  reference_name: string | null;
  auto?: boolean;
};

type Tab = "open" | "overdue" | "done";
type Source = "all" | "auto" | "human";

function stripHtml(html: string) {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function nyToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isOverdue(date: string | null) {
  if (!date) return false;
  return date < nyToday();
}

function dueLabel(date: string | null) {
  if (!date) return "No date";
  const today = nyToday();
  if (date === today) return "Today";
  const d = new Date(date + "T12:00:00");
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (date < today) return `${label} · late`;
  return label;
}

function who(email?: string | null) {
  if (!email) return "Unassigned";
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function groupKey(t: Todo) {
  return t.reference_name || t.name;
}

export default function TasksGlass() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("open");
  const [source, setSource] = useState<Source>("all");
  const [picked, setPicked] = useState<Todo | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const list = useQuery({
    queryKey: ["alts-tasks", tab === "done" ? "closed" : "open", source],
    queryFn: () =>
      api.get<Todo[]>(
        withShowTest(
          `/api/tasks?status=${tab === "done" ? "closed" : "open"}&limit=500&scope=house&source=${source}`,
        ),
      ),
    refetchInterval: 60_000,
  });

  const close = useMutation({
    mutationFn: (name: string) => api.patch(`/api/tasks/${encodeURIComponent(name)}`, { status: "Closed" }),
    onSuccess: () => {
      toast.success("Done");
      setPicked(null);
      qc.invalidateQueries({ queryKey: ["alts-tasks"] });
      qc.invalidateQueries({ queryKey: ["alts-tasks-count"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not close"),
  });

  const bulkClose = useMutation({
    mutationFn: (names: string[]) => api.post<{ closed: number }>("/api/tasks/bulk-close", { names }),
    onSuccess: (data) => {
      toast.success(`Closed ${data?.closed ?? selected.length}`);
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["alts-tasks"] });
      qc.invalidateQueries({ queryKey: ["alts-tasks-count"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not close"),
  });

  const create = useMutation({
    mutationFn: (description: string) => api.post("/api/tasks", { description, priority: "Medium" }),
    onSuccess: () => {
      toast.success("Added");
      setDraft("");
      setComposing(false);
      qc.invalidateQueries({ queryKey: ["alts-tasks"] });
      qc.invalidateQueries({ queryKey: ["alts-tasks-count"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not add"),
  });

  const rows = list.data ?? [];
  const openRows = rows.filter((t) => t.status === "Open");
  const overdueRows = openRows.filter((t) => isOverdue(t.date));
  const shown = tab === "done" ? rows : tab === "overdue" ? overdueRows : openRows;
  const live = syncLabel(list.dataUpdatedAt, list.isFetching);

  const groups = useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const t of shown) {
      const key = groupKey(t);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      label: items[0]?.reference_name
        ? `${items[0].reference_type || "Ticket"} · ${items[0].reference_name}`
        : "Standalone",
      items,
    }));
  }, [shown]);

  const counts = useMemo(
    () => ({
      open: openRows.length,
      overdue: overdueRows.length,
      done: tab === "done" ? rows.length : 0,
    }),
    [openRows.length, overdueRows.length, rows.length, tab],
  );

  const toggle = (name: string) => {
    setSelected((cur) => (cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]));
  };

  const selectGroup = (items: Todo[]) => {
    const names = items.filter((t) => t.status === "Open").map((t) => t.name);
    setSelected((cur) => {
      const set = new Set(cur);
      const allOn = names.every((n) => set.has(n));
      if (allOn) names.forEach((n) => set.delete(n));
      else names.forEach((n) => set.add(n));
      return [...set];
    });
  };

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[28px] leading-none">Tasks</div>
          <div className="caps mt-1">House list · grouped by ticket</div>
        </div>
        <div className="flex-1" />
        <div className={cn("sf-live", list.isFetching && "is-sync", list.isError && "is-down")}>
          <span className="dot" />
          {list.isError ? "ERPNext down" : live}
        </div>
      </header>

      <div className="px-4 sm:px-5 pt-3 flex flex-wrap gap-2">
        {(
          [
            ["open", "Open", tab === "done" ? "—" : counts.open],
            ["overdue", "Overdue", tab === "done" ? "—" : counts.overdue],
            ["done", "Done", tab === "done" ? counts.done : ""],
          ] as const
        ).map(([k, lab, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            {n !== "" && n !== "—" ? <span className="og-count">{n}</span> : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="ml-auto px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border border-brass/45 bg-brass/15 text-cream"
        >
          + Add
        </button>
      </div>

      <div className="px-4 sm:px-5 pt-2 flex flex-wrap gap-2">
        {(["all", "human", "auto"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSource(k)}
            className={cn(
              "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide border",
              source === k ? "bg-brass/20 border-brass text-cream" : "border-brass/20 text-cream-dim",
            )}
          >
            {k === "all" ? "All sources" : k === "auto" ? "Auto-assigned" : "Human"}
          </button>
        ))}
        {selected.length > 0 && tab !== "done" && (
          <button
            type="button"
            disabled={bulkClose.isPending}
            onClick={() => bulkClose.mutate(selected)}
            className="ml-auto px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-brass/45 bg-brass/15 text-cream"
          >
            {bulkClose.isPending ? "Closing…" : `Close ${selected.length}`}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {list.isError && (
          <QueryErrorPanel
            title="Could not load tasks"
            message={list.error instanceof Error ? list.error.message : "Retry — an empty list is not the same as an outage."}
            onRetry={() => list.refetch()}
          />
        )}
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="caps text-brass-light truncate">{g.label}</div>
              {g.items.length > 1 && (
                <span className="text-[10px] text-cream-dim">{g.items.length}</span>
              )}
              {tab !== "done" && g.items.some((t) => t.status === "Open") && (
                <button
                  type="button"
                  onClick={() => selectGroup(g.items)}
                  className="ml-auto text-[10px] uppercase tracking-wide text-brass-light"
                >
                  Select group
                </button>
              )}
            </div>
            {g.items.map((t) => {
              const late = t.status === "Open" && isOverdue(t.date);
              const on = selected.includes(t.name);
              return (
                <div key={t.name} className="flex items-stretch gap-2">
                  {tab !== "done" && (
                    <button
                      type="button"
                      onClick={() => toggle(t.name)}
                      className={cn(
                        "w-10 rounded-xl border flex items-center justify-center text-xs font-bold",
                        on ? "border-brass bg-brass/20 text-cream" : "border-brass/20 text-cream-dim",
                      )}
                      aria-label="Select task"
                    >
                      {on ? "✓" : ""}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPicked(t)}
                    className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-start gap-3"
                  >
                    <span
                      className={cn(
                        "mt-1 h-2.5 w-2.5 rounded-full shrink-0",
                        t.priority === "High" || late ? "bg-[var(--ro)]" : t.priority === "Low" ? "bg-[var(--cd)]" : "bg-[var(--bl)]",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("chip", late && "text-[var(--ro)]")}>{dueLabel(t.date)}</span>
                        <span className="text-[11px] text-cream-dim">{t.priority}</span>
                        <span className="text-[11px] text-cream-dim">{who(t.allocated_to)}</span>
                        {t.auto && (
                          <span className="text-[9px] uppercase tracking-widest border border-brass/30 text-brass-light rounded px-1.5 py-0.5">
                            Auto
                          </span>
                        )}
                      </div>
                      <div className="display text-[22px] leading-tight mt-1">{stripHtml(t.description) || "Untitled"}</div>
                    </div>
                    <div className="text-cream-dim">→</div>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {!list.isLoading && !shown.length && !list.isError && (
          <div className="sf-empty">{tab === "overdue" ? "Nothing late." : tab === "done" ? "Nothing closed yet." : "The list is clear."}</div>
        )}
      </div>

      <LuxuryLayer open={!!picked} onClose={() => setPicked(null)} variant="sheet" label="Task" z={70}>
        {picked && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="flex justify-center pb-2" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            <div className="caps text-brass-light">{dueLabel(picked.date)}</div>
            <h2 className="display text-[28px] leading-tight mt-1">{stripHtml(picked.description) || "Untitled"}</h2>
            <p className="text-sm text-cream-dim mt-2">
              {[picked.priority, who(picked.allocated_to), picked.assigned_by_full_name ? `from ${picked.assigned_by_full_name}` : "", picked.auto ? "auto-assigned" : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="flex flex-col gap-2 mt-5">
              {picked.status === "Open" && (
                <button
                  type="button"
                  disabled={close.isPending}
                  onClick={() => close.mutate(picked.name)}
                  className="btn-brass h-12 text-xs"
                >
                  {close.isPending ? "Saving…" : "Mark complete"}
                </button>
              )}
              <button type="button" onClick={() => setPicked(null)} className="btn-ghost h-12 text-xs">
                Close
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>

      <LuxuryLayer open={composing} onClose={() => setComposing(false)} variant="sheet" label="New task" z={70}>
        <div
          className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
        >
          <div className="flex justify-center pb-2" aria-hidden>
            <i className="block w-10 h-1 rounded-full bg-brass/40" />
          </div>
          <div className="caps text-brass-light">New task</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="What needs doing?"
            className="mt-3 w-full rounded-xl border border-brass/25 bg-black/30 px-3 py-3 text-base text-cream placeholder:text-cream-dim"
          />
          <div className="flex flex-col gap-2 mt-4">
            <button
              type="button"
              disabled={create.isPending || !draft.trim()}
              onClick={() => create.mutate(draft.trim())}
              className="btn-brass h-12 text-xs"
            >
              {create.isPending ? "Saving…" : "Add to the list"}
            </button>
            <button type="button" onClick={() => setComposing(false)} className="btn-ghost h-12 text-xs">
              Cancel
            </button>
          </div>
        </div>
      </LuxuryLayer>
    </div>
  );
}
