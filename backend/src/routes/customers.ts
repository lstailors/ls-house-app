import { Hono } from "hono";
import { getAuthedUser, canReadCustomer } from "../lib/scope";
import {
  searchCustomers,
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  updateCustomerPhotos,
  upsertCustomerDossier,
  archiveCustomer,
} from "../lib/erpnext/customers";

export const customersRouter = new Hono();

customersRouter.get("/search", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });

  try {
    const data = await searchCustomers(q, 10);
    return c.json({ data });
  } catch {
    return c.json({ data: [] });
  }
});

customersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  const q = (c.req.query("q") ?? "").trim();
  const locationFilter = c.req.query("location") ?? "";
  const vipFilter = c.req.query("vip") ?? "";
  const statusFilter = c.req.query("status") ?? "Active";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100"), 500);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const opts: Parameters<typeof listCustomers>[0] = {
    q,
    vip: vipFilter || undefined,
    status: statusFilter,
    limit,
    offset,
  };

  if (user.role !== "super_admin" && !user.canViewAllLocations) {
    if (user.locationCode) opts.location = user.locationCode;
  } else if (locationFilter) {
    opts.location = locationFilter;
  }

  try {
    const { data, total } = await listCustomers(opts);
    return c.json({ data, total });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to list customers" } }, 500);
  }
});

customersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const row = await getCustomer(c.req.param("id"));
    if (!row) return c.json({ error: { message: "Not found" } }, 404);
    if (!canReadCustomer(user, { division: row.locationId ?? undefined, locationId: row.locationId ?? undefined })) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
    return c.json({ data: row });
  } catch {
    return c.json({ error: { message: "Not found" } }, 404);
  }
});

customersRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json()) as any;
  if (!body.full_name) return c.json({ error: { message: "full_name is required" } }, 400);

  try {
    const data = await createCustomer(body, { division: user.locationCode ?? "NYC" });
    return c.json({ data }, 201);
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to create customer" } }, 500);
  }
});

customersRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;

  const allowed = [
    "full_name", "first_name", "last_name", "email", "phone", "company", "title_role",
    "address", "city", "state", "zip_code", "division", "vip_tier", "status",
    "style_preferences", "fit_notes", "notes", "birthday", "anniversary", "tags",
    "communication_pref", "preferred_contact", "sms_opted_out", "payment_preference",
    "credit_terms", "casa_tier", "source_channel",
  ];

  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: { message: "No fields to update" } }, 400);
  }

  try {
    const data = await updateCustomer(id, update);
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to update customer" } }, 500);
  }
});

customersRouter.patch("/:id/photos", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json()) as { photos?: string[] };
  const photos = Array.isArray(body.photos) ? body.photos : [];

  try {
    const data = await updateCustomerPhotos(id, photos);
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to update photos" } }, 500);
  }
});

customersRouter.patch("/:id/dossier", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;

  try {
    const data = await upsertCustomerDossier(id, body);
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to update dossier" } }, 500);
  }
});

customersRouter.delete("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden — super_admin only" } }, 403);

  try {
    await archiveCustomer(c.req.param("id"));
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to archive customer" } }, 500);
  }
});
