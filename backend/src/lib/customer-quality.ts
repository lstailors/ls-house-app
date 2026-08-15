import { containsPan, findPanHits, type PanHitKind } from "./pci-guard";

export type QualityFlag =
  | "track_or_pan"
  | "weird_name"
  | "marketing_email"
  | "missing_contact"
  | "duplicate_phone";

export type QualityRow = {
  id: string;
  name: string;
  /** Safe display — never a PAN. */
  displayName: string;
  email: string | null;
  phone: string | null;
  flags: QualityFlag[];
  panKind?: PanHitKind;
};

const MARKETING_EMAIL_RE =
  /(southwest\.com|noreply@|no-reply@|donotreply@|mailchimp|sendgrid\.net|notifications@|newsletter@|promo@|marketing@)/i;

export function isWeirdName(name: string | null | undefined): boolean {
  const s = String(name ?? "").trim();
  if (!s) return true;
  if (containsPan(s)) return false; // classified separately
  if (/^[\d\s.:;,\-_/\\#*]+$/.test(s)) return true;
  if (/^\./.test(s) && s.length < 24) return true;
  if (/^\d{1,4}$/.test(s)) return true;
  if (s.length <= 1) return true;
  return false;
}

export function isMarketingEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim();
  if (!e) return false;
  return MARKETING_EMAIL_RE.test(e);
}

export function safeDisplayName(name: string | null | undefined): string {
  const s = String(name ?? "").trim() || "Unknown";
  if (containsPan(s)) return "Needs review · card data removed from display";
  return s;
}

export function flagsForCustomer(row: {
  id?: string;
  name?: string | null;
  customer_name?: string | null;
  email?: string | null;
  email_id?: string | null;
  phone?: string | null;
  mobile_no?: string | null;
  notes?: string | null;
  customer_details?: string | null;
}): QualityFlag[] {
  const name = row.customer_name ?? row.name ?? "";
  const email = row.email_id ?? row.email ?? null;
  const phone = row.mobile_no ?? row.phone ?? null;
  const notes = row.customer_details ?? row.notes ?? null;
  const flags: QualityFlag[] = [];
  const pan = findPanHits(name).length || findPanHits(email).length || findPanHits(phone).length || findPanHits(notes).length;
  if (pan) flags.push("track_or_pan");
  if (isWeirdName(name)) flags.push("weird_name");
  if (isMarketingEmail(email)) flags.push("marketing_email");
  const hasPhone = String(phone ?? "").replace(/\D/g, "").length >= 7;
  const hasEmail = Boolean(String(email ?? "").includes("@"));
  if (!hasPhone && !hasEmail) flags.push("missing_contact");
  return flags;
}

export function phoneKey(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 7) return null;
  return d.slice(-10);
}
