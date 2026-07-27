import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@ls/design/utils";
import type { AgentStatus } from "../mockData";

// ─── Fake loading — shows the skeleton pattern even though data is static, ─────
// so the wiring session has the loading states already in place.

export function useFakeLoading(ms = 450) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return loading;
}

// ─── "Coming soon" toast — every disabled action routes through here ───────────

export function comingSoon() {
  toast("Coming soon — wiring in progress", {
    description: "This action goes live when we connect the Hermes API.",
  });
}

// ─── Status dot (Online / Idle / Offline) ─────────────────────────────────────

export const STATUS_DOT: Record<AgentStatus, string> = {
  online: "bg-signal-emerald shadow-[0_0_6px_rgba(79,191,142,0.8)]",
  idle: "bg-signal-amber shadow-[0_0_6px_rgba(232,168,92,0.7)]",
  offline: "bg-signal-rose shadow-[0_0_6px_rgba(217,123,108,0.6)]",
};

export const STATUS_TEXT: Record<AgentStatus, string> = {
  online: "text-signal-emerald",
  idle: "text-signal-amber",
  offline: "text-signal-rose",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  online: "Online",
  idle: "Idle",
  offline: "Offline",
};

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        STATUS_DOT[status],
        status === "online" && "animate-pulse",
        className,
      )}
    />
  );
}

// ─── Agent avatar — photo if we have one, brass monogram otherwise ────────────

const SIZE_MAP = {
  sm: "h-8 w-8 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-lg",
} as const;

export function AgentAvatar({
  name,
  photo,
  size = "md",
  className,
}: {
  name: string;
  photo?: string;
  size?: keyof typeof SIZE_MAP;
  className?: string;
}) {
  const initial = name.charAt(0).toUpperCase();
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className={cn("rounded-full object-cover border border-brass/25 shrink-0", SIZE_MAP[size], className)}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center font-display italic font-medium",
        "bg-gradient-to-br from-forest-raised to-forest-deep border border-brass/30 text-brass-light",
        SIZE_MAP[size],
        className,
      )}
    >
      {initial || <Bot className="h-4 w-4" />}
    </div>
  );
}

// ─── Agent name → accent color (used for badges in the activity log) ──────────

export const AGENT_ACCENT: Record<string, string> = {
  Maestro: "text-brass-light border-brass/30 bg-brass/10",
  Sofia: "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10",
  Mia: "text-[#7FA8E0] border-[#7FA8E0]/30 bg-[#7FA8E0]/10",
  Simone: "text-[#C9A0E0] border-[#C9A0E0]/30 bg-[#C9A0E0]/10",
  "La Penna": "text-cream-muted border-cream/20 bg-cream/5",
  Paperclip: "text-signal-amber border-signal-amber/30 bg-signal-amber/10",
  Marco: "text-[#E0A87F] border-[#E0A87F]/30 bg-[#E0A87F]/10",
};

export function agentAccent(name: string) {
  return AGENT_ACCENT[name] ?? "text-cream-muted border-cream/20 bg-cream/5";
}

// ─── Tab skeleton — shared loading pattern for every tab ──────────────────────

export function SkeletonGrid({ count = 6, h = "h-44" }: { count?: number; h?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("glass-panel rounded-2xl animate-pulse", h)} />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5, h = "h-16" }: { count?: number; h?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("glass-panel rounded-xl animate-pulse", h)} />
      ))}
    </div>
  );
}
