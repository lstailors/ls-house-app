/**
 * SPEC 081 — Alts Messages Desk helpers (people inbox + noise filter + needs-you).
 */
import { phoneKey } from "./ops-mode";

const OWNER_KEYS = new Set(
  [process.env.OWNER_MOBILE || "+16319260917", "+16319260917"]
    .map((p) => phoneKey(p))
    .filter((k) => k.length >= 10),
);

const PROVE_BODY_RE =
  /e2e\b|bridge prove|automated\b|unifi-sofia-bridge|sofia-bridge-|hermes test|no client action|disregarded|webhook test|unifi→sofia|unifi->sofia/i;

const PROVE_NAME_RE = /\b(e2e|webhook test|bridge prove)\b/i;

export function fmtE164ish(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return String(phone ?? "").trim();
}

export function isOwnerPhone(phone: string | null | undefined): boolean {
  const k = phoneKey(phone);
  return k.length >= 10 && OWNER_KEYS.has(k);
}

export function isFake555(phone: string | null | undefined): boolean {
  const k = phoneKey(phone);
  // US 555 exchange (not all 555 are fake, but prove uses 555-700-xxxx etc.)
  return k.length === 10 && k.slice(3, 6) === "555";
}

export function isNoiseSms(msg: {
  client_phone?: string | null;
  content?: string | null;
  body?: string | null;
  context_tag?: string | null;
  direction?: string | null;
}): boolean {
  if (isOwnerPhone(msg.client_phone) || isFake555(msg.client_phone)) return true;
  const tag = String(msg.context_tag ?? "").toLowerCase();
  if (tag === "owner-inbound" || tag.startsWith("held:")) return true;
  const text = `${msg.content ?? ""} ${msg.body ?? ""}`;
  if (PROVE_BODY_RE.test(text)) return true;
  return false;
}

export function isNoiseCall(call: {
  from?: string | null;
  to?: string | null;
  from_caller_name?: string | null;
  transcript_whisper?: string | null;
  transcript_raw?: string | null;
}): boolean {
  const phone = call.from || call.to;
  if (isOwnerPhone(phone) || isFake555(phone)) return true;
  if (PROVE_NAME_RE.test(String(call.from_caller_name ?? ""))) return true;
  const t = `${call.transcript_whisper ?? ""} ${call.transcript_raw ?? ""}`;
  if (PROVE_BODY_RE.test(t)) return true;
  return false;
}

export function previewClean(text: string | null | undefined, max = 100): string {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function tsMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = String(raw).includes("T") ? String(raw) : String(raw).replace(" ", "T");
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
}

export function summaryBullets(text: string | null | undefined, max = 3): string[] {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  // Prefer sentence splits; fall back to single clip
  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 12);
  if (parts.length >= 2) return parts.slice(0, max).map((p) => (p.length > 120 ? `${p.slice(0, 119)}…` : p));
  return [t.length > 160 ? `${t.slice(0, 159)}…` : t];
}

export type DeskChannel = "sms" | "missed" | "vm" | "call" | "voice";

export type DeskPerson = {
  phone: string;
  phone_key: string;
  customer_id: string | null;
  customer_name: string | null;
  preview: string;
  last_at: string | null;
  needs_you: boolean;
  unread_count: number;
  channels: DeskChannel[];
  via_shop_line: boolean;
  last_direction?: string | null;
};

export function recordingPlayUrl(call: {
  recording?: string | null;
  external_id?: string | null;
  name?: string | null;
}): string | null {
  const r = call.recording;
  if (r && /^https?:\/\//i.test(String(r))) return String(r);
  const base = (process.env.RECORDING_PROXY_URL || "https://maestro.lstailors.com/unifi-audio").replace(/\/$/, "");
  const token = process.env.RECORDING_PROXY_TOKEN || "";
  const id = call.external_id || call.name;
  if (!id || String(r) === "0" || r === 0 || r === false) {
    if (String(r) === "1" || r === true || r === "true") {
      // has flag but need id
    } else if (!r) return null;
  }
  if (!id) return null;
  if (String(r) === "1" || r === true || r === "true" || (r && !/^https?:/i.test(String(r)))) {
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${base}/recording/${encodeURIComponent(String(id))}${q}`;
  }
  return null;
}
