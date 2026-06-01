import { cn } from "@/lib/utils";

interface Props {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

export function Monogram({ size = "md", className }: Props) {
  return (
    <div
      className={cn(
        "relative rounded-full flex items-center justify-center font-display italic font-medium text-brass-glow",
        "bg-gradient-to-br from-forest-raised to-forest-deep border border-brass/35 shadow-glass",
        SIZE_MAP[size],
        className,
      )}
    >
      <span className="relative z-10">L&amp;S</span>
      <div className="pointer-events-none absolute inset-0 rounded-full bg-brass-radial opacity-40" />
    </div>
  );
}
