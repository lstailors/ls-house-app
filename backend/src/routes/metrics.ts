import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { getAltsMetrics } from "../lib/metrics";
import { getLiveHome } from "../lib/live-home";

export const metricsRouter = new Hono();

function deny(c: any, status: 401 | 403 = 401) {
  return c.json({ error: { message: status === 401 ? "Unauthorized" : "Forbidden" } }, status);
}

async function requireFloor(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { user: null, res: deny(c, 401) };
  if (user.role === "driver" || user.role === "customer") return { user: null, res: deny(c, 403) };
  return { user, res: null };
}

/** GET /api/metrics — house-wide Alts dashboard COUNTs. Floor staff. */
metricsRouter.get("/", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;

  try {
    const data = await getAltsMetrics();
    return c.json({ data });
  } catch (e: any) {
    console.error("GET /api/metrics", e);
    return c.json({ error: { message: e?.message || "Could not load metrics" } }, 502);
  }
});

/** GET /api/metrics/live-home — counts + exception/today/money/glimpse/activity. */
metricsRouter.get("/live-home", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;

  try {
    const data = await getLiveHome();
    return c.json({ data });
  } catch (e: any) {
    console.error("GET /api/metrics/live-home", e);
    return c.json({ error: { message: e?.message || "Could not load live home" } }, 502);
  }
});

/** GET /api/metrics/exceptions — exception queue only (60s poll). */
metricsRouter.get("/exceptions", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;

  try {
    const live = await getLiveHome();
    return c.json({
      data: {
        generated_at: live.generated_at,
        today: live.today,
        exceptions: live.exceptions,
      },
    });
  } catch (e: any) {
    console.error("GET /api/metrics/exceptions", e);
    return c.json({ error: { message: e?.message || "Could not load exceptions" } }, 502);
  }
});
