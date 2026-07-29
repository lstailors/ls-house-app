import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Phone, Truck, CheckCircle2, Camera, PenLine, MapPin, Loader2, X, Navigation } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import imageCompression from "browser-image-compression";
import { api } from "@/lib/api";

const LS_PHONE = "(212) 308-4431";
const LS_PHONE_RAW = "+12123084431";

// Design tokens — match the app exactly
const C = {
  bg:      "#163524",
  bgRaise: "#121F15",
  glass:   "rgba(255,255,255,0.04)",
  border:  "rgba(176,141,87,0.18)",
  brass:   "#B08D57",
  brassLt: "rgba(176,141,87,0.55)",
  cream:   "#F1E9D6",
  creamDm: "rgba(241,233,214,0.5)",
  creamXm: "rgba(241,233,214,0.25)",
  green:   "#1F3A2E",
  emerald: "#34D399",
} as const;

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Montserrat:wght@400;500;600;700&display=swap');`;

interface TrackingData {
  id: string;
  delivery_no: string | null;
  status: string;
  method: string | null;
  garment_summary: string | null;
  garment_count: number | null;
  scheduled_at: string | null;
  delivered_at: string | null;
  received_by: string | null;
  pod_method: string | null;
  driver_first_name: string | null;
  address: string | null;
  customer_name: string | null;
  proof_urls: { photo1: string | null; photo2: string | null; photo3: string | null; signature: string | null };
}

function fmt(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", opts);
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function DeliveryTracking() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["scan", token],
    queryFn: () => api.get<TrackingData>(`/api/scan/${token}`),
    enabled: !!token,
    retry: 1,
    staleTime: 30_000,
  });

  return (
    <>
      <style>{`${FONTS} *{box-sizing:border-box;margin:0;padding:0} body{margin:0;background:${C.bg};font-family:'Montserrat',sans-serif;color:${C.cream};-webkit-font-smoothing:antialiased} @keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
      <div style={{ minHeight: "100dvh", background: `linear-gradient(160deg, #163524 0%, ${C.bg} 60%)` }}>
        <Header />
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "28px 20px 80px" }}>
          {isLoading ? <LoadingState /> :
           isError || !data ? <NotFound /> :
           data.status === "Delivered" || data.status === "Picked Up" ? <ProofPage delivery={data} /> :
           <CapturePage delivery={data} token={token!} onSuccess={() => refetch()} />}
        </div>
      </div>
    </>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 20px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 600, fontStyle: "italic", color: C.brass, lineHeight: 1 }}>L&amp;S</div>
          <div style={{ fontSize: 9, color: C.brassLt, letterSpacing: "0.2em", marginTop: 2 }}>CUSTOM TAILORS</div>
        </div>
        <a href={`tel:${LS_PHONE_RAW}`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 99, border: `1px solid ${C.border}`, color: C.brassLt, fontSize: 11, fontWeight: 600, textDecoration: "none", letterSpacing: "0.05em" }}>
          <Phone size={12} /> {LS_PHONE}
        </a>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <Loader2 size={28} color={C.brassLt} className="spin" />
    </div>
  );
}

function NotFound() {
  return (
    <div style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontStyle: "italic", color: C.cream, marginBottom: 10 }}>Delivery not found</div>
      <div style={{ fontSize: 12, color: C.creamDm, lineHeight: 1.7, marginBottom: 28 }}>This link may have expired or is incorrect.<br />Contact us and we'll sort it out.</div>
      <a href={`tel:${LS_PHONE_RAW}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 8, background: `rgba(176,141,87,0.12)`, border: `1px solid ${C.border}`, color: C.brass, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
        <Phone size={14} /> {LS_PHONE}
      </a>
    </div>
  );
}

// ─── Delivery info card (shared) ──────────────────────────────────────────────

function DeliveryCard({ delivery }: { delivery: TrackingData }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <Label>Deliver to</Label>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 600, color: C.cream, lineHeight: 1.1, marginBottom: 6 }}>{delivery.customer_name ?? "—"}</div>
          {delivery.address ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: C.creamDm }}>
              <MapPin size={13} style={{ flexShrink: 0, marginTop: 1, color: C.brassLt }} />
              {delivery.address}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <StatusBadge status={delivery.status} />
          {delivery.delivery_no ? (
            <div style={{ fontSize: 9, fontFamily: "monospace", color: C.creamXm, marginTop: 6, letterSpacing: "0.05em" }}>{delivery.delivery_no}</div>
          ) : null}
        </div>
      </div>
      {delivery.garment_summary ? (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.creamDm }}>{delivery.garment_summary}</div>
      ) : null}
    </Card>
  );
}

// ─── Driver capture page ──────────────────────────────────────────────────────

function CapturePage({ delivery, token, onSuccess }: { delivery: TrackingData; token: string; onSuccess: () => void }) {
  const sigPadRef = useRef<SignatureCanvas>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [receivedBy, setReceivedBy] = useState("");
  const [driverName, setDriverName] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "fetching" | "ok" | "denied">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setGpsStatus("fetching");
    navigator.geolocation.getCurrentPosition(
      (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setGpsStatus("ok"); },
      () => setGpsStatus("denied"),
      { timeout: 10000, enableHighAccuracy: true },
    );
  }, []);

  const addPhotos = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 3 - photos.length);
    const out: File[] = [];
    for (const f of files) {
      try {
        const c = await imageCompression(f, { maxWidthOrHeight: 1600, useWebWorker: true });
        out.push(new File([c], f.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      } catch { out.push(f); }
    }
    setPhotos((p) => [...p, ...out].slice(0, 3));
    setPreviews((p) => [...p, ...out.map((f) => URL.createObjectURL(f))].slice(0, 3));
    e.target.value = "";
  }, [photos.length]);

  const submit = async () => {
    setSubmitting(true); setErr(null);
    try {
      const fd = new FormData();
      photos.forEach((f, i) => fd.append(`photo_${i + 1}`, f));
      if (sigPadRef.current && !sigPadRef.current.isEmpty()) {
        const blob = await (await fetch(sigPadRef.current.getCanvas().toDataURL("image/png"))).blob();
        fd.append("signature", new File([blob], "sig.png", { type: "image/png" }));
      }
      if (receivedBy) fd.append("received_by", receivedBy);
      if (driverName) fd.append("driver_name", driverName);
      if (gps) { fd.append("lat", String(gps.lat)); fd.append("lng", String(gps.lng)); fd.append("accuracy", String(gps.acc)); }
      const res = await fetch(`/api/scan/${token}/pod`, { method: "POST", body: fd });
      const json = await res.json() as any;
      if (!res.ok) throw new Error(json?.error?.message ?? "Submission failed");
      setDone(true); onSuccess();
    } catch (e) { setErr((e as Error).message); }
    finally { setSubmitting(false); }
  };

  if (done) {
    return (
      <div style={{ textAlign: "center", paddingTop: 60 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(52,211,153,0.12)", border: `1px solid ${C.emerald}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <CheckCircle2 size={26} color={C.emerald} />
        </div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, fontStyle: "italic", color: C.cream, marginBottom: 6 }}>Delivered</div>
        <div style={{ fontSize: 12, color: C.creamDm }}>{delivery.customer_name} · {delivery.delivery_no}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontStyle: "italic", color: C.cream, marginBottom: 4 }}>Mark Delivered</div>
        <div style={{ fontSize: 12, color: C.creamDm }}>Capture proof and confirm the drop.</div>
      </div>

      <DeliveryCard delivery={delivery} />

      {/* GPS */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 11, color: gpsStatus === "ok" ? C.emerald : C.creamXm }}>
        <Navigation size={13} />
        {gpsStatus === "ok" ? `Location locked · ±${Math.round(gps!.acc)}m` :
         gpsStatus === "fetching" ? "Acquiring location…" :
         "Location unavailable — delivery will still be recorded"}
      </div>

      {/* Photos */}
      <Section label="Photos" icon={<Camera size={12} />} note="Up to 3">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {previews.map((url, i) => (
            <div key={i} style={{ position: "relative", width: 86, height: 86, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
              <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button type="button" onClick={() => { setPhotos((p) => p.filter((_, j) => j !== i)); setPreviews((p) => p.filter((_, j) => j !== i)); }} style={{ position: "absolute", top: 4, right: 4, background: "rgba(13,26,16,0.75)", border: "none", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <X size={11} color={C.cream} />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <label style={{ width: 86, height: 86, borderRadius: 8, border: `1.5px dashed ${C.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer" }}>
              <Camera size={20} color={C.brassLt} />
              <span style={{ fontSize: 9, color: C.brassLt, letterSpacing: "0.12em" }}>ADD</span>
              <input type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} style={{ display: "none" }} />
            </label>
          )}
        </div>
      </Section>

      {/* Signature */}
      <Section label="Signature" icon={<PenLine size={12} />} note="Optional">
        <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, background: "#fff" }}>
          <SignatureCanvas ref={sigPadRef} penColor="#0D1A10" canvasProps={{ height: 140, style: { width: "100%", height: 140, display: "block" } }} />
        </div>
        <button type="button" onClick={() => sigPadRef.current?.clear()} style={{ marginTop: 6, fontSize: 10, color: C.creamXm, background: "none", border: "none", cursor: "pointer", letterSpacing: "0.1em" }}>CLEAR</button>
      </Section>

      {/* Received by */}
      <Section label="Received by" note="Optional">
        <Field value={receivedBy} onChange={setReceivedBy} placeholder="Name of person who received" />
      </Section>

      {/* Driver */}
      <Section label="Your name" note="Optional">
        <Field value={driverName} onChange={setDriverName} placeholder="Driver name" />
      </Section>

      {err ? (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "12px 14px", fontSize: 12, color: "#FCA5A5", marginBottom: 16 }}>{err}</div>
      ) : null}

      <button type="button" onClick={submit} disabled={submitting} style={{ width: "100%", padding: "16px", borderRadius: 10, background: submitting ? `rgba(176,141,87,0.35)` : C.brass, border: "none", color: "#0D1A10", fontFamily: "Montserrat, sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", cursor: submitting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 4px 20px rgba(176,141,87,0.2)" }}>
        {submitting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
        {submitting ? "SUBMITTING…" : "CONFIRM DELIVERED"}
      </button>
    </div>
  );
}

// ─── Customer proof page ──────────────────────────────────────────────────────

function ProofPage({ delivery }: { delivery: TrackingData }) {
  const proof = delivery.proof_urls;
  const photos = [proof.photo1, proof.photo2, proof.photo3].filter(Boolean) as string[];

  const stages = [
    { label: "Order received" },
    { label: "Prepared at the atelier" },
    { label: "Out for delivery" },
    { label: "Delivered" },
  ];

  const stage = delivery.status === "Delivered" || delivery.status === "Picked Up" ? 3
    : delivery.status === "Out for Delivery" || delivery.status === "In Flight" ? 2
    : delivery.status === "Scheduled" || delivery.status === "Queued" ? 1 : 0;

  return (
    <div>
      {/* Hero status */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(52,211,153,0.12)", border: `1px solid ${C.emerald}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <CheckCircle2 size={22} color={C.emerald} />
        </div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontStyle: "italic", color: C.cream, marginBottom: 6 }}>Delivered</div>
        <div style={{ fontSize: 12, color: C.creamDm }}>
          {fmt(delivery.delivered_at, { weekday: "long", month: "long", day: "numeric" })}
          {delivery.delivered_at ? ` · ${new Date(delivery.delivered_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
        </div>
      </div>

      {/* Delivery card */}
      <DeliveryCard delivery={delivery} />

      {/* Timeline */}
      <Card style={{ marginBottom: 16 }}>
        <Label style={{ marginBottom: 14 }}>Journey</Label>
        {stages.map((s, i) => {
          const done = i < stage;
          const active = i === stage;
          return (
            <div key={i} style={{ display: "flex", gap: 14, paddingBottom: i < stages.length - 1 ? 18 : 0, position: "relative" }}>
              {i < stages.length - 1 && (
                <div style={{ position: "absolute", left: 10, top: 20, bottom: 0, width: 1, background: done ? `rgba(176,141,87,0.5)` : C.border }} />
              )}
              <div style={{ flexShrink: 0, zIndex: 1, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done || active ? "rgba(176,141,87,0.15)" : "transparent", border: `1px solid ${done || active ? C.brass : C.border}` }}>
                {done ? <Check size={11} color={C.brass} strokeWidth={2.5} /> : null}
                {active ? <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.brass }} /> : null}
              </div>
              <div style={{ paddingTop: 2 }}>
                <div style={{ fontSize: 13, fontWeight: done || active ? 600 : 400, color: done || active ? C.cream : C.creamXm }}>{s.label}</div>
                {i === 3 && delivery.received_by ? (
                  <div style={{ fontSize: 11, color: C.creamDm, marginTop: 2 }}>Received by {delivery.received_by}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Proof photos */}
      {photos.length > 0 ? (
        <Card style={{ marginBottom: 16 }}>
          <Label style={{ marginBottom: 12 }}>Proof of delivery</Label>
          {delivery.pod_method ? (
            <div style={{ fontSize: 11, color: C.creamDm, marginBottom: 12 }}>{delivery.pod_method}</div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: photos.length === 1 ? "1fr" : "1fr 1fr", gap: 10 }}>
            {photos.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: "block", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                <img src={url} alt="" style={{ width: "100%", display: "block", objectFit: "cover", maxHeight: photos.length === 1 ? 320 : 200 }} />
              </a>
            ))}
          </div>
          {proof.signature ? (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.brassLt, letterSpacing: "0.15em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <PenLine size={11} /> SIGNATURE
              </div>
              <img src={proof.signature} alt="Signature" style={{ maxWidth: 200, width: "100%", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", padding: 6 }} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Contact */}
      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <div style={{ fontSize: 11, color: C.creamXm, marginBottom: 12 }}>Questions about your delivery?</div>
        <a href={`tel:${LS_PHONE_RAW}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 8, background: "rgba(176,141,87,0.1)", border: `1px solid ${C.border}`, color: C.brass, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
          <Phone size={14} /> {LS_PHONE}
        </a>
      </div>
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", backdropFilter: "blur(8px)", ...style }}>
      {children}
    </div>
  );
}

function Label({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.22em", color: C.brassLt, textTransform: "uppercase", marginBottom: 4, ...style }}>{children}</div>
  );
}

function Section({ label, icon, note, children }: { label: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
        {icon ? <span style={{ color: C.brassLt }}>{icon}</span> : null}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: C.brassLt, textTransform: "uppercase" }}>{label}</span>
        {note ? <span style={{ fontSize: 10, color: C.creamXm, marginLeft: 4 }}>· {note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Field({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: "100%", background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.cream, fontSize: 13, fontFamily: "Montserrat, sans-serif", outline: "none", caretColor: C.brass }}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOut = status === "Out for Delivery" || status === "In Flight";
  const isDone = status === "Delivered" || status === "Picked Up";
  const color = isDone ? C.emerald : isOut ? "#FBBF24" : C.brassLt;
  const bg = isDone ? "rgba(52,211,153,0.1)" : isOut ? "rgba(251,191,36,0.1)" : "rgba(176,141,87,0.1)";
  const border = isDone ? "rgba(52,211,153,0.35)" : isOut ? "rgba(251,191,36,0.35)" : C.border;
  return (
    <span style={{ display: "inline-block", background: bg, border: `1px solid ${border}`, borderRadius: 99, padding: "3px 10px", fontSize: 10, fontWeight: 700, color, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}
