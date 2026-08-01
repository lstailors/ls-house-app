/**
 * Signed e-ticket / public ticket keys (server-only).
 * Prevents casual guessing of ALT-… IDs on the public e-ticket API.
 */
import { createHash } from "node:crypto";

function secret(): string {
  return (
    process.env.E_TICKET_SECRET ||
    process.env.JWT_SECRET ||
    process.env.AUTH_SECRET ||
    "lst-alts-eticket-dev"
  );
}

/** Deterministic short token for a ticket name (hex). */
export function eTicketKey(ticketName: string): string {
  const raw = `${secret()}:${String(ticketName).trim().toUpperCase()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 20);
}

export function eTicketKeyValid(ticketName: string, key: string | null | undefined): boolean {
  if (!key || !String(key).trim()) return false;
  return eTicketKey(ticketName) === String(key).trim().toLowerCase();
}

export function eTicketPublicUrl(ticketName: string): string {
  const base =
    (process.env.ALTS_URL || process.env.VITE_ALTS_PUBLIC_URL || "https://alts.lstailors.com").replace(
      /\/$/,
      "",
    );
  const k = eTicketKey(ticketName);
  return `${base}/t/${encodeURIComponent(ticketName)}?k=${encodeURIComponent(k)}`;
}
