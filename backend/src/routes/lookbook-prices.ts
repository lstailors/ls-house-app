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
import { getLookbookPriceReview } from "../lib/lookbook-prices";

export const lookbookPricesRouter = new Hono();

lookbookPricesRouter.get("/review", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const refresh = c.req.query("refresh") === "1";
    const data = await getLookbookPriceReview(refresh);
    return c.json({ data });
  } catch (e: any) {
    const detail = typeof e?.message === "string" ? e.message : String(e);
    console.error("lookbook-prices review error:", detail);
    // Route is auth-gated (MGMT users), so the underlying reason is safe to
    // surface — it is the only way to see what Desk rejected in production.
    return c.json({ error: { message: `Failed to build lookbook price review: ${detail}` } }, 502);
  }
});
