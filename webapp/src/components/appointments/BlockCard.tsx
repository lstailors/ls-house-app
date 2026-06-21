import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimeBlock } from "../../../../backend/src/types";

const AGENT_COLORS: Record<string, { dot: string; text: string }> = {
  "carl@lstailors.com": { dot: "bg-emerald-400", text: "text-emerald-300" },
  "sal@lstailors.com": { dot: "bg-amber-400", text: "text-amber-300" },
  "kelvin@lstailors.com": { dot: "bg-blue-400", text: "text-blue-300" },
  "chris@ckcny.com": { dot: "bg-rose-400", text: "text-rose-300" },
};
const DEFAULT_AGENT_COLOR = { dot: "bg-[#B08D57]", text: "text-[#B08D57]" };

function formatTime(str: string): string {
  return new Date(str.replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

interface Props {
  block: TimeBlock;
}

export function BlockCard({ block }: Props) {
  const agentEmail = block.agentUser ?? "";
  const agentColors = AGENT_COLORS[agentEmail] ?? DEFAULT_AGENT_COLOR;

  const timeLabel = block.allDay
    ? "All Day"
    : `${formatTime(block.startsOn)}${block.endsOn ? ` – ${formatTime(block.endsOn)}` : ""}`;

  return (
    <div
      className="w-full rounded-xl border border-white/10 p-3 bg-[#0D1A10]/80 relative overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(-45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 10px)",
      }}
    >
      <div className="flex items-start gap-2">
        <Ban className="w-4 h-4 text-white/30 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#F1E9D6]/50 font-mono tabular-nums">{timeLabel}</span>
            {block.isWholeshop ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                Whole Shop
              </span>
            ) : null}
          </div>
          <p className="text-sm text-[#F1E9D6]/70 truncate mt-0.5">
            {block.reason ?? "Blocked"}
          </p>
          {block.agentDisplayName ? (
            <div className={cn("flex items-center gap-1 mt-1")}>
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", agentColors.dot)} />
              <span className={cn("text-[10px]", agentColors.text)}>{block.agentDisplayName}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
