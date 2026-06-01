import type { ReactNode } from "react";
import { GlassCard } from "./GlassCard";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
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
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  className,
  toolbar,
  density = "default",
}: Props<T>) {
  const pad = density === "compact" ? "py-2.5" : "py-3.5";
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
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "ui-label text-[9px] font-medium",
                    pad,
                    "px-5 text-left whitespace-nowrap",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-12 text-center text-cream-muted">
                  {empty ?? "Nothing here yet."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-brass/5 last:border-0 transition-colors",
                    onRowClick && "cursor-pointer hover:bg-brass/[0.06]",
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
