import { Camera, PenLine, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeliveryProofUrls } from "@/lib/queries";
import type { Delivery } from "@/lib/types";

interface Props {
  delivery: Delivery | null;
  onClose: () => void;
}

export function ProofViewerDialog({ delivery, onClose }: Props) {
  const { data: urls, isLoading } = useDeliveryProofUrls(delivery?.id ?? null);

  const photos = [urls?.photo1, urls?.photo2, urls?.photo3].filter(Boolean) as string[];

  return (
    <Dialog open={!!delivery} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-[#0e1a14]/95 backdrop-blur-xl border-[#c9a84c]/25 text-[#f5f0e8]">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-[#f5f0e8]">
            Proof of Delivery
          </DialogTitle>
          {delivery ? (
            <p className="text-sm text-[#a89070]">
              {delivery.deliveryNo ?? `#${delivery.id.slice(-6).toUpperCase()}`} · {delivery.customer?.name}
            </p>
          ) : null}
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-[#a89070] text-sm">Loading proof…</div>
        ) : (
          <div className="space-y-4 mt-2">
            {photos.length > 0 ? (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-[#8a7560] mb-2">
                  <Camera className="h-3 w-3" /> Photos
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-[#c9a84c]/15 hover:border-[#c9a84c]/40 transition-colors">
                      <img src={url} alt={`Proof photo ${i + 1}`} className="w-full object-cover aspect-[4/3] bg-[#162118]" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {urls?.signature ? (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-[#8a7560] mb-2">
                  <PenLine className="h-3 w-3" /> Signature
                </div>
                <a href={urls.signature} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-[#c9a84c]/15 hover:border-[#c9a84c]/40 transition-colors max-w-xs">
                  <img src={urls.signature} alt="Signature" className="w-full object-contain bg-white p-2" />
                </a>
              </div>
            ) : null}

            {photos.length === 0 && !urls?.signature ? (
              <div className="py-8 text-center text-[#a89070] text-sm">No proof files stored for this delivery.</div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
