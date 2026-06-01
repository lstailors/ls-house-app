import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, canReadCustomer } from "../lib/scope";

export const customersRouter = new Hono();

function serializeCustomer(row: any) {
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone ?? null,
    email: row.email ?? null,
    locationId: row.division ?? null,
    createdById: null,
    dossier: {
      vip: row.vip_tier !== "Standard",
      preferences: row.style_preferences ?? null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/customers/search?q=  — fuzzy search via pg_trgm similarity
customersRouter.get("/search", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });

  // pg_trgm similarity across name, phone, email — threshold 0.1 keeps it
  // generous enough for short queries while filtering pure noise.
  const { data, error } = await supabaseAdmin.rpc("search_customers_fuzzy", {
    p_query: q,
    p_limit: 10,
  });

  if (error) {
    // Fallback to ilike if the RPC doesn't exist yet
    const { data: fallback } = await supabaseAdmin
      .from("customers")
      .select("id,full_name,phone,email,division,vip_tier,created_at,updated_at")
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      .neq("status", "Archived")
      .order("updated_at", { ascending: false })
      .limit(10);
    return c.json({ data: (fallback ?? []).map(serializeCustomer) });
  }

  return c.json({ data: (data ?? []).map(serializeCustomer) });
});

customersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  if (!supabaseAdmin) return c.json({ data: [] });

  let query = supabaseAdmin
    .from("customers")
    .select("id,full_name,phone,email,company,division,status,vip_tier,style_preferences,fit_notes,created_at,updated_at")
    .order("full_name")
    .limit(200);

  if (user.locationCode && user.role !== "super_admin" && !user.canViewAllLocations) {
    query = query.eq("division", user.locationCode) as typeof query;
  }

  const { data, error } = await query;
  if (error) {
    console.error("customers GET error:", error.message);
    return c.json({ data: [] });
  }

  return c.json({ data: (data ?? []).map(serializeCustomer) });
});

customersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!supabaseAdmin) return c.json({ data: [] });

  const { data: row, error } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);

  if (!canReadCustomer(user, row)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  return c.json({ data: serializeCustomer(row) });
});
