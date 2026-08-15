/**
 * Walk-in Sell catalog rules (SPEC 057).
 * MTM garment SKUs are first-class invoice lines — not fabric, not wholesale programs.
 */

export const MTM_SELL_GROUPS = [
  "MTM",
  "MTM Jacket",
  "MTM Other",
  "MTM Overcoat",
  "MTM Shirt",
  "MTM Suit",
  "MTM Trouser",
  "MTM Vest",
] as const;

/** RTW / stock / Tramarossa — queried alongside MTM. */
export const RTW_SELL_GROUPS = [
  "Stock Garments",
  "RTW",
  "RTW Shirt",
  "RTW Trouser",
  "RTW Jacket",
  "RTW Suit",
  "RTW Accessory",
  "Tramarossa",
  "Tramarossa Jeans",
  "Tramarossa Jeans Colored",
  "Tramarossa Pants",
  "Tramarossa Bermuda",
] as const;

/** Never show service / fabric / wholesale / bespoke / MTM-program groups. */
export const DENY_SELL_GROUPS = [
  "Alteration Services",
  "Alterations",
  "Alterations - Legacy",
  "Factory Surcharges",
  "Fabric",
  "Suiting",
  "Shirting",
  "Jacketing",
  "Lining",
  "Coating",
  "Specialty",
  "Trouser-Only",
  "Trims",
  "Buttons",
  "Canvas & Interlining",
  "Labels & Monograms",
  "Other Trims",
  "Thread",
  "Zippers",
  "CMT - Factory",
  "Consultations",
  "Business Expenses",
  "Equipment",
  "Services",
  "Repairs",
  "Rush",
  "Pickup & Delivery",
  "Embroidery",
  "Casa L&S",
  "Casa Add-On",
  "Membership - Atelier",
  "Membership - Founder",
  "Membership - Heritage",
  "Membership - Signature",
  "Wholesale - MTM Program",
  "MTM Program - Jacket",
  "MTM Program - Sample Kit",
  "MTM Program - Setup Fee",
  "MTM Program - Shirt",
  "MTM Program - Suit",
  "MTM Program - Trouser",
  "Wholesale - RTW",
  "RTW Wholesale - Accessory",
  "RTW Wholesale - Jacket",
  "RTW Wholesale - Shirt",
  "RTW Wholesale - Suit",
  "RTW Wholesale - Trouser",
  "Bespoke",
  "Bespoke Jacket",
  "Bespoke Other",
  "Bespoke Overcoat",
  "Bespoke Shirt",
  "Bespoke Suit",
  "Bespoke Trouser",
  "Bespoke Vest",
  "Custom Made",
] as const;

const DENY = new Set(DENY_SELL_GROUPS.map((s) => s.toLowerCase()));
const PREFER_RTW = new Set(RTW_SELL_GROUPS.map((s) => s.toLowerCase()));

export type SellableKind = "mtm" | "rtw";
export type SellableAvailability = "in" | "order" | "out";
export type SellableUiGroup = "tops" | "bottoms" | "accessories" | "other";

/** Client-invoicable MTM garments. Excludes wholesale MTM Program kits. */
export function isMtmSellGroup(group: string): boolean {
  const g = (group || "").toLowerCase().trim();
  if (!g) return false;
  if (g.includes("program") || g.includes("wholesale")) return false;
  return g === "mtm" || g.startsWith("mtm ");
}

export function isDeniedGroup(group: string): boolean {
  const g = (group || "").toLowerCase().trim();
  if (!g) return false;
  if (isMtmSellGroup(g)) return false;
  return DENY.has(g);
}

export function isPreferredGroup(group: string, extra: string[] = []): boolean {
  const g = (group || "").toLowerCase().trim();
  if (isMtmSellGroup(g)) return true;
  if (PREFER_RTW.has(g)) return true;
  if (g.startsWith("rtw") && !g.includes("wholesale")) return true;
  if (g.startsWith("tramarossa")) return true;
  if (g === "stock garments") return true;
  return extra.some((a) => a.toLowerCase() === g);
}

export function sellableKind(group: string): SellableKind {
  return isMtmSellGroup(group) ? "mtm" : "rtw";
}

export function uiGroupFrom(itemGroup: string, name: string): SellableUiGroup {
  const g = `${itemGroup} ${name}`.toLowerCase();
  if (/tramarossa/.test(g)) return "bottoms";
  if (/trouser|jean|chino|pant|bottom|skirt|bermuda/.test(g)) return "bottoms";
  if (/shirt|polo|tee|top|jacket|coat|overshirt|vest/.test(g)) return "tops";
  if (/accessor|belt|sock|cap|tie|scarf/.test(g)) return "accessories";
  if (/rtw trouser/.test(itemGroup.toLowerCase())) return "bottoms";
  if (/rtw shirt|rtw jacket/.test(itemGroup.toLowerCase())) return "tops";
  if (/rtw accessor/.test(itemGroup.toLowerCase())) return "accessories";
  return "other";
}

export function availabilityFrom(isStock: boolean, qty: number | null): SellableAvailability {
  if (!isStock) return "order";
  if (qty == null) return "order";
  if (qty > 0) return "in";
  return "order";
}

export function envAllowGroups(raw = process.env.ALTS_SELLABLE_ITEM_GROUPS || ""): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Filterable = {
  item_name: string;
  item_code: string;
  item_group: string;
  color_label?: string | null;
  availability: SellableAvailability;
  ui_group?: SellableUiGroup;
  kind?: SellableKind;
};

export function applySellableFilters<T extends Filterable>(
  items: T[],
  opts: { q?: string; filter?: string },
): T[] {
  const q = (opts.q || "").trim().toLowerCase();
  const filter = (opts.filter || "all").toLowerCase();
  let dto = items;
  if (q) {
    dto = dto.filter((d) => {
      const hay = `${d.item_name} ${d.item_code} ${d.color_label || ""} ${d.item_group}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (filter === "in") dto = dto.filter((d) => d.availability === "in");
  else if (filter === "order") {
    dto = dto.filter((d) => d.availability === "order" && !isMtmSellGroup(d.item_group));
  } else if (filter === "mtm") dto = dto.filter((d) => isMtmSellGroup(d.item_group));
  else if (filter === "tops") dto = dto.filter((d) => d.ui_group === "tops");
  else if (filter === "bottoms") dto = dto.filter((d) => d.ui_group === "bottoms");
  return dto;
}

/** MTM first (quick invoice), then in-stock RTW, then special-order, then name. */
export function sortSellableItems<T extends Filterable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ar = rank(a);
    const br = rank(b);
    if (ar !== br) return ar - br;
    return a.item_name.localeCompare(b.item_name);
  });
}

function rank(d: Filterable): number {
  if (isMtmSellGroup(d.item_group) || d.kind === "mtm") return 0;
  if (d.availability === "in") return 1;
  if (d.availability === "order") return 2;
  return 3;
}

export function dedupeByItemCode<T extends { item_code: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const code = row.item_code;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(row);
  }
  return out;
}
