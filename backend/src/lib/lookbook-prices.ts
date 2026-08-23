// House lookbook price review (read-only).
//
// Buckets every non-SW Fabric Swatch by matching fabric_article_id against
// "Fabric Buying USD" Item Price rows (item_code = FAB-<mill code>-<article>).
// Exact article string match only — no fuzzy matching, no invented prices.
// LSH Fabric Pricing is summarized as a per-mill gap panel only; it is not
// used to propose prices (its fabric_name key cannot reach swatch articles).
import type {
  LookbookExampleRow,
  LookbookMillReview,
  LookbookPriceReview,
  LshPricingGapMill,
} from "@ls/types";
import { erpCount, erpList } from "./erp";
import { DT } from "./erpnext/doctypes";

export type SwatchRow = {
  swatch_number: string;
  mill: string | null;
  collection: string | null;
  fabric_article_id: string | null;
  price_per_meter: number | null;
  swatch_photo_url: string | null;
};

export type ItemPriceRow = {
  item_code: string;
  price_list_rate: number | null;
};

export type LshPricingRow = {
  fabric_name: string | null;
  mill: string | null;
  price: number | null;
};

const FABRIC_ITEM_CODE = /^FAB-[A-Z0-9]{2,4}-(.+)$/;
const EXAMPLES_PER_BUCKET = 5;
const RATE_EPSILON = 0.01;

/** `FAB-COL-109301` → `109301`; returns null for codes without an article part. */
export function articleFromItemCode(itemCode: string): string | null {
  const m = FABRIC_ITEM_CODE.exec(itemCode.trim());
  return m?.[1] ?? null;
}

/** Distinct Fabric Buying USD rates per article (rates deduped at 2 decimals). */
export function buildArticleRates(rows: ItemPriceRow[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (typeof row.price_list_rate !== "number") continue;
    const article = articleFromItemCode(row.item_code ?? "");
    if (!article) continue;
    const rates = map.get(article) ?? [];
    if (!rates.some((r) => Math.abs(r - row.price_list_rate!) <= RATE_EPSILON)) {
      rates.push(row.price_list_rate);
    }
    map.set(article, rates);
  }
  return map;
}

export type Bucket = "book" | "joined" | "conflict" | "noListino";

export function bucketSwatch(
  swatch: SwatchRow,
  articleRates: Map<string, number[]>,
): { bucket: Bucket; joinRate: number | null; conflictRates?: number[]; pending: boolean } {
  const price = swatch.price_per_meter ?? 0;
  const rates = swatch.fabric_article_id
    ? articleRates.get(swatch.fabric_article_id.trim())
    : undefined;

  if (rates && rates.length > 1) {
    return { bucket: "conflict", joinRate: null, conflictRates: rates, pending: false };
  }
  if (rates && rates.length === 1) {
    const rate = rates[0]!;
    if (price > 0 && Math.abs(price - rate) > RATE_EPSILON) {
      // Mill book and Fabric Buying USD disagree — show both, pick nothing.
      return { bucket: "conflict", joinRate: null, conflictRates: [price, rate], pending: false };
    }
    return { bucket: "joined", joinRate: rate, pending: price === 0 };
  }
  if (price > 0) return { bucket: "book", joinRate: null, pending: false };
  return { bucket: "noListino", joinRate: null, pending: false };
}

function toExample(
  swatch: SwatchRow,
  joinRate: number | null,
  conflictRates?: number[],
): LookbookExampleRow {
  const photo = swatch.swatch_photo_url ?? "";
  return {
    swatchNumber: swatch.swatch_number,
    articleId: swatch.fabric_article_id ?? null,
    collection: swatch.collection ?? null,
    bookPrice: swatch.price_per_meter && swatch.price_per_meter > 0 ? swatch.price_per_meter : null,
    joinRate,
    conflictRates,
    photoUrl: photo.startsWith("/lookbook/") ? photo : null,
  };
}

export function computeReview(
  swatches: SwatchRow[],
  itemPrices: ItemPriceRow[],
  lshPricing: LshPricingRow[],
): LookbookPriceReview {
  const articleRates = buildArticleRates(itemPrices);

  type MillAcc = {
    swatchCount: number;
    buckets: { book: number; joined: number; joinedPending: number; conflict: number; noListino: number };
    examples: Record<Bucket, LookbookExampleRow[]>;
  };
  const mills = new Map<string, MillAcc>();
  const totals = { book: 0, joined: 0, joinedPending: 0, conflict: 0, noListino: 0 };
  let swExcluded = 0;

  for (const swatch of swatches) {
    if (swatch.swatch_number.startsWith("SW-")) {
      swExcluded += 1; // SW- house stock: do not touch, do not bucket.
      continue;
    }
    const millName = swatch.mill?.trim() || "(no mill)";
    let acc = mills.get(millName);
    if (!acc) {
      acc = {
        swatchCount: 0,
        buckets: { book: 0, joined: 0, joinedPending: 0, conflict: 0, noListino: 0 },
        examples: { book: [], joined: [], conflict: [], noListino: [] },
      };
      mills.set(millName, acc);
    }
    acc.swatchCount += 1;

    const { bucket, joinRate, conflictRates, pending } = bucketSwatch(swatch, articleRates);
    acc.buckets[bucket] += 1;
    totals[bucket] += 1;
    if (pending) {
      acc.buckets.joinedPending += 1;
      totals.joinedPending += 1;
    }
    if (acc.examples[bucket].length < EXAMPLES_PER_BUCKET) {
      acc.examples[bucket].push(toExample(swatch, joinRate, conflictRates));
    }
  }

  const swatchMills = new Set(mills.keys());
  const millReviews: LookbookMillReview[] = [...mills.entries()]
    .sort((a, b) => b[1].swatchCount - a[1].swatchCount)
    .map(([mill, acc]) => ({ mill, ...acc }));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      swatches: swatches.length,
      swExcluded,
    },
    mills: millReviews,
    lshGap: computeLshGap(lshPricing, swatchMills),
  };
}

/**
 * Per-mill summary of LSH Fabric Pricing — the gap story. Identical (key, price)
 * rows are deduped first; a key counts as an internal conflict only when it
 * still has more than one distinct price. `reachable` is exact-name-only
 * (per ruling: Hess stays unmapped; no fuzzy mill mapping).
 */
export function computeLshGap(
  rows: LshPricingRow[],
  swatchMills: Set<string>,
): LshPricingGapMill[] {
  const byMill = new Map<string, Map<string, Set<number>>>();
  for (const row of rows) {
    const mill = row.mill?.trim() || "(no mill)";
    const key = row.fabric_name?.trim() || "(no name)";
    let keys = byMill.get(mill);
    if (!keys) {
      keys = new Map();
      byMill.set(mill, keys);
    }
    let prices = keys.get(key);
    if (!prices) {
      prices = new Set();
      keys.set(key, prices);
    }
    if (typeof row.price === "number") prices.add(Math.round(row.price * 100) / 100);
  }

  const counts = new Map<string, number>();
  for (const row of rows) {
    const mill = row.mill?.trim() || "(no mill)";
    counts.set(mill, (counts.get(mill) ?? 0) + 1);
  }

  return [...byMill.entries()]
    .sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0))
    .map(([mill, keys]) => ({
      mill,
      rows: counts.get(mill) ?? 0,
      distinctKeys: keys.size,
      internalConflicts: [...keys.values()].filter((prices) => prices.size > 1).length,
      reachable: swatchMills.has(mill),
    }));
}

// ── Live fetch (Desk read-only) ────────────────────────────────────────────────

// Large pages keep the request count low (~16 total for all three doctypes):
// the whole build has to fit inside one serverless invocation, and every extra
// roundtrip to Desk through the tunnel is latency plus a chance to flake.
const PAGE_SIZE = 5000;
const CONCURRENCY = 4;
const PAGE_RETRIES = 2;

async function fetchPage<T>(
  doctype: string,
  fields: string[],
  filters: unknown[],
  start: number,
): Promise<T[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
    try {
      return await erpList<T>(doctype, {
        fields,
        filters,
        limit: PAGE_SIZE,
        start,
        order_by: "name asc",
        throwOnError: true,
      });
    } catch (e) {
      lastError = e;
      // Tunnel hiccups and rate-limit blips recover on a short backoff.
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchAll<T>(
  doctype: string,
  fields: string[],
  filters: unknown[] = [],
): Promise<T[]> {
  const total = await erpCount(doctype, filters);
  const starts: number[] = [];
  for (let start = 0; start < total; start += PAGE_SIZE) starts.push(start);

  const pages: T[][] = new Array(starts.length);
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      const i = next++;
      pages[i] = await fetchPage<T>(doctype, fields, filters, starts[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, starts.length) }, worker));
  return pages.flat();
}

export async function fetchLookbookPriceReview(): Promise<LookbookPriceReview> {
  const [swatches, itemPrices, lshPricing] = await Promise.all([
    fetchAll<SwatchRow>(DT.FABRIC_SWATCH, [
      "swatch_number",
      "mill",
      "collection",
      "fabric_article_id",
      "price_per_meter",
      "swatch_photo_url",
    ]),
    fetchAll<ItemPriceRow>(
      DT.ITEM_PRICE,
      ["item_code", "price_list_rate"],
      [["price_list", "=", "Fabric Buying USD"]],
    ),
    fetchAll<LshPricingRow>(DT.FABRIC_PRICING, ["fabric_name", "mill", "price"]),
  ]);
  return computeReview(swatches, itemPrices, lshPricing);
}

// Module-level cache: Desk holds ~62k swatch rows; don't refetch per request.
const CACHE_TTL_MS = 10 * 60_000;
let cache: { data: LookbookPriceReview; at: number } | null = null;
let inflight: Promise<LookbookPriceReview> | null = null;

export async function getLookbookPriceReview(refresh = false): Promise<LookbookPriceReview> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!inflight) {
    inflight = fetchLookbookPriceReview()
      .then((data) => {
        cache = { data, at: Date.now() };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
