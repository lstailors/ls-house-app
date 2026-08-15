import { Hono } from "hono";
import { erpPing } from "../lib/erp";
import { ApiHealth } from "../types";

export const healthRouter = new Hono();

// GET /api/health — public. Used by alts/shop-floor to distinguish
// "ERPNext is down" from "no tickets today". Does not leak secrets.
healthRouter.get("/", async (c) => {
  const erp = await erpPing();
  const payload = ApiHealth.parse({
    ok: erp.reachable,
    status: erp.reachable ? "ok" : "degraded",
    erp,
  });
  return c.json({ ok: payload.ok, status: payload.status, data: payload });
});
