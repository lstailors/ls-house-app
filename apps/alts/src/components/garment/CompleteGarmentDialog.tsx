import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@ls/design/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ls/design/ui/select";
import { Input } from "@ls/design/ui/input";
import { Label } from "@ls/design/ui/label";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import { api } from "@ls/api-client";
import type { GarmentWorker } from "@ls/types";

/** Floor chips — quick select, no start/stop timer. */
export const TIME_CHIPS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: "15m" },
  { minutes: 30, label: "30m" },
  { minutes: 45, label: "45m" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1½h" },
  { minutes: 120, label: "2h" },
  { minutes: 150, label: "2½h" },
  { minutes: 180, label: "3h" },
];

const LAST_WORKER_KEY = "alts.last-complete-worker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (worker: string, actualMinutes: number) => void;
  isSubmitting: boolean;
  /** Prefill from est. minutes when available */
  defaultMinutes?: number | null;
}

export function CompleteGarmentDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  defaultMinutes,
}: Props) {
  const [worker, setWorker] = useState<string>("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ["garment-workers"],
    queryFn: () => api.get<GarmentWorker[]>("/api/garment/workers"),
    enabled: open,
  });

  // Prefill last worker + nearest chip when dialog opens
  useEffect(() => {
    if (!open) return;
    try {
      const last = localStorage.getItem(LAST_WORKER_KEY);
      if (last) setWorker(last);
    } catch {
      /* private mode */
    }
    setUseCustom(false);
    setCustom("");
    if (defaultMinutes && defaultMinutes > 0) {
      const nearest =
        TIME_CHIPS.reduce((best, c) =>
          Math.abs(c.minutes - defaultMinutes) < Math.abs(best.minutes - defaultMinutes)
            ? c
            : best,
        ).minutes;
      setMinutes(nearest);
    } else {
      setMinutes(null);
    }
  }, [open, defaultMinutes]);

  const resolvedMinutes = (() => {
    if (useCustom) {
      const n = Number(custom);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    return minutes;
  })();

  const canSubmit = !!worker && resolvedMinutes != null && resolvedMinutes > 0 && !isSubmitting;

  const handleConfirm = () => {
    if (!worker || resolvedMinutes == null || resolvedMinutes <= 0) return;
    try {
      localStorage.setItem(LAST_WORKER_KEY, worker);
    } catch {
      /* ignore */
    }
    onConfirm(worker, resolvedMinutes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-forest-raised/95 backdrop-blur-2xl border-brass/25 text-cream max-w-md">
        <DialogHeader>
          <DialogTitle className="display-heading text-2xl">Mark complete</DialogTitle>
          <DialogDescription className="text-cream-muted">
            Who finished it, and about how long? Chips only — no start/stop timer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="ui-label">Completed by</Label>
            <Select value={worker} onValueChange={setWorker}>
              <SelectTrigger className="min-h-[44px] bg-forest-deep/60 border-brass/25 text-cream">
                <SelectValue placeholder={isLoading ? "Loading workers…" : "Select tailor"} />
              </SelectTrigger>
              <SelectContent className="bg-forest-raised border-brass/25 text-cream">
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="ui-label">Time on piece</Label>
            <div className="grid grid-cols-4 gap-2">
              {TIME_CHIPS.map((c) => {
                const on = !useCustom && minutes === c.minutes;
                return (
                  <button
                    key={c.minutes}
                    type="button"
                    onClick={() => {
                      setUseCustom(false);
                      setMinutes(c.minutes);
                    }}
                    className={cn(
                      "min-h-[48px] rounded-xl border text-sm font-semibold transition-colors",
                      on
                        ? "border-brass bg-brass/25 text-cream"
                        : "border-brass/25 bg-forest-deep/40 text-cream-muted hover:border-brass/50 hover:text-cream",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setUseCustom(true);
                setMinutes(null);
              }}
              className={cn(
                "w-full min-h-[40px] rounded-xl border text-xs font-bold uppercase tracking-wide",
                useCustom
                  ? "border-brass bg-brass/15 text-brass"
                  : "border-brass/20 text-cream-dim hover:border-brass/40",
              )}
            >
              Custom minutes
            </button>
            {useCustom ? (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={480}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="e.g. 20"
                autoFocus
                className="min-h-[44px] bg-forest-deep/60 border-brass/25 text-cream placeholder:text-cream-dim/50"
              />
            ) : null}
            {resolvedMinutes != null ? (
              <p className="text-[11px] text-cream-dim">
                Logging <span className="text-brass font-semibold">{resolvedMinutes} min</span>
              </p>
            ) : (
              <p className="text-[11px] text-signal-amber">Pick a time chip to continue</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="min-h-[44px] border-brass/25 text-cream-muted hover:bg-brass/10"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="btn-brass min-h-[44px] gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isSubmitting ? "Saving…" : "Confirm complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
