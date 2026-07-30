import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { upsertCustomerWithAddress } from "./customer";
import { DT } from "./doctypes";
import { storeFindOne, storeUpsert } from "./store";
import { erpFileAbsoluteUrl } from "./files";

/** Fields safe for Customer list queries (live ERP schema — not invented custom_*). */
const CUSTOMER_LIST_FIELDS = [
  "name",
  "customer_name",
  "first_name",
  "last_name",
  "mobile_no",
  "email_id",
  "customer_group",
  "territory",
  "disabled",
  "image",
  "vip_flag",
  "preferred_name",
  "profession",
  "casa_membership",
  "lifetime_value",
  "total_garments_owned",
  "legacy_customer_number",
  "creation",
  "modified",
];

export function serializeCustomer(row: any) {
  const vip = !!row.vip_flag;
  const imageRaw = row.image || null;
  const notes =
    row.custom_client_notes ||
    row.customer_details ||
    row.lifestyle_notes ||
    null;

  // Inline measurements from Customer L&S fields (detail get always has these)
  const measurements: Record<string, number | null> = {};
  const pushMeas = (key: string, raw: unknown) => {
    if (raw == null || raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) return;
    measurements[key] = n;
  };
  pushMeas("chest", row.lsh_chest);
  pushMeas("hips", row.lsh_seat);
  pushMeas("back_length", row.lsh_back_length);
  pushMeas("outseam", row.lsh_outseam);

  return {
    id: row.name,
    customerNumber: row.legacy_customer_number ?? row.name,
    name: row.customer_name ?? row.name,
    preferredName: row.preferred_name ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    phone: row.mobile_no || null,
    email: row.email_id || null,
    company: row.home_company ?? null,
    titleRole: row.profession ?? null,
    profession: row.profession ?? null,
    pronouns: row.pronouns ?? null,
    address: null as string | null,
    city: null as string | null,
    state: null as string | null,
    zipCode: null as string | null,
    primaryAddressText: row.primary_address ?? null,
    locationId: null as string | null,
    status: row.disabled ? "Archived" : "Active",
    vipTier: vip ? "VIP" : "Standard",
    vipFlag: vip,
    sourceChannel: null as string | null,
    stylePreferences: row.style_notes ?? null,
    fitNotes: row.fit_notes ?? null,
    lifestyleNotes: row.lifestyle_notes ?? null,
    notes,
    birthday: row.date_of_birth ?? null,
    anniversary: row.anniversary_date ?? null,
    tags: [] as string[],
    communicationPref: null as string | null,
    preferredContact: row.preferred_contact ?? "email",
    smsOptIn: row.sms_opt_in == null ? true : !!row.sms_opt_in,
    smsOptedOut: row.sms_opt_in == null ? false : !row.sms_opt_in,
    paymentPreference: row.payment_preference ?? null,
    creditTerms: null as string | null,
    referralCode: row.referral_code ?? null,
    referralCredits: 0,
    casaTier: row.casa_membership ?? null,
    lifetimeValue: Number(row.lifetime_value ?? 0),
    totalGarmentsOwned: Number(row.total_garments_owned ?? 0),
    image: imageRaw ? erpFileAbsoluteUrl(String(imageRaw)) : null,
    imagePath: imageRaw ? String(imageRaw) : null,
    measurements: Object.keys(measurements).length ? measurements : null,
    photos: row.lsh_photos ? String(row.lsh_photos) : null,
    customerGroup: row.customer_group ?? null,
    territory: row.territory ?? null,
    erpnextCustomerId: row.name,
    createdAt: row.creation,
    updatedAt: row.modified,
    // Multi-contact (filled by getCustomer enrichment)
    phones: [] as any[],
    emails: [] as any[],
    addresses: [] as any[],
    people: [] as any[],
  };
}

/** Partial ERP doc from API body — only sets keys that were provided. */
function bodyToCustomerDoc(body: any, defaults: { division?: string } = {}) {
  const doc: Record<string, unknown> = {
    customer_type: "Individual",
  };

  const name = body.full_name ?? body.fullName ?? body.customer_name ?? body.name;
  if (name !== undefined) doc.customer_name = name;
  if (body.customer_group !== undefined) doc.customer_group = body.customer_group;
  else if (name !== undefined) doc.customer_group = "MTM";
  if (body.territory !== undefined) doc.territory = body.territory;
  else if (name !== undefined) doc.territory = "United States";

  // Contact on Customer is mostly mirrored from primary Contact; still accept writes
  // for callers that only touch Customer (Contact patch is intake multi-edit).
  if (body.phone !== undefined || body.mobile_no !== undefined) {
    doc.mobile_no = body.phone ?? body.mobile_no ?? "";
  }
  if (body.email !== undefined || body.email_id !== undefined) {
    doc.email_id = body.email ?? body.email_id ?? "";
  }

  if (body.preferred_name !== undefined) doc.preferred_name = body.preferred_name;
  if (body.profession !== undefined || body.title_role !== undefined) {
    doc.profession = body.profession ?? body.title_role ?? "";
  }
  if (body.pronouns !== undefined) doc.pronouns = body.pronouns;

  if (body.notes !== undefined) {
    doc.custom_client_notes = body.notes;
    doc.customer_details = body.notes;
  }
  if (body.style_preferences !== undefined) doc.style_notes = body.style_preferences;
  if (body.fit_notes !== undefined) doc.fit_notes = body.fit_notes;
  if (body.lifestyle_notes !== undefined) doc.lifestyle_notes = body.lifestyle_notes;

  if (body.birthday !== undefined) doc.date_of_birth = body.birthday || null;
  if (body.anniversary !== undefined) doc.anniversary_date = body.anniversary || null;

  if (body.preferred_contact !== undefined) doc.preferred_contact = body.preferred_contact;
  if (body.payment_preference !== undefined) doc.payment_preference = body.payment_preference;
  if (body.casa_tier !== undefined) doc.casa_membership = body.casa_tier;
  if (body.referral_code !== undefined) doc.referral_code = body.referral_code;

  if (body.sms_opted_out !== undefined) {
    doc.sms_opt_in = body.sms_opted_out ? 0 : 1;
  } else if (body.sms_opt_in !== undefined) {
    doc.sms_opt_in = body.sms_opt_in ? 1 : 0;
  }

  // VIP: accept vip_flag boolean or vip_tier string
  if (body.vip_flag !== undefined) {
    doc.vip_flag = body.vip_flag ? 1 : 0;
  } else if (body.vip_tier !== undefined) {
    const t = String(body.vip_tier);
    doc.vip_flag = t === "Standard" || t === "" || t === "false" ? 0 : 1;
  }

  if (body.status !== undefined) {
    doc.disabled = body.status === "Archived" || body.status === "Inactive" ? 1 : 0;
  }

  if (body.image !== undefined) doc.image = body.image;

  // Measurements
  if (body.measurements && typeof body.measurements === "object") {
    const m = body.measurements as Record<string, unknown>;
    if (m.chest !== undefined) doc.lsh_chest = m.chest;
    if (m.hips !== undefined || m.seat !== undefined) doc.lsh_seat = m.hips ?? m.seat;
    if (m.back_length !== undefined) doc.lsh_back_length = m.back_length;
    if (m.outseam !== undefined) doc.lsh_outseam = m.outseam;
  }
  if (body.lsh_chest !== undefined) doc.lsh_chest = body.lsh_chest;
  if (body.lsh_seat !== undefined) doc.lsh_seat = body.lsh_seat;
  if (body.lsh_back_length !== undefined) doc.lsh_back_length = body.lsh_back_length;
  if (body.lsh_outseam !== undefined) doc.lsh_outseam = body.lsh_outseam;

  void defaults;
  return doc;
}

async function loadLinkedContactsAndAddresses(customerId: string) {
  const linkFilter: unknown[] = [
    ["Dynamic Link", "link_doctype", "=", "Customer"],
    ["Dynamic Link", "link_name", "=", customerId],
  ];

  const [contactRows, addrRows, cust] = await Promise.all([
    erpList<any>("Contact", {
      filters: linkFilter,
      fields: [
        "name",
        "first_name",
        "last_name",
        "full_name",
        "mobile_no",
        "phone",
        "email_id",
        "designation",
        "is_primary_contact",
      ],
      limit: 20,
    }).catch(() => [] as any[]),
    erpList<any>("Address", {
      filters: linkFilter,
      fields: [
        "name",
        "address_title",
        "address_type",
        "address_line1",
        "address_line2",
        "city",
        "state",
        "pincode",
        "country",
        "is_primary_address",
        "is_shipping_address",
        "disabled",
        "phone",
        "email_id",
      ],
      limit: 20,
    }).catch(() => [] as any[]),
    erpGet<any>("Customer", customerId),
  ]);

  const people: any[] = [];
  const phones: any[] = [];
  const emails: any[] = [];
  let primaryContact: any = null;

  for (const row of contactRows ?? []) {
    let full: any = row;
    try {
      const got = await erpGet<any>("Contact", row.name);
      if (got) full = got;
    } catch {
      /* keep list row */
    }

    const name =
      full.full_name ||
      [full.first_name, full.last_name].filter(Boolean).join(" ") ||
      row.name;
    const roleRaw = String(full.designation || "").trim();
    const isPrimary =
      !!full.is_primary_contact ||
      full.name === cust?.customer_primary_contact ||
      (!cust?.customer_primary_contact && people.length === 0 && !roleRaw);
    const role =
      isPrimary && !/assistant/i.test(roleRaw)
        ? "Client"
        : roleRaw || (isPrimary ? "Client" : "Other");

    people.push({
      id: full.name,
      name,
      role,
      phone: full.mobile_no || full.phone || "",
      email: full.email_id || "",
      isPrimary,
    });

    if (isPrimary || full.name === cust?.customer_primary_contact) primaryContact = full;

    const phoneRows = Array.isArray(full.phone_nos) ? full.phone_nos : [];
    for (const p of phoneRows) {
      const num = String(p.phone || "").trim();
      if (!num) continue;
      phones.push({
        id: p.name || undefined,
        number: num,
        label: p.is_primary_mobile_no ? "Mobile" : p.is_primary_phone ? "Phone" : "Other",
        isPrimary: !!(p.is_primary_mobile_no || p.is_primary_phone),
        contactId: full.name,
      });
    }
    if (full.mobile_no && !phones.some((p) => p.number === full.mobile_no && p.contactId === full.name)) {
      phones.push({
        number: full.mobile_no,
        label: "Mobile",
        isPrimary: isPrimary && !phones.some((p) => p.isPrimary),
        contactId: full.name,
      });
    }
    if (
      full.phone &&
      full.phone !== full.mobile_no &&
      !phones.some((p) => p.number === full.phone && p.contactId === full.name)
    ) {
      phones.push({
        number: full.phone,
        label: "Work",
        isPrimary: false,
        contactId: full.name,
      });
    }

    const emailRows = Array.isArray(full.email_ids) ? full.email_ids : [];
    for (const e of emailRows) {
      const em = String(e.email_id || "").trim();
      if (!em) continue;
      emails.push({
        id: e.name || undefined,
        email: em,
        isPrimary: !!e.is_primary,
        contactId: full.name,
      });
    }
    if (full.email_id && !emails.some((e) => e.email === full.email_id && e.contactId === full.name)) {
      emails.push({
        email: full.email_id,
        isPrimary: isPrimary && !emails.some((e) => e.isPrimary),
        contactId: full.name,
      });
    }
  }

  const addresses = (addrRows ?? [])
    .filter((a: any) => !a.disabled)
    .map((a: any) => ({
      id: a.name,
      title: a.address_title || a.address_type || "",
      type: a.address_type || "Personal",
      line1: a.address_line1 || "",
      line2: a.address_line2 || "",
      city: a.city || "",
      state: a.state || "",
      zip: a.pincode || "",
      country: a.country || "United States",
      isBilling: !!a.is_primary_address || a.name === cust?.customer_primary_address,
      isShipping: !!a.is_shipping_address,
    }));

  return { people, phones, emails, addresses, primaryContact, cust };
}

export async function searchCustomers(q: string, limit = 10) {
  if (q.length < 2) return [];
  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const sec = process.env.ERPNEXT_API_SECRET ?? "";
  if (!base || !key || !sec) return [];

  const searchUrl =
    `${base}/api/method/frappe.desk.search.search_link?` +
    `txt=${encodeURIComponent(q)}&doctype=Customer&page_length=${limit}`;

  try {
    const res = await fetch(searchUrl, {
      headers: {
        Authorization: `token ${key}:${sec}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0)",
      },
    });
    if (res.ok) {
      const json: any = await res.json();
      const hits: { value: string }[] = json.results ?? json.message ?? [];
      const docs = await Promise.all(hits.map((h) => erpGet<any>("Customer", h.value)));
      return docs.filter(Boolean).map(serializeCustomer);
    }
  } catch {
    /* fallback below */
  }

  const rows = await erpList<any>("Customer", {
    filters: [["customer_name", "like", `%${q}%`]],
    fields: CUSTOMER_LIST_FIELDS,
    limit,
  });
  return rows.map(serializeCustomer);
}

export async function listCustomers(
  opts: {
    q?: string;
    location?: string;
    vip?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const filters: unknown[] = [];
  if (opts.status === "Archived" || opts.status === "Inactive") {
    filters.push(["disabled", "=", 1]);
  } else if (opts.status && opts.status !== "all") {
    // Active (default)
    filters.push(["disabled", "=", 0]);
  } else if (!opts.status || opts.status === "Active") {
    filters.push(["disabled", "=", 0]);
  }

  if (opts.vip && opts.vip !== "All" && opts.vip !== "Standard") {
    filters.push(["vip_flag", "=", 1]);
  } else if (opts.vip === "Standard") {
    filters.push(["vip_flag", "=", 0]);
  }

  if (opts.q && opts.q.length >= 2) {
    filters.push(["customer_name", "like", `%${opts.q}%`]);
  }

  // location filter not on live Customer (no custom_lst_division) — ignore quietly
  void opts.location;

  const rows = await erpList<any>("Customer", {
    filters,
    fields: CUSTOMER_LIST_FIELDS,
    order_by: "customer_name asc",
    limit: opts.limit ?? 100,
    start: opts.offset ?? 0,
  });

  return { data: rows.map(serializeCustomer), total: rows.length };
}

export async function getCustomer(id: string) {
  const row = await erpGet<any>("Customer", id);
  if (!row) return null;

  const [dossier, linked] = await Promise.all([
    storeFindOne(DT.CUSTOMER_DOSSIER, "customer", id).catch(() => null),
    loadLinkedContactsAndAddresses(id),
  ]);

  const base = serializeCustomer(row);

  // Prefer linked contact phone/email when Customer mirrors are empty
  const phone =
    base.phone ||
    linked.phones.find((p) => p.isPrimary)?.number ||
    linked.primaryContact?.mobile_no ||
    null;
  const email =
    base.email ||
    linked.emails.find((e) => e.isPrimary)?.email ||
    linked.primaryContact?.email_id ||
    null;

  const primaryAddr =
    linked.addresses.find((a) => a.isBilling) ||
    linked.addresses.find((a) => a.isShipping) ||
    linked.addresses[0] ||
    null;

  return {
    ...base,
    phone,
    email,
    address: primaryAddr?.line1 ?? null,
    city: primaryAddr?.city ?? null,
    state: primaryAddr?.state ?? null,
    zipCode: primaryAddr?.zip ?? null,
    phones: linked.phones,
    emails: linked.emails,
    addresses: linked.addresses,
    people: linked.people,
    dossier: dossier ?? null,
  };
}

export async function createCustomer(body: any, defaults: { division?: string } = {}) {
  const doc = bodyToCustomerDoc(body, defaults);
  if (!doc.customer_name) throw new Error("Customer name is required");
  if (!doc.customer_group) doc.customer_group = "MTM";
  if (!doc.territory) doc.territory = "United States";

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

  return getCustomer(created.name);
}

export async function updateCustomer(id: string, body: any) {
  const doc = bodyToCustomerDoc(body);
  // erpUpdate merges; drop empty customer_type-only shells
  delete doc.customer_type;
  if (Object.keys(doc).length === 0) {
    const existing = await getCustomer(id);
    if (!existing) throw new Error("Customer not found");
    return existing;
  }

  const updated = await erpUpdate<any>("Customer", id, doc);
  if (!updated) throw new Error("Failed to update customer");

  // Single-address convenience write from profile basic edit
  if (body.address || body.city || body.state || body.zip_code) {
    await upsertCustomerWithAddress({
      name: id,
      fullName: updated.customer_name ?? id,
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

  return getCustomer(id);
}

export async function setCustomerImage(id: string, imageUrl: string) {
  await erpUpdate("Customer", id, { image: imageUrl });
  return getCustomer(id);
}

export async function upsertCustomerDossier(customerId: string, body: Record<string, unknown>) {
  const dossierDoc: Record<string, unknown> = {
    customer: customerId,
    dossier_json: JSON.stringify(body),
  };
  for (const key of [
    "style_preferences",
    "fit_notes_structured",
    "preferences_likes",
    "preferences_dislikes",
    "fabric_interests",
    "life_events",
    "important_dates",
    "family_context",
    "travel_context",
    "professional_context",
    "tone_preferences",
    "communication_style",
    "open_action_items",
    "notable_quotes",
  ]) {
    if (body[key] !== undefined) {
      dossierDoc[`lsh_${key}`] = typeof body[key] === "object" ? JSON.stringify(body[key]) : body[key];
    }
  }
  return storeUpsert(DT.CUSTOMER_DOSSIER, dossierDoc, "customer");
}

export async function archiveCustomer(id: string) {
  await erpUpdate("Customer", id, { disabled: 1 });
}

export async function getCustomersByIds(ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const rows = await erpList<any>("Customer", {
    filters: [["name", "in", ids]],
    fields: CUSTOMER_LIST_FIELDS,
    limit: ids.length,
  });
  return new Map(rows.map((r) => [r.name, r]));
}

export async function findCustomerByPhone(phone: string) {
  const rows = await erpList<any>("Customer", {
    filters: [["mobile_no", "=", phone]],
    fields: CUSTOMER_LIST_FIELDS,
    limit: 1,
  });
  return rows[0] ?? null;
}
