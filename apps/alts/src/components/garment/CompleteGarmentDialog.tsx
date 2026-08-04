import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, CheckCircle2, ImagePlus, X } from "lucide-react";
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
import { getStoredToken } from "@ls/auth/authClient";
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
const API = import.meta.env.VITE_BACKEND_URL || "";

type StagedPhoto = { id: string; file: File; url: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (worker: string, actualMinutes: number) => void;
  isSubmitting: boolean;
  /** Prefill from est. minutes when available */
  defaultMinutes?: number | null;
  /** When set, show optional finished-piece photo capture (uploads before complete). */
  ticket?: string | null;
  garmentId?: string | null;
  /** Override title for batch progress mode */
  title?: string;
  description?: string;
}

async function uploadFinishedPhoto(ticket: string, garment: string, file: File) {
  const fd = new FormData();
  const safeName = (file.name || "photo.jpg").replace(/[^\w.\-]+/g, "_");
  fd.append("file", file);
  fd.append("path", `alts/${ticket}/${garment}/done-${Date.now()}-${safeName}`);
  fd.append("ticketName", ticket);
  fd.append("garmentRef", garment);
  const token = getStoredToken();
  const res = await fetch(`${API}/api/intake-alterations/photos`, {
    method: "POST",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string } | string;
    data?: unknown;
  };
  if (!res.ok) {
    const msg =
      typeof json.error === "string"
        ? json.error
        : json.error?.message || `Photo upload failed (${res.status})`;
    throw new Error(msg);
  }
  return json.data;
}

export function CompleteGarmentDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  defaultMinutes,
  ticket,
  garmentId,
  title,
  description,
}: Props) {
  const [worker, setWorker] = useState<string>("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const photosEnabled = !!(ticket && garmentId);

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ["garment-workers"],
    queryFn: () => api.get<GarmentWorker[]>("/api/garment/workers"),
    enabled: open,
  });

  // Prefill last worker + nearest chip when dialog opens; clear staged photos
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
    setPhotoError(null);
    setUploadingPhotos(false);
    setPhotos((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.url);
      return [];
    });
    if (defaultMinutes && defaultMinutes > 0) {
      const nearest = TIME_CHIPS.reduce((best, c) =>
        Math.abs(c.minutes - defaultMinutes) < Math.abs(best.minutes - defaultMinutes)
          ? c
          : best,
      ).minutes;
      setMinutes(nearest);
    } else {
      setMinutes(null);
    }
  }, [open, defaultMinutes]);

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      setPhotos((prev) => {
        for (const p of prev) URL.revokeObjectURL(p.url);
        return prev;
      });
    };
  }, []);

  const resolvedMinutes = (() => {
    if (useCustom) {
      const n = Number(custom);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    return minutes;
  })();

  const busy = isSubmitting || uploadingPhotos;
  const canSubmit = !!worker && resolvedMinutes != null && resolvedMinutes > 0 && !busy;

  const stageFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next: StagedPhoto[] = [];
    for (const file of Array.from(list)) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
      });
    }
    if (next.length) {
      setPhotos((prev) => [...prev, ...next].slice(0, 8));
      setPhotoError(null);
    }
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleConfirm = async () => {
    if (!worker || resolvedMinutes == null || resolvedMinutes <= 0) return;
    try {
      localStorage.setItem(LAST_WORKER_KEY, worker);
    } catch {
      /* ignore */
    }

    if (photosEnabled && photos.length > 0 && ticket && garmentId) {
      setUploadingPhotos(true);
      setPhotoError(null);
      try {
        for (const p of photos) {
          await uploadFinishedPhoto(ticket, garmentId, p.file);
        }
      } catch (e) {
        setUploadingPhotos(false);
        setPhotoError(e instanceof Error ? e.message : "Photo upload failed");
        return;
      }
      setUploadingPhotos(false);
    }

    onConfirm(worker, resolvedMinutes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-forest-raised/95 backdrop-blur-2xl border-brass/25 text-cream max-w-md max-h-[min(92dvh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="display-heading text-2xl">
            {title ?? "Mark complete"}
          </DialogTitle>
          <DialogDescription className="text-cream-muted">
            {description ??
              "Who finished it, and about how long? Chips only — no start/stop timer."}
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

          {photosEnabled ? (
            <div className="space-y-2">
              <Label className="ui-label">Finished photos · optional</Label>
              <p className="text-[11px] text-cream-dim">
                Snap the finished piece before you log it. Saved on the ticket under {garmentId}.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy || photos.length >= 8}
                  onClick={() => cameraRef.current?.click()}
                  className="min-h-[48px] rounded-xl border border-brass/40 bg-brass/15 text-cream text-xs font-bold uppercase tracking-wide inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  Take photo
                </button>
                <button
                  type="button"
                  disabled={busy || photos.length >= 8}
                  onClick={() => libraryRef.current?.click()}
                  className="min-h-[48px] rounded-xl border border-brass/25 bg-forest-deep/40 text-cream-muted text-xs font-bold uppercase tracking-wide inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <ImagePlus className="h-4 w-4" />
                  Library
                </button>
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  stageFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={libraryRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  stageFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {photos.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {photos.map((p) => (
                    <div
                      key={p.id}
                      className="relative aspect-square rounded-lg overflow-hidden border border-brass/25 bg-black/40"
                    >
                      <img src={p.url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        disabled={busy}
                        onClick={() => removePhoto(p.id)}
                        className="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-forest-deep/90 border border-brass/30 text-cream grid place-items-center"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-cream-dim/80">No photos — complete still works without them.</p>
              )}
              {photoError ? (
                <p className="text-[11px] text-signal-rose">{photoError}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="min-h-[44px] border-brass/25 text-cream-muted hover:bg-brass/10"
          >
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!canSubmit} className="btn-brass min-h-[44px] gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {uploadingPhotos
              ? `Uploading photo${photos.length === 1 ? "" : "s"}…`
              : isSubmitting
                ? "Saving…"
                : photos.length
                  ? `Confirm · ${photos.length} photo${photos.length === 1 ? "" : "s"}`
                  : "Confirm complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
