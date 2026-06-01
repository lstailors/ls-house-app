import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

export const meRouter = new Hono();

function serializeLocation(loc: any) {
  if (!loc) return null;
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

meRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!supabaseAdmin) {
    return c.json({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        locationId: user.supabaseLocationId,
        location: null,
        image: null,
        isActive: true,
      },
    });
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,email,avatar_url,phone,status,home_location,can_view_all_locations")
    .eq("email", user.email)
    .single();

  if (error || !profile) {
    return c.json({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        locationId: user.supabaseLocationId,
        location: null,
        image: null,
        isActive: true,
      },
    });
  }

  let location = null;
  if (profile.home_location) {
    const { data: loc } = await supabaseAdmin
      .from("locations")
      .select("code,name,address,erpnext_company,active,created_at,updated_at")
      .eq("code", profile.home_location)
      .single();
    location = serializeLocation(loc);
  }

  return c.json({
    data: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: user.role,
      locationId: user.supabaseLocationId,
      location,
      image: profile.avatar_url ?? null,
      isActive: profile.status === "active",
    },
  });
});

meRouter.patch("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json()) as { name?: string; image?: string };

  if (!supabaseAdmin) {
    return c.json({ error: { message: "Service unavailable" } }, 503);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.full_name = body.name;
  if (body.image !== undefined) updates.avatar_url = body.image;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.email !== undefined) updates.email = body.email;

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("email", user.email);

  if (updateError) {
    console.error("me PATCH update error:", updateError.message);
    return c.json({ error: { message: "Update failed" } }, 500);
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,email,avatar_url,phone,status,home_location,can_view_all_locations")
    .eq("email", user.email)
    .single();

  let location = null;
  if (profile?.home_location) {
    const { data: loc } = await supabaseAdmin
      .from("locations")
      .select("code,name,address,erpnext_company,active,created_at,updated_at")
      .eq("code", profile.home_location)
      .single();
    location = serializeLocation(loc);
  }

  return c.json({
    data: {
      id: profile?.id ?? user.id,
      name: profile?.full_name ?? user.name,
      email: profile?.email ?? user.email,
      role: user.role,
      locationId: user.supabaseLocationId,
      location,
      image: profile?.avatar_url ?? null,
      isActive: profile?.status === "active",
    },
  });
});

meRouter.post("/password", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (!password || password.length < 8) {
    return c.json({ error: { message: "Password must be at least 8 characters" } }, 400);
  }

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
  if (error) return c.json({ error: { message: error.message } }, 400);

  return c.json({ data: { ok: true } });
});
