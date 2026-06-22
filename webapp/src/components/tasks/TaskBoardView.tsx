import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { type Todo, BOARD_COLUMNS, groupTasks } from "@/lib/tasks";
import { TaskCard } from "./TaskCard";

interface Props {
  todos: Todo[];
  onSelect: (todo: Todo) => void;
  onComplete: (id: string) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  completing: boolean;
  canManage: boolean;
}

const ACCENT_BAR: Record<string, string> = {
  rose: "bg-signal-rose",
  amber: "bg-signal-amber",
  brass: "bg-brass-light",
  dim: "bg-cream-dim/60",
};

const ACCENT_TEXT: Record<string, string> = {
  rose: "text-signal-rose",
  amber: "text-signal-amber",
  brass: "text-brass-light",
  dim: "text-cream-dim",
};

export function TaskBoardView({ todos, onSelect, onComplete, onPatch, completing, canManage }: Props) {
  // Board folds undated tasks into Upcoming so columns stay tidy.
  const grouped = useMemo(() => groupTasks(todos, true), [todos]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory md:grid md:grid-cols-4 md:overflow-visible scrollbar-none">
      {BOARD_COLUMNS.map((col) => {
        const items = grouped[col.key];
        return (
          <div
            key={col.key}
            className="snap-start shrink-0 w-[80vw] sm:w-[330px] md:w-auto flex flex-col rounded-xl bg-forest-raised/20 border border-brass/10"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-brass/10">
              <span className={cn("h-3 w-1 rounded-full", ACCENT_BAR[col.accent])} />
              <span className={cn("text-[11px] uppercase tracking-widest font-medium", ACCENT_TEXT[col.accent])}>
                {col.label}
              </span>
              <span className="ml-auto text-[11px] text-cream-dim tabular-nums bg-white/5 rounded-full px-2 py-0.5">
                {items.length}
              </span>
            </div>

            {/* Column body */}
            <div className="flex-1 p-2 space-y-2 min-h-[120px] md:max-h-[calc(100vh-22rem)] md:overflow-y-auto scrollbar-none">
              {items.length === 0 ? (
                <div className="h-24 flex items-center justify-center text-[11px] text-cream-dim/50 italic">
                  Nothing here
                </div>
              ) : (
                items.map((todo) => (
                  <TaskCard
                    key={todo.name}
                    todo={todo}
                    onSelect={onSelect}
                    onComplete={onComplete}
                    onPatch={onPatch}
                    completing={completing}
                    canManage={canManage}
                    compact
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
