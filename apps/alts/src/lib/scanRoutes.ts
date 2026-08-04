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

function pathOf(decoded: string): string {
  const value = decoded.trim();
  if (!value) return "";
  try {
    return new URL(value).pathname;
  } catch {
    // bare path or host/path without scheme
    const slash = value.indexOf("/");
    return slash >= 0 ? value.slice(value.indexOf("/", value.startsWith("http") ? 8 : 0)) : value;
  }
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

/**
 * Thermal ticket / e-ticket QR:
 *   https://alts.lstailors.com/t/ALT-NYC-2026-00061
 *   https://alts.lstailors.com/e-ticket/ALT-…
 *   bare ALT-NYC-… / LS-ALT-…
 * Staff scanner opens TicketDetail (not the public e-ticket).
 */
export function parseTicketUrl(decoded: string): string | null {
  const value = decoded.trim();
  if (!value) return null;

  // Bare ticket name
  if (/^(ALT-|LS-ALT-)/i.test(value) && !/\s/.test(value) && value.length < 80) {
    return value;
  }

  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    const m = value.match(/\/(?:t|e-ticket)\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]);
    const alt = value.match(/\b((?:LS-)?ALT-[A-Z0-9-]+)\b/i);
    return alt ? alt[1] : null;
  }

  const m = path.match(/^\/(?:t|e-ticket)\/([^/]+)\/?$/i);
  if (m) return decodeURIComponent(m[1]);

  const orders = path.match(/^\/orders\/alterations\/([^/]+)\/?$/i);
  if (orders) return decodeURIComponent(orders[1]);

  return null;
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

/** Invoice / pay deep link. */
export function parsePayUrl(decoded: string): string | null {
  const value = decoded.trim();
  if (!value) return null;
  // L&S SI names: LSTNY-SINV-… / LSTX-SINV-… / SINV-… / ACC-SINV-…
  if (/^(?:LSTNY-|LSTX-|ACC-)?SINV-/i.test(value) && !/\s/.test(value) && value.length < 80) {
    return value;
  }
  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    const m = value.match(/\/(?:pay|invoices|i)\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }
  const m = path.match(/^\/pay\/([^/]+)\/?$/i);
  if (m) return decodeURIComponent(m[1]);
  const inv = path.match(/^\/invoices\/([^/]+)\/?$/i);
  if (inv) return decodeURIComponent(inv[1]);
  const my = path.match(/^\/i\/([^/]+)\/?$/i);
  if (my) return decodeURIComponent(my[1]);
  return null;
}

/**
 * What a pickup counter scan should add to the bag.
 * Prefer ticket (garment tag / thermal / bare ALT) over invoice when both parse.
 */
export function parsePickupScanTarget(
  decoded: string,
): { kind: "ticket"; id: string } | { kind: "invoice"; id: string } | null {
  const garment = parseGarmentTagUrl(decoded);
  if (garment?.ticket) return { kind: "ticket", id: garment.ticket };

  const ticket = parseTicketUrl(decoded);
  if (ticket) return { kind: "ticket", id: ticket };

  const pay = parsePayUrl(decoded);
  if (pay) return { kind: "invoice", id: pay };

  // ALT-…/G1 paste
  const slash = decoded.trim().match(/^(ALT-[A-Z0-9-]+)[/:](G\d+)$/i);
  if (slash) return { kind: "ticket", id: slash[1] };

  return null;
}

/**
 * Mark Progress mode — must resolve to a single piece (hang tag).
 * Thermal ticket-only is not enough: time is logged per garment.
 */
export function parseProgressScanTarget(
  decoded: string,
): { ticket: string; garment: string } | null {
  const garment = parseGarmentTagUrl(decoded);
  if (garment) return garment;

  // ALT-…/G1 or ALT-…:G1 paste
  const slash = decoded.trim().match(/^((?:LS-)?ALT-[A-Z0-9-]+)[/:](G\d+)$/i);
  if (slash) {
    return { ticket: slash[1], garment: slash[2].toUpperCase() };
  }

  return null;
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
      const ticketRef = metaStr(meta, "alteration_ticket_ref") || metaStr(meta, "alteration_ticket");
      if (ticketRef) {
        return {
          kind: "path",
          path: `/orders/alterations/${encodeURIComponent(ticketRef)}`,
          replace: true,
        };
      }
      return { kind: "path", path: `/pay/${encodeURIComponent(name)}`, replace: true };
    }

    case "lsh_delivery":
      return { kind: "path", path: `/deliveries/${encodeURIComponent(name)}`, replace: true };

    case "tailor_transfer":
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
      return { kind: "none" };
    }

    case "custom_order":
      return { kind: "none" };

    default:
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

  if (result.ok && result.name && result.doctype) {
    const slug = result.doctype.trim().toLowerCase().replace(/\s+/g, "-");
    return {
      kind: "external",
      url: `https://erp.lstailors.com/app/${slug}/${encodeURIComponent(result.name)}`,
    };
  }
  return { kind: "none" };
}

/** Fast client-side routing before any network call. */
export function routeFromRawScan(decoded: string): ScanNav {
  const garment = parseGarmentTagUrl(decoded);
  if (garment) {
    return {
      kind: "path",
      path: `/g/${encodeURIComponent(garment.ticket)}/${encodeURIComponent(garment.garment)}`,
      replace: true,
    };
  }

  const ticket = parseTicketUrl(decoded);
  if (ticket) {
    return {
      kind: "path",
      path: `/orders/alterations/${encodeURIComponent(ticket)}`,
      replace: true,
    };
  }

  const customer = parseCustomerUrl(decoded);
  if (customer) {
    return {
      kind: "path",
      path: `/customers/${encodeURIComponent(customer)}`,
      replace: true,
    };
  }

  const pay = parsePayUrl(decoded);
  if (pay) {
    return {
      kind: "path",
      path: `/pay/${encodeURIComponent(pay)}`,
      replace: true,
    };
  }

  // silence unused helper if tree-shaken poorly
  void pathOf;
  return { kind: "none" };
}
