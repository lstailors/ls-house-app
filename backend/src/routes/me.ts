import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpGet, erpUpdate } from "../lib/erp";

export const meRouter = new Hono();

meRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Fetch user_image from ERPNext User record
  let image: string | null = null;
  try {
    const erpUser = await erpGet<any>("User", user.email);
    image = erpUser?.user_image ?? null;
  } catch { /* non-blocking */ }

  return c.json({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      locationId: user.locationCode,
      location: user.locationCode ? { id: user.locationCode, name: user.locationCode } : null,
      image,
      isActive: true,
    },
  });
});

meRouter.patch("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) update.full_name = body.name;
  if (body.image !== undefined) update.user_image = body.image;
  if (body.phone !== undefined) update.mobile_no = body.phone;

  if (Object.keys(update).length === 0) {
    return c.json({ data: { ok: true } });
  }

  await erpUpdate("User", user.email, update).catch(() => {});

  return c.json({ data: { ok: true } });
});

meRouter.post("/password", async (c) => {
  return c.json({ error: { message: "Change your password at erp.lstailors.com/update-password" } }, 400);
});
