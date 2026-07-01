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
        size === "sm" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
        meta.pill,
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}
