/**
 * LSH Delivery helpers — site time (America/New_York), GPS hygiene, POD gates.
 * SPEC delivery-scheduling-zones Part 1.
 */

export const SHOP_ORIGIN = {
  NYC: { lat: 40.76289, lng: -73.9665 },
  HOU: { lat: 29.7604, lng: -95.3698 },
} as const;

const MAX_GPS_ACCURACY_M = 100;
const MAX_GPS_DISTANCE_MI = 60;

/** ERPNext Datetime as America/New_York wall clock (no Z, no ms). */
export function erpDatetime(d?: Date | string | null): string {
  const dt = d == null || d === "" ? new Date() : new Date(d);
  if (Number.isNaN(dt.getTime())) {
    return erpDatetime(new Date());
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  let hour = g("hour");
  if (hour === "24") hour = "00";
  return `${g("year")}-${g("month")}-${g("day")} ${hour}:${g("minute")}:${g("second")}`;
}

/**
 * ERP stores site-local wall time. Do NOT force Z (that was the 4h skew bug).
 * Date-only values stay YYYY-MM-DD so the UI never invents midnight.
 */
export function erpToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
  return trimmed.replace(" ", "T");
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type GpsSanitizeResult =
  | { ok: true; lat: number; lng: number; accuracy: number | null }
  | { ok: false; reason: string };

/** Reject 0/0, bad accuracy, and fixes >60mi from shop. Never write 0.0. */
export function sanitizeGps(opts: {
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  origin?: "NYC" | "HOU";
}): GpsSanitizeResult {
  const lat = opts.lat == null ? null : Number(opts.lat);
  const lng = opts.lng == null ? null : Number(opts.lng);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { ok: false, reason: "missing" };
  }
  if (lat === 0 && lng === 0) {
    return { ok: false, reason: "zero_null_island" };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, reason: "out_of_range" };
  }
  const accuracy =
    opts.accuracy == null || Number.isNaN(Number(opts.accuracy)) ? null : Number(opts.accuracy);
  if (accuracy != null && accuracy > MAX_GPS_ACCURACY_M) {
    return { ok: false, reason: `accuracy_${accuracy}` };
  }
  const origin = SHOP_ORIGIN[opts.origin === "HOU" ? "HOU" : "NYC"];
  const miles = haversineMiles(origin.lat, origin.lng, lat, lng);
  if (miles > MAX_GPS_DISTANCE_MI) {
    return { ok: false, reason: `distance_${miles.toFixed(1)}mi` };
  }
  return {
    ok: true,
    lat,
    lng,
    accuracy: accuracy != null && !Number.isNaN(accuracy) ? accuracy : null,
  };
}

export function hasPod(doc: {
  lsh_pod_method?: string | null;
  lsh_signature_image_url?: string | null;
  lsh_signature_name?: string | null;
  lsh_photos?: Array<{ photo_url?: string | null }> | null;
}): boolean {
  const method = String(doc.lsh_pod_method || "").trim();
  if (!method) return false;
  const photos = (doc.lsh_photos || []).filter((p) => String(p.photo_url || "").trim());
  const hasSig =
    Boolean(String(doc.lsh_signature_image_url || "").trim()) ||
    Boolean(String(doc.lsh_signature_name || "").trim());
  if (method === "Photo Only") return photos.length > 0;
  if (method === "Signature") return hasSig;
  if (method === "Signature + Photo") return hasSig && photos.length > 0;
  return photos.length > 0 || hasSig;
}

/** If delivered_at is >6h before now (site), require attempt notes. */
export function needsBackdateNote(deliveredAt: string | Date | null | undefined, notes?: string | null): boolean {
  if (!deliveredAt) return false;
  const d = typeof deliveredAt === "string" ? new Date(deliveredAt.replace(" ", "T")) : deliveredAt;
  if (Number.isNaN(d.getTime())) return false;
  const ageMs = Date.now() - d.getTime();
  if (ageMs <= 6 * 60 * 60 * 1000) return false;
  return !String(notes || "").trim();
}

export function normalizeZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

/**
 * LSH Delivery Timeline.event_type Select options in ERP.
 * Status "Queued" is valid on the parent doc; the child row must be "queued".
 */
export const LSH_TIMELINE_EVENTS = [
  "created",
  "queued",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Failed",
  "proof_viewed",
  "note_added",
] as const;

export type LshTimelineEvent = (typeof LSH_TIMELINE_EVENTS)[number];

const STATUS_TO_TIMELINE_EVENT: Record<string, LshTimelineEvent> = {
  created: "created",
  queued: "queued",
  Queued: "queued",
  "Out for Delivery": "Out for Delivery",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
  Failed: "Failed",
  proof_viewed: "proof_viewed",
  note_added: "note_added",
};

export function timelineEventType(status: string): LshTimelineEvent {
  return STATUS_TO_TIMELINE_EVENT[status] ?? "queued";
}

