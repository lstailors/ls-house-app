import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { GlassCard } from "./GlassCard";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <GlassCard className={cn("p-10 md:p-14 flex flex-col items-center text-center", className)}>
      <div className="h-14 w-14 rounded-full border border-brass/25 bg-brass/5 flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-brass-light/80" />
      </div>
      <div className="display-heading text-2xl mb-1">{title}</div>
      {description ? (
        <div className="text-sm text-cream-muted max-w-sm">{description}</div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </GlassCard>
  );
}
