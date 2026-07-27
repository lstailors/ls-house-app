import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "../ui/input";
import { cn } from "../lib/utils";

interface Option {
  value: string;
  label: string;
}

interface Props {
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  filterValue?: string;
  onFilterChange?: (v: string) => void;
  filterOptions?: Option[];
  right?: ReactNode;
  className?: string;
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filterValue,
  onFilterChange,
  filterOptions,
  right,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-col md:flex-row md:items-center gap-3", className)}>
      {onSearchChange ? (
        <div className="relative flex-1 md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
          <Input
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 h-11 md:h-10 bg-forest-raised/40 border-brass/15 focus-visible:ring-brass/40 text-cream text-base md:text-sm"
          />
        </div>
      ) : null}
      {filterOptions && filterOptions.length > 0 ? (
        <div className="flex flex-nowrap md:flex-wrap gap-1.5 overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0 md:overflow-visible scrollbar-none">
          {filterOptions.map((opt) => {
            const active = filterValue === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFilterChange?.(opt.value)}
                className={cn(
                  "rounded-full px-3.5 py-2 md:py-1.5 text-xs border transition-all whitespace-nowrap min-h-[36px] md:min-h-0 shrink-0",
                  active
                    ? "border-brass bg-brass/15 text-cream shadow-brass-glow"
                    : "border-brass/15 bg-forest-raised/40 text-cream-muted hover:border-brass/40 hover:text-cream active:bg-brass/10",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {right ? <div className="md:ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}
