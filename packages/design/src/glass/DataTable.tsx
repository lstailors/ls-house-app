import { useState, useMemo, type ReactNode } from "react";
import { GlassCard } from "./GlassCard";
import { cn } from "../lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  // Provide accessor to make this column sortable
  accessor?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  width?: string;
  className?: string;
  align?: "left" | "right" | "center";
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  className?: string;
  toolbar?: ReactNode;
  density?: "default" | "compact";
  highlightRow?: (row: T) => boolean;
  highlightRef?: React.RefObject<HTMLTableRowElement>;
}

type SortDir = "asc" | "desc" | null;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  className,
  toolbar,
  density = "default",
  highlightRow,
  highlightRef,
}: Props<T>) {
  const pad = density === "compact" ? "py-2.5" : "py-3.5";
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = (col: Column<T>) => {
    if (!col.accessor && !col.sortable) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.accessor) return rows;
    return [...rows].sort((a, b) => {
      const av = col.accessor!(a) ?? "";
      const bv = col.accessor!(b) ?? "";
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  return (
    <GlassCard className={cn("overflow-hidden", className)}>
      {toolbar ? (
        <div className="px-5 py-3 border-b border-brass/10 flex items-center justify-between gap-3">
          {toolbar}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brass/10 bg-brass/[0.03]">
              {columns.map((c) => {
                const isSortable = !!(c.accessor || c.sortable);
                const isActive = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    onClick={isSortable ? () => handleSort(c) : undefined}
                    className={cn(
                      "ui-label text-[9px] font-medium",
                      pad,
                      "px-5 text-left whitespace-nowrap",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.className,
                      isSortable && "cursor-pointer select-none group",
                    )}
                  >
                    <span className={cn(
                      "inline-flex items-center gap-1",
                      isSortable && "hover:text-brass-shimmer transition-colors",
                      isActive && "text-brass-shimmer",
                    )}>
                      {c.header}
                      {isSortable && (
                        <span className={cn(
                          "transition-opacity",
                          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50",
                        )}>
                          {isActive && sortDir === "asc"
                            ? <ChevronUp className="h-2.5 w-2.5" />
                            : isActive && sortDir === "desc"
                            ? <ChevronDown className="h-2.5 w-2.5" />
                            : <ChevronsUpDown className="h-2.5 w-2.5" />}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-12 text-center text-cream-muted">
                  {empty ?? "Nothing here yet."}
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const isHighlighted = highlightRow?.(row) ?? false;
                return (
                <tr
                  key={rowKey(row)}
                  ref={isHighlighted ? (highlightRef as any) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-brass/5 last:border-0 transition-colors",
                    onRowClick && "cursor-pointer hover:bg-brass/[0.06]",
                    isHighlighted && "bg-brass/10 border-l-2 border-l-brass-shimmer",
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-5",
                        pad,
                        "align-middle",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
