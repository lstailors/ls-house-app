import { Hono } from "hono";
import { cachedErpPing } from "../lib/erp";
import { ApiHealth } from "../types";

export const healthRouter = new Hono();

function payloadFromErp(erp: Awaited<ReturnType<typeof cachedErpPing>>) {
  return ApiHealth.parse({
    ok: erp.reachable,
    status: erp.reachable ? "ok" : "degraded",
    erp,
  });
}

// GET /api/health — public. Used by alts/shop-floor to distinguish
// "ERPNext is down" from "no tickets today". Does not leak secrets.
// Auth-only ping + 30s cache: floor tablets poll this every minute.
healthRouter.get("/", async (c) => {
  const erp = await cachedErpPing({ deep: false });
  const payload = payloadFromErp(erp);
  return c.json({ ok: payload.ok, status: payload.status, data: payload });
});

// GET /api/health/erp — optional deep check (ticket list). Same cache.
healthRouter.get("/erp", async (c) => {
  const erp = await cachedErpPing({ deep: true });
  const payload = payloadFromErp(erp);
  return c.json({ ok: payload.ok, status: payload.status, data: payload });
});
