import { Hono } from "hono";
import { upsertCustomerWithAddress, type CustomerInput } from "../lib/erpnext/customer.js";
import { getAuthedUser } from "../lib/scope.js";

export const erpnextCustomersRouter = new Hono();

function parseBody(raw: any): CustomerInput {
  return {
    name: raw.name ?? raw.erpnextName ?? undefined,
    fullName: raw.fullName ?? raw.customerName ?? raw.name_display ?? "",
    firstName: raw.firstName,
    lastName: raw.lastName,
    phone: raw.phone ?? raw.mobile,
    email: raw.email,
    notes: raw.notes,
    customerGroup: raw.customerGroup,
    territory: raw.territory,
    address: raw.address ?? {
      line1: raw.streetLine1, line2: raw.streetLine2, city: raw.city,
      state: raw.state, zip: raw.zip, country: raw.country,
    },
  };
}

async function handle(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  let input: CustomerInput;
  try {
    const body = await c.req.json();
    input = parseBody(body);
  } catch {
    return c.json({ error: { message: "Invalid JSON body" } }, 400);
  }

  if (!input.fullName?.trim()) return c.json({ error: { message: "Customer name is required" } }, 400);

  try {
    const result = await upsertCustomerWithAddress(input);
    return c.json({ data: { ok: true, customer: result.name } });
  } catch (e: any) {
    const status = e?.status && e.status >= 400 && e.status < 500 ? 422 : 500;
    console.error("[erpnext-customers] upsert failed:", e?.message, e);
    return c.json({ error: { message: e?.message ?? "Failed to save customer" } }, status);
  }
}

erpnextCustomersRouter.post("/", handle);
erpnextCustomersRouter.put("/", handle);
