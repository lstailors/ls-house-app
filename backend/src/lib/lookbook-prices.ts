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
  LookbookSwatchList,
  LookbookSwatchRow,
  LshPricingGapMill,
} from "@ls/types";
import { erpCount, erpList } from "./erp";
import { DT } from "./erpnext/doctypes";

export type SwatchRow = {
  swatch_number: string;
  mill: string | null;
  collection: string | null;
  fabric_article_id: string | null;
  fabric_name: string | null;
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

export type LookbookData = {
  review: LookbookPriceReview;
  rows: LookbookSwatchRow[];
  bySwatch: Map<string, LookbookSwatchRow>;
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

function toSwatchRow(
  swatch: SwatchRow,
  b: ReturnType<typeof bucketSwatch>,
): LookbookSwatchRow {
  const photo = swatch.swatch_photo_url ?? "";
  return {
    swatchNumber: swatch.swatch_number,
    mill: swatch.mill?.trim() || "(no mill)",
    collection: swatch.collection ?? null,
    articleId: swatch.fabric_article_id ?? null,
    fabricName: swatch.fabric_name ?? null,
    bucket: b.bucket,
    joinedPending: b.pending,
    bookPrice: swatch.price_per_meter && swatch.price_per_meter > 0 ? swatch.price_per_meter : null,
    joinRate: b.joinRate,
    conflictRates: b.conflictRates,
    photoUrl: photo.startsWith("/lookbook/") ? photo : null,
  };
}

function toExample(row: LookbookSwatchRow): LookbookExampleRow {
  return {
    swatchNumber: row.swatchNumber,
    articleId: row.articleId,
    collection: row.collection,
    bookPrice: row.bookPrice,
    joinRate: row.joinRate,
    conflictRates: row.conflictRates,
    photoUrl: row.photoUrl,
  };
}

export function computeData(
  swatches: SwatchRow[],
  itemPrices: ItemPriceRow[],
  lshPricing: LshPricingRow[],
): LookbookData {
  const articleRates = buildArticleRates(itemPrices);

  type MillAcc = {
    swatchCount: number;
    buckets: { book: number; joined: number; joinedPending: number; conflict: number; noListino: number };
    examples: Record<Bucket, LookbookExampleRow[]>;
  };
  const mills = new Map<string, MillAcc>();
  const totals = { book: 0, joined: 0, joinedPending: 0, conflict: 0, noListino: 0 };
  let swExcluded = 0;
  const rows: LookbookSwatchRow[] = [];
  const bySwatch = new Map<string, LookbookSwatchRow>();

  for (const swatch of swatches) {
    if (swatch.swatch_number.startsWith("SW-")) {
      swExcluded += 1; // SW- house stock: do not touch, do not bucket.
      continue;
    }
    const b = bucketSwatch(swatch, articleRates);
    const row = toSwatchRow(swatch, b);
    rows.push(row);
    bySwatch.set(row.swatchNumber, row);

    let acc = mills.get(row.mill);
    if (!acc) {
      acc = {
        swatchCount: 0,
        buckets: { book: 0, joined: 0, joinedPending: 0, conflict: 0, noListino: 0 },
        examples: { book: [], joined: [], conflict: [], noListino: [] },
      };
      mills.set(row.mill, acc);
    }
    acc.swatchCount += 1;
    acc.buckets[b.bucket] += 1;
    totals[b.bucket] += 1;
    if (b.pending) {
      acc.buckets.joinedPending += 1;
      totals.joinedPending += 1;
    }
    if (acc.examples[b.bucket].length < EXAMPLES_PER_BUCKET) {
      acc.examples[b.bucket].push(toExample(row));
    }
  }

  const swatchMills = new Set(mills.keys());
  const millReviews: LookbookMillReview[] = [...mills.entries()]
    .sort((a, b) => b[1].swatchCount - a[1].swatchCount)
    .map(([mill, acc]) => ({ mill, ...acc }));

  const review: LookbookPriceReview = {
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      swatches: swatches.length,
      swExcluded,
    },
    mills: millReviews,
    lshGap: computeLshGap(lshPricing, swatchMills),
  };
  return { review, rows, bySwatch };
}

export function computeReview(
  swatches: SwatchRow[],
  itemPrices: ItemPriceRow[],
  lshPricing: LshPricingRow[],
): LookbookPriceReview {
  return computeData(swatches, itemPrices, lshPricing).review;
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

// ── Fuzzy search over the cached rows ─────────────────────────────────────────

export type SwatchQuery = {
  q?: string;
  mill?: string;
  bucket?: Bucket;
  hasPhoto?: boolean;
  start?: number;
  limit?: number;
};

/** Higher is better; 0 means no match. Fields weighted: id/article > names. */
function scoreField(hayUpper: string, needleUpper: string): number {
  if (!hayUpper) return 0;
  if (hayUpper.startsWith(needleUpper)) return 100;
  const idx = hayUpper.indexOf(needleUpper);
  if (idx > 0) {
    const prevChar = hayUpper[idx - 1]!;
    return /[A-Z0-9]/.test(prevChar) ? 40 : 60; // word-boundary substring beats mid-token
  }
  // In-order subsequence, e.g. "ART1093" over "ARTEXTILE-109301".
  let i = 0;
  for (const ch of hayUpper) {
    if (ch === needleUpper[i]) i++;
    if (i === needleUpper.length) return 15;
  }
  return 0;
}

export function scoreSwatch(row: LookbookSwatchRow, needleUpper: string): number {
  const parts: Array<[string | null, number]> = [
    [row.swatchNumber, 3],
    [row.articleId, 3],
    [row.collection, 2],
    [row.fabricName, 2],
    [row.mill, 1],
  ];
  let best = 0;
  for (const [value, weight] of parts) {
    if (!value) continue;
    const s = scoreField(value.toUpperCase(), needleUpper) * weight;
    if (s > best) best = s;
  }
  return best;
}

export function searchSwatches(rows: LookbookSwatchRow[], query: SwatchQuery): LookbookSwatchList {
  const start = Math.max(0, query.start ?? 0);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const q = (query.q ?? "").trim().toUpperCase();

  let candidates = rows;
  if (query.mill) candidates = candidates.filter((r) => r.mill === query.mill);
  if (query.bucket) candidates = candidates.filter((r) => r.bucket === query.bucket);
  if (query.hasPhoto) candidates = candidates.filter((r) => !!r.photoUrl);

  let matched: LookbookSwatchRow[];
  if (q.length >= 2) {
    matched = candidates
      .map((row) => ({ row, score: scoreSwatch(row, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.row.swatchNumber.localeCompare(b.row.swatchNumber))
      .map((x) => x.row);
  } else {
    matched = [...candidates].sort((a, b) => a.swatchNumber.localeCompare(b.swatchNumber));
  }

  return {
    total: matched.length,
    start,
    limit,
    rows: matched.slice(start, start + limit),
  };
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

export async function fetchLookbookData(): Promise<LookbookData> {
  const [swatches, itemPrices, lshPricing] = await Promise.all([
    fetchAll<SwatchRow>(DT.FABRIC_SWATCH, [
      "swatch_number",
      "mill",
      "collection",
      "fabric_article_id",
      "fabric_name",
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
  return computeData(swatches, itemPrices, lshPricing);
}

export async function fetchLookbookPriceReview(): Promise<LookbookPriceReview> {
  return (await fetchLookbookData()).review;
}

// Module-level cache: Desk holds ~62k swatch rows; don't refetch per request.
const CACHE_TTL_MS = 10 * 60_000;
let cache: { data: LookbookData; at: number } | null = null;
let inflight: Promise<LookbookData> | null = null;

export async function getLookbookData(refresh = false): Promise<LookbookData> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!inflight) {
    inflight = fetchLookbookData()
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

export async function getLookbookPriceReview(refresh = false): Promise<LookbookPriceReview> {
  return (await getLookbookData(refresh)).review;
}
