/**
 * House lookbook price review — read-only against live Desk.
 * GET /api/lookbook-prices/review[?refresh=1]
 *
 * Per mill: BOOK / JOINED from Fabric Buying USD / CONFLICT / NO LISTINO
 * counts with a few example rows each, plus the LSH Fabric Pricing gap panel.
 * No Desk writes anywhere on this router.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  getLookbookData,
  getLookbookPriceReview,
  searchSwatches,
  type Bucket,
} from "../lib/lookbook-prices";

export const lookbookPricesRouter = new Hono();

const BUCKETS = new Set(["book", "joined", "conflict", "noListino"]);

function deskError(c: any, e: any) {
  const detail = typeof e?.message === "string" ? e.message : String(e);
  console.error("lookbook-prices error:", detail);
  // Route is auth-gated (MGMT users), so the underlying reason is safe to
  // surface — it is the only way to see what Desk rejected in production.
  return c.json({ error: { message: `Failed to build lookbook price review: ${detail}` } }, 502);
}

lookbookPricesRouter.get("/review", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const refresh = c.req.query("refresh") === "1";
    const data = await getLookbookPriceReview(refresh);
    return c.json({ data });
  } catch (e: any) {
    return deskError(c, e);
  }
});

lookbookPricesRouter.get("/swatches", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const bucketParam = c.req.query("bucket");
    const { rows } = await getLookbookData();
    const data = searchSwatches(rows, {
      q: c.req.query("q"),
      mill: c.req.query("mill") || undefined,
      bucket: bucketParam && BUCKETS.has(bucketParam) ? (bucketParam as Bucket) : undefined,
      start: Number(c.req.query("start")) || 0,
      limit: Number(c.req.query("limit")) || 50,
    });
    return c.json({ data });
  } catch (e: any) {
    return deskError(c, e);
  }
});

// Query param instead of a path param: swatch numbers can contain "/"
// (Marzoni articles like 120-721/700).
lookbookPricesRouter.get("/swatch", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = (c.req.query("id") ?? "").trim();
  if (!id) return c.json({ error: { message: "Missing id" } }, 400);

  try {
    const { bySwatch } = await getLookbookData();
    const row = bySwatch.get(id);
    if (!row) return c.json({ error: { message: `No swatch ${id}` } }, 404);
    return c.json({ data: row });
  } catch (e: any) {
    return deskError(c, e);
  }
});
