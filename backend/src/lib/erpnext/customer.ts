// Fixes the "Request failed with status 500" on customer create/update.
// Customer + Address are two separate ERPNext doctypes with different field
// names (address_line1, pincode) and a Dynamic Link. Write them as two calls.

const ERP_URL = process.env.ERP_URL ?? "https://erp.lstailors.com";
const ERP_KEY = process.env.ERP_API_KEY!;
const ERP_SECRET = process.env.ERP_API_SECRET!;

const authHeaders = {
  Authorization: `token ${ERP_KEY}:${ERP_SECRET}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function erpFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ERP_URL}${path}`, { ...init, headers: authHeaders });
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    let msg = body?.exception || body?.message || `ERPNext ${res.status}`;
    try {
      const sm = body?._server_messages ? JSON.parse(body._server_messages) : [];
      if (sm.length) msg = JSON.parse(sm[0])?.message ?? msg;
    } catch {}
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body.data as T;
}

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
  const filters = encodeURIComponent(JSON.stringify([
    ["Dynamic Link", "link_doctype", "=", "Customer"],
    ["Dynamic Link", "link_name", "=", customerName],
  ]));
  const rows = await erpFetch<Array<{ name: string }>>(
    `/api/resource/Address?filters=${filters}&fields=["name"]&limit_page_length=1`
  );
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
    await erpFetch(`/api/resource/Address/${encodeURIComponent(existing)}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await erpFetch(`/api/resource/Address`, { method: "POST", body: JSON.stringify(payload) });
  }
}

export async function upsertCustomerWithAddress(c: CustomerInput) {
  let customerName = c.name;
  if (customerName) {
    await erpFetch(`/api/resource/Customer/${encodeURIComponent(customerName)}`, { method: "PUT", body: JSON.stringify(customerPayload(c)) });
  } else {
    const created = await erpFetch<{ name: string }>(`/api/resource/Customer`, { method: "POST", body: JSON.stringify(customerPayload(c)) });
    customerName = created.name;
  }
  if (hasAddress(c.address)) { await upsertAddress(customerName!, c.address!); }
  return { name: customerName! };
}
