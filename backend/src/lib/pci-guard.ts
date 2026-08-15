/**
 * PCI guard — never store magstripe / PAN in CRM fields.
 * Never log a full PAN. Reports use last-4 only.
 */

export class PciFieldRejected extends Error {
  status = 422 as const;
  field: string;
  constructor(field = "name") {
    super(
      `Card numbers cannot be stored in customer ${field}. Enter the person's name only.`,
    );
    this.name = "PciFieldRejected";
    this.field = field;
  }
}

/** ISO/IEC 7813 Track 1: %B{PAN}^{NAME}^{YYMM…} */
export const TRACK1_RE = /%B(\d{13,19})\^([^^]{0,80})\^/i;
/** Track 2: ;{PAN}={YYMM…} */
export const TRACK2_RE = /;(\d{13,19})=(\d{4,})/i;
/** Bare 13–19 digit runs (spaces/dashes allowed). */
export const BARE_PAN_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

const PCI_TEXT_KEYS = [
  "name",
  "full_name",
  "fullName",
  "customer_name",
  "first_name",
  "last_name",
  "preferred_name",
  "notes",
  "custom_client_notes",
  "customer_details",
  "style_preferences",
  "style_notes",
  "fit_notes",
  "lifestyle_notes",
  "company",
  "profession",
  "title_role",
];

export function luhnOk(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function last4(digits: string): string {
  const d = digits.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "????";
}

export function maskPan(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length < 13) return "[redacted]";
  return `••••${last4(d)}`;
}

export function maskTrack(raw: string): string {
  return String(raw).replace(TRACK1_RE, (_m, pan: string, name: string) => `%B${maskPan(pan)}^${name}^`).replace(
    TRACK2_RE,
    (_m, pan: string) => `;${maskPan(pan)}=`,
  );
}

export function digitsOnly(raw: string): string {
  return String(raw).replace(/\D/g, "");
}

export type PanHitKind = "track1" | "track2" | "pan";

export type PanHit = {
  kind: PanHitKind;
  last4: string;
  /** Start index in the original string. */
  index: number;
};

export function findPanHits(raw: string | null | undefined): PanHit[] {
  const text = String(raw ?? "");
  if (!text) return [];
  const hits: PanHit[] = [];

  const t1 = TRACK1_RE.exec(text);
  if (t1 && luhnOk(t1[1])) {
    hits.push({ kind: "track1", last4: last4(t1[1]), index: t1.index });
  }
  const t2 = TRACK2_RE.exec(text);
  if (t2 && luhnOk(t2[1])) {
    hits.push({ kind: "track2", last4: last4(t2[1]), index: t2.index });
  }

  const covered = new Set(hits.map((h) => h.last4));
  for (const m of text.matchAll(BARE_PAN_RE)) {
    const d = digitsOnly(m[0]);
    if (!luhnOk(d)) continue;
    const l4 = last4(d);
    if (covered.has(l4) && (hits.some((h) => h.kind !== "pan"))) continue;
    if (hits.some((h) => h.last4 === l4)) continue;
    hits.push({ kind: "pan", last4: l4, index: m.index ?? 0 });
  }
  return hits;
}

export function containsPan(raw: string | null | undefined): boolean {
  return findPanHits(raw).length > 0;
}

/**
 * Track 1 name is LAST/FIRST. "PASSARO III/MICHAEL F" → "Michael F Passaro III".
 */
export function nameFromTrack1(raw: string): string | null {
  const m = TRACK1_RE.exec(String(raw));
  if (!m?.[2]) return null;
  const [lastRaw, firstRaw] = m[2].split("/");
  const last = titleCaseName(String(lastRaw || "").replace(/\s+/g, " ").trim());
  const first = titleCaseName(String(firstRaw || "").replace(/\s+/g, " ").trim());
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
}

function titleCaseName(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      if (/^(ii|iii|iv|jr|sr)$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

/** Strip track/PAN sequences from a string. Empty if nothing human remains. */
export function stripPan(raw: string): string {
  let out = String(raw ?? "");
  out = out.replace(TRACK1_RE, " ");
  out = out.replace(TRACK2_RE, " ");
  out = out.replace(BARE_PAN_RE, (chunk) => (luhnOk(digitsOnly(chunk)) ? " " : chunk));
  return out.replace(/\s+/g, " ").trim();
}

export function assertNoPanInCustomerFields(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== "object") return;
  for (const key of PCI_TEXT_KEYS) {
    const v = body[key];
    if (typeof v === "string" && containsPan(v)) throw new PciFieldRejected(key.replace(/_/g, " "));
  }
  if (Array.isArray(body.people)) {
    for (const p of body.people as Array<{ name?: string }>) {
      if (p?.name && containsPan(p.name)) throw new PciFieldRejected("name");
    }
  }
  if (typeof body.notes === "string" && containsPan(body.notes)) throw new PciFieldRejected("notes");
}

export function suggestedNameFromRecord(fields: {
  customer_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
}): string {
  const fromTrack =
    nameFromTrack1(fields.customer_name || "") ||
    nameFromTrack1(fields.preferred_name || "");
  if (fromTrack) return fromTrack;
  const stripped = stripPan(fields.customer_name || "");
  if (stripped && !containsPan(stripped) && /[A-Za-z]{2,}/.test(stripped)) return stripped;
  const first = stripPan(fields.first_name || "");
  const last = stripPan(fields.last_name || "");
  const joined = [first, last].filter(Boolean).join(" ").trim();
  if (joined && /[A-Za-z]{2,}/.test(joined)) return joined;
  return "Needs review";
}
