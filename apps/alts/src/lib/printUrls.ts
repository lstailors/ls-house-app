/** Canonical public origins for print QR targets (C lock 2026-07-27). */

export const ALTS_ORIGIN =
  (import.meta.env.VITE_ALTS_PUBLIC_URL as string | undefined)?.replace(/\/$/, "") ||
  (typeof window !== "undefined" && window.location.hostname.includes("alts.")
    ? window.location.origin
    : "https://alts.lstailors.com");

export const APP_ORIGIN =
  (import.meta.env.VITE_APP_PUBLIC_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://app.lstailors.com";

/** Garment hang-tag QR → job card in alts (no login at machine). */
export function garmentJobUrl(ticket: string, garmentId: string): string {
  return `${ALTS_ORIGIN}/g/${encodeURIComponent(ticket)}/${encodeURIComponent(garmentId)}`;
}

/** Store / e-ticket scan target. */
export function ticketPublicUrl(ticket: string): string {
  return `${ALTS_ORIGIN}/t/${encodeURIComponent(ticket)}`;
}

/** Pay link when billable. */
export function payUrl(salesInvoice: string): string {
  return `${APP_ORIGIN}/pay/${encodeURIComponent(salesInvoice)}`;
}

/** Short ticket for rack (ALT-NYC-2026-00061 → A00061). */
export function shortTicketNo(name: string): string {
  const m = name.match(/(\d{3,})$/);
  if (m) return `A${m[1]}`;
  const parts = name.split("-");
  return parts[parts.length - 1] || name;
}

/** Surname emphasis for rack read. */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[parts.length - 1] || fullName).toUpperCase();
}

/**
 * Rack due parts matching classic purple slip:
 *   Friday
 *   6:00 PM
 *   Aug 4
 * Date-only ERP fields → shop EOD ready-by (default 6:00 PM).
 */
export function parseDueRack(
  iso?: string | null,
  defaultTime = "6:00 PM",
): { weekday: string; time: string; dateShort: string } | null {
  if (!iso) return null;
  const raw = String(iso).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const hasTime = !dateOnly && /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(raw);
  const d = new Date(dateOnly ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) {
    return { weekday: raw, time: defaultTime, dateShort: raw };
  }
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const dateShort = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let time = defaultTime;
  if (hasTime) {
    time = d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      .replace(/^0/, "");
  }
  return { weekday, time, dateShort };
}

/** @deprecated prefer parseDueRack — kept for call sites */
export function fmtDueRack(iso?: string | null): { day: string; time: string } {
  const p = parseDueRack(iso);
  if (!p) return { day: "", time: "" };
  return { day: p.weekday, time: p.time };
}

export function fmtDueShort(iso?: string | null): string {
  const p = parseDueRack(iso);
  if (!p) return "—";
  return `${p.weekday} ${p.dateShort}`.toUpperCase();
}

export function fmtMoney(n: number | undefined | null): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}
