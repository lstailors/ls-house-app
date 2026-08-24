/**
 * House lookbook price review — read-only against live Desk.
 * GET /api/lookbook-prices/review[?refresh=1]
 *
 * Per mill: BOOK / JOINED from Fabric Buying USD / CONFLICT / NO LISTINO
 * counts with a few example rows each, plus the LSH Fabric Pricing gap panel.
 * No Desk writes anywhere on this router.
 */
import { Hono } from "hono";
import { canSeeFinancials, getAuthedUser } from "../lib/scope";
import { erpGet } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";
import {
  getLookbookData,
  getLookbookPriceReview,
  searchSwatches,
  type Bucket,
} from "../lib/lookbook-prices";

export const lookbookPricesRouter = new Hono();

const BUCKETS = new Set(["book", "joined", "conflict", "noListino"]);

async function requireMgmt(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { error: c.json({ error: { message: "Unauthorized" } }, 401) };
  if (!canSeeFinancials(user.role)) return { error: c.json({ error: { message: "Forbidden" } }, 403) };
  return { user };
}

function deskError(c: any, e: any) {
  const detail = typeof e?.message === "string" ? e.message : String(e);
  console.error("lookbook-prices error:", detail);
  // Route is auth-gated (MGMT users), so the underlying reason is safe to
  // surface — it is the only way to see what Desk rejected in production.
  return c.json({ error: { message: `Failed to build lookbook price review: ${detail}` } }, 502);
}

lookbookPricesRouter.get("/review", async (c) => {
  const gate = await requireMgmt(c);
  if (gate.error) return gate.error;

  try {
    const refresh = c.req.query("refresh") === "1";
    const data = await getLookbookPriceReview(refresh);
    return c.json({ data });
  } catch (e: any) {
    return deskError(c, e);
  }
});

lookbookPricesRouter.get("/swatches", async (c) => {
  const gate = await requireMgmt(c);
  if (gate.error) return gate.error;

  try {
    const bucketParam = c.req.query("bucket");
    const { rows, review } = await getLookbookData();
    const data = searchSwatches(rows, {
      q: c.req.query("q"),
      mill: c.req.query("mill") || undefined,
      bucket: bucketParam && BUCKETS.has(bucketParam) ? (bucketParam as Bucket) : undefined,
      hasPhoto: c.req.query("photo") === "1",
      start: Number(c.req.query("start")) || 0,
      limit: Number(c.req.query("limit")) || 50,
    });
    return c.json({ data: { ...data, mills: review.mills.map((m) => m.mill) } });
  } catch (e: any) {
    return deskError(c, e);
  }
});

// Query param instead of a path param: swatch numbers can contain "/"
// (Marzoni articles like 120-721/700).
lookbookPricesRouter.get("/swatch", async (c) => {
  const gate = await requireMgmt(c);
  if (gate.error) return gate.error;

  const id = (c.req.query("id") ?? "").trim();
  if (!id) return c.json({ error: { message: "Missing id" } }, 400);

  try {
    const { bySwatch } = await getLookbookData();
    const row = bySwatch.get(id);
    if (!row) return c.json({ error: { message: `No swatch ${id}` } }, 404);
    const desk = await erpGet<{
      composition?: string | null;
      weight_grams?: number | null;
      width_cm?: number | null;
      season?: string | null;
      availability_status?: string | null;
    }>(DT.FABRIC_SWATCH, id);
    return c.json({
      data: {
        ...row,
        composition: desk?.composition ?? null,
        weightGrams: typeof desk?.weight_grams === "number" ? desk.weight_grams : null,
        widthCm: typeof desk?.width_cm === "number" ? desk.width_cm : null,
        season: desk?.season ?? null,
        availability: desk?.availability_status ?? null,
      },
    });
  } catch (e: any) {
    return deskError(c, e);
  }
});

// Same-origin download so the browser can save ERP lookbook photos (cross-origin
// <a download> from erp.lstailors.com is blocked).
lookbookPricesRouter.get("/photo", async (c) => {
  const gate = await requireMgmt(c);
  if (gate.error) return gate.error;

  const id = (c.req.query("id") ?? "").trim();
  if (!id) return c.json({ error: { message: "Missing id" } }, 400);

  try {
    const { bySwatch } = await getLookbookData();
    const row = bySwatch.get(id);
    if (!row?.photoUrl) return c.json({ error: { message: `No photo for ${id}` } }, 404);

    const base = (process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com").replace(/\/$/, "");
    const key = process.env.ERPNEXT_API_KEY ?? "";
    const secret = process.env.ERPNEXT_API_SECRET ?? "";
    const headers: Record<string, string> = { Accept: "image/*,*/*" };
    if (key && secret) headers.Authorization = `token ${key}:${secret}`;

    const res = await fetch(`${base}${row.photoUrl}`, { headers });
    if (!res.ok) return c.json({ error: { message: `Photo fetch failed (${res.status})` } }, 502);

    const buf = await res.arrayBuffer();
    const ext = row.photoUrl.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const safe = id.replace(/[/\\]+/g, "_");
    return new Response(buf, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Content-Disposition": `attachment; filename="${safe}.${ext}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    return deskError(c, e);
  }
});
