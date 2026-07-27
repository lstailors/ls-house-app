import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Plus, Clock, AlertTriangle, ListTodo, Flame, X, Wand2, Sparkles, Lightbulb, ChevronDown, List, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { KpiCard } from "@ls/design";
import { EmptyState } from "@ls/design";
import { FilterBar } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@ls/design/utils";
import { type Todo, stripHtml, isOverdue, formatDate } from "@/lib/tasks";
import { TaskListView } from "@/components/tasks/TaskListView";
import { TaskBoardView } from "@/components/tasks/TaskBoardView";

// ── Types ────────────────────────────────────────────────────────────────────

interface NewTaskDefaults {
  description: string;
  priority: "High" | "Medium" | "Low";
  date: string | null;
  allocated_to: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Helpers, Todo type, PriorityBadge, and TaskCard now live in @/lib/tasks and
// @/components/tasks/*.

// ── Priority badge ────────────────────────────────────────────────────────────


// ── Task card ─────────────────────────────────────────────────────────────────


// ── Task Detail Panel ─────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  todo: Todo;
  onClose: () => void;
}

function TaskDetailPanel({ todo, onClose }: TaskDetailPanelProps) {
  const qc = useQueryClient();
  const isClosed = todo.status === "Closed" || todo.status === "Cancelled";

  const [priority, setPriority] = useState<"High" | "Medium" | "Low">(todo.priority);
  const [date, setDate] = useState(todo.date ?? "");
  const [assignedTo, setAssignedTo] = useState(todo.allocated_to ?? "");
  const [description, setDescription] = useState(stripHtml(todo.description));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Todo>(`/api/tasks/${todo.name}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  const markComplete = useMutation({
    mutationFn: () => api.patch<Todo>(`/api/tasks/${todo.name}`, { status: "Closed" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task marked complete");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    save.mutate({
      priority,
      date: date || null,
      allocated_to: assignedTo.trim() || null,
      description: description.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full sm:max-w-lg bg-[#0a120e] border border-brass/20 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brass/10 sticky top-0 bg-[#0a120e] z-10">
          <span className="ui-label">Task Details</span>
          <button type="button" onClick={onClose} className="text-cream-dim hover:text-cream transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          {/* Description */}
          <div>
            <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream-dim/50 focus:outline-none focus:border-brass/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Priority */}
            <div>
              <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Priority</label>
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

            {/* Due date */}
            <div>
              <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Due Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-brass/50"
              />
            </div>
          </div>

          {/* Assigned to */}
          <div>
            <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Assign To</label>
            <StaffPicker value={assignedTo} onChange={setAssignedTo} />
          </div>

          {/* Reference link */}
          {todo.reference_type && todo.reference_name ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brass/5 border border-brass/10">
              <span className="text-[11px] text-cream-dim uppercase tracking-widest">Ref</span>
              <span className="text-[11px] font-mono text-brass-light/70">{todo.reference_type} · {todo.reference_name}</span>
            </div>
          ) : null}

          {/* History / meta */}
          <div className="border-t border-brass/10 pt-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-cream-dim mb-2">History</p>
            {todo.assigned_by_full_name ? (
              <p className="text-[11px] text-cream-muted">Created by <span className="text-cream">{todo.assigned_by_full_name}</span></p>
            ) : null}
            {todo.reference_type && todo.reference_name ? (
              <p className="text-[11px] text-cream-muted">
                Linked to{" "}
                <span className="font-mono text-brass-light/70">{todo.reference_type} · {todo.reference_name}</span>
              </p>
            ) : null}
            {isClosed ? (
              <p className="text-[11px] text-cream-muted">Status: <span className="text-cream">{todo.status}</span></p>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!isClosed ? (
              <Button
                type="button"
                onClick={() => markComplete.mutate()}
                disabled={markComplete.isPending}
                variant="outline"
                className="border-brass/30 text-brass-light hover:bg-brass/10 h-9 text-sm flex-1"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                {markComplete.isPending ? "Saving…" : "Mark Complete"}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={save.isPending}
              className="bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm flex-1"
            >
              {save.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── New Task Panel ────────────────────────────────────────────────────────────

interface NewTaskPanelProps {
  onClose: () => void;
  currentUserEmail: string;
  defaults?: Partial<NewTaskDefaults> | null;
}

function NewTaskPanel({ onClose, currentUserEmail, defaults }: NewTaskPanelProps) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(defaults?.description ?? "");
  const [priority, setPriority] = useState<"High" | "Medium" | "Low">(
    (defaults?.priority as "High" | "Medium" | "Low") ?? "Medium"
  );
  const [date, setDate] = useState(defaults?.date ?? "");
  const [assignedTo, setAssignedTo] = useState(defaults?.allocated_to ?? currentUserEmail);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [refType, setRefType] = useState("");
  const [refName, setRefName] = useState("");
  const [repeat, setRepeat] = useState<"None" | "Daily" | "Weekly" | "Monthly">("None");

  // Auto-priority suggestion
  const [aiPriority, setAiPriority] = useState<{ priority: string; reason: string } | null>(null);
  const [aiPriorityLoading, setAiPriorityLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (description.length < 20) { setAiPriority(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setAiPriorityLoading(true);
      try {
        const result = await api.post<{ priority: string; reason: string }>("/api/tasks/ai-priority", { description });
        setAiPriority(result);
      } catch { /* ignore */ }
      finally { setAiPriorityLoading(false); }
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [description]);

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
    const repeatPrefix = repeat !== "None" ? `[${repeat}] ` : "";
    const body: Record<string, unknown> = {
      description: repeatPrefix + description.trim(),
      priority,
      date: date || null,
      allocated_to: assignedTo.trim() || currentUserEmail,
    };
    if (refType.trim()) body.reference_type = refType.trim();
    if (refName.trim()) body.reference_name = refName.trim();
    create.mutate(body);
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
            {/* AI Priority Suggestion */}
            {aiPriorityLoading ? (
              <p className="text-[10px] text-brass-light/50 mt-1 italic">Analyzing…</p>
            ) : aiPriority && aiPriority.priority !== priority ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-brass-light/60 shrink-0" />
                <span className="text-[10px] text-cream-dim italic">{aiPriority.reason}</span>
                <button
                  type="button"
                  onClick={() => setPriority(aiPriority.priority as "High" | "Medium" | "Low")}
                  className="ml-auto text-[10px] text-brass-light underline underline-offset-2 hover:text-brass transition-colors shrink-0"
                >
                  Use {aiPriority.priority}
                </button>
              </div>
            ) : null}
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

        {/* Repeat */}
        <div>
          <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Repeat</label>
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as "None" | "Daily" | "Weekly" | "Monthly")}
            className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-brass/50"
          >
            <option value="None">None</option>
            <option value="Daily">Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
          </select>
          {repeat !== "None" ? (
            <p className="text-[10px] text-cream-dim/60 mt-1 italic">Recurrence is noted in the task description.</p>
          ) : null}
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">
            Assign To
          </label>
          <StaffPicker value={assignedTo} onChange={setAssignedTo} />
        </div>

        {/* Advanced: reference fields */}
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")} />
            Advanced
          </button>
          {advancedOpen ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Link Type</label>
                <input
                  type="text"
                  value={refType}
                  onChange={(e) => setRefType(e.target.value)}
                  placeholder="Sales Order"
                  className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream-dim/40 focus:outline-none focus:border-brass/50"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest text-cream-dim mb-1.5 block">Link ID</label>
                <input
                  type="text"
                  value={refName}
                  onChange={(e) => setRefName(e.target.value)}
                  placeholder="LSTNY-SO-2026-00001"
                  className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream-dim/40 focus:outline-none focus:border-brass/50"
                />
              </div>
            </div>
          ) : null}
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


const STAFF_MEMBERS = [
  { label: "Carl", value: "carl@lstailors.com", initials: "CC" },
  { label: "Kelvin", value: "kelvin@lstailors.com", initials: "KE" },
  { label: "Gianna", value: "gianna@lstailors.com", initials: "GI" },
  { label: "Antonio", value: "antonio@lstailors.com", initials: "AN" },
];

function StaffPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {STAFF_MEMBERS.map((s) => {
        const selected = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange(selected ? "" : s.value)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium transition-all",
              selected
                ? "bg-brass/20 border-brass/50 text-brass-light"
                : "border-brass/15 text-cream-muted hover:border-brass/30 hover:text-cream",
            )}
          >
            <span className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
              selected ? "bg-brass/40 text-brass-light" : "bg-forest-raised/60 text-cream-dim",
            )}>
              {s.initials}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

const FILTER_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "closed", label: "Closed" },
];

const STAFF = [
  { label: "All", value: "all" },
  { label: "Carl", value: "carl@lstailors.com" },
  { label: "Kelvin", value: "kelvin@lstailors.com" },
  { label: "Gianna", value: "gianna@lstailors.com" },
  { label: "Antonio", value: "antonio@lstailors.com" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefaults, setNewTaskDefaults] = useState<Partial<NewTaskDefaults> | null>(null);
  const [selectedTask, setSelectedTask] = useState<Todo | null>(null);
  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<number[]>([]);
  const [view, setView] = useState<"list" | "board">(
    () => (localStorage.getItem("tasksView") as "list" | "board") || "list",
  );
  useEffect(() => { localStorage.setItem("tasksView", view); }, [view]);
  const canManage = me?.role === "super_admin" || me?.role === "store_manager";

  const { data: todos = [], isLoading } = useQuery<Todo[]>({
    queryKey: ["tasks", statusFilter, assigneeFilter],
    queryFn: () => {
      const params = new URLSearchParams({ status: statusFilter });
      if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
      return api.get<Todo[]>(`/api/tasks?${params.toString()}`);
    },
    enabled: !!me,
  });

  const { data: briefingData } = useQuery({
    queryKey: ["tasks-briefing"],
    queryFn: () => api.get<{ briefing: string }>("/api/tasks/briefing"),
    staleTime: 10 * 60_000,
    enabled: !!me,
  });

  const { data: suggestions = [] } = useQuery<{ description: string; priority: string; date: string | null }[]>({
    queryKey: ["tasks-suggestions"],
    queryFn: () => api.get<{ description: string; priority: string; date: string | null }[]>("/api/tasks/suggestions"),
    staleTime: 5 * 60_000,
    enabled: !!me && me.role === "super_admin",
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.patch<Todo>(`/api/tasks/${id}`, { status: "Closed" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task marked complete");
    },
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  // Single patch entry point used by the card quick-actions (reschedule,
  // reprioritize, reassign, complete/reopen) in both list and board views.
  const patchTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<Todo>(`/api/tasks/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  const createTask = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Todo>("/api/tasks", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task created");
    },
    onError: (e: Error) => toast.error(e.message || "Could not create task"),
  });

  const handleNlParse = async () => {
    if (!nlText.trim() || nlParsing) return;
    setNlParsing(true);
    try {
      const result = await api.post<{ description: string; priority: string; date: string | null; allocated_to: string | null }>(
        "/api/tasks/ai-parse",
        { text: nlText }
      );
      setNewTaskDefaults(result as Partial<NewTaskDefaults>);
      setNewTaskOpen(true);
      setNlText("");
    } catch {
      toast.error("Could not parse task");
    } finally {
      setNlParsing(false);
    }
  };

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

  const visibleSuggestions = suggestions.filter((_, i) => !dismissedSuggestions.includes(i));

  return (
    <div className="space-y-5 md:space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Ops"
        title={<>Tasks.</>}
        description="Errands, pickups, internal jobs. Every open task in the house."
        actions={
          <Button
            onClick={() => { setNewTaskDefaults(null); setNewTaskOpen((v) => !v); }}
            className="bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Task
          </Button>
        }
      />

      {/* Natural Language Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleNlParse(); }}
            placeholder="Type a task in plain English… 'Call Emanuel Cohen about deposit by Friday'"
            className="w-full bg-forest-deep/60 border border-brass/20 rounded-xl px-4 py-2.5 pr-10 text-sm text-cream placeholder:text-cream-dim/40 focus:outline-none focus:border-brass/50 transition-colors"
          />
          {nlParsing ? (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleNlParse}
          disabled={!nlText.trim() || nlParsing}
          title="Parse with AI"
          className={cn(
            "h-10 w-10 rounded-xl border border-brass/30 flex items-center justify-center shrink-0 transition-colors",
            "hover:bg-brass/15 hover:border-brass/60 text-brass-light/70 hover:text-brass-light",
            (!nlText.trim() || nlParsing) && "opacity-40 cursor-not-allowed",
          )}
        >
          <Wand2 className="h-4 w-4" />
        </button>
      </div>

      {/* AI Briefing */}
      {briefingData?.briefing ? (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-brass/5 border border-brass/15 text-sm text-cream-muted italic">
          <Sparkles className="h-4 w-4 text-brass-light/60 shrink-0 mt-0.5" />
          <span>{briefingData.briefing}</span>
        </div>
      ) : null}

      {/* New task panel */}
      {newTaskOpen ? (
        <NewTaskPanel
          onClose={() => setNewTaskOpen(false)}
          currentUserEmail={me?.email ?? ""}
          defaults={newTaskDefaults}
        />
      ) : null}

      {/* AI Suggestions (super_admin only) */}
      {me?.role === "super_admin" && visibleSuggestions.length > 0 ? (
        <GlassCard className="border border-brass/15 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setSuggestionsOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-brass/5 transition-colors"
          >
            <Lightbulb className="h-4 w-4 text-brass-light/70" />
            <span className="text-sm font-medium text-cream-muted">AI Suggestions</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-brass/15 text-brass-light font-semibold">
              {visibleSuggestions.length}
            </span>
            <span className="ml-auto text-cream-dim text-xs">{suggestionsOpen ? "▲" : "▼"}</span>
          </button>
          {suggestionsOpen ? (
            <div className="px-4 pb-3 space-y-2 border-t border-brass/10">
              {visibleSuggestions.map((s, idx) => {
                const realIdx = suggestions.indexOf(s);
                return (
                  <div key={idx} className="flex items-center gap-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-cream leading-snug">{s.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn(
                          "text-[10px] font-semibold uppercase tracking-widest",
                          s.priority === "High" ? "text-signal-rose" : s.priority === "Medium" ? "text-signal-amber" : "text-cream-dim"
                        )}>{s.priority}</span>
                        {s.date ? <span className="text-[10px] text-cream-dim">{formatDate(s.date)}</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        createTask.mutate({
                          description: s.description,
                          priority: s.priority,
                          date: s.date,
                          allocated_to: me?.email,
                        });
                        setDismissedSuggestions((prev) => [...prev, realIdx]);
                      }}
                      className="shrink-0 h-7 w-7 rounded-full border border-brass/30 flex items-center justify-center hover:bg-brass/15 hover:border-brass/60 text-brass-light/70 hover:text-brass-light transition-colors"
                      title="Add task"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </GlassCard>
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

      {/* Assignee pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest text-cream-dim mr-1">Assignee</span>
        {STAFF.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setAssigneeFilter(s.value)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border",
              assigneeFilter === s.value
                ? "bg-brass/20 border-brass/50 text-brass-light"
                : "border-brass/15 text-cream-dim hover:border-brass/30 hover:text-cream-muted",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-cream-dim">
          {filtered.length} {filtered.length === 1 ? "task" : "tasks"}
        </span>
        <div className="inline-flex rounded-lg border border-brass/15 bg-forest-raised/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              view === "list" ? "bg-brass/20 text-brass-light" : "text-cream-dim hover:text-cream-muted",
            )}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            type="button"
            onClick={() => setView("board")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              view === "board" ? "bg-brass/20 text-brass-light" : "text-cream-dim hover:text-cream-muted",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Board
          </button>
        </div>
      </div>

      {/* Task list / board */}
      {isLoading ? (
        <div className="text-cream-muted text-sm py-4">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks"
          description={statusFilter === "open" ? "All caught up — no open tasks." : "Nothing here."}
        />
      ) : view === "board" ? (
        <TaskBoardView
          todos={filtered}
          onSelect={setSelectedTask}
          onComplete={(id) => complete.mutate(id)}
          onPatch={(id, body) => patchTask.mutate({ id, body })}
          completing={complete.isPending}
          canManage={canManage}
        />
      ) : (
        <TaskListView
          todos={filtered}
          onSelect={setSelectedTask}
          onComplete={(id) => complete.mutate(id)}
          onPatch={(id, body) => patchTask.mutate({ id, body })}
          completing={complete.isPending}
          canManage={canManage}
        />
      )}

      {/* Task detail panel */}
      {selectedTask !== null ? (
        <TaskDetailPanel
          todo={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
    </div>
  );
}
