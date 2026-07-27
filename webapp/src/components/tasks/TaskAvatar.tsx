import { cn } from "@ls/design/utils";
import { staffMeta } from "@/lib/tasks";

interface Props {
  email: string | null;
  size?: "sm" | "md";
  className?: string;
}

const SIZE = {
  sm: "h-6 w-6 text-[9px]",
  md: "h-8 w-8 text-[11px]",
} as const;

// Initials avatar for a task assignee. Color is stable per person.
export function TaskAvatar({ email, size = "md", className }: Props) {
  const meta = staffMeta(email);
  return (
    <div
      title={meta.email || "Unassigned"}
      className={cn(
        "rounded-full flex items-center justify-center font-semibold uppercase shrink-0 select-none",
        meta.bg,
        meta.text,
        SIZE[size],
        className,
      )}
    >
      {meta.initials}
    </div>
  );
}
