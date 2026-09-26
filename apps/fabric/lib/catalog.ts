// ERPNext lookups for the estimator. All via the service user; none of these
// results (buying prices especially) are ever sent to the browser verbatim.
import "server-only";
import { serviceGet, serviceList } from "./erp";
import { GARMENT_CODE, MAKE_LEVELS, type MakeLevel, cmtItemCode } from "./pricing";
import type { SingleGarment } from "./yardage";

export interface Vendor {
  vendor_code: string;
  vendor_name: string;
  price_list: string;
  currency: string;
  provisional: boolean;
}

export interface Fabric {
  item_code: string;
  item_name: string;
  composition: string | null;
  image: string | null;
  width_in: number | null;
  out_of_stock: boolean;
}

const memo = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

export function todayISO(): string {
  // Business runs on New York time.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function activeVendors(): Promise<Vendor[]> {
  return cached("vendors", 5 * 60_000, async () => {
    const rows = await serviceList<{
      vendor_code: string;
      vendor_name: string;
      price_list: string;
      currency: string;
      notes: string | null;
    }>("Fabric Vendor Map", {
      filters: [["is_active", "=", 1]],
      fields: ["vendor_code", "vendor_name", "price_list", "currency", "notes"],
      order_by: "vendor_name asc",
      limit: 100,
    });
    return rows.map((r) => ({
      vendor_code: r.vendor_code,
      vendor_name: r.vendor_name,
      price_list: r.price_list,
      currency: r.currency,
      provisional: /provisional/i.test(r.notes ?? ""),
    }));
  });
}

/** Vendor is identified by item_code prefix, never the brand field. Longest prefix wins. */
export function vendorForItem(itemCode: string, vendors: Vendor[]): Vendor | null {
  return (
    [...vendors]
      .sort((a, b) => b.vendor_code.length - a.vendor_code.length)
      .find((v) => itemCode.startsWith(v.vendor_code + "-")) ?? null
  );
}

interface ItemRow {
  item_code: string;
  item_name: string;
  description: string | null;
  image: string | null;
  custom_fabric_width_in: number | null;
  disabled: 0 | 1;
}

const ITEM_FIELDS = ["item_code", "item_name", "description", "image", "custom_fabric_width_in", "disabled"];

function toFabric(r: ItemRow): Fabric {
  const width = typeof r.custom_fabric_width_in === "number" && r.custom_fabric_width_in > 0 ? r.custom_fabric_width_in : null;
  return {
    item_code: r.item_code,
    item_name: r.item_name,
    composition: r.description ? r.description.replace(/<[^>]+>/g, "").trim() || null : null,
    image: r.image || null,
    width_in: width,
    out_of_stock: r.disabled === 1,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export async function searchFabrics(vendor: Vendor, q: string, limit = 20): Promise<Fabric[]> {
  const term = q.trim();
  const prefix = `${vendor.vendor_code}-%`;
  const filters: unknown[] = [
    ["item_group", "=", "Fabric"],
    ["item_code", "like", prefix],
  ];
  const opts = { fields: ITEM_FIELDS, limit, order_by: "item_code asc" };
  if (!term) return (await serviceList<ItemRow>("Item", { ...opts, filters })).map(toFabric);
  const like = `%${escapeLike(term)}%`;
  const rows = await serviceList<ItemRow>("Item", {
    ...opts,
    filters,
    or_filters: [
      ["item_code", "like", like],
      ["item_name", "like", like],
    ],
  });
  return rows.map(toFabric);
}

export async function getFabric(itemCode: string): Promise<Fabric | null> {
  const r = await serviceGet<ItemRow & { item_group: string }>("Item", itemCode);
  if (!r || r.item_group !== "Fabric") return null;
  return toFabric(r);
}

export interface FabricPrice {
  rate: number;
  currency: string;
  uom: string | null;
  stale: boolean;
  valid_upto: string | null;
}

interface PriceRow {
  price_list_rate: number;
  currency: string;
  uom: string | null;
  valid_from: string | null;
  valid_upto: string | null;
}

/** Pick the price in force today; if every row has expired, return the latest one flagged stale. */
export function pickPrice(rows: PriceRow[], today: string): FabricPrice | null {
  const priced = rows.filter((r) => r.price_list_rate > 0);
  const live = priced
    .filter((r) => (!r.valid_from || r.valid_from <= today) && (!r.valid_upto || r.valid_upto >= today))
    .sort((a, b) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""));
  const expired = priced
    .filter((r) => r.valid_upto && r.valid_upto < today)
    .sort((a, b) => (b.valid_upto ?? "").localeCompare(a.valid_upto ?? ""));
  const row = live[0] ?? expired[0];
  if (!row) return null;
  return {
    rate: row.price_list_rate,
    currency: row.currency,
    uom: row.uom,
    stale: !live[0],
    valid_upto: row.valid_upto,
  };
}

export async function fabricBuyingPrice(itemCode: string, vendor: Vendor, today: string): Promise<FabricPrice | null> {
  const rows = await serviceList<PriceRow>("Item Price", {
    filters: [
      ["item_code", "=", itemCode],
      ["price_list", "=", vendor.price_list],
    ],
    fields: ["price_list_rate", "currency", "uom", "valid_from", "valid_upto"],
    limit: 20,
  });
  return pickPrice(
    rows.map((r) => ({ ...r, currency: r.currency || vendor.currency })),
    today,
  );
}

/** Metres → yards: a price per metre × 0.9144 = price per yard. */
export function perYard(rate: number, uom: string | null): number {
  return uom && /^(m|meter|metre)s?$/i.test(uom.trim()) ? rate * 0.9144 : rate;
}

export async function cmtPrices(priceList: string, make: MakeLevel): Promise<Record<SingleGarment, number | undefined>> {
  if (!MAKE_LEVELS.includes(make)) throw new Error("bad make level");
  const all = await cached(`cmt:${priceList}`, 5 * 60_000, () =>
    serviceList<{ item_code: string; price_list_rate: number }>("Item Price", {
      filters: [
        ["price_list", "=", priceList],
        ["item_code", "like", "CMT-%"],
      ],
      fields: ["item_code", "price_list_rate"],
      limit: 200,
    }),
  );
  const by = new Map(all.map((r) => [r.item_code, r.price_list_rate]));
  const garments = Object.keys(GARMENT_CODE) as SingleGarment[];
  return Object.fromEntries(garments.map((g) => [g, by.get(cmtItemCode(make, g))])) as Record<
    SingleGarment,
    number | undefined
  >;
}

// TODO(launch): create ALT-FLAT-{JKT|TRS|VST|OVC} Item Prices on "Wholesale - Alterations".
const ALT_PRICE_LIST = "Wholesale - Alterations";
const ALT_FALLBACK: Record<SingleGarment, number> = { Jacket: 150, Trouser: 50, Vest: 75, Overcoat: 150 };

export async function alterationsFees(): Promise<Record<SingleGarment, number>> {
  return cached("alts", 5 * 60_000, async () => {
    const rows = await serviceList<{ item_code: string; price_list_rate: number }>("Item Price", {
      filters: [
        ["price_list", "=", ALT_PRICE_LIST],
        ["item_code", "like", "ALT-FLAT-%"],
      ],
      fields: ["item_code", "price_list_rate"],
      limit: 20,
    }).catch(() => []);
    const by = new Map(rows.map((r) => [r.item_code, r.price_list_rate]));
    const out = { ...ALT_FALLBACK };
    const missing: string[] = [];
    for (const g of Object.keys(GARMENT_CODE) as SingleGarment[]) {
      const v = by.get(`ALT-FLAT-${GARMENT_CODE[g]}`);
      if (typeof v === "number" && v >= 0) out[g] = v;
      else missing.push(g);
    }
    if (missing.length)
      console.warn(
        `⚠️  [fabric-estimator] ALTERATIONS FEES NOT IN ERPNEXT for ${missing.join(", ")} — ` +
          `using HARDCODED fallback. Create ALT-FLAT-* Item Prices on "${ALT_PRICE_LIST}".`,
      );
    return out;
  });
}
