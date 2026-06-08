import { useRef, useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, Camera, X, MapPin, PenLine } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import imageCompression from "browser-image-compression";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMarkDelivered } from "@/lib/queries";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

const schema = z.object({
  pod_method: z.string().min(1, "POD method is required"),
  received_by: z.string().optional(),
  signature_name: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const POD_METHODS = [
  "Signature",
  "Photo Only",
  "Signature + Photo",
  "Verbal Confirmation",
  "Left with Doorman",
  "Left at Door",
];

const REQUIRES_PHOTO = new Set(["Photo Only", "Signature + Photo"]);
const REQUIRES_SIG = new Set(["Signature", "Signature + Photo"]);

interface GpsCoords { latitude: number; longitude: number; accuracy: number }

interface Props {
  delivery: Delivery | null;
  onClose: () => void;
}

export function MarkDeliveredDialog({ delivery, onClose }: Props) {
  const markDelivered = useMarkDelivered();
  const sigPadRef = useRef<SignatureCanvas>(null);

  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [gps, setGps] = useState<GpsCoords | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "fetching" | "ok" | "denied">("idle");
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { pod_method: "" },
  });

  const podMethod = watch("pod_method");
  const needsPhoto = REQUIRES_PHOTO.has(podMethod);
  const needsSig = REQUIRES_SIG.has(podMethod);

  // Auto-fetch GPS when dialog opens
  useEffect(() => {
    if (!delivery) return;
    setGpsStatus("fetching");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsStatus("ok");
      },
      () => setGpsStatus("denied"),
      { timeout: 8000, enableHighAccuracy: true },
    );
  }, [delivery?.id]);

  const handlePhotoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 3 - photos.length);
    const compressed: File[] = [];
    for (const f of files) {
      try {
        const c = await imageCompression(f, { maxWidthOrHeight: 1600, useWebWorker: true });
        compressed.push(new File([c], f.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      } catch {
        compressed.push(f);
      }
    }
    setPhotos((p) => [...p, ...compressed].slice(0, 3));
    setPhotoPreviews((p) => [...p, ...compressed.map((f) => URL.createObjectURL(f))].slice(0, 3));
    e.target.value = "";
  }, [photos.length]);

  const removePhoto = (i: number) => {
    setPhotos((p) => p.filter((_, idx) => idx !== i));
    setPhotoPreviews((p) => p.filter((_, idx) => idx !== i));
  };

  const handleClose = () => {
    reset();
    setPhotos([]);
    setPhotoPreviews([]);
    setGps(null);
    setGpsStatus("idle");
    sigPadRef.current?.clear();
    onClose();
  };

  const onSubmit = async (values: FormValues) => {
    if (!delivery) return;

    if (needsPhoto && photos.length === 0) {
      toast.error("At least one photo is required for this POD method");
      return;
    }
    if (needsSig && (sigPadRef.current?.isEmpty() !== false)) {
      toast.error("Signature is required for this POD method");
      return;
    }

    setSubmitting(true);
    try {
      const id = delivery.id;
      const now = Date.now();
      const BUCKET = "delivery-photos";

      // Upload photos → collect public URLs
      const photoUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const path = `${id}/photo_${i + 1}_${now}.jpg`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, photos[i], { contentType: "image/jpeg", upsert: true });
        if (error) throw new Error(`Photo upload failed: ${error.message}`);
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        if (pub?.publicUrl) photoUrls.push(pub.publicUrl);
      }

      // Upload signature → get public URL
      let signatureImageUrl: string | undefined;
      if (needsSig && sigPadRef.current && !sigPadRef.current.isEmpty()) {
        const dataUrl = sigPadRef.current.getCanvas().toDataURL("image/png");
        const blob = await (await fetch(dataUrl)).blob();
        const sigFile = new File([blob], `signature_${now}.png`, { type: "image/png" });
        const sigPath = `${id}/signature_${now}.png`;
        const { error } = await supabase.storage.from(BUCKET).upload(sigPath, sigFile, { contentType: "image/png", upsert: true });
        if (!error) {
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(sigPath);
          signatureImageUrl = pub?.publicUrl ?? undefined;
        }
      }

      await markDelivered.mutateAsync({
        id,
        podMethod: values.pod_method,
        receivedBy: values.received_by || undefined,
        signatureName: values.signature_name || undefined,
        photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
        signatureImageUrl,
        gpsLat: gps?.latitude,
        gpsLng: gps?.longitude,
        gpsAccuracy: gps?.accuracy,
      });

      toast.success("Delivery marked as complete");
      handleClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not update delivery");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!delivery} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg bg-[#0e1a14]/95 backdrop-blur-xl border-[#c9a84c]/25 text-[#f5f0e8] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-[#f5f0e8]">
            Mark Delivered
          </DialogTitle>
          <DialogDescription className="text-[#a89070]">
            {delivery ? `Confirm delivery for ${delivery.customer?.name ?? "this customer"}.` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-1">

          {/* POD Method */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">
              POD Method <span className="text-rose-400">*</span>
            </Label>
            <Select onValueChange={(v) => setValue("pod_method", v, { shouldValidate: true })}>
              <SelectTrigger className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8]">
                <SelectValue placeholder="Select method…" />
              </SelectTrigger>
              <SelectContent className="bg-[#0e1a14] border-[#c9a84c]/25 text-[#f5f0e8]">
                {POD_METHODS.map((m) => (
                  <SelectItem key={m} value={m} className="focus:bg-[#c9a84c]/15 focus:text-[#f5f0e8]">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.pod_method && <p className="text-xs text-rose-400">{errors.pod_method.message}</p>}
          </div>

          {/* Photo upload */}
          <div className="space-y-1.5">
            <Label className={cn("text-[11px] uppercase tracking-widest", needsPhoto ? "text-[#c9a84c]" : "text-[#8a7560]")}>
              <Camera className="inline h-3 w-3 mr-1" />
              Photos {needsPhoto ? <span className="text-rose-400">*</span> : "(optional)"}
            </Label>
            <div className="flex gap-2 flex-wrap">
              {photoPreviews.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#c9a84c]/20">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removePhoto(i)} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <X className="h-2.5 w-2.5 text-white" />
                  </button>
                </div>
              ))}
              {photos.length < 3 && (
                <label className="w-20 h-20 flex flex-col items-center justify-center rounded-lg border border-dashed border-[#c9a84c]/30 cursor-pointer hover:border-[#c9a84c]/60 transition-colors">
                  <Camera className="h-5 w-5 text-[#8a7560] mb-1" />
                  <span className="text-[9px] text-[#8a7560] uppercase tracking-wider">Add</span>
                  <input type="file" accept="image/*" capture="environment" multiple onChange={handlePhotoChange} className="sr-only" />
                </label>
              )}
            </div>
          </div>

          {/* Signature pad */}
          <div className="space-y-1.5">
            <Label className={cn("text-[11px] uppercase tracking-widest", needsSig ? "text-[#c9a84c]" : "text-[#8a7560]")}>
              <PenLine className="inline h-3 w-3 mr-1" />
              Signature {needsSig ? <span className="text-rose-400">*</span> : "(optional)"}
            </Label>
            <div className="rounded-lg border border-[#c9a84c]/20 overflow-hidden bg-white">
              <SignatureCanvas
                ref={sigPadRef}
                penColor="#000"
                canvasProps={{ width: 440, height: 140, style: { width: "100%", height: 140, display: "block" } }}
              />
            </div>
            <button type="button" onClick={() => sigPadRef.current?.clear()} className="text-[10px] text-[#8a7560] hover:text-[#f5f0e8] transition-colors">
              Clear signature
            </button>
          </div>

          {/* Received by */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Received By (optional)</Label>
            <Input placeholder="Name of person who received" {...register("received_by")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
          </div>

          {/* Signature name */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-[#8a7560]">Signature Name (optional)</Label>
            <Input placeholder="Name on signature" {...register("signature_name")} className="bg-[#162118]/60 border-[#c9a84c]/20 text-[#f5f0e8] placeholder:text-[#8a7560] focus:border-[#c9a84c]/50" />
          </div>

          {/* GPS status */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <MapPin className="h-3 w-3 text-[#8a7560]" />
            {gpsStatus === "ok" ? (
              <span className="text-emerald-400">Location captured ✓</span>
            ) : gpsStatus === "fetching" ? (
              <span className="text-[#8a7560]">Getting location…</span>
            ) : gpsStatus === "denied" ? (
              <span className="text-[#8a7560]">Location unavailable</span>
            ) : null}
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting} className="flex-1 border-[#c9a84c]/20 bg-transparent text-[#a89070] hover:bg-[#c9a84c]/10 hover:text-[#f5f0e8] h-11">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium h-11">
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {submitting ? "Saving…" : "Confirm Delivered"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
