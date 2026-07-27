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

/** Short ticket digits for hang tags (strip prefix). */
export function shortTicketNo(name: string): string {
  const m = name.match(/(\d{4,})$/);
  if (m) return m[1]!;
  const parts = name.split("-");
  return parts[parts.length - 1] || name;
}

/** Surname emphasis for rack read. */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[parts.length - 1] || fullName).toUpperCase();
}

export function fmtDueShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

export function fmtMoney(n: number | undefined | null): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}
