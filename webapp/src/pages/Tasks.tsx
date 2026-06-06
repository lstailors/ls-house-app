import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Clock, AlertTriangle, ListTodo, Flame, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { EmptyState } from "@/components/glass/EmptyState";
import { FilterBar } from "@/components/glass/FilterBar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Todo {
  name: string;
  description: string;
  status: "Open" | "Closed" | "Cancelled";
  priority: "High" | "Medium" | "Low";
  date: string | null;
  allocated_to: string | null;
  assigned_by: string | null;
  assigned_by_full_name: string | null;
  reference_type: string | null;
  reference_name: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html?.replace(/<[^>]*>/g, "").trim() ?? "";
}

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

function isDueToday(date: string | null): boolean {
  if (!date) return false;
  return date === new Date().toISOString().slice(0, 10);
}

function shortEmail(email: string | null): string {
  if (!email) return "—";
  return email.split("@")[0];
}

function formatDate(date: string | null): string {
  if (!date) return "";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ── Priority badge ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: Todo["priority"] }) {
  if (priority === "High") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-signal-rose/10 text-signal-rose">
        High
      </span>
    );
  }
  if (priority === "Medium") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-signal-amber/10 text-signal-amber">
        Medium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-cream-dim">
      Low
    </span>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  todo: Todo;
  onComplete: (id: string) => void;
  completing: boolean;
}

function TaskCard({ todo, onComplete, completing }: TaskCardProps) {
  const text = stripHtml(todo.description);
  const truncated = text.length > 120 ? text.slice(0, 120) + "…" : text;
  const overdue = isOverdue(todo.date);
  const today = isDueToday(todo.date);
  const isClosed = todo.status === "Closed" || todo.status === "Cancelled";

  return (
    <GlassCard
      className={cn(
        "p-4 border border-brass/15 rounded-xl transition-all",
        overdue && !isClosed && "border-signal-rose/30",
        todo.priority === "High" && !isClosed && "border-signal-rose/20",
        isClosed && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Left: content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Priority + status row */}
          <div className="flex items-center gap-2 flex-wrap">
            <PriorityBadge priority={todo.priority} />
            {isClosed ? (
              <span className="inline-flex text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-cream-dim">
                {todo.status}
              </span>
            ) : null}
          </div>

          {/* Description */}
          <p className={cn("text-sm leading-relaxed", isClosed ? "text-cream-dim line-through" : "text-cream")}>
            {truncated || <span className="text-cream-dim italic">No description</span>}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            {todo.date ? (
              <span
                className={cn(
                  "flex items-center gap-1",
                  overdue && !isClosed ? "text-signal-rose font-medium" : today && !isClosed ? "text-signal-amber font-medium" : "text-cream-dim",
                )}
              >
                <Clock className="h-3 w-3" />
                {overdue && !isClosed ? "Overdue · " : today && !isClosed ? "Due today · " : ""}
                {formatDate(todo.date)}
              </span>
            ) : null}

            {todo.allocated_to ? (
              <span className="text-cream-dim">
                → <span className="text-cream-muted">{shortEmail(todo.allocated_to)}</span>
              </span>
            ) : null}

            {todo.reference_type && todo.reference_name ? (
              <span className="text-brass-light/60 font-mono text-[10px]">
                {todo.reference_type} · {todo.reference_name}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right: complete button */}
        {!isClosed ? (
          <button
            type="button"
            onClick={() => onComplete(todo.name)}
            disabled={completing}
            title="Mark complete"
            className={cn(
              "shrink-0 h-8 w-8 rounded-full border border-brass/30 flex items-center justify-center",
              "hover:bg-brass/15 hover:border-brass/60 transition-colors",
              "text-brass-light/60 hover:text-brass-light",
              completing && "opacity-40 cursor-not-allowed",
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </GlassCard>
  );
}

// ── New Task Panel ────────────────────────────────────────────────────────────

interface NewTaskPanelProps {
  onClose: () => void;
  currentUserEmail: string;
}

function NewTaskPanel({ onClose, currentUserEmail }: NewTaskPanelProps) {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"High" | "Medium" | "Low">("Medium");
  const [date, setDate] = useState("");
  const [assignedTo, setAssignedTo] = useState(currentUserEmail);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Todo>("/api/tasks", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not create task"),
  });

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!description.trim()) return;
    create.mutate({
      description: description.trim(),
      priority,
      date: date || null,
      allocated_to: assignedTo.trim() || currentUserEmail,
    });
  }

  return (
    <GlassCard className="p-5 border border-brass/20 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <span className="ui-label">New Task</span>
        <button type="button" onClick={onClose} className="text-cream-dim hover:text-cream transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            placeholder="What needs to be done?"
            className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream-dim/50 focus:outline-none focus:border-brass/50 resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as "High" | "Medium" | "Low")}
              className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-brass/50"
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">
              Due Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-brass/50"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">
            Assign To (email)
          </label>
          <input
            type="text"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            placeholder={currentUserEmail}
            className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream-dim/50 focus:outline-none focus:border-brass/50"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-brass/20 text-cream-muted hover:bg-brass/10 h-9 text-sm"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !description.trim()}
            className="bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm"
          >
            {create.isPending ? "Creating…" : "Create Task"}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

// ── Filter config ─────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "closed", label: "Closed" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const { data: todos = [], isLoading } = useQuery<Todo[]>({
    queryKey: ["tasks", statusFilter],
    queryFn: () => api.get<Todo[]>(`/api/tasks?status=${statusFilter}`),
    enabled: !!me,
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.patch<Todo>(`/api/tasks/${id}`, { status: "Closed" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task marked complete");
    },
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  const today = new Date().toISOString().slice(0, 10);

  const kpis = useMemo(() => {
    const open = todos.filter((t) => t.status === "Open");
    return {
      open: open.length,
      dueToday: open.filter((t) => t.date === today).length,
      overdue: open.filter((t) => isOverdue(t.date)).length,
      high: open.filter((t) => t.priority === "High").length,
    };
  }, [todos, today]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return todos;
    return todos.filter((t) =>
      stripHtml(t.description).toLowerCase().includes(s) ||
      (t.allocated_to ?? "").toLowerCase().includes(s) ||
      (t.reference_name ?? "").toLowerCase().includes(s),
    );
  }, [todos, search]);

  return (
    <div className="space-y-5 md:space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Ops"
        title={<>Tasks.</>}
        description="Errands, pickups, internal jobs. Every open task in the house."
        actions={
          <Button
            onClick={() => setNewTaskOpen((v) => !v)}
            className="bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Task
          </Button>
        }
      />

      {/* New task panel */}
      {newTaskOpen ? (
        <NewTaskPanel
          onClose={() => setNewTaskOpen(false)}
          currentUserEmail={me?.email ?? ""}
        />
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <KpiCard
          label="Open"
          value={kpis.open}
          icon={<ListTodo className="h-4 w-4" />}
        />
        <KpiCard
          label="Due Today"
          value={kpis.dueToday}
          icon={<Clock className="h-4 w-4" />}
          accent="amber"
        />
        <KpiCard
          label="Overdue"
          value={kpis.overdue}
          icon={<AlertTriangle className="h-4 w-4" />}
          accent="rose"
        />
        <KpiCard
          label="High Priority"
          value={kpis.high}
          icon={<Flame className="h-4 w-4" />}
          accent="rose"
        />
      </div>

      {/* Filter + search */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tasks…"
        filterValue={statusFilter}
        onFilterChange={setStatusFilter}
        filterOptions={FILTER_OPTIONS}
      />

      {/* Task list */}
      {isLoading ? (
        <div className="text-cream-muted text-sm py-4">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks"
          description={statusFilter === "open" ? "All caught up — no open tasks." : "Nothing here."}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((todo) => (
            <TaskCard
              key={todo.name}
              todo={todo}
              onComplete={(id) => complete.mutate(id)}
              completing={complete.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
