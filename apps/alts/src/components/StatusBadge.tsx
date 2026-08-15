import { cn } from "@ls/design/utils";
import { toneFor, type StatusTone } from "@alts/lib/statusTone";

type Props = {
  status?: string | null;
  label?: string | null;
  tone?: StatusTone;
  /** larger tablet chip */
  size?: "sm" | "md";
  className?: string;
};

export default function StatusBadge({ status, label, tone, size = "md", className }: Props) {
  const t = toneFor(status || label, tone);
  const text = (label || status || "—").toString();
  return (
    <span className={cn("st-badge", `st-${t}`, size === "sm" && "is-sm", className)}>
      {text}
    </span>
  );
}
