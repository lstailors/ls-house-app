// Canonical public origin for anything that outlives the session that created it:
// QR codes printed onto garment tags, links handed to customers, etc.
//
// Deliberately NOT window.location.origin. The same tag-print page is served by
// both app.lstailors.com and the alterations POS at alts.lstailors.com, and a tag
// printed at the counter must still resolve years later regardless of which app
// printed it. Pinning it here keeps every printed QR on one long-lived host.
//
// The in-app scanner parses these host-agnostically (see pages/Scanner.tsx), so
// this only matters when a customer or staff member opens the URL with a phone
// camera — which is exactly the case that must not break.
export const PUBLIC_ORIGIN: string =
  import.meta.env.VITE_PUBLIC_ORIGIN ||
  (import.meta.env.PROD ? "https://app.lstailors.com" : window.location.origin);

// Where alterations are actually worked. Used by the admin dashboard's
// read-only screens to deep-link staff over to the POS.
export const POS_ORIGIN: string =
  import.meta.env.VITE_POS_ORIGIN ||
  (import.meta.env.PROD ? "https://alts.lstailors.com" : window.location.origin);
