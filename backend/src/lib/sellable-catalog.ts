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
  "Custom Made",
] as const;

/**
 * Always-on Walk-in tiles for quick MTM invoices.
 * Codes match custom-order SO lines (MTM-SUIT, …). Rates are house construction
 * labor and overlay with ERP Item Price when that SKU exists.
 */
export const HOUSE_MTM_ITEMS = [
  {
    item_code: "MTM-JACKET",
    item_name: "MTM Jacket",
    item_group: "MTM Jacket",
    rate: 2400,
    ui_group: "tops" as const,
    attributes: { Size: ["36", "38", "40", "42", "44", "46"] },
  },
  {
    item_code: "MTM-SUIT",
    item_name: "MTM Suit",
    item_group: "MTM Suit",
    rate: 4400,
    ui_group: "other" as const,
    attributes: { Size: ["36", "38", "40", "42", "44", "46"] },
  },
  {
    item_code: "MTM-TROUSERS",
    item_name: "MTM Trousers",
    item_group: "MTM Trouser",
    rate: 900,
    ui_group: "bottoms" as const,
    attributes: { Size: ["28", "30", "32", "34", "36", "38"] },
  },
  {
    item_code: "MTM-VEST",
    item_name: "MTM Vest",
    item_group: "MTM Vest",
    rate: 1100,
    ui_group: "tops" as const,
    attributes: { Size: ["36", "38", "40", "42", "44", "46"] },
  },
  {
    item_code: "MTM-OVERCOAT",
    item_name: "MTM Overcoat",
    item_group: "MTM Overcoat",
    rate: 3200,
    ui_group: "tops" as const,
    attributes: { Size: ["36", "38", "40", "42", "44", "46"] },
  },
  {
    item_code: "MTM-SHIRT",
    item_name: "MTM Shirt",
    item_group: "MTM Shirt",
    rate: 380,
    ui_group: "tops" as const,
    attributes: { Size: ["14.5", "15", "15.5", "16", "16.5", "17"] },
  },
] as const;

export const HOUSE_MTM_CODES = HOUSE_MTM_ITEMS.map((h) => h.item_code);

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
] as const;

const DENY = new Set(DENY_SELL_GROUPS.map((s) => s.toLowerCase()));
const PREFER_RTW = new Set(RTW_SELL_GROUPS.map((s) => s.toLowerCase()));

export type SellableKind = "mtm" | "rtw";
export type SellableSource = "erp" | "seed" | "house";
export type SellableAvailability = "in" | "order" | "out";
export type SellableUiGroup = "tops" | "bottoms" | "accessories" | "other";

export function canonMtmCode(code: string): string {
  return (code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/TROUSERS$/, "TROUSER");
}

/** Client-invoicable MTM garments. Excludes wholesale MTM Program kits. */
export function isMtmSellGroup(group: string): boolean {
  const g = (group || "").toLowerCase().trim();
  if (!g) return false;
  if (g.includes("program") || g.includes("wholesale")) return false;
  if (g === "custom made" || g === "custom-made") return true;
  return g === "mtm" || g.startsWith("mtm ");
}

export function isMtmSellItem(d: { item_group?: string; item_code?: string; item_name?: string; kind?: SellableKind }): boolean {
  if (d.kind === "mtm") return true;
  if (isMtmSellGroup(d.item_group || "")) return true;
  const code = (d.item_code || "").toUpperCase();
  if (code.includes("PROGRAM") || code.includes("WHOLESALE")) return false;
  if (code.startsWith("MTM-") || code.startsWith("MTM_")) return true;
  return false;
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

export function sellableKind(group: string, itemCode = ""): SellableKind {
  return isMtmSellItem({ item_group: group, item_code: itemCode }) ? "mtm" : "rtw";
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
    dto = dto.filter((d) => d.availability === "order" && !isMtmSellItem(d));
  } else if (filter === "mtm") dto = dto.filter((d) => isMtmSellItem(d));
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
  if (isMtmSellItem(d)) return 0;
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

export type HouseMtmDto = {
  item_code: string;
  item_name: string;
  item_group: string;
  rate: number;
  is_stock_item: false;
  stock_qty: null;
  availability: "order";
  has_variants: false;
  attributes: { Size?: string[]; Color?: string[] };
  image: null;
  ui_group: SellableUiGroup;
  color_label: null;
  source: "house";
  eta: "Made to measure";
  kind: "mtm";
};

export function houseMtmDto(item: (typeof HOUSE_MTM_ITEMS)[number]): HouseMtmDto {
  return {
    item_code: item.item_code,
    item_name: item.item_name,
    item_group: item.item_group,
    rate: item.rate,
    is_stock_item: false,
    stock_qty: null,
    availability: "order",
    has_variants: false,
    attributes: { Size: [...item.attributes.Size] },
    image: null,
    ui_group: item.ui_group,
    color_label: null,
    source: "house",
    eta: "Made to measure",
    kind: "mtm",
  };
}

type Mergeable = Filterable & {
  rate?: number;
  source?: SellableSource;
  eta?: string | null;
  attributes?: { Size?: string[]; Color?: string[] };
};

function findHouseMatch<T extends Mergeable>(item: T): (typeof HOUSE_MTM_ITEMS)[number] | undefined {
  const code = canonMtmCode(item.item_code);
  const byCode = HOUSE_MTM_ITEMS.find((h) => canonMtmCode(h.item_code) === code);
  if (byCode) return byCode;
  const name = (item.item_name || "").toLowerCase();
  return HOUSE_MTM_ITEMS.find((h) => name === h.item_name.toLowerCase());
}

/**
 * Pin the six house MTM tiles first (quick invoice), overlay ERP rates when
 * the SKU already exists, then the rest of the catalog.
 */
export function mergeHouseMtm<T extends Mergeable>(items: T[]): Array<T | HouseMtmDto> {
  const overlay = new Map<string, T>();
  const extraMtm: T[] = [];
  const rtw: T[] = [];

  for (const it of items) {
    const house = findHouseMatch(it);
    if (house && !overlay.has(house.item_code)) {
      overlay.set(house.item_code, it);
      continue;
    }
    if (isMtmSellItem(it)) extraMtm.push({ ...it, kind: "mtm" });
    else rtw.push(it);
  }

  const pinned = HOUSE_MTM_ITEMS.map((h) => {
    const hit = overlay.get(h.item_code);
    if (!hit) return houseMtmDto(h);
    return {
      ...hit,
      kind: "mtm" as const,
      eta: hit.eta || "Made to measure",
      item_name: hit.item_name || h.item_name,
      rate: Number(hit.rate) > 0 ? hit.rate : h.rate,
    };
  });

  return [...pinned, ...extraMtm, ...rtw];
}

/** House MTM first (stable), then remaining MTM, then sorted RTW. */
export function finalizeSellableCatalog<T extends Mergeable>(
  items: T[],
  opts: { q?: string; filter?: string; limit: number },
): Array<T | HouseMtmDto> {
  const merged = mergeHouseMtm(items);
  const filtered = applySellableFilters(merged, opts);
  const mtm = filtered.filter((d) => isMtmSellItem(d));
  const rest = sortSellableItems(filtered.filter((d) => !isMtmSellItem(d)));
  return [...mtm, ...rest].slice(0, opts.limit);
}
