import { Hono } from "hono";
import { upsertCustomerWithAddress, type CustomerInput } from "../lib/erpnext/customer";
import { getAuthedUser } from "../lib/scope";
import { erpGet, erpList } from "../lib/erp";

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

// GET /api/erpnext-customers/:name — fetch customer and address from ERPNext
erpnextCustomersRouter.get("/:name", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const name = c.req.param("name");
  if (!name) return c.json({ error: { message: "Customer name is required" } }, 400);

  try {
    const customer = await erpGet<any>("Customer", name);
    if (!customer) return c.json({ error: { message: "Customer not found" } }, 404);

    // Fetch customer's address from ERPNext Address doctype
    let address = null;
    const addresses = await erpList<any>("Address", {
      filters: [
        ["Dynamic Link", "link_doctype", "=", "Customer"],
        ["Dynamic Link", "link_name", "=", name],
      ],
      fields: ["address_line1", "address_line2", "city", "state", "pincode"],
      limit: 1,
    });

    if (addresses.length > 0) {
      address = {
        line1: addresses[0].address_line1 ?? null,
        line2: addresses[0].address_line2 ?? null,
        city: addresses[0].city ?? null,
        state: addresses[0].state ?? null,
        zip: addresses[0].pincode ?? null,
      };
    }

    return c.json({
      data: {
        name: customer.name,
        fullName: customer.customer_name,
        phone: customer.mobile_no ?? null,
        email: customer.email_id ?? null,
        address,
      },
    });
  } catch (e: any) {
    console.error("[erpnext-customers GET] error:", e?.message);
    return c.json({ error: { message: e?.message ?? "Failed to fetch customer" } }, 500);
  }
});

erpnextCustomersRouter.post("/", handle);
erpnextCustomersRouter.put("/", handle);
