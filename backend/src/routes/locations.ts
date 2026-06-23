import { Hono } from "hono";
import { getAuthedUser, canAccessSuperAdminPortal } from "../lib/scope";
import { erpUpdate } from "../lib/erp";
import {
  listLocations,
  getLocationByCode,
  createLocation,
  updateLocation,
  getLocationCompany,
  serializeLocation,
} from "../lib/erpnext/locations";

export const locationsRouter = new Hono();

locationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    if (!canAccessSuperAdminPortal(user.role) && !user.canViewAllLocations) {
      if (!user.locationCode) return c.json({ data: [] });
      const locations = await listLocations({ activeOnly: true, code: user.locationCode });
      return c.json({ data: locations.map(serializeLocation) });
    }
    const locations = await listLocations();
    return c.json({ data: locations.map(serializeLocation) });
  } catch {
    return c.json({ data: [] });
  }
});

locationsRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const body = await c.req.json() as Record<string, unknown>;
  if (!body.code || !body.name) return c.json({ error: { message: "code and name are required" } }, 400);

  try {
    const data = await createLocation(body);
    return c.json({ data: serializeLocation(data) });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to create location" } }, 500);
  }
});

locationsRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const code = c.req.param("id");
  const body = await c.req.json() as Record<string, unknown>;

  try {
    const data = await updateLocation(code, body);
    return c.json({ data: serializeLocation(data) });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to update location" } }, 500);
  }
});

locationsRouter.get("/:code/settings", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)
  if (!canAccessSuperAdminPortal(user.role)) return c.json({ error: { message: "Forbidden" } }, 403)

  const code = c.req.param("code")
  const loc = await getLocationByCode(code)
  if (!loc) return c.json({ error: { message: "Location not found" } }, 404)

  const erp = await getLocationCompany(code).catch(() => null)

  return c.json({ data: {
    code: loc.location_code,
    name: loc.location_name,
    shortName: loc.short_name ?? null,
    address: loc.address ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    postalCode: loc.postal_code ?? null,
    phone: loc.phone ?? null,
    twilioNumber: loc.twilio_number ?? null,
    timezone: loc.timezone ?? null,
    isActive: loc.is_active !== 0,
    sortOrder: loc.sort_order ?? 0,
    defaultDepositPct: loc.default_deposit_pct ?? 50,
    squareLocationId: loc.square_location_id ?? null,
    calComCalendarId: loc.cal_com_calendar_id ?? null,
    erpnextCompany: loc.erpnext_company ?? null,
    erpnextWarehouse: loc.erpnext_warehouse ?? null,
    erpArAccount: loc.erp_ar_account ?? null,
    erp: erp ? {
      abbr: erp.abbr,
      defaultCurrency: erp.default_currency,
      country: erp.country,
      taxId: erp.tax_id ?? null,
      email: erp.email ?? null,
      website: erp.website ?? null,
      phoneNo: erp.phone_no ?? null,
      defaultBankAccount: erp.default_bank_account ?? null,
      defaultCashAccount: erp.default_cash_account ?? null,
      defaultReceivableAccount: erp.default_receivable_account ?? null,
      defaultIncomeAccount: erp.default_income_account ?? null,
      defaultExpenseAccount: erp.default_expense_account ?? null,
      costCenter: erp.cost_center ?? null,
      monthlyTarget: erp.monthly_sales_target ?? 0,
      totalMonthlySales: erp.total_monthly_sales ?? 0,
      parentCompany: erp.parent_company ?? null,
    } : null,
  }})
})

locationsRouter.put("/:code/settings", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)
  if (!canAccessSuperAdminPortal(user.role)) return c.json({ error: { message: "Forbidden" } }, 403)

  const code = c.req.param("code")
  const body = await c.req.json() as any

  const updateBody: Record<string, unknown> = {}
  const fieldMap: Record<string, string> = {
    name: "name", shortName: "shortName", address: "address", city: "city",
    state: "state", postalCode: "postalCode", phone: "phone",
    twilioNumber: "twilioNumber", timezone: "timezone", isActive: "isActive",
    defaultDepositPct: "defaultDepositPct", squareLocationId: "squareLocationId",
    calComCalendarId: "calComCalendarId", erpnextWarehouse: "erpnextWarehouse",
    erpArAccount: "erpArAccount", sortOrder: "sortOrder",
  }
  for (const [jsKey, bodyKey] of Object.entries(fieldMap)) {
    if (body[jsKey] !== undefined) updateBody[bodyKey] = body[jsKey]
  }

  let loc
  try {
    loc = await updateLocation(code, updateBody)
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to update location" } }, 500)
  }

  let erpSynced = false
  if (loc.erpnext_company && body.erp) {
    const erpPayload: Record<string, unknown> = {}
    if (body.phone !== undefined) erpPayload.phone_no = body.phone
    if (body.erp.email !== undefined) erpPayload.email = body.erp.email
    if (body.erp.website !== undefined) erpPayload.website = body.erp.website
    if (body.erp.taxId !== undefined) erpPayload.tax_id = body.erp.taxId
    if (body.erp.monthlyTarget !== undefined) erpPayload.monthly_sales_target = body.erp.monthlyTarget
    if (body.erp.defaultBankAccount !== undefined) erpPayload.default_bank_account = body.erp.defaultBankAccount
    if (body.erp.defaultIncomeAccount !== undefined) erpPayload.default_income_account = body.erp.defaultIncomeAccount
    if (body.erp.costCenter !== undefined) erpPayload.cost_center = body.erp.costCenter

    if (Object.keys(erpPayload).length > 0) {
      await erpUpdate("Company", loc.erpnext_company, erpPayload)
        .then(() => { erpSynced = true })
        .catch(() => {})
    }
  }

  return c.json({ data: { ...serializeLocation(loc), erpSynced } })
})
