import { cn } from "@ls/design/utils";

type Props = {
  on: boolean;
  onToggle: () => void;
  size?: "chip" | "band";
  className?: string;
};

export function CoverMoneyButton({ on, onToggle, size = "chip", className }: Props) {
  const label = on ? "Show numbers" : "Hide numbers";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      data-testid={size === "band" ? "cover-money" : "cover-money-chip"}
      title={on ? "Show sales numbers" : "Hide sales numbers from customers"}
      className={cn(
        "shrink-0 min-h-0 font-bold uppercase tracking-[0.08em] border",
        size === "band"
          ? "h-9 px-3.5 rounded-full text-[12px]"
          : "h-8 px-2.5 rounded-full text-[10.5px]",
        on
          ? "bg-brass text-forest-deep border-brass"
          : "bg-brass/20 text-brass-light border-brass/55 hover:bg-brass/30",
        className,
      )}
    >
      {label}
    </button>
  );
}
