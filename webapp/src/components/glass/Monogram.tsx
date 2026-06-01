import { cn } from "@/lib/utils";

interface Props {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_MAP = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
  xl: "h-24 w-24",
} as const;

export function Monogram({ size = "md", className }: Props) {
  return (
    <div className={cn("relative rounded-full overflow-hidden shrink-0", SIZE_MAP[size], className)}>
      <img
        src="/ls-logo-seal.png"
        alt="L&S Custom Tailors"
        className="h-full w-full object-cover"
        onError={(e) => {
          // Fallback to text monogram if image fails
          const el = e.currentTarget;
          el.style.display = "none";
          const parent = el.parentElement;
          if (parent) {
            parent.classList.add(
              "flex", "items-center", "justify-center",
              "bg-gradient-to-br", "from-forest-raised", "to-forest-deep",
              "border", "border-brass/35", "shadow-glass",
              "font-display", "italic", "font-medium", "text-brass-glow"
            );
            parent.textContent = "L&S";
          }
        }}
      />
    </div>
  );
}
