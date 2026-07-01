import { LayoutGrid, CalendarDays, Table2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ShopFloorView = "kanban" | "calendar" | "table";

const VIEWS: Array<{ key: ShopFloorView; label: string; icon: LucideIcon }> = [
  { key: "kanban", label: "Kanban", icon: LayoutGrid },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "table", label: "Table", icon: Table2 },
];

interface Props {
  value: ShopFloorView;
  onChange: (v: ShopFloorView) => void;
}

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-brass/20 bg-forest-deep/50 p-1">
      {VIEWS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            value === key
              ? "bg-brass/20 text-brass-light"
              : "text-cream-dim hover:text-cream",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
