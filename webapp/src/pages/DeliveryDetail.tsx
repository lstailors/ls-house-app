import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Phone, MapPin, Clock, CheckCircle2, Truck, Printer,
  Camera, Search, Loader2, User, Pencil, PenLine, Navigation, QrCode,
  Package, ExternalLink, FileText,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useUpdateDelivery, useCustomerSearch, useDeliveryProofUrls } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { formatDateTime } from "@/lib/format";
import { MarkDeliveredDialog } from "@/components/deliveries/MarkDeliveredDialog";
import { DeliveryPinMap } from "@/components/maps/DeliveryPinMap";
import { AiInsightsCard } from "@/components/deliveries/AiInsightsCard";
import type { Delivery } from "@/lib/types";

// Delivery extended with fields added to serializeDelivery
interface DeliveryDetail extends Delivery {
  podMethod?: string | null;
  receivedBy?: string | null;
  signatureName?: string | null;
  hasSignature?: boolean;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  garmentSummary?: string | null;
  garmentCount?: number | null;
}

export default function DeliveryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const update = useUpdateDelivery();

  const [markDeliveredOpen, setMarkDeliveredOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const { data: delivery, isLoading } = useQuery({
    queryKey: ["delivery", id],
    queryFn: () => api.get<DeliveryDetail>(`/api/deliveries/${id}`),
    enabled: !!id,
  });

  // Load proof URLs when delivered (photos/signature stored as public URLs in ERP)
  const { data: proof, isLoading: proofLoading } = useDeliveryProofUrls(
    delivery?.status === "delivered" ? (id ?? null) : null,
  );

  const { data: contactResults = [], isFetching: searchingContact } = useCustomerSearch(contactSearch);

  const { data: orderItems } = useQuery({
    queryKey: ["delivery-order-items", delivery?.orderRef],
    queryFn: async () => {
      if (!delivery?.orderRef) return null;
      const so = await api.get<any>(`/api/sales-orders/${encodeURIComponent(delivery.orderRef)}`);
      return (so as any)?.items ?? null;
    },
    enabled: !!delivery?.orderRef,
    staleTime: 5 * 60_000,
  });

  // Generate QR on load
  useEffect(() => {
    if (!delivery?.qrToken) return;
    QRCode.toDataURL(
      `https://delivered.lstailors.com/d/${delivery.qrToken}`,
      { width: 200, margin: 1, color: { dark: "#000000", light: "#ffffff" } },
    ).then(setQrDataUrl).catch(() => {});
  }, [delivery?.qrToken]);

  const swapContact = useMutation({
    mutationFn: (customerId: string) =>
      api.patch<Delivery>(`/api/deliveries/${id}`, { customerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery", id] });
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      setEditingContact(false);
      setContactSearch("");
      toast.success("Contact updated");
    },
    onError: () => toast.error("Could not update contact"),
  });

  const handleStart = async () => {
    try {
      await update.mutateAsync({ id: id!, status: "out_for_delivery" });
      qc.invalidateQueries({ queryKey: ["delivery", id] });
      toast.success("Marked out for delivery");
    } catch { toast.error("Could not update"); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-cream-muted text-sm">Loading…</div>;
  }

  if (!delivery) {
    return (
      <div className="text-center py-16">
        <div className="text-cream-muted mb-4">Delivery not found</div>
        <Button variant="outline" onClick={() => navigate("/deliveries")}>Back to board</Button>
      </div>
    );
  }

  const isOut = delivery.status === "out_for_delivery";
  const isDelivered = delivery.status === "delivered";
  const photos = [proof?.photo1, proof?.photo2, proof?.photo3].filter(Boolean) as string[];
  const mapsUrl = delivery.gpsLatitude && delivery.gpsLongitude
    ? `https://maps.google.com/?q=${delivery.gpsLatitude},${delivery.gpsLongitude}`
    : null;

  return (
    <div className="space-y-5 animate-fade-up max-w-2xl mx-auto pb-10">

      {/* Back */}
      <button
        onClick={() => navigate("/deliveries")}
        className="flex items-center gap-2 text-sm text-cream-muted hover:text-cream transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to board
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-cream font-medium text-xl">{delivery.customer?.name ?? "—"}</div>
          <div className="text-xs text-cream-dim font-mono mt-1">
            {delivery.deliveryNo ?? `#${delivery.id.slice(-6).toUpperCase()}`}
          </div>
          {delivery.orderRef ? (
            <Link
              to={`/sales-orders/${delivery.orderRef}`}
              className="text-xs text-brass-light/70 hover:text-brass-light font-mono flex items-center gap-1 mt-1"
            >
              <ExternalLink className="h-3 w-3" /> {delivery.orderRef}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={delivery.status} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/deliveries/${id}/label`)}
            className="border-brass/20 hover:bg-brass/10 text-cream-muted h-8 px-2"
            title="Print 4×6 label"
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`/api/deliveries/${id}/confirmation`, "_blank")}
            className="border-brass/20 hover:bg-brass/10 text-cream-muted h-8 px-2"
            title="Print confirmation"
          >
            <FileText className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {delivery.status === "scheduled" ? (
          <Button onClick={handleStart} disabled={update.isPending} className="btn-brass flex-1">
            <Truck className="h-4 w-4 mr-1.5" /> Start delivery
          </Button>
        ) : null}
        {isOut ? (
          <Button onClick={() => setMarkDeliveredOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1">
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark delivered
          </Button>
        ) : null}
        {delivery.customer?.phone ? (
          <Button variant="outline" className="border-brass/20 hover:bg-brass/10 text-cream-muted" asChild>
            <a href={`tel:${delivery.customer.phone}`}>
              <Phone className="h-4 w-4" />
            </a>
          </Button>
        ) : null}
      </div>

      {/* Contact card */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
            <User className="h-3 w-3" /> Contact
          </div>
          <button
            type="button"
            onClick={() => { setEditingContact((v) => !v); setContactSearch(""); }}
            className="flex items-center gap-1 text-[10px] text-brass-light/60 hover:text-brass-light transition-colors"
          >
            <Pencil className="h-3 w-3" /> {editingContact ? "Cancel" : "Change"}
          </button>
        </div>

        {editingContact ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
              <Input
                autoFocus
                placeholder="Search by name, phone, or email…"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="pl-8 bg-forest-raised/40 border-brass/20 text-cream placeholder:text-cream-dim text-sm h-9"
              />
              {searchingContact ? (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim animate-spin" />
              ) : null}
            </div>
            {contactSearch.length >= 2 && (
              <div className="rounded-lg border border-brass/15 bg-forest-deep divide-y divide-brass/10 max-h-40 overflow-y-auto">
                {contactResults.length === 0 && !searchingContact ? (
                  <div className="px-3 py-2 text-xs text-cream-muted">No customers found</div>
                ) : (
                  contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={swapContact.isPending}
                      onClick={() => swapContact.mutate(c.id)}
                      className="w-full text-left px-3 py-2.5 hover:bg-brass/10 transition-colors"
                    >
                      <div className="text-sm text-cream font-medium">{c.name}</div>
                      <div className="text-[10px] text-cream-dim mt-0.5">
                        {[c.phone, c.email].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-cream font-medium">{delivery.customer?.name ?? "—"}</div>
            {delivery.customer?.phone ? (
              <a href={`tel:${delivery.customer.phone}`} className="flex items-center gap-1.5 text-xs text-cream-muted hover:text-cream transition-colors">
                <Phone className="h-3 w-3" /> {delivery.customer.phone}
              </a>
            ) : null}
            {delivery.customer?.email ? (
              <div className="text-xs text-cream-dim">{delivery.customer.email}</div>
            ) : null}
          </div>
        )}
      </GlassCard>

      {/* Delivery info */}
      <GlassCard className="p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-widest text-cream-dim">Delivery Info</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {delivery.addressLine ? (
            <div className="col-span-2 flex items-start gap-1.5 text-cream-muted">
              <MapPin className="h-3.5 w-3.5 text-brass-light/60 mt-0.5 shrink-0" />
              <span>{delivery.addressLine}</span>
              <a
                href={`https://maps.apple.com/?daddr=${encodeURIComponent(delivery.addressLine)}&dirflg=d`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-brass-light hover:underline shrink-0"
              >
                Directions →
              </a>
            </div>
          ) : null}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Scheduled</div>
            <div className="text-cream">{formatDateTime(delivery.scheduledAt)}</div>
          </div>
          {delivery.deliveredAt ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Delivered</div>
              <div className="text-signal-emerald">{formatDateTime(delivery.deliveredAt)}</div>
            </div>
          ) : null}
          {delivery.driver ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Driver</div>
              <div className="text-cream">{delivery.driver.name}</div>
            </div>
          ) : null}
          {delivery.notes ? (
            <div className="col-span-2">
              <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Garments</div>
              <div className="text-cream-muted">{delivery.notes}</div>
            </div>
          ) : null}
        </div>
      </GlassCard>

      {/* Order Items */}
      {(orderItems?.length || delivery.garmentSummary) ? (
        <GlassCard className="p-4">
          <div className="text-[11px] uppercase tracking-widest text-cream-dim mb-3 flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" /> Items in this Delivery
          </div>
          {orderItems?.length ? (
            <div className="space-y-2">
              {orderItems.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-brass/10 last:border-0">
                  <div>
                    <div className="text-sm text-cream font-medium">{item.item_name}</div>
                    {item.description ? (
                      <div className="text-[11px] text-cream-dim mt-0.5 leading-snug">
                        {item.description.replace(/<[^>]*>/g, "").slice(0, 80)}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-sm font-bold text-brass-light ml-4">×{item.qty}</div>
                </div>
              ))}
            </div>
          ) : delivery.garmentSummary ? (
            <div className="text-sm text-cream">{delivery.garmentSummary}</div>
          ) : null}
        </GlassCard>
      ) : null}

      {/* Map — GPS drop point if available, else geocode address */}
      {(delivery.gpsLatitude || delivery.addressLine) ? (
        <GlassCard className="p-0 overflow-hidden">
          <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
            <MapPin className="h-3 w-3" />
            {delivery.gpsLatitude ? "Drop Location" : "Delivery Address"}
          </div>
          <DeliveryPinMap
            lat={delivery.gpsLatitude}
            lng={delivery.gpsLongitude}
            address={delivery.gpsLatitude ? undefined : delivery.addressLine}
            label={delivery.customer?.name ?? undefined}
            height={240}
          />
        </GlassCard>
      ) : null}

      {/* POD — auto-loaded, large */}
      {isDelivered ? (
        <GlassCard className="p-4 space-y-4">
          <div className="text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
            <Camera className="h-3 w-3" /> Proof of Delivery
          </div>

          {/* POD meta */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {delivery.podMethod ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Method</div>
                <div className="text-cream">{delivery.podMethod}</div>
              </div>
            ) : null}
            {delivery.receivedBy ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Received by</div>
                <div className="text-cream">{delivery.receivedBy}</div>
              </div>
            ) : null}
            {delivery.signatureName ? (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-0.5">Signature name</div>
                <div className="text-cream">{delivery.signatureName}</div>
              </div>
            ) : null}
          </div>

          {/* GPS drop point */}
          {delivery.gpsLatitude && delivery.gpsLongitude ? (
            <div className="flex items-center gap-2 text-xs text-cream-muted">
              <Navigation className="h-3.5 w-3.5 text-brass-light/60 shrink-0" />
              <span>{delivery.gpsLatitude.toFixed(5)}, {delivery.gpsLongitude.toFixed(5)}</span>
              {delivery.gpsAccuracy ? (
                <span className="text-cream-dim">±{Math.round(delivery.gpsAccuracy)}m</span>
              ) : null}
              {mapsUrl ? (
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-brass-light hover:underline ml-1">
                  Open in Maps →
                </a>
              ) : null}
            </div>
          ) : null}

          {/* Proof photos — large */}
          {proofLoading ? (
            <div className="flex items-center gap-2 text-xs text-cream-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading proof…
            </div>
          ) : photos.length > 0 ? (
            <div className={`grid gap-3 ${photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {photos.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border border-brass/15 hover:border-brass/40 transition-colors">
                  <img
                    src={url}
                    alt={`Proof photo ${i + 1}`}
                    className="w-full object-cover"
                    style={{ maxHeight: photos.length === 1 ? 480 : 280 }}
                  />
                </a>
              ))}
            </div>
          ) : (
            <div className="text-xs text-cream-dim">No photos stored</div>
          )}

          {/* Signature */}
          {proof?.signature ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-2 flex items-center gap-1.5">
                <PenLine className="h-3 w-3" /> Signature
              </div>
              <a href={proof.signature} target="_blank" rel="noopener noreferrer" className="inline-block rounded-xl overflow-hidden border border-brass/15 hover:border-brass/40 transition-colors">
                <img src={proof.signature} alt="Signature" className="max-w-xs w-full object-contain bg-white p-3" style={{ maxHeight: 140 }} />
              </a>
            </div>
          ) : delivery.hasSignature ? (
            <div className="text-xs text-cream-dim flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5" /> Signature on file (URL expired — reload to refresh)
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      {/* AI Insights */}
      <AiInsightsCard deliveryId={delivery.id} />

      {/* QR code */}
      {delivery.qrToken ? (
        <GlassCard className="p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
            <QrCode className="h-3 w-3" /> QR Code
          </div>
          <div className="flex items-start gap-4">
            {qrDataUrl ? (
              <div className="rounded-lg border border-brass/20 bg-white p-2 shrink-0">
                <img src={qrDataUrl} alt="QR" width={120} height={120} />
              </div>
            ) : (
              <div className="w-[136px] h-[136px] rounded-lg border border-brass/20 bg-forest-raised/40 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-cream-dim animate-spin" />
              </div>
            )}
            <div className="space-y-1 text-xs text-cream-muted min-w-0">
              <div className="font-mono break-all text-[10px] text-cream-dim">{delivery.qrToken}</div>
              <a
                href={`https://delivered.lstailors.com/d/${delivery.qrToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brass-light hover:underline block mt-1"
              >
                Open tracking page →
              </a>
            </div>
          </div>
        </GlassCard>
      ) : null}

      <MarkDeliveredDialog
        delivery={markDeliveredOpen ? delivery : null}
        onClose={() => {
          setMarkDeliveredOpen(false);
          qc.invalidateQueries({ queryKey: ["delivery", id] });
          qc.invalidateQueries({ queryKey: ["delivery-proof", id] });
        }}
      />
    </div>
  );
}
