import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { upsertCustomerWithAddress } from "./customer";
import { DT } from "./doctypes";
import { storeFindOne, storeUpsert } from "./store";

const CUSTOMER_FIELDS = [
  "name", "customer_name", "first_name", "last_name", "mobile_no", "email_id",
  "customer_group", "territory", "disabled", "custom_lst_division", "custom_vip_tier",
  "custom_client_notes", "custom_style_preferences", "custom_fit_notes", "custom_company",
  "custom_title_role", "custom_status", "custom_source_channel", "custom_birthday",
  "custom_anniversary", "custom_communication_pref", "custom_preferred_contact",
  "custom_sms_opted_out", "custom_payment_preference", "custom_credit_terms",
  "custom_referral_code", "custom_referral_credits", "custom_casa_tier",
  "creation", "modified",
];

export function serializeCustomer(row: any) {
  return {
    id: row.name,
    customerNumber: row.name,
    name: row.customer_name ?? row.name,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    phone: row.mobile_no ?? null,
    email: row.email_id ?? null,
    company: row.custom_company ?? null,
    titleRole: row.custom_title_role ?? null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    locationId: row.custom_lst_division ?? null,
    status: row.custom_status ?? (row.disabled ? "Archived" : "Active"),
    vipTier: row.custom_vip_tier ?? "Standard",
    sourceChannel: row.custom_source_channel ?? null,
    stylePreferences: row.custom_style_preferences ?? null,
    fitNotes: row.custom_fit_notes ?? null,
    notes: row.custom_client_notes ?? null,
    birthday: row.custom_birthday ?? null,
    anniversary: row.custom_anniversary ?? null,
    tags: [],
    communicationPref: row.custom_communication_pref ?? null,
    preferredContact: row.custom_preferred_contact ?? "email",
    smsOptedOut: !!row.custom_sms_opted_out,
    paymentPreference: row.custom_payment_preference ?? null,
    creditTerms: row.custom_credit_terms ?? null,
    referralCode: row.custom_referral_code ?? null,
    referralCredits: Number(row.custom_referral_credits ?? 0),
    casaTier: row.custom_casa_tier ?? null,
    erpnextCustomerId: row.name,
    createdAt: row.creation,
    updatedAt: row.modified,
  };
}

function bodyToCustomerDoc(body: any, defaults: { division?: string } = {}) {
  return {
    customer_name: body.full_name ?? body.fullName ?? body.customer_name,
    customer_type: "Individual",
    customer_group: body.customer_group ?? "MTM",
    territory: body.territory ?? "United States",
    first_name: body.first_name ?? body.firstName ?? "",
    last_name: body.last_name ?? body.lastName ?? "",
    mobile_no: body.phone ?? body.mobile_no ?? "",
    email_id: body.email ?? body.email_id ?? "",
    custom_lst_division: body.division ?? body.locationId ?? defaults.division ?? "NYC",
    custom_vip_tier: body.vip_tier ?? "Standard",
    custom_status: body.status ?? "Active",
    custom_source_channel: body.source_channel ?? "Walk-In",
    custom_client_notes: body.notes ?? "",
    custom_style_preferences: body.style_preferences ?? null,
    custom_fit_notes: body.fit_notes ?? null,
    custom_company: body.company ?? null,
    custom_title_role: body.title_role ?? null,
    custom_birthday: body.birthday ?? null,
    custom_anniversary: body.anniversary ?? null,
    custom_communication_pref: body.communication_pref ?? null,
    custom_preferred_contact: body.preferred_contact ?? "email",
    custom_sms_opted_out: body.sms_opted_out ? 1 : 0,
    custom_payment_preference: body.payment_preference ?? null,
    custom_credit_terms: body.credit_terms ?? null,
    custom_casa_tier: body.casa_tier ?? null,
    disabled: body.status === "Archived" ? 1 : 0,
  };
}

export async function searchCustomers(q: string, limit = 10) {
  if (q.length < 2) return [];
  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const sec = process.env.ERPNEXT_API_SECRET ?? "";
  if (!base || !key || !sec) return [];

  const searchUrl = `${base}/api/method/frappe.desk.search.search_link?` +
    `txt=${encodeURIComponent(q)}&doctype=Customer&page_length=${limit}`;

  try {
    const res = await fetch(searchUrl, {
      headers: { Authorization: `token ${key}:${sec}`, Accept: "application/json" },
    });
    if (res.ok) {
      const json: any = await res.json();
      const hits: { value: string }[] = json.results ?? json.message ?? [];
      const docs = await Promise.all(hits.map((h) => erpGet<any>("Customer", h.value)));
      return docs.filter(Boolean).map(serializeCustomer);
    }
  } catch { /* fallback below */ }

  const rows = await erpList<any>("Customer", {
    filters: [["customer_name", "like", `%${q}%`]],
    fields: CUSTOMER_FIELDS,
    limit,
  });
  return rows.map(serializeCustomer);
}

export async function listCustomers(opts: {
  q?: string;
  location?: string;
  vip?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const filters: unknown[] = [];
  if (opts.status && opts.status !== "all") {
    filters.push(["custom_status", "=", opts.status]);
  } else {
    filters.push(["disabled", "=", 0]);
  }
  if (opts.vip) filters.push(["custom_vip_tier", "=", opts.vip]);
  if (opts.location) filters.push(["custom_lst_division", "=", opts.location]);
  if (opts.q && opts.q.length >= 2) {
    filters.push(["customer_name", "like", `%${opts.q}%`]);
  }

  const rows = await erpList<any>("Customer", {
    filters,
    fields: CUSTOMER_FIELDS,
    order_by: "customer_name asc",
    limit: opts.limit ?? 100,
  });

  return { data: rows.map(serializeCustomer), total: rows.length };
}

export async function getCustomer(id: string) {
  const row = await erpGet<any>("Customer", id);
  if (!row) return null;
  const dossier = await storeFindOne(DT.CUSTOMER_DOSSIER, "customer", id);
  return { ...serializeCustomer(row), dossier: dossier ?? null };
}

function normalizeEmail(raw?: string | null): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length < 5) return null;
  return e;
}

function normalizePhoneDigits(raw?: string | null): string | null {
  let d = String(raw ?? "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  if (d.length < 10) return null;
  if (/^(\d)\1+$/.test(d)) return null;
  if (["2127521638", "2127511638", "3472911638"].includes(d)) return null;
  return d;
}

function normalizePersonName(raw?: string | null): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+-\s+\d+$/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesCompatible(a?: string | null, b?: string | null): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const pa = na.split(" ").filter(Boolean);
  const pb = nb.split(" ").filter(Boolean);
  if (pa.length && pb.length && pa[pa.length - 1] === pb[pb.length - 1] && pa[0] === pb[0]) return true;
  return false;
}

/** Create-time identity resolve — email → phone → exact name. Active only. */
export async function resolveExistingCustomer(opts: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<{ name: string; match: "email" | "phone" | "name"; row: any } | null> {
  const email = normalizeEmail(opts.email);
  const phone = normalizePhoneDigits(opts.phone);
  const name = String(opts.name ?? "").trim();
  const nameKey = normalizePersonName(name);

  if (email) {
    const rows =
      (await erpList<any>("Customer", {
        filters: [
          ["disabled", "=", 0],
          ["email_id", "=", email],
        ],
        fields: CUSTOMER_FIELDS,
        limit: 5,
      }).catch(() => [])) || [];
    if (rows[0]?.name) return { name: rows[0].name, match: "email", row: rows[0] };
  }

  if (phone) {
    const rows =
      (await erpList<any>("Customer", {
        filters: [
          ["disabled", "=", 0],
          ["mobile_no", "like", `%${phone}%`],
        ],
        fields: CUSTOMER_FIELDS,
        limit: 25,
      }).catch(() => [])) || [];
    const matched = rows.filter((r) => normalizePhoneDigits(r.mobile_no) === phone);
    if (matched.length === 1 && namesCompatible(name, matched[0].customer_name || matched[0].name)) {
      return { name: matched[0].name, match: "phone", row: matched[0] };
    }
    if (matched.length > 1) {
      const byName = matched.find((r) => namesCompatible(name, r.customer_name || r.name));
      if (byName) return { name: byName.name, match: "phone", row: byName };
    }
  }

  if (nameKey && nameKey.length >= 3) {
    const rows =
      (await erpList<any>("Customer", {
        filters: [
          ["disabled", "=", 0],
          ["customer_name", "=", name],
        ],
        fields: CUSTOMER_FIELDS,
        limit: 5,
      }).catch(() => [])) || [];
    if (rows.length === 1) return { name: rows[0].name, match: "name", row: rows[0] };
  }

  return null;
}

export async function createCustomer(body: any, defaults: { division?: string } = {}) {
  const doc = bodyToCustomerDoc(body, defaults);
  if (!doc.customer_name) throw new Error("Customer name is required");

  const existing = await resolveExistingCustomer({
    email: body.email ?? body.email_id ?? (doc as any).email_id,
    phone: body.phone ?? body.mobile_no ?? (doc as any).mobile_no,
    name: String((doc as any).customer_name ?? ""),
  });
  if (existing) {
    const serialized = serializeCustomer(existing.row);
    (serialized as any).reusedFromDedupe = true;
    (serialized as any).dedupeMatch = existing.match;
    return serialized;
  }

  const created = await erpCreate<any>("Customer", doc);
  if (!created) throw new Error("Failed to create customer");

  if (body.address || body.city) {
    await upsertCustomerWithAddress({
      name: created.name,
      fullName: created.customer_name,
      phone: body.phone,
      email: body.email,
      address: {
        line1: body.address,
        city: body.city,
        state: body.state,
        zip: body.zip_code,
      },
    }).catch(() => {});
  }

  const serialized = serializeCustomer(created);
  (serialized as any).reusedFromDedupe = false;
  return serialized;
}

export async function updateCustomer(id: string, body: any) {
  const doc = bodyToCustomerDoc(body);
  const updated = await erpUpdate<any>("Customer", id, doc);
  if (!updated) throw new Error("Failed to update customer");
  return serializeCustomer(updated);
}

export async function upsertCustomerDossier(customerId: string, body: Record<string, unknown>) {
  const dossierDoc: Record<string, unknown> = {
    customer: customerId,
    dossier_json: JSON.stringify(body),
  };
  for (const key of [
    "style_preferences", "fit_notes_structured", "preferences_likes", "preferences_dislikes",
    "fabric_interests", "life_events", "important_dates", "family_context", "travel_context",
    "professional_context", "tone_preferences", "communication_style", "open_action_items", "notable_quotes",
  ]) {
    if (body[key] !== undefined) {
      dossierDoc[`lsh_${key}`] = typeof body[key] === "object" ? JSON.stringify(body[key]) : body[key];
    }
  }
  return storeUpsert(DT.CUSTOMER_DOSSIER, dossierDoc, "customer");
}

export async function archiveCustomer(id: string) {
  await erpUpdate("Customer", id, { custom_status: "Archived", disabled: 1 });
}

export async function getCustomersByIds(ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const rows = await erpList<any>("Customer", {
    filters: [["name", "in", ids]],
    fields: CUSTOMER_FIELDS,
    limit: ids.length,
  });
  return new Map(rows.map((r) => [r.name, r]));
}

export async function findCustomerByPhone(phone: string) {
  const rows = await erpList<any>("Customer", {
    filters: [["mobile_no", "=", phone]],
    fields: CUSTOMER_FIELDS,
    limit: 1,
  });
  return rows[0] ?? null;
}
