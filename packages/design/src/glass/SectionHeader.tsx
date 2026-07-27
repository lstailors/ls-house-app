import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface Props {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({ eyebrow, title, description, actions, className }: Props) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div>
        {eyebrow ? <div className="ui-label mb-2">{eyebrow}</div> : null}
        <h1 className="display-heading text-4xl md:text-5xl leading-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm text-cream-muted max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
