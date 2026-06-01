import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, canAccessSuperAdminPortal } from "../lib/scope";

export const locationsRouter = new Hono();

function serializeLocation(loc: any) {
  return {
    id: loc.code,
    name: loc.name,
    address: loc.address ?? null,
    erpnextCompanyOrBranch: loc.erpnext_company ?? null,
    isActive: loc.active ?? true,
    createdAt: loc.created_at,
    updatedAt: loc.updated_at,
  };
}

locationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!supabaseAdmin) return c.json({ data: [] });

  let query = supabaseAdmin
    .from("locations")
    .select("*")
    .eq("active", true)
    .order("sort_order");

  if (!canAccessSuperAdminPortal(user.role) && !user.canViewAllLocations) {
    if (user.locationCode) {
      query = query.eq("code", user.locationCode) as typeof query;
    } else {
      return c.json({ data: [] });
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("locations GET error:", error.message);
    return c.json({ data: [] });
  }

  return c.json({ data: (data ?? []).map(serializeLocation) });
});

locationsRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as {
    code: string;
    name: string;
    address?: string;
    erpnextCompanyOrBranch?: string;
  };

  if (!body.code) {
    return c.json({ error: { message: "code is required" } }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("locations")
    .insert({
      code: body.code,
      name: body.name,
      address: body.address ?? null,
      erpnext_company: body.erpnextCompanyOrBranch ?? null,
      active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("locations POST error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeLocation(data) });
});

locationsRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const code = c.req.param("id");
  const body = (await c.req.json()) as Record<string, unknown>;

  const mapped: Record<string, unknown> = {};
  if (body.name !== undefined) mapped.name = body.name;
  if (body.address !== undefined) mapped.address = body.address;
  if (body.erpnextCompanyOrBranch !== undefined) mapped.erpnext_company = body.erpnextCompanyOrBranch;
  if (body.isActive !== undefined) mapped.active = body.isActive;

  const { data, error } = await supabaseAdmin
    .from("locations")
    .update(mapped)
    .eq("code", code)
    .select()
    .single();

  if (error) {
    console.error("locations PATCH error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeLocation(data) });
});
