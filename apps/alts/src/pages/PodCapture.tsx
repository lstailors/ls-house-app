/**
 * SPEC 012 — Proof of delivery (phone tier).
 * Lucia mock: ~/ls-design/alts-pos/012-pod
 * Writes via authenticated PATCH /api/deliveries/:id/pod — never charges.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SignatureCanvas from "react-signature-canvas";
import imageCompression from "browser-image-compression";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { StatusPill } from "@ls/design";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type BoardDelivery = {
  id: string;
  deliveryNo?: string | null;
  status: string;
  method?: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  addressLine?: string | null;
  city?: string | null;
  notes?: string | null;
  garmentSummary?: string | null;
  garmentCount?: number | null;
  alterationTicket?: string | null;
  podMethod?: string | null;
  qrToken?: string | null;
};

type TicketGarment = {
  garment_id?: string;
  garment_type?: string;
  color?: string;
  garment_description?: string;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function uploadDeliveryFile(file: File | Blob, filename: string, deliveryId: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, filename);
  formData.append("doctype", "LSH Delivery");
  formData.append("docname", deliveryId);
  const res = await api.raw("/api/files/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message || json?.error || "Upload failed");
  }
  const json = await res.json();
  if (!json.data?.url) throw new Error("Upload failed — no URL returned");
  return json.data.url as string;
}

export default function PodCapture() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const sigRef = useRef<SignatureCanvas>(null);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [signedBy, setSignedBy] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "fetching" | "ok" | "denied">("idle");
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState("");

  const deliveryQ = useQuery({
    queryKey: ["pod-delivery", id],
    enabled: !!id,
    queryFn: () => api.get<BoardDelivery>(`/api/deliveries/${encodeURIComponent(id!)}`),
  });

  const d = deliveryQ.data;

  const ticketQ = useQuery({
    queryKey: ["pod-ticket", d?.alterationTicket],
    enabled: !!d?.alterationTicket,
    queryFn: () =>
      api.get<{
        name: string;
        customer_name?: string;
        ticket_total?: number;
        payment_status?: string;
        sales_invoice?: string;
        garments?: TicketGarment[];
      }>(`/api/intake-alterations/tickets/${encodeURIComponent(d!.alterationTicket!)}`),
  });

  const garments = ticketQ.data?.garments ?? [];
  const garmentKeys =
    garments.length > 0
      ? garments.map((g, i) => g.garment_id || `G${i + 1}`)
      : Array.from({ length: Math.max(d?.garmentCount || 0, 1) }, (_, i) => `G${i + 1}`);

  useEffect(() => {
    // default all checked when list loads
    const next: Record<string, boolean> = {};
    for (const k of garmentKeys) next[k] = true;
    setChecked(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id, garmentKeys.join("|")]);

  useEffect(() => {
    setGpsStatus("fetching");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setGpsStatus("ok");
      },
      () => setGpsStatus("denied"),
      { timeout: 10000, enableHighAccuracy: true },
    );
  }, []);

  const addPhotos = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).slice(0, 3 - photos.length);
      const out: File[] = [];
      for (const f of files) {
        try {
          const c = await imageCompression(f, { maxWidthOrHeight: 1600, useWebWorker: true });
          out.push(new File([c], f.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        } catch {
          out.push(f);
        }
      }
      setPhotos((p) => [...p, ...out].slice(0, 3));
      setPreviews((p) => [...p, ...out.map((f) => URL.createObjectURL(f))].slice(0, 3));
      e.target.value = "";
    },
    [photos.length],
  );

  const allGarmentsOk = garmentKeys.every((k) => checked[k]);
  const hasSig = () => sigRef.current && !sigRef.current.isEmpty();
  const paid = ticketQ.data?.payment_status === "Paid" || ticketQ.data?.payment_status === "N/A";
  const total = Number(ticketQ.data?.ticket_total) || 0;
  const alreadyDone = d?.status === "delivered";

  const submit = useMutation({
    mutationFn: async () => {
      if (!id || !d) throw new Error("No delivery");
      if (alreadyDone) throw new Error("Already delivered");
      if (!allGarmentsOk) throw new Error("Confirm every garment");
      if (!hasSig()) throw new Error("Signature required");
      if (photos.length < 2) throw new Error("Add at least 2 photos");
      if (!signedBy.trim()) throw new Error("Print name required");

      const photoUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const f = photos[i];
        photoUrls.push(await uploadDeliveryFile(f, `${id}-pod-${Date.now()}-${i}.jpg`, id));
      }

      let signatureImageUrl: string | undefined;
      if (sigRef.current && !sigRef.current.isEmpty()) {
        const blob = await (await fetch(sigRef.current.getCanvas().toDataURL("image/png"))).blob();
        signatureImageUrl = await uploadDeliveryFile(blob, `${id}-sig-${Date.now()}.png`, id);
      }

      return api.patch(`/api/deliveries/${encodeURIComponent(id)}/pod`, {
        podMethod: "Signature + Photo",
        receivedBy: signedBy.trim(),
        signatureName: signedBy.trim(),
        signatureImageUrl,
        photoUrls,
        gpsLat: gps?.lat,
        gpsLng: gps?.lng,
        gpsAccuracy: gps?.acc,
      });
    },
    onSuccess: () => {
      toast.success("Delivered — POD on file");
      qc.invalidateQueries({ queryKey: ["pod-delivery", id] });
      qc.invalidateQueries({ queryKey: ["dispatch-board"] });
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
      nav(d?.alterationTicket ? `/orders/alterations/${d.alterationTicket}` : "/deliveries");
    },
    onError: (e: Error) => toast.error(e.message || "POD failed"),
  });

  const fail = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("No delivery");
      const reason = failReason.trim() || "Could not deliver";
      await api.patch(`/api/deliveries/${encodeURIComponent(id)}`, {
        status: "failed",
        notes: reason,
      });
      // notes may not map — also try status endpoint
      try {
        await api.patch(`/api/deliveries/${encodeURIComponent(id)}/status`, {
          status: "failed",
          message: reason,
        });
      } catch {
        /* primary patch may be enough */
      }
    },
    onSuccess: () => {
      toast.message("Marked failed — reschedule from board");
      qc.invalidateQueries({ queryKey: ["pod-delivery", id] });
      nav("/deliveries");
    },
    onError: (e: Error) => toast.error(e.message || "Could not mark failed"),
  });

  if (deliveryQ.isLoading) {
    return (
      <div className="alts-root min-h-dvh grid place-items-center">
        <div className="h-6 w-6 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
      </div>
    );
  }

  if (deliveryQ.isError || !d) {
    return (
      <div className="alts-root min-h-dvh p-5 max-w-[414px] mx-auto">
        <Link to="/" className="text-brass-light text-[12px] font-bold tracking-widest uppercase">
          ← Home
        </Link>
        <p className="mt-8 text-cream-dim">Delivery not found.</p>
      </div>
    );
  }

  const phone = d.customer?.phone;
  const clientName = ticketQ.data?.customer_name || d.customer?.name || "Client";

  return (
    <div className="alts-root min-h-dvh">
      <div className="max-w-[414px] mx-auto px-4 pt-4 pb-8">
        <header className="flex items-center gap-3 pb-4">
          <button
            type="button"
            onClick={() => nav(-1)}
            className="w-[42px] h-[42px] rounded-xl border border-brass/25 grid place-items-center text-cream-dim shrink-0"
            style={{ background: "var(--glass, rgba(255,255,255,.05))" }}
            aria-label="Back"
          >
            ←
          </button>
          <div className="min-w-0">
            <div className="display text-[19px] leading-tight">Proof of delivery</div>
            <div className="font-mono text-[12px] text-brass-light truncate">{d.deliveryNo || d.id}</div>
          </div>
          <div className="flex-1" />
          <StatusPill status={d.status} />
        </header>

        {/* Paid banner — collect nothing */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 rounded-[15px] mb-3"
          style={{
            background: paid
              ? "linear-gradient(135deg,rgba(79,191,142,.15),rgba(79,191,142,.03))"
              : "linear-gradient(135deg,rgba(232,168,92,.14),rgba(232,168,92,.03))",
            border: paid ? "1px solid rgba(79,191,142,.44)" : "1px solid rgba(232,168,92,.4)",
          }}
        >
          <div className={cn("shrink-0 text-2xl", paid ? "text-[var(--em)]" : "text-[var(--am)]")}>
            {paid ? "✓" : "$"}
          </div>
          <div className="flex-1 min-w-0">
            <b className="block text-[13px] font-semibold">
              {paid ? "Already paid — collect nothing" : "Balance may be open — still no charge on POD"}
            </b>
            <i className="not-italic block text-[12px] text-[var(--cd)] mt-0.5">
              {paid ? "Charged at Ready · POD is proof only" : "Money stays on Terminal / pay link / card on file"}
            </i>
          </div>
          {total > 0 && (
            <div className={cn("display text-2xl shrink-0", paid ? "text-[var(--em)]" : "text-[var(--am)]")}>
              {money(total)}
            </div>
          )}
        </div>

        {alreadyDone && (
          <div className="card-glass p-4 mb-3 text-center">
            <div className="display text-xl text-[var(--em)]">Already delivered</div>
            <p className="text-[12px] text-[var(--cd)] mt-2">POD is on file. Open the board for proof.</p>
            <a
              href={`https://app.lstailors.com/deliveries/${encodeURIComponent(d.id)}`}
              className="btn-ghost inline-flex mt-3 min-h-11 px-4 items-center text-[12px]"
            >
              View on board →
            </a>
          </div>
        )}

        {/* Deliver to */}
        <div className="card-glass overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-brass/15 bg-black/20">
            <h2 className="display text-[17px] m-0">Deliver to</h2>
          </div>
          <div className="p-4">
            <div className="display text-[21px] mb-1">{clientName}</div>
            <div className="text-[13.5px] leading-relaxed">
              <b className="font-semibold">{d.addressLine || "Address not set"}</b>
              {d.city ? (
                <>
                  <br />
                  {d.city}
                </>
              ) : null}
            </div>
            {phone && (
              <a href={`tel:${phone.replace(/\D/g, "")}`} className="block mt-2 text-[12.5px] text-brass-light">
                {phone} ↗ tap to call
              </a>
            )}
            {d.notes && (
              <div
                className="mt-3 px-3.5 py-3 rounded-xl text-[12px] leading-relaxed text-[var(--cm)]"
                style={{ background: "rgba(232,168,92,.1)", border: "1px solid rgba(232,168,92,.34)" }}
              >
                <b className="block text-[12px] font-bold tracking-[0.14em] uppercase text-[var(--am)] mb-1">
                  Delivery notes
                </b>
                {d.notes}
              </div>
            )}
          </div>
        </div>

        {/* Garments */}
        <div className="card-glass overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center gap-2">
            <h2 className="display text-[17px] m-0 flex-1">
              Confirm {garmentKeys.length} garment{garmentKeys.length === 1 ? "" : "s"}
            </h2>
            {allGarmentsOk && (
              <span className="w-[22px] h-[22px] rounded-full bg-[var(--em)] text-forest-deep grid place-items-center text-[12px] font-bold">
                ✓
              </span>
            )}
          </div>
          <div>
            {garmentKeys.map((key, i) => {
              const g = garments[i];
              const on = !!checked[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChecked((c) => ({ ...c, [key]: !c[key] }))}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-brass/10 last:border-0 text-left"
                >
                  <span
                    className={cn(
                      "w-8 h-8 rounded-[9px] grid place-items-center shrink-0 border-[1.5px]",
                      on ? "bg-[var(--em)] border-[var(--em)] text-forest-deep" : "border-brass/45 text-transparent",
                    )}
                  >
                    ✓
                  </span>
                  <span className="flex-1 min-w-0">
                    <b className="block text-[13.5px] font-semibold">
                      {g?.garment_type || d.garmentSummary?.split(",")[i]?.trim() || `Garment ${i + 1}`}
                    </b>
                    <i className="not-italic text-[12px] text-[var(--cd)]">
                      {[g?.color, g?.garment_description].filter(Boolean).join(" · ") || "Tap to confirm handoff"}
                    </i>
                  </span>
                  <span className="font-mono text-[12px] text-brass/80 px-2 py-1 rounded border border-brass/25">
                    {key}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Signature */}
        <div className="card-glass overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center">
            <h2 className="display text-[17px] m-0 flex-1">Signature</h2>
            <span className="text-[12px] font-bold tracking-widest uppercase text-[var(--ro)]">Required</span>
          </div>
          <div className="p-4">
            <div
              className="h-[168px] rounded-[14px] relative overflow-hidden border border-brass/30"
              style={{ background: "#F6F1E4" }}
            >
              <SignatureCanvas
                ref={sigRef}
                penColor="#1F3A2E"
                canvasProps={{
                  className: "absolute inset-0 w-full h-full",
                  style: { width: "100%", height: "100%" },
                }}
              />
              <div className="absolute left-[18px] right-[18px] bottom-11 h-px bg-forest/20 pointer-events-none" />
              <div className="absolute left-0 right-0 bottom-4 text-center text-[12px] font-bold tracking-[0.14em] uppercase text-forest/40 pointer-events-none">
                Signed on glass
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => sigRef.current?.clear()}
                className="flex-1 h-[46px] rounded-[11px] border border-brass/25 text-[12px] font-bold tracking-widest uppercase text-cream-dim bg-black/25"
              >
                Clear
              </button>
            </div>
            <label className="block mt-3">
              <span className="caps mb-1.5 block">Signed by — print name</span>
              <input
                value={signedBy}
                onChange={(e) => setSignedBy(e.target.value)}
                placeholder="Name / doorman / EA"
                className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-3.5 text-[14.5px] text-cream outline-none focus:border-brass"
              />
            </label>
          </div>
        </div>

        {/* Photos */}
        <div className="card-glass overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-brass/15 bg-black/20 flex items-center">
            <h2 className="display text-[17px] m-0 flex-1">Photos</h2>
            <span className="text-[12px] font-bold tracking-widest uppercase text-[var(--ro)]">2 min</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 p-4">
            {previews.map((url, i) => (
              <div
                key={url}
                className="aspect-[4/3] rounded-[13px] overflow-hidden relative border border-brass/25"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setPhotos((p) => p.filter((_, j) => j !== i));
                    setPreviews((p) => p.filter((_, j) => j !== i));
                  }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-cream grid place-items-center"
                >
                  ×
                </button>
                <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 text-[12px] font-semibold bg-gradient-to-t from-black/80 to-transparent">
                  Photo {i + 1}
                </div>
              </div>
            ))}
            {photos.length < 3 && (
              <label className="aspect-[4/3] rounded-[13px] border border-dashed border-brass/40 grid place-items-center cursor-pointer text-brass-light">
                <span className="text-center">
                  <span className="block text-2xl mb-1">+</span>
                  <span className="text-[12px] font-bold tracking-widest uppercase text-[var(--cd)]">Add photo</span>
                </span>
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addPhotos} />
              </label>
            )}
          </div>
          <div className="flex items-center gap-3 px-4 pb-4 text-[12px] text-[var(--cm)]">
            <span className={cn("text-lg", gpsStatus === "ok" ? "text-[var(--em)]" : "text-[var(--cd)]")}>⌖</span>
            <div className="flex-1 leading-snug">
              <b className="block text-[12px] font-semibold text-cream">
                {gpsStatus === "ok"
                  ? "Location stamped"
                  : gpsStatus === "fetching"
                    ? "Acquiring GPS…"
                    : "GPS unavailable — still ok"}
              </b>
              {gps && (
                <code className="font-mono text-[12px] text-brass-light">
                  {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · ±{Math.round(gps.acc)} m
                </code>
              )}
            </div>
          </div>
        </div>

        {!alreadyDone && (
          <>
            <button
              type="button"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
              className="w-full h-[92px] rounded-[18px] border-0 cursor-pointer flex flex-col items-center justify-center gap-1.5 font-bold tracking-[0.13em] uppercase text-[15px] text-[#04180E] disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg,#5FCB9C,#3C9E76)",
                boxShadow: "0 14px 32px rgba(79,191,142,.3), inset 0 1px 0 rgba(255,255,255,.3)",
              }}
            >
              {submit.isPending ? "Saving…" : "Mark delivered"}
              <i className="not-italic text-[12px] tracking-[0.15em] opacity-70">
                SIGNATURE + {Math.max(photos.length, 2)} PHOTOS + GPS
              </i>
            </button>

            {!failOpen ? (
              <button
                type="button"
                onClick={() => setFailOpen(true)}
                className="w-full h-16 mt-2.5 rounded-[15px] border border-dashed border-signal-rose/50 text-[var(--ro)] text-[12px] font-bold tracking-widest uppercase bg-transparent"
              >
                Couldn’t deliver
              </button>
            ) : (
              <div className="mt-3 card-glass p-4 space-y-3">
                <label className="block">
                  <span className="caps mb-1.5 block">Why</span>
                  <input
                    value={failReason}
                    onChange={(e) => setFailReason(e.target.value)}
                    placeholder="No answer · wrong address · refused…"
                    className="w-full h-12 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream"
                  />
                </label>
                <button
                  type="button"
                  disabled={fail.isPending}
                  onClick={() => fail.mutate()}
                  className="w-full min-h-11 h-12 rounded-xl bg-signal-rose/90 text-forest-deep font-bold tracking-widest uppercase text-[12px]"
                >
                  {fail.isPending ? "…" : "Confirm failed"}
                </button>
                <button type="button" onClick={() => setFailOpen(false)} className="w-full text-[12px] text-cream-dim">
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        <div
          className="mt-3 px-3.5 py-3 rounded-xl text-[12px] leading-relaxed text-[var(--cm)]"
          style={{ background: "rgba(176,141,87,.07)", border: "1px solid rgba(176,141,87,.18)" }}
        >
          <b className="block text-[12px] font-bold tracking-[0.15em] uppercase text-brass-light mb-1">
            What this writes
          </b>
          Sets <code className="font-mono text-brass-light">LSH Delivery</code> to <b className="text-cream">Delivered</b>{" "}
          with signature + photos + GPS. <b className="text-cream">No payment step</b> — charge was at Ready.
        </div>
      </div>
    </div>
  );
}
