import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, CheckCircle2, XCircle, Loader2, Play, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { SkeletonRows } from "../components/shared";
import { toast } from "sonner";

type RunStatus = "success" | "failed" | "running" | "unknown";

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  last_run: string;
  next_run: string;
  enabled: boolean;
  last_status: RunStatus;
  description: string;
}

const STATUS_META: Record<RunStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  success: { label: "Success", cls: "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Failed", cls: "text-signal-rose border-signal-rose/30 bg-signal-rose/10", icon: <XCircle className="h-3 w-3" /> },
  running: { label: "Running", cls: "text-signal-amber border-signal-amber/30 bg-signal-amber/10", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  unknown: { label: "Unknown", cls: "text-cream-dim border-brass/15 bg-cream/5", icon: <Clock className="h-3 w-3" /> },
};

function StatusBadge({ status }: { status: RunStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.unknown;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border", m.cls)}>
      {m.icon} {m.label}
    </span>
  );
}

function JobToggle({ job, onToggle }: { job: CronJob; onToggle: (id: string, enabled: boolean) => void }) {
  return (
    <Switch
      checked={job.enabled}
      onCheckedChange={(checked) => onToggle(job.id, checked)}
      className="data-[state=checked]:bg-signal-emerald data-[state=unchecked]:bg-cream/15"
    />
  );
}

function MobileJobCard({
  job,
  onRun,
  onToggle,
  running,
}: {
  job: CronJob;
  onRun: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  running: boolean;
}) {
  return (
    <div className={cn("glass-panel rounded-xl p-4 border border-brass/10", !job.enabled && "opacity-50")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-cream font-medium">{job.name}</div>
          <div className="text-[10px] text-cream-muted mt-0.5">{job.description}</div>
        </div>
        <JobToggle job={job} onToggle={onToggle} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <div><span className="ui-label text-[8px] block">Schedule</span><span className="text-cream-muted font-mono">{job.schedule}</span></div>
        <div><span className="ui-label text-[8px] block">Status</span><StatusBadge status={job.last_status} /></div>
        <div><span className="ui-label text-[8px] block">Last run</span><span className="text-cream-dim">{job.last_run}</span></div>
        <div><span className="ui-label text-[8px] block">Next run</span><span className="text-cream-dim">{job.next_run}</span></div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onRun(job.id)}
        disabled={running}
        className="mt-3 w-full h-8 text-xs border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
      >
        {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
        Run Now
      </Button>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-panel rounded-2xl p-8 border border-brass/10 flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-cream-dim">Could not load scheduled jobs.</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
      </Button>
    </div>
  );
}

export default function CronTab() {
  const qc = useQueryClient();
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["house-cron"],
    queryFn: () => api.get<{ jobs: CronJob[] }>("/api/house/cron"),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<{ ok: boolean }>(`/api/house/cron/${id}`, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: ["house-cron"] });
      const prev = qc.getQueryData<{ jobs: CronJob[] }>(["house-cron"]);
      qc.setQueryData(["house-cron"], (old: any) => ({
        ...old,
        jobs: old?.jobs?.map((j: CronJob) =>
          j.id === id ? { ...j, enabled } : j
        ) ?? [],
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["house-cron"], ctx.prev);
      toast.error("Failed to update job");
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean }>(`/api/house/cron/${id}/run`, {}),
    onMutate: (id) => setRunningIds((s) => new Set(s).add(id)),
    onSuccess: (_res, id) => {
      setRunningIds((s) => { const n = new Set(s); n.delete(id); return n; });
      toast.success("Job triggered");
    },
    onError: (_err, id) => {
      setRunningIds((s) => { const n = new Set(s); n.delete(id); return n; });
      toast.error("Failed to trigger job");
    },
  });

  const jobs: CronJob[] = data?.jobs ?? [];

  if (isLoading) return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">SCHEDULED JOBS</span>
        </div>
      </div>
      <SkeletonRows count={5} h="h-14" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">SCHEDULED JOBS</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8 text-xs border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block glass-panel rounded-2xl border border-brass/10 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-brass/10">
                  {["Name", "Schedule", "Last Run", "Next Run", "Status", "Actions"].map((h) => (
                    <th key={h} className="ui-label text-[9px] px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className={cn("border-b border-brass/5 last:border-0 hover:bg-cream/[0.02] transition-colors", !job.enabled && "opacity-50")}>
                    <td className="px-4 py-3">
                      <div className="text-sm text-cream font-medium">{job.name}</div>
                      <div className="text-[10px] text-cream-dim mt-0.5 max-w-[220px] truncate">{job.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-cream-muted font-mono bg-forest-deep/50 border border-brass/10 rounded px-1.5 py-0.5">{job.schedule}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-cream-dim">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{job.last_run}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-cream-dim">{job.next_run}</td>
                    <td className="px-4 py-3"><StatusBadge status={job.last_status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <JobToggle job={job} onToggle={(id, enabled) => toggleMutation.mutate({ id, enabled })} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runMutation.mutate(job.id)}
                          disabled={runningIds.has(job.id)}
                          className="h-7 text-[11px] border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
                        >
                          {runningIds.has(job.id)
                            ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            : <Play className="h-3 w-3 mr-1" />}
                          Run Now
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-cream-dim">
                      No scheduled jobs found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {jobs.map((job) => (
              <MobileJobCard
                key={job.id}
                job={job}
                onRun={(id) => runMutation.mutate(id)}
                onToggle={(id, enabled) => toggleMutation.mutate({ id, enabled })}
                running={runningIds.has(job.id)}
              />
            ))}
            {jobs.length === 0 ? (
              <div className="glass-panel rounded-xl p-8 border border-brass/10 text-center">
                <p className="text-sm text-cream-dim">No scheduled jobs found.</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
