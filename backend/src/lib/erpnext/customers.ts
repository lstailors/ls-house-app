import { erpList, erpGet, erpCreate, erpUpdate, erpCount } from "../erp";
import { upsertCustomerWithAddress } from "./customer";
import { DT } from "./doctypes";
import { storeFindOne, storeUpsert } from "./store";
import { erpFileAbsoluteUrl } from "./files";
import { assertNoPanInCustomerFields, containsPan, stripPan } from "../pci-guard";
import { flagsForCustomer, safeDisplayName } from "../customer-quality";

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
  const rawName = row.customer_name ?? row.name;
  const displayName = safeDisplayName(rawName);
  const notesRaw =
    row.custom_client_notes ||
    row.customer_details ||
    row.lifestyle_notes ||
    null;
  const notes =
    typeof notesRaw === "string" && containsPan(notesRaw) ? stripPan(notesRaw) || null : notesRaw;

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
    name: displayName,
    preferredName: containsPan(row.preferred_name) ? null : row.preferred_name ?? null,
    firstName: containsPan(row.first_name) ? null : row.first_name ?? null,
    lastName: containsPan(row.last_name) ? null : row.last_name ?? null,
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
    reviewFlags: flagsForCustomer({
      id: row.name,
      customer_name: row.customer_name,
      email_id: row.email_id,
      mobile_no: row.mobile_no,
      customer_details: row.customer_details,
    }),
    displayName,
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

/**
 * Full-book customer search (ERP fuzzy link search + name/phone/email fallbacks).
 * Used by GET /api/customers/search and by listCustomers() when ?q= is present —
 * always searches the FULL book (ignores pagination), not just the currently
 * loaded page, so a real client never comes back "No clients found" just
 * because they weren't in the first 100/500 rows.
 */
export async function searchCustomers(q: string, limit = 40) {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const sec = process.env.ERPNEXT_API_SECRET ?? "";
  const byId = new Map<string, any>();

  const take = (rows: any[]) => {
    for (const row of rows) {
      if (!row?.name || byId.has(row.name)) continue;
      byId.set(row.name, row);
      if (byId.size >= limit) break;
    }
  };

  // 1) Frappe link search — fuzzy on Customer name + configured search fields
  if (base && key && sec) {
    const searchUrl =
      `${base}/api/method/frappe.desk.search.search_link?` +
      `txt=${encodeURIComponent(needle)}&doctype=Customer&page_length=${limit}`;
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
        const docs = await Promise.all(
          hits.slice(0, limit).map((h) => erpGet<any>("Customer", h.value).catch(() => null)),
        );
        take(docs.filter(Boolean));
      }
    } catch {
      /* fall through to LIKE-based fallbacks below */
    }
  }

  // 2) Name / preferred name / first / last — LIKE, or-grouped
  if (byId.size < limit) {
    const nameOr: unknown[] = [
      ["customer_name", "like", `%${needle}%`],
      ["preferred_name", "like", `%${needle}%`],
      ["first_name", "like", `%${needle}%`],
      ["last_name", "like", `%${needle}%`],
    ];
    try {
      const rows = await erpList<any>("Customer", {
        or_filters: nameOr,
        fields: CUSTOMER_LIST_FIELDS,
        limit,
        order_by: "customer_name asc",
      });
      take(rows);
    } catch {
      const rows = await erpList<any>("Customer", {
        filters: [["customer_name", "like", `%${needle}%`]],
        fields: CUSTOMER_LIST_FIELDS,
        limit,
      });
      take(rows);
    }
  }

  // 3) Phone digits (mobile_no)
  const digits = needle.replace(/\D/g, "");
  if (byId.size < limit && digits.length >= 4) {
    try {
      const rows = await erpList<any>("Customer", {
        or_filters: [
          ["mobile_no", "like", `%${digits}%`],
          ["mobile_no", "like", `%${digits.slice(-10)}%`],
        ],
        fields: CUSTOMER_LIST_FIELDS,
        limit,
      });
      take(rows);
    } catch {
      const rows = await erpList<any>("Customer", {
        filters: [["mobile_no", "like", `%${digits}%`]],
        fields: CUSTOMER_LIST_FIELDS,
        limit,
      });
      take(rows);
    }
  }

  // 4) Email
  if (byId.size < limit && needle.includes("@")) {
    const rows = await erpList<any>("Customer", {
      filters: [["email_id", "like", `%${needle}%`]],
      fields: CUSTOMER_LIST_FIELDS,
      limit,
    });
    take(rows);
  }

  // 5) Company / home_company
  if (byId.size < limit) {
    const rows = await erpList<any>("Customer", {
      filters: [["home_company", "like", `%${needle}%`]],
      fields: CUSTOMER_LIST_FIELDS,
      limit,
    });
    take(rows);
  }

  // 6) Legacy customer number (exact-ish, digits only)
  if (byId.size < limit && digits.length >= 2) {
    const rows = await erpList<any>("Customer", {
      filters: [["legacy_customer_number", "like", `%${digits}%`]],
      fields: CUSTOMER_LIST_FIELDS,
      limit,
    });
    take(rows);
  }

  return Array.from(byId.values()).slice(0, limit).map(serializeCustomer);
}

export async function listCustomers(
  opts: {
    q?: string;
    location?: string;
    vip?: string;
    casa?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = (opts.q ?? "").trim();

  // Search path — always searches the FULL book (fuzzy, multi-field), then
  // applies vip/status as client-side filters on the matched set. This is
  // what fixes "500 clients loaded, search finds nobody" — search never
  // depends on what page happened to be loaded.
  if (q.length >= 2) {
    let data = await searchCustomers(q, limit);
    if (opts.status === "Archived" || opts.status === "Inactive") {
      data = data.filter((c) => c.status === "Archived" || c.status === "Inactive");
    } else if (opts.status && opts.status !== "all") {
      data = data.filter((c) => c.status !== "Archived" && c.status !== "Inactive");
    }
    if (opts.vip && opts.vip !== "All" && opts.vip !== "Standard") {
      data = data.filter((c) => c.vipFlag || (c.vipTier && c.vipTier !== "Standard"));
    } else if (opts.vip === "Standard") {
      data = data.filter((c) => !c.vipFlag && (!c.vipTier || c.vipTier === "Standard"));
    }
    if (opts.casa && opts.casa !== "All" && opts.casa !== "0") {
      data = data.filter((c) => !!c.casaTier);
    }
    void opts.location;
    return { data, total: data.length, mode: "search" as const };
  }

  const filters: unknown[] = [];
  if (opts.status === "Archived" || opts.status === "Inactive") {
    filters.push(["disabled", "=", 1]);
  } else if (!opts.status || opts.status === "all") {
    // no disabled filter — show everyone
  } else {
    // Active (default)
    filters.push(["disabled", "=", 0]);
  }

  if (opts.vip && opts.vip !== "All" && opts.vip !== "Standard") {
    filters.push(["vip_flag", "=", 1]);
  } else if (opts.vip === "Standard") {
    filters.push(["vip_flag", "=", 0]);
  }

  if (opts.casa && opts.casa !== "All" && opts.casa !== "0") {
    filters.push(["casa_membership", "is", "set"]);
  }

  // location filter not on live Customer (no custom_lst_division) — ignore quietly
  void opts.location;

  const [rows, total] = await Promise.all([
    erpList<any>("Customer", {
      filters,
      fields: CUSTOMER_LIST_FIELDS,
      order_by: "customer_name asc",
      limit,
      start: offset,
    }),
    erpCount("Customer", filters),
  ]);

  return {
    data: rows.map(serializeCustomer),
    total: total || rows.length,
    mode: "browse" as const,
  };
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
    linked.addresses.find((a) => a.isShipping) ||
    linked.addresses.find((a) => a.isBilling) ||
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

/**
 * Live spend stats + recent invoice history from ERP Sales Invoices.
 * ERP Customer.lifetime_value is often stale/zero — always compute from SI.
 */
export async function getCustomerSpend(customerId: string, historyLimit = 40) {
  const id = customerId.trim();
  if (!id) {
    return emptySpend();
  }

  // Pull up to 500 submitted SIs so totals aren't capped to the UI history page.
  // History returned to the client is sliced to historyLimit.
  const rows = await erpList<any>("Sales Invoice", {
    filters: [
      ["customer", "=", id],
      ["docstatus", "=", 1],
    ],
    fields: [
      "name",
      "customer",
      "customer_name",
      "status",
      "grand_total",
      "total",
      "outstanding_amount",
      "paid_amount",
      "posting_date",
      "due_date",
      "currency",
      "remarks",
      "company",
    ],
    limit: 500,
    order_by: "posting_date desc",
  });

  let lifetimeInvoiced = 0;
  let lifetimePaid = 0;
  let outstanding = 0;
  let unpaidCount = 0;
  let overdueCount = 0;
  let paidCount = 0;
  let lastPurchaseDate: string | null = null;

  const history = rows.map((row) => {
    const status = String(row.status || "").toLowerCase();
    const grand = Number(row.grand_total ?? row.total ?? 0);
    const out = Number(row.outstanding_amount ?? 0);
    // NOTE: ERPNext's paid_amount on Sales Invoice is not reliably populated
    // here (payments are tracked via Payment Entry, not always mirrored back
    // to the invoice doc) — it comes back as a literal 0 even on fully-paid
    // invoices. Derive paid from grand_total - outstanding instead, which is
    // always correct regardless of whether paid_amount was set.
    const rawPaid = Number(row.paid_amount ?? 0);
    const paid = rawPaid > 0 ? rawPaid : Math.max(0, grand - out);

    lifetimeInvoiced += grand;
    lifetimePaid += paid;
    outstanding += out;

    if (status === "paid") paidCount += 1;
    if (["unpaid", "overdue", "partly paid"].includes(status) || out > 0.009) unpaidCount += 1;
    if (status === "overdue") overdueCount += 1;
    if (!lastPurchaseDate && row.posting_date) lastPurchaseDate = String(row.posting_date);

    return {
      id: row.name,
      status: status.replace(/\s+/g, "_"),
      total: grand,
      outstandingAmount: out,
      paidAmount: paid,
      postingDate: row.posting_date ?? null,
      dueDate: row.due_date ?? null,
      company: row.company ?? null,
      currency: row.currency ?? "USD",
      remarks: row.remarks ?? null,
    };
  });

  const invoiceCount = rows.length;
  const avgOrder = invoiceCount > 0 ? lifetimeInvoiced / invoiceCount : 0;

  // Ticket count (alterations) — soft fail
  let ticketCount = 0;
  try {
    ticketCount = await erpCount("Alteration Ticket", [["customer", "=", id]]);
  } catch {
    ticketCount = 0;
  }

  const histCap = Math.min(Math.max(historyLimit, 1), 100);
  return {
    customerId: id,
    lifetimeInvoiced: round2(lifetimeInvoiced),
    lifetimePaid: round2(lifetimePaid),
    outstanding: round2(outstanding),
    avgOrder: round2(avgOrder),
    invoiceCount,
    paidCount,
    unpaidCount,
    overdueCount,
    ticketCount,
    lastPurchaseDate,
    history: history.slice(0, histCap),
  };
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function emptySpend() {
  return {
    customerId: "",
    lifetimeInvoiced: 0,
    lifetimePaid: 0,
    outstanding: 0,
    avgOrder: 0,
    invoiceCount: 0,
    paidCount: 0,
    unpaidCount: 0,
    overdueCount: 0,
    ticketCount: 0,
    lastPurchaseDate: null as string | null,
    history: [] as any[],
  };
}

/** Normalize email for identity match (lowercase trim). */
export function normalizeEmail(raw?: string | null): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length < 5) return null;
  return e;
}

/** Last 10 digits; drop trivial / known shop lines. */
export function normalizePhoneDigits(raw?: string | null): string | null {
  let d = String(raw ?? "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  if (d.length < 10) return null;
  if (/^(\d)\1+$/.test(d)) return null;
  // House / known non-person lines — never treat as client identity
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
  if (!na || !nb) return true; // missing name is not a conflict
  if (na === nb) return true;
  // one contains the other (Alger vs Eleanor Alger)
  if (na.includes(nb) || nb.includes(na)) return true;
  const pa = na.split(" ").filter(Boolean);
  const pb = nb.split(" ").filter(Boolean);
  if (pa.length && pb.length && pa[pa.length - 1] === pb[pb.length - 1] && pa[0] === pb[0]) return true;
  return false;
}

/**
 * Create-time identity resolve — email → phone → exact name.
 * Active customers only. No fuzzy email/name search.
 */
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
    // Exact case variants; ERP stores as entered
    const rows =
      (await erpList<any>("Customer", {
        filters: [
          ["disabled", "=", 0],
          ["email_id", "=", email],
        ],
        fields: CUSTOMER_LIST_FIELDS,
        limit: 5,
      }).catch(() => [])) || [];
    let hit = rows[0];
    if (!hit) {
      // try original casing from caller
      const raw = String(opts.email ?? "").trim();
      if (raw && raw !== email) {
        const rows2 =
          (await erpList<any>("Customer", {
            filters: [
              ["disabled", "=", 0],
              ["email_id", "=", raw],
            ],
            fields: CUSTOMER_LIST_FIELDS,
            limit: 5,
          }).catch(() => [])) || [];
        hit = rows2[0];
      }
    }
    if (hit?.name) return { name: hit.name, match: "email", row: hit };
  }

  if (phone) {
    // LIKE last-10 — mobile_no may be +1… formatted
    const rows =
      (await erpList<any>("Customer", {
        filters: [
          ["disabled", "=", 0],
          ["mobile_no", "like", `%${phone}%`],
        ],
        fields: CUSTOMER_LIST_FIELDS,
        limit: 25,
      }).catch(() => [])) || [];
    const matched = rows.filter((r) => normalizePhoneDigits(r.mobile_no) === phone);
    if (matched.length === 1) {
      const only = matched[0];
      if (namesCompatible(name, only.customer_name || only.name)) {
        return { name: only.name, match: "phone", row: only };
      }
    } else if (matched.length > 1) {
      const byName = matched.filter((r) => namesCompatible(name, r.customer_name || r.name));
      const pick = byName[0] || null;
      if (pick) return { name: pick.name, match: "phone", row: pick };
    }
  }

  // Exact name only when unique among active (post-cleanup book has unique names)
  if (nameKey && nameKey.length >= 3) {
    const rows =
      (await erpList<any>("Customer", {
        filters: [
          ["disabled", "=", 0],
          ["customer_name", "=", name],
        ],
        fields: CUSTOMER_LIST_FIELDS,
        limit: 5,
      }).catch(() => [])) || [];
    if (rows.length === 1) {
      return { name: rows[0].name, match: "name", row: rows[0] };
    }
    // case-insensitive fallback via like then filter
    if (!rows.length) {
      const loose =
        (await erpList<any>("Customer", {
          filters: [
            ["disabled", "=", 0],
            ["customer_name", "like", name],
          ],
          fields: CUSTOMER_LIST_FIELDS,
          limit: 10,
        }).catch(() => [])) || [];
      const exact = loose.filter((r) => normalizePersonName(r.customer_name) === nameKey);
      if (exact.length === 1) {
        return { name: exact[0].name, match: "name", row: exact[0] };
      }
    }
  }

  return null;
}

async function enrichExistingCustomerContact(
  id: string,
  body: any,
): Promise<void> {
  const email = normalizeEmail(body.email ?? body.email_id);
  const phoneRaw = body.phone ?? body.mobile_no;
  const phoneDigits = normalizePhoneDigits(phoneRaw);
  if (!email && !phoneDigits) return;

  try {
    const cur = await erpGet<any>("Customer", id);
    if (!cur) return;
    const needEmail = email && !normalizeEmail(cur.email_id);
    const needPhone = phoneDigits && normalizePhoneDigits(cur.mobile_no) !== phoneDigits;
    // only fill empties — never overwrite a different live phone/email
    if (!needEmail && !(needPhone && !normalizePhoneDigits(cur.mobile_no))) return;

    await updateCustomerContactBook(id, {
      email: needEmail ? email! : undefined,
      phone:
        needPhone && !normalizePhoneDigits(cur.mobile_no)
          ? String(phoneRaw)
          : undefined,
    }).catch(() => {});
  } catch {
    /* non-fatal */
  }
}

export async function createCustomer(body: any, defaults: { division?: string } = {}) {
  assertNoPanInCustomerFields(body);
  const doc = bodyToCustomerDoc(body, defaults);
  if (!doc.customer_name) throw new Error("Customer name is required");
  if (!doc.customer_group) doc.customer_group = "MTM";
  if (!doc.territory) doc.territory = "United States";

  const email = (body.email ?? body.email_id ?? doc.email_id) as string | undefined;
  const phone = (body.phone ?? body.mobile_no ?? doc.mobile_no) as string | undefined;
  const personName = String(doc.customer_name);

  const existing = await resolveExistingCustomer({
    email,
    phone,
    name: personName,
  });
  if (existing) {
    await enrichExistingCustomerContact(existing.name, body);
    if (body.address || body.city) {
      await upsertCustomerWithAddress({
        name: existing.name,
        fullName: personName,
        phone,
        email,
        address: {
          line1: body.address,
          city: body.city,
          state: body.state,
          zip: body.zip_code,
        },
      }).catch(() => {});
    }
    const row = await getCustomer(existing.name);
    if (row && typeof row === "object") {
      (row as any).reusedFromDedupe = true;
      (row as any).dedupeMatch = existing.match;
    }
    return row;
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

  const row = await getCustomer(created.name);
  if (row && typeof row === "object") {
    (row as any).reusedFromDedupe = false;
  }
  return row;
}

/**
 * Two-way contact book write — Contact (+ phone_nos / email_ids) + Address rows.
 * Customer.mobile_no / email_id are Read Only mirrors; always write Contact.
 */
export async function updateCustomerContactBook(
  id: string,
  body: {
    phone?: string;
    email?: string;
    preferred_name?: string;
    preferred_contact?: string;
    sms_opt_in?: boolean | number;
    phones?: Array<{ number: string; label?: string; isPrimary?: boolean }>;
    emails?: Array<{ email: string; isPrimary?: boolean }>;
    addresses?: Array<{
      id?: string;
      title?: string;
      type?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
      isBilling?: boolean;
      isShipping?: boolean;
      _delete?: boolean;
    }>;
    address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string; title?: string; type?: string };
  },
) {
  const cust = await erpGet<any>("Customer", id);
  if (!cust) throw new Error("Customer not found");

  const custName = cust.customer_name || id;
  const nameParts = String(custName).split(/\s+/);
  const firstName = nameParts[0] || custName;
  const lastName = nameParts.slice(1).join(" ") || "";
  const linkFilter = [
    ["Dynamic Link", "link_doctype", "=", "Customer"],
    ["Dynamic Link", "link_name", "=", id],
  ];

  // Customer-level profile prefs (writable on Customer)
  const custPatch: Record<string, unknown> = {};
  if (body.preferred_name !== undefined) custPatch.preferred_name = body.preferred_name;
  if (body.preferred_contact !== undefined) custPatch.preferred_contact = body.preferred_contact;
  if (body.sms_opt_in !== undefined) custPatch.sms_opt_in = body.sms_opt_in ? 1 : 0;
  if (Object.keys(custPatch).length) {
    await erpUpdate("Customer", id, custPatch);
  }

  async function ensurePrimaryContact(): Promise<string | null> {
    if (cust.customer_primary_contact) return String(cust.customer_primary_contact);
    const contacts = await erpList<any>("Contact", {
      filters: linkFilter,
      fields: ["name", "is_primary_contact"],
      limit: 5,
    }).catch(() => [] as any[]);
    const hit = (contacts ?? []).find((x: any) => x.is_primary_contact) || contacts?.[0];
    if (hit?.name) {
      await erpUpdate("Customer", id, { customer_primary_contact: hit.name });
      return hit.name;
    }
    const created = await erpCreate<any>("Contact", {
      first_name: firstName,
      last_name: lastName,
      is_primary_contact: 1,
      links: [{ link_doctype: "Customer", link_name: id }],
    });
    const cname = created?.name;
    if (cname) {
      await erpUpdate("Customer", id, { customer_primary_contact: cname });
    }
    return cname || null;
  }

  let phoneList = body.phones;
  if (!phoneList && body.phone !== undefined) {
    phoneList = String(body.phone || "").trim()
      ? [{ number: String(body.phone).trim(), label: "Mobile", isPrimary: true }]
      : [];
  }
  let emailList = body.emails;
  if (!emailList && body.email !== undefined) {
    emailList = String(body.email || "").trim()
      ? [{ email: String(body.email).trim(), isPrimary: true }]
      : [];
  }

  if (phoneList || emailList) {
    const contactId = await ensurePrimaryContact();
    if (contactId) {
      const patch: Record<string, unknown> = {};
      if (phoneList) {
        const cleaned = phoneList
          .map((p) => ({
            number: String(p.number || "").trim(),
            label: p.label || "Mobile",
            isPrimary: !!p.isPrimary,
          }))
          .filter((p) => p.number);
        // Deduplicate numbers; exactly one primary mobile
        const seen = new Set<string>();
        const uniq = cleaned.filter((p) => {
          const k = p.number.replace(/\D/g, "") || p.number;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        let primaryIdx = uniq.findIndex((p) => p.isPrimary);
        if (primaryIdx < 0) primaryIdx = 0;
        uniq.forEach((p, i) => {
          p.isPrimary = i === primaryIdx;
        });
        const primary = uniq[primaryIdx];
        patch.mobile_no = primary?.number || "";
        patch.phone = uniq.find((p) => !p.isPrimary)?.number || "";
        patch.phone_nos = uniq.map((p) => ({
          phone: p.number,
          is_primary_mobile_no: p.isPrimary ? 1 : 0,
          is_primary_phone: 0,
        }));
      }
      if (emailList) {
        const cleaned = emailList
          .map((e) => ({
            email: String(e.email || "").trim().toLowerCase(),
            isPrimary: !!e.isPrimary,
          }))
          .filter((e) => e.email);
        const seen = new Set<string>();
        const uniq = cleaned.filter((e) => {
          if (seen.has(e.email)) return false;
          seen.add(e.email);
          return true;
        });
        let primaryIdx = uniq.findIndex((e) => e.isPrimary);
        if (primaryIdx < 0) primaryIdx = 0;
        uniq.forEach((e, i) => {
          e.isPrimary = i === primaryIdx;
        });
        patch.email_id = uniq[primaryIdx]?.email || uniq[0]?.email || "";
        patch.email_ids = uniq.map((e) => ({
          email_id: e.email,
          is_primary: e.isPrimary ? 1 : 0,
        }));
      }
      await erpUpdate("Contact", contactId, patch);
    }
  }

  let addressList = body.addresses;
  if (!addressList && body.address) {
    addressList = [{ ...body.address, type: body.address.type || "Personal", isBilling: true, isShipping: true }];
  }
  if (addressList) {
    let primaryAddrName: string | null = null;
    for (const a of addressList) {
      if (a._delete && a.id) {
        await erpUpdate("Address", a.id, { disabled: 1 }).catch(() => {});
        continue;
      }
      if (!(a.line1 || "").trim() && !(a.city || "").trim()) continue;

      const addrPayload: Record<string, unknown> = {
        address_title: (a.title || a.type || custName).trim() || custName,
        address_type: a.type || "Personal",
        address_line1: a.line1 || "",
        address_line2: a.line2 || "",
        city: a.city || "New York",
        state: a.state || "",
        pincode: a.zip || "",
        country: a.country || "United States",
        is_primary_address: a.isBilling ? 1 : 0,
        is_shipping_address: a.isShipping ? 1 : 0,
        links: [{ link_doctype: "Customer", link_name: id }],
      };

      if (a.id) {
        await erpUpdate("Address", a.id, addrPayload);
        if (a.isBilling) primaryAddrName = a.id;
      } else {
        const created = await erpCreate<any>("Address", addrPayload);
        const aname = created?.name;
        if (a.isBilling && aname) primaryAddrName = aname;
      }
    }
    if (primaryAddrName) {
      await erpUpdate("Customer", id, { customer_primary_address: primaryAddrName });
    }
  }

  return getCustomer(id);
}

export async function updateCustomer(id: string, body: any) {
  assertNoPanInCustomerFields(body);
  const doc = bodyToCustomerDoc(body);
  // erpUpdate merges; drop empty customer_type-only shells
  delete doc.customer_type;

  const hasContactBook =
    body.phones !== undefined ||
    body.emails !== undefined ||
    body.addresses !== undefined ||
    body.phone !== undefined ||
    body.email !== undefined ||
    body.address ||
    body.city ||
    body.state ||
    body.zip_code;

  if (Object.keys(doc).length > 0) {
    const updated = await erpUpdate<any>("Customer", id, doc);
    if (!updated) throw new Error("Failed to update customer");
  } else if (!hasContactBook) {
    const existing = await getCustomer(id);
    if (!existing) throw new Error("Customer not found");
    return existing;
  }

  // Multi phone/email/address — canonical Contact + Address path
  if (
    body.phones !== undefined ||
    body.emails !== undefined ||
    body.addresses !== undefined ||
    body.phone !== undefined ||
    body.email !== undefined
  ) {
    return updateCustomerContactBook(id, body);
  }

  // Single-address convenience write from profile basic edit
  if (body.address || body.city || body.state || body.zip_code) {
    const existing = await erpGet<any>("Customer", id);
    await updateCustomerContactBook(id, {
      phone: body.phone,
      email: body.email,
      address: {
        line1: body.address,
        city: body.city,
        state: body.state,
        zip: body.zip_code,
      },
    }).catch(async () => {
      await upsertCustomerWithAddress({
        name: id,
        fullName: existing?.customer_name ?? id,
        phone: body.phone,
        email: body.email,
        address: {
          line1: body.address,
          city: body.city,
          state: body.state,
          zip: body.zip_code,
        },
      }).catch(() => {});
    });
  }

  return getCustomer(id);
}

/** Resolve ERP Customer id for a portal login email (or phone). */
export async function findCustomerIdForPortalUser(opts: {
  email?: string | null;
  phone?: string | null;
}): Promise<string | null> {
  const email = (opts.email || "").trim().toLowerCase();
  const phoneDigits = String(opts.phone || "").replace(/\D/g, "");

  if (email) {
    const byEmail = await erpList<any>("Customer", {
      filters: [["email_id", "=", email]],
      fields: ["name", "email_id"],
      limit: 5,
    }).catch(() => [] as any[]);
    if (byEmail?.[0]?.name) return byEmail[0].name;

    // Contact.email_id → Dynamic Link Customer
    const contacts = await erpList<any>("Contact", {
      filters: [["email_id", "=", email]],
      fields: ["name", "email_id"],
      limit: 10,
    }).catch(() => [] as any[]);
    for (const c of contacts || []) {
      const full = await erpGet<any>("Contact", c.name).catch(() => null);
      const links = Array.isArray(full?.links) ? full.links : [];
      const custLink = links.find((l: any) => l.link_doctype === "Customer" && l.link_name);
      if (custLink?.link_name) return String(custLink.link_name);
    }
  }

  if (phoneDigits.length >= 10) {
    const last10 = phoneDigits.slice(-10);
    const byPhone = await erpList<any>("Customer", {
      filters: [["mobile_no", "like", `%${last10}%`]],
      fields: ["name", "mobile_no"],
      limit: 5,
    }).catch(() => [] as any[]);
    if (byPhone?.[0]?.name) return byPhone[0].name;
  }

  return null;
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
  const digits = normalizePhoneDigits(phone);
  if (!digits) {
    const rows = await erpList<any>("Customer", {
      filters: [
        ["disabled", "=", 0],
        ["mobile_no", "=", phone],
      ],
      fields: CUSTOMER_LIST_FIELDS,
      limit: 1,
    });
    return rows[0] ?? null;
  }
  const hit = await resolveExistingCustomer({ phone: digits });
  return hit?.row ?? null;
}
