import { Hono } from "hono";
import { supabaseAdmin, lshAdmin } from "../lib/supabase";
import { getAuthedUser, canAccessSuperAdminPortal } from "../lib/scope";

export const referenceRouter = new Hono();

// ─── Serializers ─────────────────────────────────────────────────────────────

function serializeFabric(row: any) {
  return {
    id: row.id,
    fabricName: row.fabric_name,
    mill: row.mill ?? null,
    composition: row.composition ?? null,
    weight: row.weight ?? null,
    season: row.season ?? null,
    tier: row.tier ?? null,
    price: Number(row.price),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeStyle(row: any) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeTailor(row: any) {
  return {
    id: String(row.id),
    name: row.name,
    locationId: row.location_code ?? null,
    isActive: row.active,
    createdAt: row.created_at,
    location: null,
  };
}

// ─── Fabric pricing ──────────────────────────────────────────────────────────

referenceRouter.get("/fabrics", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!lshAdmin) return c.json({ data: [] });

  const { data, error } = await lshAdmin
    .from("fabric_pricing")
    .select("*")
    .eq("is_active", true)
    .order("fabric_name");

  if (error) {
    console.error("fabrics GET error:", error.message);
    return c.json({ data: [] });
  }

  return c.json({ data: (data ?? []).map(serializeFabric) });
});

referenceRouter.post("/fabrics", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!lshAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;

  const { data, error } = await lshAdmin
    .from("fabric_pricing")
    .insert({
      fabric_name: body.fabricName,
      mill: body.mill ?? null,
      composition: body.composition ?? null,
      weight: body.weight ?? null,
      season: body.season ?? null,
      tier: body.tier ?? null,
      price: body.price,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("fabrics POST error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeFabric(data) });
});

referenceRouter.patch("/fabrics/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!lshAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;
  const mapped: Record<string, unknown> = {};
  if (body.fabricName !== undefined) mapped.fabric_name = body.fabricName;
  if (body.mill !== undefined) mapped.mill = body.mill;
  if (body.composition !== undefined) mapped.composition = body.composition;
  if (body.weight !== undefined) mapped.weight = body.weight;
  if (body.season !== undefined) mapped.season = body.season;
  if (body.tier !== undefined) mapped.tier = body.tier;
  if (body.price !== undefined) mapped.price = body.price;
  if (body.isActive !== undefined) mapped.is_active = body.isActive;

  const { data, error } = await lshAdmin
    .from("fabric_pricing")
    .update(mapped)
    .eq("id", c.req.param("id"))
    .select()
    .single();

  if (error) {
    console.error("fabrics PATCH error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeFabric(data) });
});

// ─── Style library ────────────────────────────────────────────────────────────

referenceRouter.get("/styles", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!lshAdmin) return c.json({ data: [] });

  const { data, error } = await lshAdmin
    .from("style_library")
    .select("*")
    .eq("is_active", true)
    .order("category")
    .order("name");

  if (error) {
    console.error("styles GET error:", error.message);
    return c.json({ data: [] });
  }

  return c.json({ data: (data ?? []).map(serializeStyle) });
});

referenceRouter.post("/styles", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!lshAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;

  const { data, error } = await lshAdmin
    .from("style_library")
    .insert({
      category: body.category,
      name: body.name,
      description: body.description ?? null,
      image_url: body.imageUrl ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("styles POST error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeStyle(data) });
});

referenceRouter.patch("/styles/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!lshAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;
  const mapped: Record<string, unknown> = {};
  if (body.category !== undefined) mapped.category = body.category;
  if (body.name !== undefined) mapped.name = body.name;
  if (body.description !== undefined) mapped.description = body.description;
  if (body.imageUrl !== undefined) mapped.image_url = body.imageUrl;
  if (body.isActive !== undefined) mapped.is_active = body.isActive;

  const { data, error } = await lshAdmin
    .from("style_library")
    .update(mapped)
    .eq("id", c.req.param("id"))
    .select()
    .single();

  if (error) {
    console.error("styles PATCH error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeStyle(data) });
});

// ─── Tailors ──────────────────────────────────────────────────────────────────

referenceRouter.get("/tailors", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!supabaseAdmin) return c.json({ data: [] });

  let query = supabaseAdmin
    .from("tailors")
    .select("id,name,active,location_code,specialty,created_at")
    .eq("active", true)
    .order("name");

  if (!canAccessSuperAdminPortal(user.role) && !user.canViewAllLocations && user.locationCode) {
    query = query.eq("location_code", user.locationCode) as typeof query;
  }

  const { data, error } = await query;
  if (error) {
    console.error("tailors GET error:", error.message);
    return c.json({ data: [] });
  }

  return c.json({ data: (data ?? []).map(serializeTailor) });
});

referenceRouter.post("/tailors", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as { name: string; locationId: string };

  const { data, error } = await supabaseAdmin
    .from("tailors")
    .insert({
      name: body.name,
      location_code: body.locationId,
      active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("tailors POST error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeTailor(data) });
});

referenceRouter.patch("/tailors/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;
  const mapped: Record<string, unknown> = {};
  if (body.name !== undefined) mapped.name = body.name;
  if (body.locationId !== undefined) mapped.location_code = body.locationId;
  if (body.isActive !== undefined) mapped.active = body.isActive;
  if (body.specialty !== undefined) mapped.specialty = body.specialty;

  const { data, error } = await supabaseAdmin
    .from("tailors")
    .update(mapped)
    .eq("id", Number(c.req.param("id")))
    .select()
    .single();

  if (error) {
    console.error("tailors PATCH error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: serializeTailor(data) });
});
