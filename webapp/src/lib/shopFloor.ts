// Shop Floor helpers — status metadata, date math, garment parsing, search.
// Dates from ERPNext are "YYYY-MM-DD" strings; we compare them as strings
// (lexicographic order == chronological for that format) to sidestep timezones.

import type { YZOrder, YZProductionStatus, YZAttentionFlag } from "@ls/types";

// ─── Status metadata ────────────────────────────────────────────────────────

export interface StatusMeta {
  label: string;
  color: string;   // exact brand hex for dots / accents
  pill: string;    // tailwind classes for a tinted pill
}

export const STATUS_META: Record<YZProductionStatus, StatusMeta> = {
  "In Production": {
    label: "In Production",
    color: "#D9B878",
    pill: "bg-brass/12 text-brass-light border-brass/30",
  },
  Shipped: {
    label: "Shipped",
    color: "#4CAF50",
    pill: "bg-[#4CAF50]/12 text-[#7FD98A] border-[#4CAF50]/30",
  },
  Rush: {
    label: "Rush",
    color: "#FF5722",
    pill: "bg-[#FF5722]/15 text-[#FF8A65] border-[#FF5722]/35",
  },
  Canceled: {
    label: "Canceled",
    color: "rgba(241,233,214,0.35)",
    pill: "bg-cream/5 text-cream-dim border-cream/15",
  },
  "On Pause": {
    label: "On Pause",
    color: "#FF9800",
    pill: "bg-[#FF9800]/12 text-[#FFB74D] border-[#FF9800]/30",
  },
  "Fabric Not Received": {
    label: "Fabric Not Received",
    color: "#9C27B0",
    pill: "bg-[#9C27B0]/15 text-[#CE93D8] border-[#9C27B0]/35",
  },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status as YZProductionStatus] ?? STATUS_META["In Production"];
}

// Kanban columns — active statuses only (Canceled excluded), in workflow order.
export const KANBAN_STATUSES: YZProductionStatus[] = [
  "Fabric Not Received",
  "In Production",
  "Rush",
  "On Pause",
  "Shipped",
];

export const ALL_STATUSES: YZProductionStatus[] = [
  "In Production",
  "Rush",
  "On Pause",
  "Fabric Not Received",
  "Shipped",
  "Canceled",
];

// ─── Date helpers (string-based, timezone-free) ─────────────────────────────

/** Local "today" as YYYY-MM-DD. */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Add `days` to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDaysStr(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Parse YYYY-MM-DD as a *local* Date (no UTC shift). */
export function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const ACTIVE_FOR_OVERDUE = new Set(["Shipped", "Canceled"]);

/** Overdue = ship date in the past and not yet Shipped/Canceled. */
export function isOverdue(o: Pick<YZOrder, "ship_date_planned" | "production_status">): boolean {
  if (!o.ship_date_planned) return false;
  if (ACTIVE_FOR_OVERDUE.has(o.production_status)) return false;
  return o.ship_date_planned < todayStr();
}

/** True if the ship date is today..+`days` inclusive. */
export function shipsWithin(shipDate: string | null, days: number): boolean {
  if (!shipDate) return false;
  const today = todayStr();
  return shipDate >= today && shipDate <= addDaysStr(today, days);
}

export type ShipTone = "overdue" | "soon" | "normal" | "none";

export function shipTone(o: Pick<YZOrder, "ship_date_planned" | "production_status">): ShipTone {
  if (!o.ship_date_planned) return "none";
  if (isOverdue(o)) return "overdue";
  if (shipsWithin(o.ship_date_planned, 7)) return "soon";
  return "normal";
}

const SHIP_TONE_CLASS: Record<ShipTone, string> = {
  overdue: "text-signal-rose",
  soon: "text-signal-amber",
  normal: "text-cream-muted",
  none: "text-cream-dim",
};

export function shipToneClass(tone: ShipTone): string {
  return SHIP_TONE_CLASS[tone];
}

/** Compact ship-date label, e.g. "Jun 30". */
export function formatShipDate(s: string | null): string {
  if (!s) return "No date";
  const d = parseYMD(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Full date label, e.g. "Jun 30, 2026". */
export function formatFullDate(s: string | null | undefined, fallback = "—"): string {
  if (!s) return fallback;
  const d = parseYMD(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Sorting ────────────────────────────────────────────────────────────────

/** Sort by planned ship date ascending, nulls last, tie-break by order_no. */
export function byShipDate(a: YZOrder, b: YZOrder): number {
  const av = a.ship_date_planned;
  const bv = b.ship_date_planned;
  if (av && bv) return av < bv ? -1 : av > bv ? 1 : a.order_no.localeCompare(b.order_no);
  if (av) return -1;
  if (bv) return 1;
  return a.order_no.localeCompare(b.order_no);
}

// ─── Garment breakdown ──────────────────────────────────────────────────────

export interface GarmentLine {
  key: string;
  label: string;
  qty: number;
}

const GARMENT_FIELDS: Array<{ key: keyof YZOrder; label: string }> = [
  { key: "qty_suit_coat", label: "Suit Coat" },
  { key: "qty_suit_pant", label: "Suit Pant" },
  { key: "qty_suit_vest", label: "Suit Vest" },
  { key: "qty_overcoat", label: "Overcoat" },
  { key: "qty_shirt", label: "Shirt" },
  { key: "qty_tux_coat", label: "Tux Coat" },
  { key: "qty_tux_pant", label: "Tux Pant" },
  { key: "qty_tux_vest", label: "Tux Vest" },
];

/** Non-zero per-garment quantities for an order. */
export function garmentLines(o: YZOrder): GarmentLine[] {
  return GARMENT_FIELDS.flatMap(({ key, label }) => {
    const qty = o[key] as number;
    return qty > 0 ? [{ key: String(key), label, qty }] : [];
  });
}

// ─── Tracking links ─────────────────────────────────────────────────────────

export interface TrackingLink {
  carrier: "UPS" | "FedEx";
  url: string;
}

/** UPS numbers start with "1Z"; everything else is treated as FedEx. */
export function trackingLink(tracking: string | null): TrackingLink | null {
  if (!tracking) return null;
  const t = tracking.trim();
  if (!t) return null;
  if (/^1Z/i.test(t)) {
    return { carrier: "UPS", url: `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}` };
  }
  return { carrier: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}` };
}

// ─── Search ─────────────────────────────────────────────────────────────────

/** Case-insensitive substring match across the key order fields. */
export function matchesQuery(o: YZOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    o.order_no,
    o.customer_name,
    o.garment_summary,
    o.fabric_number,
    o.mtmpro_order,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // match every whitespace-separated term (loose fuzzy)
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface ShopFloorStats {
  active: number;
  rush: number;
  shippingThisWeek: number;
  overdue: number;
}

const ACTIVE_STATUSES = new Set<string>([
  "In Production",
  "Rush",
  "On Pause",
  "Fabric Not Received",
]);

export function computeStats(orders: YZOrder[]): ShopFloorStats {
  let active = 0;
  let rush = 0;
  let shippingThisWeek = 0;
  let overdue = 0;
  for (const o of orders) {
    if (ACTIVE_STATUSES.has(o.production_status)) active++;
    if (o.rush_days > 0 || o.production_status === "Rush") rush++;
    if (shipsWithin(o.ship_date_planned, 7)) shippingThisWeek++;
    if (isOverdue(o)) overdue++;
  }
  return { active, rush, shippingThisWeek, overdue };
}

export function isRush(o: YZOrder): boolean {
  return o.rush_days > 0 || o.production_status === "Rush";
}

// ─── Attention flags ──────────────────────────────────────────────────────────

export type AttentionTone = "high" | "medium" | "none";

export function attentionTone(o: YZOrder): AttentionTone {
  if (!o.attention || o.attention.length === 0) return "none";
  return o.attention.some((f) => f.severity === "high") ? "high" : "medium";
}

export function hasAttention(o: YZOrder): boolean {
  return (o.attention?.length ?? 0) > 0;
}

// Brand hex for the attention "light" — reuses the rush/amber signal colors.
export const ATTENTION_COLOR: Record<Exclude<AttentionTone, "none">, string> = {
  high: "#FF5722",
  medium: "#FF9800",
};

/** Short combined label of an order's flags, e.g. "Overdue · Rush at risk". */
export function attentionLabel(flags: YZAttentionFlag[]): string {
  return flags.map((f) => f.label).join(" · ");
}

export function attentionCount(orders: YZOrder[]): number {
  return orders.reduce((n, o) => (hasAttention(o) ? n + 1 : n), 0);
}
