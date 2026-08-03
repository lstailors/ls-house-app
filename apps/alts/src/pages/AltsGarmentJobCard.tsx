import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  Calendar,
  Flame,
  PlayCircle,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@ls/api-client";
import { GlassCard } from "@ls/design";
import { StatusPill } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { Skeleton } from "@ls/design/ui/skeleton";
import { GarmentDetailsCard } from "@alts/components/garment/GarmentDetailsCard";
import { WorkToDoList } from "@alts/components/garment/WorkToDoList";
import { MeasurementsList } from "@alts/components/garment/MeasurementsList";
import { CompleteGarmentDialog } from "@alts/components/garment/CompleteGarmentDialog";
import {
  formatDueDate,
  isTruthyFlag,
  isInProgress,
  isCompleted,
  statusVariant,
} from "@alts/components/garment/garmentFormat";
import type { GarmentJobCard, GarmentActionResult } from "@ls/types";

export default function GarmentJobCardPage() {
  const { ticket, garmentId } = useParams<{ ticket: string; garmentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);

  const jobCardKey = ["garment-job-card", ticket, garmentId];

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: jobCardKey,
    queryFn: () =>
      api.post<GarmentJobCard>("/api/garment/job-card", {
        ticket,
        garment_id: garmentId,
      }),
    enabled: !!ticket && !!garmentId,
    retry: (count, err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return false;
      return count < 2;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: jobCardKey });

  const statusMutation = useMutation({
    mutationFn: (status: "In Progress" | "Pending") =>
      api.post<GarmentActionResult>("/api/garment/status", {
        ticket,
        garment_id: garmentId,
        status,
      }),
    onSuccess: (res, status) => {
      toast.success(res.message ?? (status === "In Progress" ? "Marked in progress" : "Garment reopened"));
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["alts-home-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["pickup-ready"] });
    },
    onError: () => toast.error("Could not update status — please try again"),
  });

  const completeMutation = useMutation({
    mutationFn: (vars: { worker: string; actual_minutes: number }) =>
      api.post<GarmentActionResult>("/api/garment/complete", {
        ticket,
        garment_id: garmentId,
        worker: vars.worker,
        actual_minutes: vars.actual_minutes,
      }),
    onSuccess: (res, vars) => {
      setCompleteOpen(false);
      if (res.all_garments_ready === true) {
        toast.success("Order complete — customer notified", {
          description: `${vars.actual_minutes} min logged · every garment ready.`,
        });
      } else {
        toast.success(res.message ?? `Complete · ${vars.actual_minutes} min logged`);
      }
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["alts-home-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["pickup-ready"] });
      void queryClient.invalidateQueries({ queryKey: ["tailor-tally"] });
    },
    onError: () => toast.error("Could not complete garment — please try again"),
  });

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-5 animate-fade-up">
        <Skeleton className="h-28 w-full rounded-2xl bg-forest-raised/40" />
        <Skeleton className="h-56 w-full rounded-2xl bg-forest-raised/40" />
        <Skeleton className="h-40 w-full rounded-2xl bg-forest-raised/40" />
        <Skeleton className="h-24 w-full rounded-2xl bg-forest-raised/40" />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (isError || !data) {
    const status = error instanceof ApiError ? error.status : 0;
    const msg = error instanceof ApiError ? error.message : "";
    const isAuth = status === 401;
    const isMissing = status === 404;
    return (
      <div className="mx-auto max-w-lg">
        <GlassCard className="p-8 flex flex-col items-center text-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-signal-rose/30 bg-signal-rose/10">
            <AlertTriangle className="h-6 w-6 text-signal-rose" />
          </div>
          <div>
            <h2 className="display-heading text-2xl">
              {isAuth
                ? "Sign in to open this tag"
                : isMissing
                  ? "Garment not found"
                  : "Couldn't load this garment"}
            </h2>
            <p className="text-sm text-cream-muted mt-1">
              {isAuth
                ? "Your session expired on this iPad — sign in once and the job card will reopen."
                : isMissing
                  ? `${garmentId} isn’t on ${ticket}. Check the hang tag.`
                  : msg || `${garmentId} on ${ticket} — check your connection and try again.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {isAuth ? (
              <Button
                onClick={() =>
                  navigate("/login", {
                    replace: true,
                    state: {
                      from: {
                        pathname: `/g/${encodeURIComponent(ticket || "")}/${encodeURIComponent(garmentId || "")}`,
                      },
                    },
                  })
                }
                className="btn-brass min-h-[44px]"
              >
                Sign in
              </Button>
            ) : (
              <Button onClick={() => refetch()} className="btn-brass min-h-[44px]" disabled={isFetching}>
                <RotateCcw className="h-4 w-4 mr-1.5" /> Retry
              </Button>
            )}
          </div>
        </GlassCard>
      </div>
    );
  }

  const rush = isTruthyFlag(data.is_rush);
  const garmentStatus = data.garment?.status ?? null;
  const inProgress = isInProgress(garmentStatus);
  const completed = isCompleted(garmentStatus);
  const estMinutes = (data.lines ?? []).reduce((sum, l) => {
    const n = Number(l.est_minutes ?? (l as { estimated_minutes?: number }).estimated_minutes ?? 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28 animate-fade-up">
      {/* Header */}
      <GlassCard variant="strong" className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ui-label">Garment Job Card</div>
            <h1 className="display-heading text-3xl leading-tight mt-1">
              {data.customer ?? "Customer"}
            </h1>
            <p className="text-xs font-mono text-brass-light/70 mt-1">{data.ticket ?? ticket}</p>
          </div>
          {rush ? (
            <span className="pill pill-rose shrink-0 !text-[11px] animate-pulse">
              <Flame className="h-3.5 w-3.5" /> RUSH
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data.ticket_state ? (
            <StatusPill
              status={data.ticket_state}
              variant={statusVariant(data.ticket_state)}
              label={data.ticket_state}
            />
          ) : null}
          {data.due_date ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-cream-muted">
              <Calendar className="h-3.5 w-3.5 text-brass-light/60" />
              Due {formatDueDate(data.due_date)}
            </span>
          ) : null}
          {data.customer_phone ? (
            <a
              href={`tel:${data.customer_phone}`}
              className="inline-flex items-center gap-1.5 text-xs text-brass-light hover:text-brass-glow transition-colors"
            >
              <Phone className="h-3.5 w-3.5" />
              {data.customer_phone}
            </a>
          ) : null}
        </div>
      </GlassCard>

      <GarmentDetailsCard garment={data.garment} fallbackId={garmentId} />

      <WorkToDoList lines={data.lines} />

      <MeasurementsList measurements={data.measurements} />

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brass/20 bg-forest-deep/95 backdrop-blur-2xl px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          <div className="flex gap-2">
            <Button
              onClick={() => statusMutation.mutate("In Progress")}
              disabled={statusMutation.isPending || inProgress}
              className="btn-brass flex-1 min-h-[48px] gap-1.5"
            >
              <PlayCircle className="h-4 w-4" />
              {inProgress ? "In Progress" : "Mark In Progress"}
            </Button>
            <Button
              onClick={() => setCompleteOpen(true)}
              disabled={completeMutation.isPending}
              className="flex-1 min-h-[48px] gap-1.5 bg-signal-emerald/90 text-forest-deep font-medium hover:bg-signal-emerald"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Complete
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => statusMutation.mutate("Pending")}
            disabled={statusMutation.isPending}
            className="min-h-[44px] gap-1.5 border-brass/25 text-cream-muted hover:bg-brass/10"
          >
            <RotateCcw className="h-4 w-4" />
            {completed ? "Reopen — Not complete" : "Reset to Pending"}
          </Button>
          {isFetching ? (
            <p className="text-center text-[10px] text-cream-dim">Refreshing…</p>
          ) : null}
        </div>
      </div>

      <CompleteGarmentDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        isSubmitting={completeMutation.isPending}
        defaultMinutes={estMinutes > 0 ? estMinutes : null}
        onConfirm={(worker, actualMinutes) =>
          completeMutation.mutate({ worker, actual_minutes: actualMinutes })
        }
      />
    </div>
  );
}
