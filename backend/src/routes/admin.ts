// Super Admin Portal endpoints — users management.

import { Hono } from "hono";
import { canAccessSuperAdminPortal, getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpUpdate } from "../lib/erp";
import { listLocations, createLocation, updateLocation } from "../lib/erpnext/locations";

export const adminRouter = new Hono();

// ─── Serializers ──────────────────────────────────────────────────────────────

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

const LST_ROLES = ["LST Super Admin", "LST Store Manager", "LST Salesperson", "LST Driver"];

function mapRole(roles: string[]): string {
  if (roles.includes("LST Super Admin")) return "super_admin";
  if (roles.includes("LST Store Manager")) return "store_manager";
  if (roles.includes("LST Driver")) return "driver";
  if (roles.includes("LST Salesperson")) return "salesperson";
  return "";
}

adminRouter.get("/users", async (c) => {
  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const sec = process.env.ERPNEXT_API_SECRET ?? "";
  if (!base || !key || !sec) return c.json({ data: [] });

  // Fetch all enabled system users
  const users = await erpList<any>("User", {
    filters: [["enabled", "=", 1], ["user_type", "=", "System User"]],
    fields: ["name", "full_name", "lst_location", "enabled"],
    limit: 100,
  });

  // For each user, fetch their roles (erpList doesn't return child tables)
  const detailed = await Promise.all(
    users.map(u => erpGet<any>("User", u.name))
  );

  const result = detailed
    .filter(Boolean)
    .map(u => {
      const roleNames: string[] = (u.roles ?? []).map((r: any) => r.role as string);
      const lstRoles = roleNames.filter(r => LST_ROLES.includes(r));
      if (!lstRoles.length) return null; // skip non-LST users
      return {
        id: u.name,
        name: u.full_name || u.name,
        email: u.name,
        role: mapRole(roleNames),
        locationId: u.lst_location || null,
        location: u.lst_location ? { id: u.lst_location, name: u.lst_location } : null,
        image: null,
        isActive: u.enabled === 1,
      };
    })
    .filter(Boolean);

  return c.json({ data: result });
});

adminRouter.post("/users", async (c) => {
  return c.json({ error: { message: "User creation is managed in ERPNext." } }, 400);
});

adminRouter.patch("/users/:id", async (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));

  const update: Record<string, any> = {};
  if (body.locationId !== undefined) update.lst_location = body.locationId;
  if (body.role !== undefined) {
    const roleMap: Record<string, string> = {
      super_admin: "LST Super Admin",
      store_manager: "LST Store Manager",
      salesperson: "LST Salesperson",
      driver: "LST Driver",
    };
    const lstRole = roleMap[body.role];
    if (lstRole) update.roles = [{ role: lstRole }];
  }
  if (body.isActive !== undefined) update.enabled = body.isActive ? 1 : 0;

  const updated = await erpUpdate<any>("User", id, update);
  if (!updated) return c.json({ error: { message: "Update failed" } }, 500);

  const roleNames: string[] = (updated.roles ?? []).map((r: any) => r.role as string);

  return c.json({
    data: {
      id: updated.name,
      name: updated.full_name || updated.name,
      email: updated.name,
      role: mapRole(roleNames),
      locationId: updated.lst_location || null,
      location: updated.lst_location ? { id: updated.lst_location, name: updated.lst_location } : null,
      image: null,
      isActive: updated.enabled === 1,
    },
  });
});

adminRouter.post("/users/:id/password", (c) => {
  return c.json({ error: { message: "Password changes are managed in ERPNext." } }, 400);
});

adminRouter.post("/locations", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || !body.code) return c.json({ error: { message: "name and code required" } }, 400);
  try {
    const data = await createLocation({
      code: body.code.toUpperCase(),
      name: body.name,
      address: body.address ?? null,
      erpnextCompanyOrBranch: body.erpnextCompany ?? null,
      isActive: true,
    });
    return c.json({ data: serializeLocation({ code: data.location_code, name: data.location_name, address: data.address, erpnext_company: data.erpnext_company, active: data.is_active !== 0, created_at: data.creation, updated_at: data.modified }) });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 400);
  }
});

adminRouter.patch("/locations/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  try {
    const data = await updateLocation(id, {
      name: body.name,
      isActive: body.isActive,
      address: body.address,
    });
    return c.json({ data: serializeLocation({ code: data.location_code, name: data.location_name, address: data.address, erpnext_company: data.erpnext_company, active: data.is_active !== 0, created_at: data.creation, updated_at: data.modified }) });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 400);
  }
});

adminRouter.get("/overview", async (c) => {
  const [users, locations, customers, customOrders, alterations, deliveries] = await Promise.all([
    erpList<any>("User", { filters: [["enabled", "=", 1], ["user_type", "=", "System User"]], fields: ["name"], limit: 500 }).catch(() => []),
    listLocations({ activeOnly: true }),
    erpList<any>("Customer", { filters: [["disabled", "=", 0]], fields: ["name"], limit: 5000 }).catch(() => []),
    erpList<any>("LSH Custom Order", { fields: ["name"], limit: 5000 }).catch(() => []),
    erpList<any>("Alteration Ticket", { fields: ["name"], limit: 5000 }).catch(() => []),
    erpList<any>("LSH Delivery", { fields: ["name"], limit: 5000 }).catch(() => []),
  ]);

  return c.json({
    data: {
      totalUsers: users.length,
      totalLocations: locations.length,
      totalCustomers: customers.length,
      totalCustomOrders: customOrders.length,
      totalAlterations: alterations.length,
      totalDeliveries: deliveries.length,
    },
  });
});
