import { useState } from "react";
import { Sparkles, AlertTriangle, CheckCircle2, XCircle, Clock, Eye, Bot, ChevronDown, ChevronUp } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { Button } from "@/components/ui/button";
import { useMaestroBrief, useMaestroApprovals, useApproveAction } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "text-signal-amber", icon: <Clock className="h-3 w-3" /> },
  awaiting_second: { label: "Awaiting 2nd", color: "text-signal-amber", icon: <Clock className="h-3 w-3" /> },
  shadow_review: { label: "Observation", color: "text-cream-dim", icon: <Eye className="h-3 w-3" /> },
  approved: { label: "Approved", color: "text-signal-emerald", icon: <CheckCircle2 className="h-3 w-3" /> },
  denied: { label: "Denied", color: "text-signal-rose", icon: <XCircle className="h-3 w-3" /> },
  revised: { label: "Revised", color: "text-cream-muted", icon: <Clock className="h-3 w-3" /> },
  expired: { label: "Expired", color: "text-cream-dim", icon: <Clock className="h-3 w-3" /> },
  cancelled: { label: "Cancelled", color: "text-cream-dim", icon: <XCircle className="h-3 w-3" /> },
};

const CATEGORY_ACCENT: Record<string, "default" | "emerald" | "amber" | "rose"> = {
  financial: "amber",
  factory: "amber",
  order: "emerald",
  email: "default",
  outbound_sms: "default",
  outbound_email: "default",
  social: "default",
  marketing: "default",
  task: "default",
  communication: "default",
  system: "rose",
  other: "default",
};

function AgentBadge({ name }: { name: string }) {
  const display = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brass/10 border border-brass/20 text-[10px] text-brass-light">
      <Bot className="h-2.5 w-2.5" />
      {display}
    </span>
  );
}

function ApprovalCard({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const [denyNote, setDenyNote] = useState("");
  const [denying, setDenying] = useState(false);
  const approve = useApproveAction();

  const statusMeta = STATUS_META[item.status] ?? STATUS_META.pending;
  const isActionable = item.status === "pending" || item.status === "awaiting_second";
  const isShadow = item.status === "shadow_review";
  const isResolved = ["approved", "denied", "expired", "cancelled", "revised"].includes(item.status);

  const handleApprove = async () => {
    try {
      await approve.mutateAsync({ id: item.id, action: "approve" });
      toast.success("Action approved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to approve");
    }
  };

  const handleDeny = async () => {
    try {
      await approve.mutateAsync({ id: item.id, action: "deny", notes: denyNote || undefined });
      toast.success("Action denied");
      setDenying(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to deny");
    }
  };

  return (
    <GlassCard className={cn("p-4 transition-opacity", isResolved && "opacity-50")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <AgentBadge name={item.source_agent ?? "unknown"} />
            <span className={cn("inline-flex items-center gap-1 text-[10px]", statusMeta.color)}>
              {statusMeta.icon}
              {statusMeta.label}
            </span>
            {item.category ? (
              <span className="text-[10px] text-cream-dim border border-brass/15 rounded px-1.5 py-0.5 capitalize">
                {item.category.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>
          <div className="text-sm text-cream font-medium leading-snug">
            {item.title ?? "(untitled)"}
          </div>
          {item.summary ? (
            <div className="text-xs text-cream-muted mt-1 leading-relaxed line-clamp-2">
              {item.summary}
            </div>
          ) : null}
        </div>
        {item.proposed_action || item.payload ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-cream-dim hover:text-cream shrink-0 mt-0.5"
            aria-label="Toggle details"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-3 pt-3 border-t border-brass/10">
          {item.proposed_action ? (
            <div className="text-xs text-cream-muted mb-2">
              <span className="ui-label text-[9px] block mb-1">Proposed action</span>
              <span className="text-cream">{String(item.proposed_action)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {isShadow ? (
        <div className="mt-3 pt-2 border-t border-brass/10 flex items-center gap-1.5 text-[10px] text-cream-dim">
          <Eye className="h-3 w-3" />
          Observation only — no action available (Sofia v3 validation)
        </div>
      ) : null}

      {isActionable && !isShadow ? (
        <div className="mt-3 pt-3 border-t border-brass/10">
          {denying ? (
            <div className="space-y-2">
              <textarea
                value={denyNote}
                onChange={(e) => setDenyNote(e.target.value)}
                placeholder="Reason for denial (optional)"
                className="w-full text-xs bg-forest-raised/50 border border-brass/15 rounded p-2 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 resize-none h-16"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={handleDeny}
                  disabled={approve.isPending}
                >
                  Confirm Deny
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setDenying(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="btn-brass h-7 text-xs"
                onClick={handleApprove}
                disabled={approve.isPending}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10 hover:text-signal-rose"
                onClick={() => setDenying(true)}
                disabled={approve.isPending}
              >
                Deny
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </GlassCard>
  );
}

export default function MissionControl() {
  const { data: brief, isLoading: briefLoading } = useMaestroBrief();
  const { data: approvals = [], isLoading: approvalsLoading } = useMaestroApprovals();

  const pendingCount = approvals.filter(
    (i) => i.status === "pending" || i.status === "awaiting_second",
  ).length;

  const visibleApprovals = approvals.filter((i) => i.category !== "financial");

  return (
    <div className="space-y-8 animate-fade-up">
      <SectionHeader
        eyebrow="Maestro · Mission Control"
        title={
          <>
            The <span className="text-brass-shimmer">brief</span> & decisions.
          </>
        }
        description="Daily intelligence from Maestro, live signals, and proposed actions awaiting your review."
      />

      {/* Signals */}
      {brief?.signals?.length ? (
        <div>
          <div className="ui-label mb-3">Live Signals</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {(brief.signals as any[]).map((s, i) => (
              <KpiCard
                key={s.key ?? i}
                label={s.label}
                value={s.value}
                hint={s.delta}
                accent={s.accent ?? CATEGORY_ACCENT[s.category ?? ""] ?? "default"}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Daily Brief */}
      <GlassCard variant="strong" className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-brass-light" />
          <span className="ui-label">Daily Brief</span>
          {brief?.date ? (
            <span className="text-[10px] text-cream-dim ml-auto">{brief.date}</span>
          ) : null}
        </div>
        {briefLoading ? (
          <div className="text-cream-dim text-sm">Loading…</div>
        ) : brief?.brief ? (
          <div className="text-sm text-cream-muted leading-relaxed whitespace-pre-wrap">
            {String(brief.brief)}
          </div>
        ) : (
          <div className="text-cream-dim text-sm italic">
            No brief received yet. Maestro will post here via webhook.
          </div>
        )}
      </GlassCard>

      {/* Anomalies */}
      {brief?.anomalies?.length ? (
        <div className="space-y-2">
          <div className="ui-label">Anomaly Flags</div>
          {(brief.anomalies as any[]).map((a, i) => (
            <div
              key={a.id ?? i}
              className={cn(
                "flex items-start gap-2 px-3 py-2 rounded-md border text-sm",
                a.severity === "critical"
                  ? "bg-signal-rose/10 border-signal-rose/30 text-signal-rose"
                  : a.severity === "warn"
                  ? "bg-signal-amber/10 border-signal-amber/30 text-signal-amber"
                  : "bg-forest-raised/40 border-brass/15 text-cream-muted",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{String(a.message)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Approval Queue */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="ui-label">Pending Actions</div>
          {pendingCount > 0 ? (
            <span className="h-5 min-w-5 px-1.5 rounded-full bg-signal-amber/20 border border-signal-amber/30 text-signal-amber text-[10px] flex items-center justify-center">
              {pendingCount}
            </span>
          ) : null}
        </div>
        {approvalsLoading ? (
          <div className="text-cream-dim text-sm">Loading…</div>
        ) : visibleApprovals.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-signal-emerald mx-auto mb-2" />
            <div className="text-cream-muted text-sm">All clear — no pending actions.</div>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleApprovals.map((item) => (
              <ApprovalCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
