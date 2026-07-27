import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@ls/design/utils";
import { type GroupKey, type Todo, LIST_GROUPS, groupTasks } from "@/lib/tasks";
import { TaskCard } from "./TaskCard";

interface Props {
  todos: Todo[];
  onSelect: (todo: Todo) => void;
  onComplete: (id: string) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  completing: boolean;
  canManage: boolean;
}

const ACCENT_DOT: Record<string, string> = {
  rose: "bg-signal-rose",
  amber: "bg-signal-amber",
  brass: "bg-brass-light",
  dim: "bg-cream-dim",
};

// Done starts collapsed; everything else expanded.
const DEFAULT_COLLAPSED: Partial<Record<GroupKey, boolean>> = { done: true };

export function TaskListView({ todos, onSelect, onComplete, onPatch, completing, canManage }: Props) {
  const grouped = useMemo(() => groupTasks(todos, false), [todos]);
  const [collapsed, setCollapsed] = useState<Partial<Record<GroupKey, boolean>>>(DEFAULT_COLLAPSED);

  const toggle = (key: GroupKey) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div className="space-y-6">
      {LIST_GROUPS.map((group) => {
        const items = grouped[group.key];
        if (items.length === 0) return null;
        const isCollapsed = collapsed[group.key] ?? false;
        return (
          <section key={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              className="w-full flex items-center gap-2 mb-3 group"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", ACCENT_DOT[group.accent])} />
              <span className="text-[11px] uppercase tracking-widest text-cream-muted font-medium">{group.label}</span>
              <span className="text-[11px] text-cream-dim tabular-nums">{items.length}</span>
              <span className="flex-1 h-px bg-brass/10 ml-1" />
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-cream-dim transition-transform group-hover:text-cream-muted",
                  isCollapsed && "-rotate-90",
                )}
              />
            </button>
            {!isCollapsed ? (
              <div className="space-y-2.5">
                {items.map((todo) => (
                  <TaskCard
                    key={todo.name}
                    todo={todo}
                    onSelect={onSelect}
                    onComplete={onComplete}
                    onPatch={onPatch}
                    completing={completing}
                    canManage={canManage}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
