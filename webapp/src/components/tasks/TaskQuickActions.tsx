import { MoreHorizontal, Check, CalendarClock, Flag, UserCog, CheckCircle2, RotateCcw, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ls/design/ui/dropdown-menu";
import { cn } from "@ls/design/utils";
import { type Priority, type Todo, STAFF_ROSTER, isoShift, isoToday } from "@/lib/tasks";
import { isClosed } from "./TaskBadges";

interface Props {
  todo: Todo;
  canManage: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onEdit?: (todo: Todo) => void;
  className?: string;
}

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

// Shared "⋯" menu used by both list cards and board cards. This is how cards
// move on the board (reschedule → time column, complete → Done) without drag.
export function TaskQuickActions({ todo, canManage, onPatch, onEdit, className }: Props) {
  const closed = isClosed(todo);
  const patch = (body: Record<string, unknown>) => onPatch(todo.name, body);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title="Quick actions"
          className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-colors",
            "text-cream-dim hover:text-cream hover:bg-brass/10",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
        className="w-52 bg-[#0a120e] border-brass/20 text-cream"
      >
        {closed ? (
          <DropdownMenuItem onClick={() => patch({ status: "Open" })} className="gap-2 focus:bg-brass/10">
            <RotateCcw className="h-3.5 w-3.5 text-brass-light/70" /> Reopen task
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => patch({ status: "Closed" })} className="gap-2 focus:bg-brass/10">
            <CheckCircle2 className="h-3.5 w-3.5 text-signal-emerald" /> Mark complete
          </DropdownMenuItem>
        )}

        {onEdit ? (
          <DropdownMenuItem onClick={() => onEdit(todo)} className="gap-2 focus:bg-brass/10">
            <Pencil className="h-3.5 w-3.5 text-brass-light/70" /> Edit details
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator className="bg-brass/10" />

        {/* Reschedule */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 focus:bg-brass/10 data-[state=open]:bg-brass/10">
            <CalendarClock className="h-3.5 w-3.5 text-brass-light/70" /> Reschedule
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="bg-[#0a120e] border-brass/20 text-cream">
            <DropdownMenuItem onClick={() => patch({ date: isoToday() })} className="focus:bg-brass/10">Today</DropdownMenuItem>
            <DropdownMenuItem onClick={() => patch({ date: isoShift(1) })} className="focus:bg-brass/10">Tomorrow</DropdownMenuItem>
            <DropdownMenuItem onClick={() => patch({ date: isoShift(7) })} className="focus:bg-brass/10">Next week</DropdownMenuItem>
            <DropdownMenuSeparator className="bg-brass/10" />
            <DropdownMenuItem onClick={() => patch({ date: null })} className="focus:bg-brass/10 text-cream-dim">Clear date</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Priority */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 focus:bg-brass/10 data-[state=open]:bg-brass/10">
            <Flag className="h-3.5 w-3.5 text-brass-light/70" /> Priority
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="bg-[#0a120e] border-brass/20 text-cream">
            {PRIORITIES.map((p) => (
              <DropdownMenuItem key={p} onClick={() => patch({ priority: p })} className="justify-between focus:bg-brass/10">
                {p}
                {todo.priority === p ? <Check className="h-3.5 w-3.5 text-brass-light" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Reassign — management only */}
        {canManage ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2 focus:bg-brass/10 data-[state=open]:bg-brass/10">
              <UserCog className="h-3.5 w-3.5 text-brass-light/70" /> Assign to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="bg-[#0a120e] border-brass/20 text-cream">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-cream-dim">Staff</DropdownMenuLabel>
              {STAFF_ROSTER.map((s) => (
                <DropdownMenuItem
                  key={s.email}
                  onClick={() => patch({ allocated_to: s.email })}
                  className="justify-between focus:bg-brass/10"
                >
                  {s.label}
                  {todo.allocated_to === s.email ? <Check className="h-3.5 w-3.5 text-brass-light" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
