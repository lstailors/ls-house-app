import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, canReadCustomer } from "../lib/scope";
import { erpCreate, erpUpdate } from "../lib/erp";

export const customersRouter = new Hono();

function serializeCustomer(row: any) {
  return {
    id: row.id,
    customerNumber: row.customer_number ?? null,
    name: row.full_name,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    company: row.company ?? null,
    titleRole: row.title_role ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zipCode: row.zip_code ?? null,
    locationId: row.division ?? null,
    status: row.status ?? 'Active',
    vipTier: row.vip_tier ?? 'Standard',
    sourceChannel: row.source_channel ?? null,
    stylePreferences: row.style_preferences ?? null,
    fitNotes: row.fit_notes ?? null,
    notes: row.notes ?? null,
    birthday: row.birthday ?? null,
    anniversary: row.anniversary ?? null,
    tags: row.tags ?? [],
    communicationPref: row.communication_pref ?? null,
    preferredContact: row.preferred_contact ?? 'email',
    smsOptedOut: row.sms_opted_out ?? false,
    paymentPreference: row.payment_preference ?? null,
    creditTerms: row.credit_terms ?? null,
    referralCode: row.referral_code ?? null,
    referralCredits: Number(row.referral_credits ?? 0),
    casaTier: row.casa_tier ?? null,
    erpnextCustomerId: row.erpnext_customer_id ?? null,
    erpnextName: row.erpnext_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/customers/search?q=
customersRouter.get("/search", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });

  const { data, error } = await supabaseAdmin.rpc("search_customers_fuzzy", {
    p_query: q,
    p_limit: 10,
  });

  if (error) {
    const { data: fallback } = await supabaseAdmin
      .from("customers")
      .select("id,customer_number,full_name,phone,email,division,vip_tier,status,company,erpnext_name,created_at,updated_at")
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      .neq("status", "Archived")
      .order("updated_at", { ascending: false })
      .limit(10);
    return c.json({ data: (fallback ?? []).map(serializeCustomer) });
  }

  return c.json({ data: (data ?? []).map(serializeCustomer) });
});

// GET /api/customers?q=&location=&vip=&status=&limit=&offset=
customersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });
  if (!supabaseAdmin) return c.json({ data: [] });

  const q = (c.req.query("q") ?? "").trim();
  const locationFilter = c.req.query("location") ?? "";
  const vipFilter = c.req.query("vip") ?? "";
  const statusFilter = c.req.query("status") ?? "Active";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100"), 500);
  const offset = parseInt(c.req.query("offset") ?? "0");

  let query = supabaseAdmin
    .from("customers")
    .select("id,customer_number,full_name,first_name,last_name,phone,email,company,title_role,division,status,vip_tier,style_preferences,fit_notes,notes,birthday,anniversary,tags,communication_pref,preferred_contact,sms_opted_out,payment_preference,credit_terms,referral_code,referral_credits,casa_tier,erpnext_customer_id,source_channel,created_at,updated_at", { count: 'exact' })
    .order("full_name")
    .range(offset, offset + limit - 1);

  if (statusFilter && statusFilter !== 'all') query = query.eq("status", statusFilter) as typeof query;
  if (vipFilter) query = query.eq("vip_tier", vipFilter) as typeof query;

  // Location scoping
  if (user.role !== "super_admin" && !user.canViewAllLocations) {
    if (user.locationCode) query = query.eq("division", user.locationCode) as typeof query;
  } else if (locationFilter) {
    query = query.eq("division", locationFilter) as typeof query;
  }

  if (q.length >= 2) {
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`) as typeof query;
  }

  const { data, error, count } = await query;
  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json({ data: (data ?? []).map(serializeCustomer), total: count ?? 0 });
});

// GET /api/customers/:id
customersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const { data: row, error } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  if (!canReadCustomer(user, row)) return c.json({ error: { message: "Forbidden" } }, 403);

  // Also fetch dossier
  const { data: dossier } = await supabaseAdmin
    .from("customer_dossiers")
    .select("*")
    .eq("customer_id", row.id)
    .single();

  const serialized = serializeCustomer(row);
  return c.json({ data: { ...serialized, dossier: dossier ?? null } });
});

// POST /api/customers
customersRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;
  if (!body.full_name) return c.json({ error: { message: "full_name is required" } }, 400);

  const insert: Record<string, any> = {
    full_name: body.full_name,
    first_name: body.first_name ?? null,
    last_name: body.last_name ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    company: body.company ?? null,
    title_role: body.title_role ?? null,
    address: body.address ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    zip_code: body.zip_code ?? null,
    division: body.division ?? user.locationCode ?? 'NYC',
    vip_tier: body.vip_tier ?? 'Standard',
    status: 'Active',
    source_channel: body.source_channel ?? 'Walk-In',
    notes: body.notes ?? null,
    style_preferences: body.style_preferences ?? null,
    fit_notes: body.fit_notes ?? null,
    birthday: body.birthday ?? null,
    anniversary: body.anniversary ?? null,
    tags: body.tags ?? [],
    communication_pref: body.communication_pref ?? null,
    preferred_contact: body.preferred_contact ?? 'email',
  };

  const { data, error } = await supabaseAdmin.from("customers").insert(insert).select("*").single();
  if (error) return c.json({ error: { message: error.message } }, 500);

  // Sync to ERPNext (non-blocking) and link back erpnext_name
  void erpCreate("Customer", {
    customer_name: body.full_name,
    customer_type: "Individual",
    customer_group: "Bespoke",
    territory: insert.division === "HOU" ? "Texas" : "New York",
    mobile_no: body.phone ?? null,
    email_id: body.email ?? null,
  }).then(erp => {
    if (erp?.name && supabaseAdmin) {
      supabaseAdmin.from("customers").update({ erpnext_name: erp.name }).eq("id", data.id).then().catch(() => {});
    }
  }).catch(() => {});

  return c.json({ data: serializeCustomer(data) }, 201);
});

// PATCH /api/customers/:id
customersRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;

  // Only map allowed fields
  const allowed = [
    'full_name','first_name','last_name','email','phone','company','title_role',
    'address','city','state','zip_code','division','vip_tier','status',
    'style_preferences','fit_notes','notes','birthday','anniversary','tags',
    'communication_pref','preferred_contact','sms_opted_out','payment_preference',
    'credit_terms','casa_tier','source_channel',
  ];

  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: { message: "No fields to update" } }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("customers")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return c.json({ error: { message: error.message } }, 500);

  // Sync to ERPNext (non-blocking) using stored erpnext_name
  if (data?.erpnext_name) {
    void erpUpdate("Customer", data.erpnext_name, {
      mobile_no: update.phone ?? undefined,
      email_id: update.email ?? undefined,
    }).catch(() => {});
  }

  return c.json({ data: serializeCustomer(data) });
});

// PATCH /api/customers/:id/dossier — update dossier (upsert)
customersRouter.patch("/:id/dossier", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;

  const dossierFields: Record<string, any> = { customer_id: id };
  const allowed = [
    'style_preferences','fit_notes_structured','preferences_likes','preferences_dislikes',
    'fabric_interests','life_events','important_dates','family_context','travel_context',
    'professional_context','tone_preferences','communication_style','open_action_items','notable_quotes',
  ];
  for (const key of allowed) {
    if (body[key] !== undefined) dossierFields[key] = body[key];
  }

  const { data, error } = await supabaseAdmin
    .from("customer_dossiers")
    .upsert(dossierFields, { onConflict: 'customer_id' })
    .select("*")
    .single();

  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data });
});

// DELETE /api/customers/:id — soft delete (set status=Archived)
customersRouter.delete("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden — super_admin only" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const { error } = await supabaseAdmin
    .from("customers")
    .update({ status: 'Archived' })
    .eq("id", c.req.param("id"));

  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data: { ok: true } });
});
