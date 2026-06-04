// Super Admin Portal endpoints — users management.

import { Hono } from "hono";
import { canAccessSuperAdminPortal, getAuthedUser } from "../lib/scope.js";
import { supabaseAdmin, lshAdmin } from "../lib/supabase.js";
import { CreateUserInput, UpdateUserInput } from "../types.js";

export const adminRouter = new Hono();

// ─── Serializers ──────────────────────────────────────────────────────────────

function serializeProfile(row: any) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.lsh_role || row.role,
    locationId: null,
    location: null,
    image: row.avatar_url,
    isActive: row.status === "active",
  };
}

function serializeLocation(row: any) {
  return {
    id: row.code,
    name: row.name,
    address: row.address,
    erpnextCompanyOrBranch: row.erpnext_company,
    isActive: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Auth guard middleware ────────────────────────────────────────────────────

adminRouter.use("*", async (c, next) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  await next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

adminRouter.get("/users", async (c) => {
  if (!supabaseAdmin) return c.json({ data: [] });
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,email,role,lsh_role,home_location,status,avatar_url,created_at")
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data: (data ?? []).map(serializeProfile) });
});

adminRouter.post("/users", async (c) => {
  const body = await c.req.json();
  const parsed = CreateUserInput.safeParse(body);
  if (!parsed.success) return c.json({ error: { message: parsed.error.message } }, 400);
  const input = parsed.data;

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.name },
  });

  if (authErr || !authData.user) {
    return c.json({ error: { message: authErr?.message ?? "Failed to create user" } }, 400);
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: authData.user.id,
        email: input.email,
        full_name: input.name,
        lsh_role: input.role,
        home_location: input.locationId ?? null,
        status: "active",
      },
      { onConflict: "email" },
    )
    .select("id, full_name, email, role, lsh_role, home_location, status, avatar_url, created_at")
    .single();

  if (profileErr || !profile) {
    return c.json({ error: { message: "User created but profile upsert failed" } }, 500);
  }

  return c.json({
    data: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.lsh_role ?? profile.role,
      locationId: null,
      location: null,
      image: profile.avatar_url ?? null,
      isActive: profile.status === "active",
    },
  });
});

adminRouter.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateUserInput.safeParse(body);
  if (!parsed.success) return c.json({ error: { message: parsed.error.message } }, 400);
  const input = parsed.data;

  if (!supabaseAdmin) return c.json({ error: { message: "DB unavailable" } }, 500);

  const update: any = {};
  if (input.name !== undefined) update.full_name = input.name;
  if (input.role !== undefined) update.lsh_role = input.role;
  if (input.locationId !== undefined) update.home_location = input.locationId;
  if (input.isActive !== undefined) update.status = input.isActive ? "active" : "inactive";

  const { data: profile } = await supabaseAdmin!
    .from("profiles")
    .update(update)
    .eq("id", id)
    .select("id, full_name, email, role, lsh_role, home_location, status, avatar_url, created_at")
    .single();

  return c.json({
    data: profile
      ? {
          id: profile.id,
          name: profile.full_name,
          email: profile.email,
          role: profile.lsh_role ?? profile.role,
          locationId: null,
          location: null,
          image: profile.avatar_url ?? null,
          isActive: profile.status === "active",
        }
      : null,
  });
});

adminRouter.post("/users/:id/password", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (!password || password.length < 8) return c.json({ error: { message: "Password must be at least 8 characters" } }, 400);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
  if (error) return c.json({ error: { message: error.message } }, 400);
  return c.json({ data: { ok: true } });
});

adminRouter.post("/locations", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || !body.code) return c.json({ error: { message: "name and code required" } }, 400);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
  const { data, error } = await supabaseAdmin
    .from("locations")
    .insert({ name: body.name, code: body.code.toUpperCase(), address: body.address ?? null, erpnext_company: body.erpnextCompany ?? null, active: true })
    .select().single();
  if (error) return c.json({ error: { message: error.message } }, 400);
  return c.json({ data });
});

adminRouter.patch("/locations/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
  const update: any = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.isActive !== undefined) update.active = body.isActive;
  if (body.address !== undefined) update.address = body.address;
  const { data, error } = await supabaseAdmin.from("locations").update(update).eq("code", id).select().single();
  if (error) return c.json({ error: { message: error.message } }, 400);
  return c.json({ data });
});

adminRouter.get("/overview", async (c) => {
  if (!supabaseAdmin || !lshAdmin) {
    return c.json({ data: { totalUsers: 0, totalLocations: 0, totalCustomers: 0, totalCustomOrders: 0, totalAlterations: 0, totalDeliveries: 0 } });
  }

  const [
    usersRes,
    locationsRes,
    customersRes,
    customOrdersRes,
    alterationsRes,
    deliveriesRes,
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("locations").select("*", { count: "exact", head: true }).eq("active", true),
    supabaseAdmin.from("customers").select("*", { count: "exact", head: true }),
    lshAdmin.from("custom_orders").select("*", { count: "exact", head: true }),
    lshAdmin.from("alterations").select("*", { count: "exact", head: true }),
    lshAdmin.from("deliveries").select("*", { count: "exact", head: true }),
  ]);

  return c.json({
    data: {
      totalUsers: usersRes.count ?? 0,
      totalLocations: locationsRes.count ?? 0,
      totalCustomers: customersRes.count ?? 0,
      totalCustomOrders: customOrdersRes.count ?? 0,
      totalAlterations: alterationsRes.count ?? 0,
      totalDeliveries: deliveriesRes.count ?? 0,
    },
  });
});
