// lib/erpnext/customer.ts
// Fixes the "Request failed with status 500" on customer create/update.
// Customer + Address are two separate ERPNext doctypes with different field
// names (address_line1, pincode) and a Dynamic Link. Write them as two calls.

import { erpCreate, erpList, erpUpdate } from "../erp-rest";

export interface CustomerInput {
  name?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  customerGroup?: string;
  territory?: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string; };
}

function customerPayload(c: CustomerInput) {
  return {
    customer_name: c.fullName,
    customer_type: "Individual",
    customer_group: c.customerGroup ?? "MTM",
    territory: c.territory ?? "United States",
    first_name: c.firstName ?? "",
    last_name: c.lastName ?? "",
    mobile_no: c.phone ?? "",
    email_id: c.email ?? "",
    custom_client_notes: c.notes ?? "",
  };
}

function hasAddress(a?: CustomerInput["address"]) {
  return !!a && !!(a.line1 || a.city || a.state || a.zip);
}

async function findCustomerAddress(customerName: string): Promise<string | null> {
  const rows = await erpList<{ name: string }>("Address", {
    filters: [
      ["Dynamic Link", "link_doctype", "=", "Customer"],
      ["Dynamic Link", "link_name", "=", customerName],
    ],
    fields: ["name"],
    limit: 1,
  });
  return rows?.[0]?.name ?? null;
}

async function upsertAddress(customerName: string, a: NonNullable<CustomerInput["address"]>) {
  const payload = {
    address_title: customerName,
    address_type: "Billing",
    address_line1: a.line1 ?? "",
    address_line2: a.line2 ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    pincode: a.zip ?? "",
    country: a.country ?? "United States",
    links: [{ link_doctype: "Customer", link_name: customerName }],
  };
  const existing = await findCustomerAddress(customerName);
  if (existing) {
    await erpUpdate("Address", existing, payload);
  } else {
    await erpCreate("Address", payload);
  }
}

export async function upsertCustomerWithAddress(c: CustomerInput) {
  let customerName = c.name;
  if (customerName) {
    await erpUpdate("Customer", customerName, customerPayload(c));
  } else {
    const created = await erpCreate<{ name: string }>("Customer", customerPayload(c));
    customerName = created?.name;
  }
  if (!customerName) throw new Error("ERPNext did not return a customer name");
  if (hasAddress(c.address)) { await upsertAddress(customerName!, c.address!); }
  return { name: customerName! };
}
