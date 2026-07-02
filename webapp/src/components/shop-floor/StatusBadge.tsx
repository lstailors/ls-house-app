import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/shopFloor";

interface Props {
  status: string;
  className?: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, className, size = "md" }: Props) {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium uppercase tracking-widerer whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-[11px]",
        meta.pill,
        className,
      )}
    >
      <span
        className={cn("rounded-full shrink-0", size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5")}
        style={{
          backgroundColor: meta.color,
          boxShadow: `0 0 6px 1px ${meta.color}, 0 0 2px 0 ${meta.color}`,
        }}
      />
      {meta.label}
    </span>
  );
}
