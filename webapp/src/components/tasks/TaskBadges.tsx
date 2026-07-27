import { Clock } from "lucide-react";
import { cn } from "@ls/design/utils";
import { type Priority, type Todo, formatDate, isDueToday, isOverdue } from "@/lib/tasks";

// ── Priority pill ─────────────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<Priority, string> = {
  High: "bg-signal-rose/10 text-signal-rose",
  Medium: "bg-signal-amber/10 text-signal-amber",
  Low: "bg-white/5 text-cream-dim",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full",
        PRIORITY_STYLE[priority],
      )}
    >
      {priority}
    </span>
  );
}

// ── Due-date chip ─────────────────────────────────────────────────────────────

interface DueChipProps {
  date: string | null;
  closed?: boolean;
  className?: string;
}

// Compact due-date chip that colors itself by urgency.
export function DueChip({ date, closed = false, className }: DueChipProps) {
  if (!date) return null;
  const overdue = !closed && isOverdue(date);
  const today = !closed && isDueToday(date);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5",
        overdue
          ? "bg-signal-rose/10 text-signal-rose"
          : today
            ? "bg-signal-amber/10 text-signal-amber"
            : "text-cream-dim",
        className,
      )}
    >
      <Clock className="h-3 w-3" />
      {overdue ? "Overdue · " : today ? "Today · " : ""}
      {formatDate(date)}
    </span>
  );
}

export function isClosed(todo: Todo): boolean {
  return todo.status === "Closed" || todo.status === "Cancelled";
}
