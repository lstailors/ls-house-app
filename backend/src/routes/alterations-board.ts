import { Hono } from "hono";
import { loadAlterationRows, type BoardFilter } from "../lib/erpnext/alterations-data.js";
import { getAuthedUser } from "../lib/scope.js";

export const alternationsBoardRouter = new Hono();

// GET /api/alterations/board?filter=all&location=
alternationsBoardRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const filter = (c.req.query("filter") ?? "all") as BoardFilter;
    const location = c.req.query("location");

    if (!["all", "in_progress", "complete", "delivered"].includes(filter)) {
      return c.json({ error: { message: "Invalid filter" } }, 400);
    }

    const rows = await loadAlterationRows(filter, location);
    return c.json({ data: rows });
  } catch (e: any) {
    console.error("[alterations-board] load failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Failed to load alterations" } }, 500);
  }
});
