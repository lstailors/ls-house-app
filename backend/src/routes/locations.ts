import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, canAccessSuperAdminPortal } from "../lib/scope";

export const locationsRouter = new Hono();

function serializeLocation(loc: any) {
  return {
    id: loc.code,
    code: loc.code,
    name: loc.name,
    shortName: loc.short_name ?? null,
    address: loc.address ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    postalCode: loc.postal_code ?? null,
    phone: loc.phone ?? null,
    twilioNumber: loc.twilio_number ?? null,
    timezone: loc.timezone ?? null,
    erpnextCompanyOrBranch: loc.erpnext_company ?? null,
    erpnextWarehouse: loc.erpnext_warehouse ?? null,
    erpArAccount: loc.erp_ar_account ?? null,
    erpSquareAccount: loc.erp_square_account ?? null,
    squareLocationId: loc.square_location_id ?? null,
    defaultDepositPct: loc.default_deposit_pct ?? 50,
    calComCalendarId: loc.cal_com_calendar_id ?? null,
    isActive: loc.active ?? true,
    sortOrder: loc.sort_order ?? 0,
    openedOn: loc.opened_on ?? null,
    createdAt: loc.created_at,
    updatedAt: loc.updated_at,
  };
}

locationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  // Super admins see all (including inactive); others see only active + their location
  let query = supabaseAdmin.from("locations").select("*").order("sort_order");

  if (!canAccessSuperAdminPortal(user.role) && !user.canViewAllLocations) {
    query = query.eq("active", true) as typeof query;
    if (user.locationCode) {
      query = query.eq("code", user.locationCode) as typeof query;
    } else {
      return c.json({ data: [] });
    }
  }

  const { data, error } = await query;
  if (error) return c.json({ data: [] });
  return c.json({ data: (data ?? []).map(serializeLocation) });
});

locationsRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = await c.req.json() as Record<string, unknown>;
  if (!body.code || !body.name) return c.json({ error: { message: "code and name are required" } }, 400);

  const { data, error } = await supabaseAdmin
    .from("locations")
    .insert(mapBodyToRow(body))
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data: serializeLocation(data) });
});

locationsRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const code = c.req.param("id");
  const body = await c.req.json() as Record<string, unknown>;

  const { data, error } = await supabaseAdmin
    .from("locations")
    .update(mapBodyToRow(body))
    .eq("code", code)
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data: serializeLocation(data) });
});

function mapBodyToRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    code: "code", name: "name", shortName: "short_name",
    address: "address", city: "city", state: "state", postalCode: "postal_code",
    phone: "phone", twilioNumber: "twilio_number", timezone: "timezone",
    erpnextCompanyOrBranch: "erpnext_company", erpnextWarehouse: "erpnext_warehouse",
    erpArAccount: "erp_ar_account", erpSquareAccount: "erp_square_account",
    squareLocationId: "square_location_id", defaultDepositPct: "default_deposit_pct",
    calComCalendarId: "cal_com_calendar_id", isActive: "active",
    sortOrder: "sort_order", openedOn: "opened_on",
  };
  for (const [jsKey, dbCol] of Object.entries(map)) {
    if (body[jsKey] !== undefined) row[dbCol] = body[jsKey];
  }
  return row;
}
