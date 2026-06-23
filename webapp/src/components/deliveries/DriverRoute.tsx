import { useMemo, useState } from "react";
import {
  Truck,
  MapPin,
  Clock,
  CheckCircle2,
  Phone,
  Camera,
  Navigation,
  Package,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Delivery } from "@/lib/types";
import { useUpdateDelivery } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  deliveries: Delivery[];
  isLoading: boolean;
  driverName: string;
}

const STATUS_ORDER: Record<string, number> = {
  out_for_delivery: 0,
  scheduled: 1,
  failed: 2,
  delivered: 3,
};

export function DriverRoute({ deliveries, isLoading, driverName }: Props) {
  const [proofDelivery, setProofDelivery] = useState<Delivery | null>(null);

  const sorted = useMemo(() => {
    return [...deliveries].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99;
      const sb = STATUS_ORDER[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
      const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
      return ta - tb;
    });
  }, [deliveries]);

  const todo = sorted.filter(
    (d) => d.status === "scheduled" || d.status === "out_for_delivery",
  );
  const done = sorted.filter(
    (d) => d.status === "delivered" || d.status === "failed",
  );

  const firstName = driverName.split(" ")[0] || "Driver";

  return (
    <div className="space-y-5 animate-fade-up pb-20">
      {/* Personal greeting */}
      <div className="space-y-2">
        <div className="ui-label text-cream-dim">My Route</div>
        <h1 className="font-display italic text-4xl sm:text-5xl text-cream leading-none">
          Good day, <span className="text-brass-shimmer">{firstName}</span>.
        </h1>
        <p className="text-sm text-cream-muted">
          {todo.length === 0
            ? "All routes cleared. Beautifully done."
            : `${todo.length} stop${todo.length === 1 ? "" : "s"} left today.`}
        </p>
      </div>

      {/* Compact summary chips */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <SummaryChip
          icon={<Clock className="h-4 w-4" />}
          label="Scheduled"
          count={deliveries.filter((d) => d.status === "scheduled").length}
        />
        <SummaryChip
          icon={<Truck className="h-4 w-4" />}
          label="On Route"
          count={deliveries.filter((d) => d.status === "out_for_delivery").length}
          accent="amber"
        />
        <SummaryChip
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Delivered"
          count={deliveries.filter((d) => d.status === "delivered").length}
          accent="emerald"
        />
      </div>

      {isLoading ? (
        <div className="text-cream-muted text-sm py-12 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading route…
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No deliveries today"
          description="Your route is clear. Check back later."
        />
      ) : (
        <>
          {/* Active stops */}
          {todo.length > 0 ? (
            <div className="space-y-3">
              <div className="ui-label">Next stops</div>
              {todo.map((d) => (
                <DriverStopCard
                  key={d.id}
                  delivery={d}
                  onUploadProof={() => setProofDelivery(d)}
                />
              ))}
            </div>
          ) : null}

          {/* Completed today */}
          {done.length > 0 ? (
            <CompletedSection deliveries={done} />
          ) : null}
        </>
      )}

      <ProofOfDeliveryDialog
        delivery={proofDelivery}
        onClose={() => setProofDelivery(null)}
      />
    </div>
  );
}

function SummaryChip({
  icon,
  label,
  count,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  accent?: "amber" | "emerald";
}) {
  const color =
    accent === "amber"
      ? "text-signal-amber"
      : accent === "emerald"
        ? "text-signal-emerald"
        : "text-brass-light";
  return (
    <GlassCard className="p-3 flex flex-col items-center text-center">
      <span className={cn("flex items-center gap-1.5 text-xs", color)}>
        {icon}
        <span>{label}</span>
      </span>
      <span className="font-display italic text-3xl text-cream leading-none mt-1">
        {count}
      </span>
    </GlassCard>
  );
}

function DriverStopCard({
  delivery,
  onUploadProof,
}: {
  delivery: Delivery;
  onUploadProof: () => void;
}) {
  const update = useUpdateDelivery();
  const isOnRoute = delivery.status === "out_for_delivery";
  const phone = delivery.customer?.phone;
  const address = delivery.addressLine ?? "";

  const mapsHref = address
    ? `https://maps.google.com/?q=${encodeURIComponent(address)}`
    : undefined;

  const startDelivery = async () => {
    try {
      await update.mutateAsync({ id: delivery.id, status: "out_for_delivery" });
      toast.success("Marked out for delivery");
    } catch (e) {
      toast.error((e as Error).message || "Could not update");
    }
  };

  const markDelivered = async () => {
    try {
      await update.mutateAsync({ id: delivery.id, status: "delivered" });
      toast.success("Marked delivered");
    } catch (e) {
      toast.error((e as Error).message || "Could not update");
    }
  };

  return (
    <GlassCard
      variant="strong"
      className={cn(
        "p-4 sm:p-5 space-y-4",
        isOnRoute && "border-signal-amber/40 shadow-[0_0_30px_-12px_rgba(232,168,92,0.4)]",
      )}
    >
      {/* Header: customer + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-cream text-lg sm:text-xl font-medium leading-tight truncate">
            {delivery.customer?.name ?? "—"}
          </div>
          <div className="text-[10px] text-cream-dim font-mono mt-0.5">
            #{delivery.id.slice(-6).toUpperCase()} · {delivery.orderRef ?? ""}
          </div>
        </div>
        <StatusPill status={delivery.status} />
      </div>

      {/* Address — prominent */}
      {address ? (
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl border border-brass/20 bg-forest-raised/40 hover:bg-brass/5 active:bg-brass/10 transition-colors p-4"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-brass/20 p-2 shrink-0">
              <MapPin className="h-4 w-4 text-brass-light" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="ui-label text-[9px] text-cream-dim">Drop-off</div>
              <div className="text-cream text-base leading-snug mt-0.5">{address}</div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-brass-light">
                <Navigation className="h-3 w-3" />
                <span>Open in Maps</span>
              </div>
            </div>
          </div>
        </a>
      ) : null}

      {/* Time */}
      <div className="flex items-center gap-2 text-sm text-cream-muted">
        <Clock className="h-4 w-4 text-cream-dim" />
        <span>{formatDateTime(delivery.scheduledAt)}</span>
      </div>

      {/* Proof status */}
      {delivery.proofOfDeliveryUrl ? (
        <div className="flex items-center gap-2 text-xs text-signal-emerald">
          <Camera className="h-3.5 w-3.5" />
          <span>Proof uploaded</span>
        </div>
      ) : null}

      {/* Action bar */}
      <div className="space-y-2 pt-1">
        {delivery.status === "scheduled" ? (
          <Button
            onClick={startDelivery}
            disabled={update.isPending}
            className="btn-brass w-full h-14 text-base"
          >
            <Truck className="h-5 w-5 mr-2" /> Start delivery
          </Button>
        ) : null}
        {isOnRoute ? (
          <Button
            onClick={markDelivered}
            disabled={update.isPending}
            className="bg-signal-emerald hover:bg-signal-emerald/90 text-forest font-medium w-full h-14 text-base"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" /> Mark delivered
          </Button>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={onUploadProof}
            className="border-brass/25 bg-forest-raised/40 hover:bg-brass/10 text-cream-muted hover:text-cream h-12"
          >
            <Camera className="h-4 w-4 mr-1.5" /> Proof
          </Button>
          {phone ? (
            <Button
              variant="outline"
              asChild
              className="border-brass/25 bg-forest-raised/40 hover:bg-brass/10 text-cream-muted hover:text-cream h-12"
            >
              <a href={`tel:${phone}`}>
                <Phone className="h-4 w-4 mr-1.5" /> Call
              </a>
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled
              className="border-brass/15 bg-forest-raised/30 text-cream-dim h-12"
            >
              <Phone className="h-4 w-4 mr-1.5" /> No phone
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function CompletedSection({ deliveries }: { deliveries: Delivery[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left px-1"
      >
        <div className="ui-label text-cream-muted flex items-center gap-2">
          <Package className="h-3 w-3" />
          Completed · {deliveries.length}
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-cream-dim" />
        ) : (
          <ChevronDown className="h-4 w-4 text-cream-dim" />
        )}
      </button>
      {open ? (
        <div className="space-y-2">
          {deliveries.map((d) => (
            <GlassCard
              key={d.id}
              className="p-3 flex items-center gap-3 opacity-75"
            >
              <CheckCircle2 className="h-4 w-4 text-signal-emerald shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-cream text-sm truncate">
                  {d.customer?.name ?? "—"}
                </div>
                <div className="text-[11px] text-cream-dim truncate">
                  {d.addressLine ?? ""}
                </div>
              </div>
              <StatusPill status={d.status} />
            </GlassCard>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProofOfDeliveryDialog({
  delivery,
  onClose,
}: {
  delivery: Delivery | null;
  onClose: () => void;
}) {
  const update = useUpdateDelivery();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const onFileChange = (f: File | null) => {
    setFile(f);
    if (f) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPreview(null);
    onClose();
  };

  const submit = async () => {
    if (!delivery || !preview) return;
    try {
      // Upload proof photos via ERPNext file API (backend handles storage).
      // For now we store the data URL on the delivery row so it's visible end-to-end.
      await update.mutateAsync({
        id: delivery.id,
        proofOfDeliveryUrl: preview,
        status: delivery.status === "out_for_delivery" ? "delivered" : delivery.status,
      });
      toast.success("Proof uploaded · delivery complete");
      handleClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not upload");
    }
  };

  return (
    <Dialog open={!!delivery} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-[420px] bg-forest-raised/95 backdrop-blur-xl border-brass/25">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-cream">
            Proof of Delivery
          </DialogTitle>
          <DialogDescription className="text-cream-muted">
            Snap a photo of the parcel handed off or signed receipt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-brass/20 bg-forest-deep">
              <img
                src={preview}
                alt="Proof preview"
                className="w-full max-h-[320px] object-contain"
              />
            </div>
          ) : (
            <label className="block rounded-xl border-2 border-dashed border-brass/25 bg-forest-deep/40 p-8 text-center cursor-pointer hover:border-brass/40 active:bg-brass/5 transition-colors">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              />
              <Camera className="h-10 w-10 text-brass-light/60 mx-auto mb-2" />
              <div className="text-cream text-sm">Tap to take photo</div>
              <div className="text-[11px] text-cream-dim mt-0.5">
                Or choose from library
              </div>
            </label>
          )}

          {preview ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => onFileChange(null)}
                className="border-brass/25 bg-forest-raised/40 hover:bg-brass/10 text-cream-muted h-12"
              >
                Retake
              </Button>
              <Button
                onClick={submit}
                disabled={update.isPending}
                className="btn-brass h-12"
              >
                {update.isPending ? "Uploading…" : "Confirm"}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={handleClose}
              className="w-full text-cream-muted hover:text-cream h-11"
            >
              Cancel
            </Button>
          )}

          <div className="text-[10px] text-cream-dim text-center">
            Photo is attached to delivery {file ? `· ${file.name}` : ""}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
