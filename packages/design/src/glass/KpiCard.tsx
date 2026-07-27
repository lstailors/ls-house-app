import type { ReactNode } from "react";
import { GlassCard } from "./GlassCard";
import { cn } from "../lib/utils";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: "default" | "emerald" | "amber" | "rose";
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

const ACCENT_GLOW: Record<NonNullable<Props["accent"]>, string> = {
  default: "from-brass/8 to-transparent",
  emerald: "from-signal-emerald/15 to-transparent",
  amber: "from-signal-amber/15 to-transparent",
  rose: "from-signal-rose/15 to-transparent",
};

export function KpiCard({ label, value, hint, icon, accent = "default", className, onClick, active }: Props) {
  return (
    <GlassCard
      hover
      onClick={onClick}
      className={cn(
        "p-3 sm:p-5 overflow-hidden",
        onClick && "cursor-pointer",
        active && "ring-1 ring-brass/50",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full blur-3xl opacity-60 bg-gradient-radial",
          "bg-gradient-to-br",
          ACCENT_GLOW[accent],
        )}
      />
      <div className="relative flex items-start justify-between">
        <div className="ui-label">{label}</div>
        {icon ? <div className="text-brass-light/70">{icon}</div> : null}
      </div>
      <div className="relative mt-3 kpi-number">{value}</div>
      {hint ? (
        <div className="relative mt-2 text-xs text-cream-muted/80">{hint}</div>
      ) : null}
    </GlassCard>
  );
}
