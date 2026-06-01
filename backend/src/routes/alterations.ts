import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const alterationsRouter = new Hono();

// Alterations are managed in Geelus (external system) — not in Supabase.
// This endpoint returns empty data pending Geelus sync integration.

alterationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ data: [], meta: { source: "geelus_pending" } });
});

alterationsRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Not found" } }, 404);
});

alterationsRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Alteration intake via Geelus — not available here" } }, 501);
});

alterationsRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Not found" } }, 404);
});
