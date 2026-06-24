import { useState } from "react";
import { Plus, Play, Calendar, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CRON_JOBS, type CronJob, type RunStatus } from "../mockData";
import { SkeletonRows, useFakeLoading, comingSoon } from "../components/shared";

const STATUS_META: Record<RunStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  success: { label: "Success", cls: "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Failed", cls: "text-signal-rose border-signal-rose/30 bg-signal-rose/10", icon: <XCircle className="h-3 w-3" /> },
  running: { label: "Running", cls: "text-signal-amber border-signal-amber/30 bg-signal-amber/10", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
};

function StatusBadge({ status }: { status: RunStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border", m.cls)}>
      {m.icon} {m.label}
    </span>
  );
}

function JobToggle({ job }: { job: CronJob }) {
  const [enabled, setEnabled] = useState(job.enabled);
  return (
    <Switch
      checked={enabled}
      onCheckedChange={() => {
        // Optimistic flip for feel; real toggle wires later.
        setEnabled((v) => !v);
        comingSoon();
      }}
      className="data-[state=checked]:bg-signal-emerald data-[state=unchecked]:bg-cream/15"
    />
  );
}

function NewJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-forest-deep/95 backdrop-blur-2xl border border-brass/20 text-cream max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-cream font-medium">New Scheduled Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 opacity-60 pointer-events-none select-none">
          <div>
            <label className="ui-label block mb-1.5">Schedule</label>
            <input
              disabled
              placeholder="e.g. 6:45 AM daily  ·  cron: 45 6 * * *"
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Prompt</label>
            <textarea
              disabled
              placeholder="What should the agent do on each run?"
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim resize-none h-24"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Delivery target</label>
            <input
              disabled
              placeholder="e.g. iMessage to C  ·  #ops channel"
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim"
            />
          </div>
        </div>
        <p className="text-[10px] text-cream-dim text-center">Job creation goes live when we wire the scheduler.</p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
            Cancel
          </Button>
          <Button onClick={() => { comingSoon(); onOpenChange(false); }} className="btn-brass">
            Create Job — Coming soon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MobileJobCard({ job }: { job: CronJob }) {
  return (
    <div className={cn("glass-panel rounded-xl p-4 border border-brass/10", !job.enabled && "opacity-50")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-cream font-medium">{job.name}</div>
          <div className="text-[10px] text-cream-muted mt-0.5">{job.description}</div>
        </div>
        <JobToggle job={job} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <div><span className="ui-label text-[8px] block">Schedule</span><span className="text-cream-muted font-mono">{job.schedule}</span></div>
        <div><span className="ui-label text-[8px] block">Status</span><StatusBadge status={job.lastStatus} /></div>
        <div><span className="ui-label text-[8px] block">Last run</span><span className="text-cream-dim">{job.lastRun}</span></div>
        <div><span className="ui-label text-[8px] block">Next run</span><span className="text-cream-dim">{job.nextRun}</span></div>
      </div>
      <Button size="sm" variant="outline" onClick={comingSoon} className="mt-3 w-full h-8 text-xs border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
        <Play className="h-3 w-3 mr-1" /> Run Now
      </Button>
    </div>
  );
}

export default function CronTab() {
  const loading = useFakeLoading();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">SCHEDULED JOBS</span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="btn-brass h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> New Job
        </Button>
      </div>

      {loading ? (
        <SkeletonRows count={5} h="h-14" />
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
                {CRON_JOBS.map((job) => (
                  <tr key={job.id} className={cn("border-b border-brass/5 last:border-0 hover:bg-cream/[0.02] transition-colors", !job.enabled && "opacity-50")}>
                    <td className="px-4 py-3">
                      <div className="text-sm text-cream font-medium">{job.name}</div>
                      <div className="text-[10px] text-cream-dim mt-0.5 max-w-[220px] truncate">{job.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-cream-muted font-mono bg-forest-deep/50 border border-brass/10 rounded px-1.5 py-0.5">{job.schedule}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-cream-dim flex items-center gap-1"><Clock className="h-3 w-3" />{job.lastRun}</td>
                    <td className="px-4 py-3 text-[11px] text-cream-dim">{job.nextRun}</td>
                    <td className="px-4 py-3"><StatusBadge status={job.lastStatus} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <JobToggle job={job} />
                        <Button size="sm" variant="outline" onClick={comingSoon} className="h-7 text-[11px] border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
                          <Play className="h-3 w-3 mr-1" /> Run Now
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {CRON_JOBS.map((job) => <MobileJobCard key={job.id} job={job} />)}
          </div>
        </>
      )}

      <NewJobDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
