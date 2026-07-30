/**
 * Map a resolved scanner result to an in-app path (alts / webapp).
 * Prefer house pages over ERP desk — staff stay in the floor app.
 */
import type { ScannerResult, ScannerType } from "@ls/types";

export type ScanNav =
  | { kind: "path"; path: string; replace?: boolean }
  | { kind: "external"; url: string }
  | { kind: "none" };

function metaStr(meta: Record<string, unknown> | undefined, key: string): string {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/** Garment tag QR: any host `/g/{ticket}/{garment}`. */
export function parseGarmentTagUrl(decoded: string): { ticket: string; garment: string } | null {
  const value = decoded.trim();
  if (!value) return null;

  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    const idx = value.indexOf("/g/");
    path = idx >= 0 ? value.slice(idx) : value;
  }

  const match = path.match(/\/g\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;

  const ticket = decodeURIComponent(match[1]);
  const garment = decodeURIComponent(match[2]);
  if (!ticket || !garment) return null;
  return { ticket, garment };
}

/** Customer deep-link: /customers/{id} on any host. */
export function parseCustomerUrl(decoded: string): string | null {
  const value = decoded.trim();
  if (!value) return null;
  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    const idx = value.indexOf("/customers/");
    path = idx >= 0 ? value.slice(idx) : value;
  }
  const m = path.match(/\/customers\/([^/?#]+)/i);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!id || id === "new") return null;
  return id;
}

/**
 * Destination after a successful resolve.
 * Auto-navigate types load the working page immediately; others keep the sheet.
 */
export function routeForScannerResult(result: ScannerResult): ScanNav {
  if (!result.ok || !result.name) return { kind: "none" };

  const type = result.type as ScannerType | undefined;
  const name = result.name;
  const meta = result.meta as Record<string, unknown> | undefined;

  switch (type) {
    case "alteration_ticket":
      return { kind: "path", path: `/orders/alterations/${encodeURIComponent(name)}`, replace: true };

    case "sales_invoice":
    case "payment_link": {
      // Prefer the ticket that minted the SI — charge lives on TicketDetail / pickup.
      const ticketRef = metaStr(meta, "alteration_ticket_ref") || metaStr(meta, "alteration_ticket");
      if (ticketRef) {
        return {
          kind: "path",
          path: `/orders/alterations/${encodeURIComponent(ticketRef)}`,
          replace: true,
        };
      }
      // Staff pay surface (public pay page also works authed)
      return { kind: "path", path: `/pay/${encodeURIComponent(name)}`, replace: true };
    }

    case "lsh_delivery":
      return { kind: "path", path: `/deliveries/${encodeURIComponent(name)}`, replace: true };

    case "tailor_transfer":
      // Keep result sheet — confirm_receipt lives there; Transfers has no deep-link yet.
      return { kind: "none" };

    case "garment_tag": {
      const ticket = metaStr(meta, "ticket") || metaStr(meta, "alteration_ticket");
      const garment = metaStr(meta, "garment_id") || metaStr(meta, "garment");
      if (ticket && garment) {
        return {
          kind: "path",
          path: `/g/${encodeURIComponent(ticket)}/${encodeURIComponent(garment)}`,
          replace: true,
        };
      }
      // Tag tokens that resolved as delivery land here via type rewrite in ERP
      return { kind: "none" };
    }

    case "custom_order": {
      // No dedicated alts custom-order detail yet — stay on sheet / ERP open
      return { kind: "none" };
    }

    default:
      // customer (if backend adds it) or unknown
      if (type === ("customer" as ScannerType) || result.doctype === "Customer") {
        return { kind: "path", path: `/customers/${encodeURIComponent(name)}`, replace: true };
      }
      return { kind: "none" };
  }
}

/** Primary "Open" path used by the result sheet (in-app first). */
export function openPathForResult(result: ScannerResult): ScanNav {
  const routed = routeForScannerResult(result);
  if (routed.kind !== "none") return routed;

  if (result.ok && result.name && result.doctype === "Customer") {
    return { kind: "path", path: `/customers/${encodeURIComponent(result.name)}` };
  }

  // Fallback: Frappe desk
  if (result.ok && result.name && result.doctype) {
    const slug = result.doctype.trim().toLowerCase().replace(/\s+/g, "-");
    return {
      kind: "external",
      url: `https://erp.lstailors.com/app/${slug}/${encodeURIComponent(result.name)}`,
    };
  }
  return { kind: "none" };
}
