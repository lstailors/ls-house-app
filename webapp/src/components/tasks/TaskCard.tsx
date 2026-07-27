import { CheckCircle2 } from "lucide-react";
import { GlassCard } from "@ls/design";
import { cn } from "@ls/design/utils";
import { type Todo, isOverdue, staffMeta, stripHtml } from "@/lib/tasks";
import { TaskAvatar } from "./TaskAvatar";
import { TaskQuickActions } from "./TaskQuickActions";
import { DueChip, PriorityBadge, isClosed } from "./TaskBadges";

interface Props {
  todo: Todo;
  onSelect: (todo: Todo) => void;
  onComplete: (id: string) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  completing: boolean;
  canManage: boolean;
  compact?: boolean;
}

export function TaskCard({ todo, onSelect, onComplete, onPatch, completing, canManage, compact = false }: Props) {
  const closed = isClosed(todo);
  const text = stripHtml(todo.description);
  const limit = compact ? 90 : 130;
  const truncated = text.length > limit ? text.slice(0, limit) + "…" : text;
  const overdue = isOverdue(todo.date) && !closed;
  const meta = staffMeta(todo.allocated_to);

  return (
    <GlassCard
      onClick={() => onSelect(todo)}
      className={cn(
        "border border-brass/15 rounded-xl transition-all cursor-pointer hover:border-brass/35 hover:bg-brass/5",
        compact ? "p-3" : "p-4",
        overdue && "border-l-2 border-l-signal-rose",
        !overdue && todo.priority === "High" && !closed && "border-l-2 border-l-signal-amber",
        closed && "opacity-60",
      )}
    >
      {/* Header: priority + quick actions */}
      <div className="flex items-center gap-2">
        <PriorityBadge priority={todo.priority} />
        {closed ? (
          <span className="inline-flex text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-cream-dim">
            {todo.status}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {!closed ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onComplete(todo.name); }}
              disabled={completing}
              title="Mark complete"
              className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center transition-colors shrink-0",
                "text-brass-light/50 hover:text-signal-emerald hover:bg-signal-emerald/10",
                completing && "opacity-40 cursor-not-allowed",
              )}
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
          ) : null}
          <TaskQuickActions todo={todo} canManage={canManage} onPatch={onPatch} onEdit={onSelect} />
        </div>
      </div>

      {/* Description */}
      <p
        className={cn(
          "mt-2 leading-relaxed",
          compact ? "text-[13px]" : "text-sm",
          closed ? "text-cream-dim line-through" : "text-cream",
        )}
      >
        {truncated || <span className="text-cream-dim italic">No description</span>}
      </p>

      {/* Meta: due · assignee · reference */}
      <div className="mt-2.5 flex items-center gap-2.5 flex-wrap">
        <DueChip date={todo.date} closed={closed} />
        {todo.allocated_to ? (
          <span className="flex items-center gap-1.5 text-[11px] text-cream-muted min-w-0">
            <TaskAvatar email={todo.allocated_to} size="sm" />
            <span className="truncate">{meta.label}</span>
          </span>
        ) : null}
        {todo.reference_type && todo.reference_name ? (
          <span className="text-brass-light/60 font-mono text-[10px] truncate">
            {todo.reference_type} · {todo.reference_name}
          </span>
        ) : null}
      </div>
    </GlassCard>
  );
}
