import { useState } from "react";
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
import { api } from "@ls/api-client";
import type { GarmentWorker } from "@ls/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (worker: string, actualMinutes?: number) => void;
  isSubmitting: boolean;
}

export function CompleteGarmentDialog({ open, onOpenChange, onConfirm, isSubmitting }: Props) {
  const [worker, setWorker] = useState<string>("");
  const [minutes, setMinutes] = useState<string>("");

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ["garment-workers"],
    queryFn: () => api.get<GarmentWorker[]>("/api/garment/workers"),
    enabled: open,
  });

  const handleConfirm = () => {
    if (!worker) return;
    const parsed = minutes.trim() === "" ? undefined : Number(minutes);
    const actual = parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined;
    onConfirm(worker, actual);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-forest-raised/95 backdrop-blur-2xl border-brass/25 text-cream">
        <DialogHeader>
          <DialogTitle className="display-heading text-2xl">Mark garment complete</DialogTitle>
          <DialogDescription className="text-cream-muted">
            Record who finished the work. Actual minutes are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="ui-label">Completed by</Label>
            <Select value={worker} onValueChange={setWorker}>
              <SelectTrigger className="min-h-[44px] bg-forest-deep/60 border-brass/25 text-cream">
                <SelectValue placeholder={isLoading ? "Loading workers…" : "Select a worker"} />
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
            <Label className="ui-label" htmlFor="actual-minutes">
              Actual minutes (optional)
            </Label>
            <Input
              id="actual-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="e.g. 45"
              className="min-h-[44px] bg-forest-deep/60 border-brass/25 text-cream placeholder:text-cream-dim/50"
            />
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
            disabled={!worker || isSubmitting}
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
