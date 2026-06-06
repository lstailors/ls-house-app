import { Hono } from "hono";
import { getAuthedUser, enrichFromErp } from "../lib/scope";

export const meRouter = new Hono();

meRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  return c.json({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      locationId: user.locationCode,
      location: user.locationCode ? { id: user.locationCode, name: user.locationCode } : null,
      image: null,
      isActive: true,
    },
  });
});

meRouter.patch("/", async (c) => {
  // Name/avatar updates are managed in ERPNext directly.
  return c.json({ error: { message: "Update your profile in ERPNext." } }, 400);
});

meRouter.post("/password", async (c) => {
  // Password changes are managed in ERPNext directly.
  return c.json({ error: { message: "Change your password in ERPNext." } }, 400);
});
