import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const financialsUnlockRouter = new Hono();

financialsUnlockRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const pin = body.pin ?? "";

  const correctPin = process.env.FINANCIALS_PIN ?? "";
  if (!correctPin) return c.json({ error: { message: "PIN not configured" } }, 500);
  if (pin !== correctPin) return c.json({ error: { message: "Incorrect code" } }, 403);

  return c.json({ data: { ok: true } });
});
