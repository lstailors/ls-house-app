import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { getAltsMetrics } from "../lib/metrics";

export const metricsRouter = new Hono();

function deny(c: any, status: 401 | 403 = 401) {
  return c.json({ error: { message: status === 401 ? "Unauthorized" : "Forbidden" } }, status);
}

/** GET /api/metrics — house-wide Alts dashboard COUNTs. Floor staff. */
metricsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return deny(c, 401);
  if (user.role === "driver" || user.role === "customer") return deny(c, 403);

  try {
    const data = await getAltsMetrics();
    return c.json({ data });
  } catch (e: any) {
    console.error("GET /api/metrics", e);
    return c.json({ error: { message: e?.message || "Could not load metrics" } }, 502);
  }
});
