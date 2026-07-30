import { Hono } from "hono";
import { erpList, erpGet, erpCreate, erpUpdate, erpPdf } from "../lib/erp";
import {
  suggestDeliveryStatus,
  summarizeDeliveryTimeline,
  generateCustomerMessage,
  detectDeliveryAnomalies,
  estimateDeliveryTime,
  summarizeDailyOps,
  DEFAULT_MODEL,
} from "../lib/ai";
import type { MessageType } from "../lib/ai";

// Web Crypto API — works in both Edge and Node runtimes
function generateToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ERPNext MySQL requires "YYYY-MM-DD HH:MM:SS" — no milliseconds, no Z
function erpDatetime(d?: Date | string | null): string {
  const dt = d ? new Date(d) : new Date();
  return dt.toISOString().replace("T", " ").slice(0, 19);
}

// ERPNext returns "YYYY-MM-DD HH:MM:SS" without timezone — treat as UTC by appending Z
function erpToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  // Already has timezone indicator
  if (s.includes("Z") || s.includes("+")) return s;
  // Space-separated ERPNext format → ISO UTC
  return s.replace(" ", "T") + "Z";
}
import { getAuthedUser, resolveLocationCode, canCreateDelivery } from "../lib/scope";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { sendSms } from "../lib/twilio";

type CustomerAddressParts = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  addressDisplay: string | null;
};

/** Primary / shipping Address linked to an ERP Customer. */
async function fetchCustomerAddress(customerName: string): Promise<CustomerAddressParts | null> {
  if (!customerName) return null;
  try {
    const rows = await erpList<any>("Address", {
      filters: [
        ["Dynamic Link", "link_doctype", "=", "Customer"],
        ["Dynamic Link", "link_name", "=", customerName],
        ["disabled", "=", 0],
      ],
      fields: [
        "name",
        "address_line1",
        "address_line2",
        "city",
        "state",
        "pincode",
        "is_primary_address",
        "is_shipping_address",
        "address_type",
      ],
      limit: 10,
      order_by: "modified desc",
    });
    if (!rows?.length) return null;
    const preferred =
      rows.find((a) => a.is_shipping_address) ||
      rows.find((a) => a.is_primary_address) ||
      rows.find((a) => String(a.address_type || "").toLowerCase() === "shipping") ||
      rows[0];
    if (!preferred) return null;
    const line1 = (preferred.address_line1 || "").trim() || null;
    const line2 = (preferred.address_line2 || "").trim() || null;
    const city = (preferred.city || "").trim() || null;
    const state = (preferred.state || "").trim() || null;
    const zip = (preferred.pincode || "").trim() || null;
    const addressDisplay =
      [line1, line2, [city, state].filter(Boolean).join(", "), zip].filter(Boolean).join(" · ") || null;
    return { line1, line2, city, state, zip, addressDisplay };
  } catch (err) {
    console.warn("fetchCustomerAddress", customerName, err);
    return null;
  }
}

/** Persist street address onto ERP Address for this customer (create or update primary). */
async function saveCustomerAddress(
  customerName: string,
  parts: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; zip?: string | null },
): Promise<void> {
  if (!customerName || !parts.line1) return;
  const filters = [
    ["Dynamic Link", "link_doctype", "=", "Customer"],
    ["Dynamic Link", "link_name", "=", customerName],
  ];
  const existing = await erpList<any>("Address", {
    filters,
    fields: ["name", "is_primary_address", "is_shipping_address"],
    limit: 5,
  }).catch(() => [] as any[]);
  const hit =
    existing.find((a) => a.is_shipping_address || a.is_primary_address) || existing[0] || null;
  const payload: Record<string, unknown> = {
    address_title: customerName,
    address_type: "Shipping",
    address_line1: parts.line1 || "",
    address_line2: parts.line2 || "",
    city: parts.city || "",
    state: parts.state || "",
    pincode: parts.zip || "",
    country: "United States",
    is_shipping_address: 1,
    is_primary_address: existing.length === 0 ? 1 : hit?.is_primary_address ? 1 : 0,
    links: [{ link_doctype: "Customer", link_name: customerName }],
  };
  if (hit?.name) {
    await erpUpdate("Address", hit.name, payload);
  } else {
    await erpCreate("Address", payload);
  }
}

// ── Timeline helper ───────────────────────────────────────────────────────────
// ERPNext child tables must be sent in full. Fetch existing rows, append new entry.
const EVENT_LABELS: Record<string, string> = {
  "queued":           "queued",
  "Queued":           "queued",
  "Ready for Pickup": "Ready for Pickup",
  "Out for Delivery": "Out for Delivery",
  "Delivered":        "Delivered",
  "Failed":           "Failed",
  "Cancelled":        "Cancelled",
};

function buildTimelineEntry(status: string, actor: string): Record<string, unknown> {
  return {
    doctype: "LSH Delivery Timeline",
    event_type: EVENT_LABELS[status] ?? status,
    event_at: erpDatetime(),
    actor_label: actor,
    message: "",
  };
}

function withTimeline(existing: any, newEntry: Record<string, unknown>): Record<string, unknown>[] {
  const rows = (existing?.lsh_timeline ?? []).map((r: any) => ({
    doctype: "LSH Delivery Timeline",
    name: r.name,
    event_type: r.event_type,
    event_at: r.event_at,
    actor_label: r.actor_label,
    message: r.message ?? "",
  }));
  return [...rows, newEntry];
}

// ── Delivery SMS notifications (fire-and-forget) ──────────────────────────────
async function notifyCustomer(doc: any, event: "out_for_delivery" | "delivered" | "ready_for_pickup"): Promise<void> {
  const phone = doc.lsh_notify_phone ?? doc.customer_phone ?? null;
  if (!phone) return;
  const first = (doc.customer_name ?? "").split(" ")[0] || "there";
  const msg = event === "out_for_delivery"
    ? `Hi ${first}, your order from L&S Custom Tailors is on its way. Your driver is en route — we'll see you shortly!`
    : event === "ready_for_pickup"
    ? `Hi ${first}, great news — your garments from L&S Custom Tailors are ready for pickup at 138 E 61st St, Suite 201, New York. We're open Mon–Fri 9–5:30 and Sat 9–4. Questions? Call (212) 752-1638. See you soon!`
    : `Hi ${first}, your garments from L&S Custom Tailors have been delivered. Thank you — enjoy!`;
  try {
    const sid = await sendSms(phone, msg);
    if (sid && doc.name) {
      // Log to ERPNext notification log (best-effort)
      await erpCreate("LSH Notification Log", {
        lsh_delivery: doc.name,
        channel: "SMS",
        recipient_phone: phone,
        template_id: event,
        twilio_sid: sid,
        status: "sent",
        sent_at: erpDatetime(),
      }).catch(() => {});
      await erpUpdate("LSH Delivery", doc.name, {
        lsh_customer_notified_at: erpDatetime(),
      }).catch(() => {});
    }
  } catch { /* non-blocking */ }
}

export const deliveriesRouter = new Hono();

// ── Serializer ───────────────────────────────────────────────────────────────
function serializeDelivery(doc: any): object {
  return {
    id: doc.name,
    deliveryNo: doc.lsh_supabase_delivery_no ?? doc.name,
    // Map ERP statuses to frontend status tokens
    // "Queued" → "scheduled" so new deliveries appear in the Scheduled tab
    status: (() => {
      const s = doc.lsh_status ?? "Queued";
      if (s === "Queued" || s === "queued") return "scheduled";
      return s.toLowerCase().replace(/ /g, "_");
    })(),
    method: doc.lsh_delivery_method ?? "Hand Delivery",
    locationId: doc.lsh_origin_location ?? "NYC",
    customerId: doc.customer ?? null,
    customer: {
      name: doc.customer_name ?? "",
      phone: doc.customer_phone ?? null,
      email: null,
    },
    orderRef: doc.lsh_sales_order ?? null,
    alterationTicket: doc.lsh_alteration_ticket ?? null,
    addressLine:
      [doc.lsh_delivery_address, doc.lsh_delivery_apt].filter(Boolean).join(", ") || null,
    city: doc.lsh_delivery_city ?? null,
    scheduledAt: erpToIso(doc.lsh_scheduled_at),
    deliveredAt: erpToIso(doc.lsh_delivered_at),
    dispatchedAt: erpToIso(doc.lsh_dispatched_at),
    qrToken: doc.lsh_qr_token ?? null,
    courierName: doc.lsh_courier_name ?? null,
    courierPhone: doc.lsh_courier_phone ?? null,
    carrier: doc.lsh_carrier ?? null,
    trackingNumber: doc.lsh_tracking_number ?? null,
    trackingUrl: doc.lsh_tracking_url ?? null,
    garmentSummary: doc.lsh_garment_summary ?? null,
    garmentCount: doc.lsh_garment_count ?? 0,
    notes: doc.lsh_delivery_notes ?? null,
    podMethod: doc.lsh_pod_method ?? null,
    signatureName: doc.lsh_signature_name ?? null,
    signatureImageUrl: doc.lsh_signature_image_url ?? null,
    hasSignature: !!doc.lsh_signature_image_url,
    receivedBy: doc.lsh_signature_name ?? null,
    // GPS — both naming conventions for frontend compatibility
    gpsLat: doc.lsh_gps_lat ?? null,
    gpsLng: doc.lsh_gps_lng ?? null,
    gpsLatitude: doc.lsh_gps_lat ?? null,
    gpsLongitude: doc.lsh_gps_lng ?? null,
    gpsAccuracy: doc.lsh_gps_accuracy ?? null,
    // Driver alias
    driver: doc.lsh_courier_name ? { name: doc.lsh_courier_name, phone: doc.lsh_courier_phone ?? null } : null,
    // Proof gate — truthy if any photo or signature is on record
    proofOfDeliveryUrl: (doc.lsh_photos?.[0]?.photo_url) ?? doc.lsh_signature_image_url ?? null,
    photos: (doc.lsh_photos ?? []).map((p: any) => ({
      url: p.photo_url,
      type: p.photo_type,
      capturedAt: p.captured_at,
    })),
    timeline: (doc.lsh_timeline ?? []).map((t: any) => ({
      event: t.event_type,
      at: t.event_at,
      actor: t.actor_label,
      message: t.message,
    })),
    erpnextSynced: true,
    createdAt: erpToIso(doc.creation),
  };
}

const LIST_FIELDS = [
  "name",
  "customer",
  "customer_name",
  "customer_phone",
  "lsh_status",
  "lsh_delivery_method",
  "lsh_origin_location",
  "lsh_scheduled_at",
  "lsh_delivered_at",
  "lsh_dispatched_at",
  "lsh_delivery_address",
  "lsh_delivery_city",
  "lsh_supabase_delivery_no",
  "lsh_qr_token",
  "lsh_courier_name",
  "lsh_garment_summary",
  "lsh_garment_count",
  "lsh_tracking_number",
  "lsh_sales_order",
  "lsh_alteration_ticket",
  "lsh_pod_method",
  "lsh_signature_image_url",
  "lsh_signature_name",
  "creation",
  "modified",
];

// ── GET /api/deliveries ───────────────────────────────────────────────────────
// Optional: ?alterationTicket=ALT-… — ticket→delivery reverse lookup for alts
// (HER-75). Prefer this over a new route; same serializer, less surface area.
deliveriesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const filters: unknown[] = [["docstatus", "!=", 2]];

  const alterationTicket = (c.req.query("alterationTicket") ?? "").trim();
  if (alterationTicket) {
    filters.push(["lsh_alteration_ticket", "=", alterationTicket]);
    const rows = await erpList("LSH Delivery", {
      filters,
      fields: LIST_FIELDS,
      limit: 20,
      order_by: "creation desc",
    });
    return c.json({ data: (rows as any[]).map(serializeDelivery) });
  }

  if (user.role === "driver") {
    filters.push(["lsh_courier_name", "=", user.name ?? user.email]);
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, c.req.query("locationId"));
    if (locCode) filters.push(["lsh_origin_location", "=", locCode]);
  }

  // Fetch active deliveries first (not Delivered/Cancelled/Failed), then recent history
  // Two-pass so the board never misses a Queued delivery due to the 200-row limit
  const activeFilters = [...filters, ["lsh_status", "not in", ["Delivered", "Cancelled", "Failed"]]];
  const [activeRows, recentRows] = await Promise.all([
    erpList("LSH Delivery", {
      filters: activeFilters,
      fields: LIST_FIELDS,
      limit: 200,
      order_by: "creation desc",
    }),
    erpList("LSH Delivery", {
      filters: [...filters, ["lsh_status", "in", ["Delivered", "Cancelled", "Failed"]]],
      fields: LIST_FIELDS,
      limit: 50,
      order_by: "lsh_delivered_at desc",
    }),
  ]);
  // Deduplicate and merge: active first, then recent history
  const seen = new Set<string>();
  const rows: unknown[] = [];
  for (const r of [...(activeRows as any[]), ...(recentRows as any[])]) {
    if (!seen.has(r.name)) { seen.add(r.name); rows.push(r); }
  }

  return c.json({ data: (rows as any[]).map(serializeDelivery) });
});

// ── GET /api/deliveries/search-context ───────────────────────────────────────
// Unified fuzzy search across customers, alteration tickets, and sales orders.
// Returns tagged results the frontend uses to pre-fill a new delivery.
deliveriesRouter.get("/search-context", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });

  const [customers, alterations, salesOrders] = await Promise.allSettled([
    erpList("Customer", {
      filters: [["customer_name", "like", `%${q}%`]],
      fields: ["name", "customer_name", "mobile_no", "email_id"],
      limit: 5,
    }),
    erpList("Alteration Ticket", {
      filters: [
        ["docstatus", "!=", 2],
        ["customer_name", "like", `%${q}%`],
      ],
      fields: ["name", "customer", "customer_name", "workflow_state", "delivery_method"],
      limit: 5,
      order_by: "creation desc",
    }),
    erpList("Sales Order", {
      filters: [
        ["status", "in", ["To Deliver and Bill", "To Deliver", "To Bill"]],
        ["customer_name", "like", `%${q}%`],
      ],
      fields: ["name", "customer", "customer_name", "contact_mobile", "delivery_date", "shipping_address"],
      limit: 5,
      order_by: "creation desc",
    }),
  ]);

  const results: Array<{
    type: "customer" | "alteration" | "order";
    id: string;
    label: string;
    sublabel?: string;
    customer?: string;
    customerName?: string;
    phone?: string | null;
    address?: string | null;
    apt?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    garmentSummary?: string | null;
    orderRef?: string | null;
    alterationTicket?: string | null;
  }> = [];

  if (customers.status === "fulfilled") {
    const rows = customers.value as any[];
    // Enrich each customer with primary address (shipping > billing > first)
    const enriched = await Promise.all(
      rows.map(async (cust) => {
        let address: string | null = null;
        let apt: string | null = null;
        let city: string | null = null;
        let state: string | null = null;
        let zip: string | null = null;
        try {
          const { getCustomer } = await import("../lib/erpnext/customers");
          const full = await getCustomer(cust.name);
          if (full) {
            address = full.address ?? null;
            apt = full.addresses?.[0]?.line2 ?? null;
            city = full.city ?? null;
            state = full.state ?? null;
            zip = full.zipCode ?? null;
          }
        } catch {
          /* skip */
        }
        return {
          type: "customer" as const,
          id: cust.name,
          label: cust.customer_name ?? cust.name,
          sublabel: [cust.mobile_no, address].filter(Boolean).join(" · ") || cust.email_id || undefined,
          customer: cust.name,
          customerName: cust.customer_name,
          phone: cust.mobile_no ?? null,
          address,
          apt,
          city,
          state,
          zip,
        };
      }),
    );
    results.push(...enriched);
  }

  if (alterations.status === "fulfilled") {
    for (const a of alterations.value as any[]) {
      let address: string | null = null;
      let apt: string | null = null;
      let city: string | null = null;
      let state: string | null = null;
      let zip: string | null = null;
      let phone: string | null = null;
      if (a.customer) {
        try {
          const { getCustomer } = await import("../lib/erpnext/customers");
          const full = await getCustomer(a.customer);
          if (full) {
            address = full.address ?? null;
            apt = full.addresses?.[0]?.line2 ?? null;
            city = full.city ?? null;
            state = full.state ?? null;
            zip = full.zipCode ?? null;
            phone = full.phone ?? null;
          }
        } catch {
          /* */
        }
      }
      results.push({
        type: "alteration",
        id: a.name,
        label: `${a.customer_name} — ${a.name}`,
        sublabel: [`Alteration · ${a.workflow_state ?? ""}`, address].filter(Boolean).join(" · "),
        customer: a.customer,
        customerName: a.customer_name,
        phone,
        address,
        apt,
        city,
        state,
        zip,
        orderRef: null,
        alterationTicket: a.name,
        garmentSummary: a.name,
      });
    }
  }

  if (salesOrders.status === "fulfilled") {
    for (const so of salesOrders.value as any[]) {
      let address: string | null = null;
      let apt: string | null = null;
      let city: string | null = null;
      let state: string | null = null;
      let zip: string | null = null;
      let phone: string | null = so.contact_mobile ?? null;
      if (so.customer) {
        try {
          const { getCustomer } = await import("../lib/erpnext/customers");
          const full = await getCustomer(so.customer);
          if (full) {
            const ship =
              full.addresses?.find((a: any) => a.isShipping) ||
              full.addresses?.find((a: any) => a.isBilling) ||
              full.addresses?.[0] ||
              null;
            address = ship?.line1 || full.address || null;
            apt = ship?.line2 || null;
            city = ship?.city || full.city || null;
            state = ship?.state || full.state || null;
            zip = ship?.zip || full.zipCode || null;
            if (!phone) phone = full.phone ?? null;
          }
        } catch {
          /* */
        }
      }
      if (!address && so.shipping_address) {
        address = String(so.shipping_address)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      results.push({
        type: "order",
        id: so.name,
        label: `${so.customer_name} — ${so.name}`,
        sublabel: [`Sales Order · ${so.status ?? ""}`, address].filter(Boolean).join(" · "),
        customer: so.customer,
        customerName: so.customer_name,
        phone,
        address,
        apt,
        city,
        state,
        zip,
        orderRef: so.name,
        alterationTicket: null,
      });
    }
  }

  return c.json({ data: results });
});

// ── GET /api/deliveries/candidates ───────────────────────────────────────────
deliveriesRouter.get("/candidates", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const orders = await erpList("Sales Order", {
      filters: [["status", "=", "To Deliver and Bill"]],
      fields: [
        "name",
        "customer_name",
        "contact_mobile",
        "contact_phone",
        "shipping_address",
        "delivery_date",
      ],
      limit: 50,
    });
    return c.json({ data: orders });
  } catch (err) {
    console.warn("candidates error:", err);
    return c.json({ data: [] });
  }
});

// ── POST /api/deliveries ──────────────────────────────────────────────────────
deliveriesRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  // FOH can queue deliveries (alts New Delivery). Drivers cannot create.
  if (!canCreateDelivery(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;
  if (!body.customerId && !body.customer && !body.newCustomerName) {
    return c.json({ error: { message: "customerId is required" } }, 400);
  }

  const token = generateToken();
  const locationId = body.locationId ?? body.origin_location ?? user.locationCode ?? "NYC";

  // Create a new ERPNext customer on-the-fly if requested
  let resolvedCustomer: string = body.customerId ?? body.customer;
  if (body.newCustomerName) {
    try {
      const newCust = await erpCreate<any>("Customer", {
        customer_name: body.newCustomerName,
        customer_type: "Individual",
        customer_group: "Bespoke",
        mobile_no: body.newCustomerPhone ?? null,
      });
      resolvedCustomer = newCust?.name ?? body.newCustomerName;
    } catch (err: any) {
      return c.json({ error: { message: `Could not create customer: ${err.message ?? err}` } }, 500);
    }
  }

  // If address blank, pull primary shipping/billing from customer record
  let addressLine = (body.addressLine ?? body.delivery_address ?? "").trim();
  let apt = body.apt ?? body.delivery_apt ?? null;
  let city = body.city ?? body.delivery_city ?? null;
  let state = body.state ?? body.delivery_state ?? null;
  let zip = body.zip ?? body.delivery_zip ?? null;
  let phone =
    body.customer_phone ?? body.customerPhone ?? body.notifyPhone ?? body.newCustomerPhone ?? null;

  if (resolvedCustomer && resolvedCustomer !== "__new__") {
    try {
      const { getCustomer } = await import("../lib/erpnext/customers");
      const cust = await getCustomer(resolvedCustomer);
      if (cust) {
        const ship =
          cust.addresses?.find((a: any) => a.isShipping) ||
          cust.addresses?.find((a: any) => a.isBilling) ||
          cust.addresses?.[0] ||
          null;
        if (!addressLine && (ship?.line1 || cust.address)) addressLine = String(ship?.line1 || cust.address);
        if (!apt && ship?.line2) apt = ship.line2;
        if (!city && (ship?.city || cust.city)) city = ship?.city || cust.city;
        if (!state && (ship?.state || cust.state)) state = ship?.state || cust.state;
        if (!zip && (ship?.zip || cust.zipCode)) zip = ship?.zip || cust.zipCode;
        if (!phone) phone = cust.phone ?? null;
      }
    } catch {
      /* best-effort */
    }
  }

  // Optional: persist typed address back onto the customer
  if (body.saveAddressToCustomer && resolvedCustomer && addressLine) {
    try {
      const { updateCustomer } = await import("../lib/erpnext/customers");
      await updateCustomer(resolvedCustomer, {
        address: addressLine,
        city: city || "New York",
        state: state || "NY",
        zip_code: zip || undefined,
        phone: phone || undefined,
      });
    } catch (e: any) {
      console.warn("[deliveries] saveAddressToCustomer:", e?.message);
    }
  }

  try {
    // Map UI method labels → ERP Select options
    const methodRaw = String(body.method ?? "Hand Delivery");
    const methodMap: Record<string, string> = {
      "Hand Delivery": "Hand Delivery",
      Courier: "Courier",
      "Ship Direct": "Ship Direct",
      Pickup: "Pickup",
      "In-Store Pickup": "Pickup",
      "Uber Messenger": "Courier",
    };
    const method = methodMap[methodRaw] || "Hand Delivery";

    // Date-only → noon Eastern-ish ISO for Datetime field
    let scheduledAt = body.scheduledAt ?? null;
    if (scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(String(scheduledAt))) {
      scheduledAt = `${scheduledAt} 12:00:00`;
    }

    const doc = await erpCreate<any>("LSH Delivery", {
      naming_series: locationId === "HOU" ? "DN-HOU-.YYYY.-" : "DN-NYC-.YYYY.-",
      customer: resolvedCustomer,
      lsh_status: "Queued",
      lsh_delivery_method: method,
      lsh_origin_location: locationId,
      lsh_delivery_address: addressLine || "",
      lsh_delivery_apt: apt,
      lsh_delivery_building: body.building ?? body.delivery_building ?? null,
      lsh_delivery_city: city || "New York",
      lsh_delivery_state: state || "NY",
      lsh_delivery_zip: zip || null,
      customer_phone: phone,
      lsh_scheduled_at: scheduledAt,
      lsh_notify_phone: body.notifyPhone ?? phone ?? null,
      lsh_qr_token: token,
      lsh_queued_at: erpDatetime(),
      lsh_garment_summary: body.garmentSummary ?? null,
      lsh_garment_count: body.garmentCount ?? null,
      lsh_courier_name: body.courierName ?? body.driverName ?? null,
      lsh_delivery_notes: body.notes ?? null,
      lsh_sales_order: body.orderRef ?? body.sales_order ?? null,
      lsh_alteration_ticket: body.alterationTicket ?? body.alteration_ticket ?? null,
      customer_name: body.customer_name ?? body.customerName ?? null,
      lsh_timeline: [buildTimelineEntry("Queued", user.name ?? user.email ?? "Staff")],
    });

    if (!doc) return c.json({ error: { message: "Create failed" } }, 500);
    return c.json({ data: serializeDelivery(doc) }, 201);
  } catch (err: any) {
    return c.json({ error: { message: err.message ?? "Create failed" } }, 500);
  }
});

// ── POST /api/deliveries/from-order ──────────────────────────────────────────
deliveriesRouter.post("/from-order", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({})) as any;
  // body: { sales_order?, alteration_ticket?, customer_name, customer_phone?, address?, city?, apt?, notify_phone?, garment_summary?, garment_count?, location? }

  const token = generateToken();
  const location = body.location ?? user.locationCode ?? "NYC";
  const isHandDeliver = body.hand_deliver === true;
  const now = erpDatetime();

  // Auto-fetch phone from ERPNext Customer if not provided
  let notifyPhone = body.notify_phone ?? body.customer_phone ?? null;
  if (!notifyPhone && body.customer_erp_name) {
    const cust = await erpGet<any>("Customer", body.customer_erp_name).catch(() => null);
    notifyPhone = cust?.mobile_no ?? cust?.phone ?? null;
  }

  const erpDoc: Record<string, unknown> = {
    naming_series: location === "HOU" ? "DN-HOU-.YYYY.-" : "DN-NYC-.YYYY.-",
    customer: body.customer_erp_name ?? body.customer_name ?? "Walk-in",
    customer_name: body.customer_name ?? "Walk-in",
    customer_phone: body.customer_phone ?? notifyPhone ?? null,
    lsh_status: isHandDeliver ? "Delivered" : "Queued",
    lsh_delivery_method: body.method ?? "Hand Delivery",
    lsh_origin_location: location,
    lsh_sales_order: body.sales_order ?? null,
    lsh_alteration_ticket: body.alteration_ticket ?? null,
    lsh_delivery_address: body.address ?? null,
    lsh_delivery_apt: body.apt ?? null,
    lsh_delivery_city: body.city ?? "New York",
    lsh_delivery_state: body.state ?? "NY",
    lsh_garment_summary: body.garment_summary ?? null,
    lsh_garment_count: body.garment_count ?? null,
    lsh_notify_phone: notifyPhone,
    lsh_qr_token: token,
    lsh_queued_at: now,
  };

  if (isHandDeliver) {
    erpDoc.lsh_delivered_at = now;
    erpDoc.lsh_dispatched_at = now;
  }

  const doc = await erpCreate<any>("LSH Delivery", erpDoc);

  // If hand delivery, send confirmation SMS
  if (isHandDeliver && doc) void notifyCustomer(doc, "delivered");

  return c.json({ data: serializeDelivery(doc) });
});

// ── GET /api/deliveries/anomalies ────────────────────────────────────────────
deliveriesRouter.get("/anomalies", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const filters: unknown[] = [
    ["docstatus", "!=", 2],
    ["lsh_status", "not in", ["Delivered", "Cancelled"]],
  ];
  if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, c.req.query("locationId"));
    if (locCode) filters.push(["lsh_origin_location", "=", locCode]);
  }

  const docs = await erpList<any>("LSH Delivery", {
    filters,
    fields: ["name", "customer_name", "lsh_status", "lsh_scheduled_at", "lsh_dispatched_at", "lsh_courier_name", "lsh_origin_location", "lsh_delivery_notes"],
    limit: 100,
    order_by: "creation desc",
  });

  try {
    const anomalies = await detectDeliveryAnomalies(docs);
    return c.json({ data: anomalies });
  } catch (err: any) {
    console.error("[ai:anomalies] error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "AI call failed" } }, 502);
  }
});

// ── GET /api/deliveries/daily-ops-summary ────────────────────────────────────
deliveriesRouter.get("/daily-ops-summary", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const filters: unknown[] = [["docstatus", "!=", 2]];
  let locationLabel: string | undefined;

  if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, c.req.query("locationId"));
    if (locCode) {
      filters.push(["lsh_origin_location", "=", locCode]);
      locationLabel = locCode;
    }
  }

  // Today's deliveries
  const today = new Date().toISOString().slice(0, 10);
  filters.push(["DATE(creation)", ">=", today]);

  const docs = await erpList<any>("LSH Delivery", {
    filters,
    fields: ["name", "customer_name", "lsh_status", "lsh_courier_name", "lsh_delivered_at", "lsh_dispatched_at"],
    limit: 200,
    order_by: "creation desc",
  });

  try {
    const result = await summarizeDailyOps(docs, locationLabel);
    return c.json({ data: { ...result, totalDeliveries: docs.length, model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:daily-ops] error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "AI call failed" } }, 502);
  }
});

// ── GET /api/deliveries/:id ───────────────────────────────────────────────────
deliveriesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  // Access checks
  if (user.role === "driver") {
    if (doc.lsh_courier_name !== user.name && doc.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && doc.lsh_origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  return c.json({ data: serializeDelivery(doc) });
});

// ── PATCH /api/deliveries/:id ─────────────────────────────────────────────────
deliveriesRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");

  // Resolve by name or qrToken
  let docName = id;
  if (!id.startsWith("DN-")) {
    // Might be a qrToken lookup
    const list = await erpList<any>("LSH Delivery", {
      filters: [["lsh_qr_token", "=", id]],
      fields: ["name", "lsh_courier_name", "lsh_origin_location"],
      limit: 1,
    });
    if (!list.length) return c.json({ error: { message: "Not found" } }, 404);
    docName = list[0].name;
  }

  const existing = await erpGet<any>("LSH Delivery", docName);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);

  // Write permission check
  if (user.role === "driver") {
    if (existing.lsh_courier_name !== user.name && existing.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role === "store_manager") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && existing.lsh_origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;
  const updates: Record<string, unknown> = {};

  if (body.status) {
    const erpSt = body.status === "out_for_delivery" ? "Out for Delivery"
      : body.status === "delivered" ? "Delivered"
      : body.status === "In Flight" ? "Out for Delivery"
      : (body.status === "ready_for_pickup" || body.status === "ready") ? "Ready for Pickup"
      : body.status;
    updates.lsh_status = erpSt;
    if (["delivered", "Delivered"].includes(body.status))
      updates.lsh_delivered_at = erpDatetime();
    if (["out_for_delivery", "Out for Delivery", "In Flight"].includes(body.status))
      updates.lsh_dispatched_at = erpDatetime();
    const actor = user.name ?? user.email ?? "Staff";
    updates.lsh_timeline = withTimeline(existing, buildTimelineEntry(erpSt, actor));
  }

  if (user.role === "super_admin" || user.role === "store_manager") {
    if (body.courierName !== undefined) updates.lsh_courier_name = body.courierName;
    if (body.driverName !== undefined) updates.lsh_courier_name = body.driverName;
    if (body.courierPhone !== undefined) updates.lsh_courier_phone = body.courierPhone;
    if (body.customerId !== undefined) updates.customer = body.customerId;
    if (body.scheduledAt !== undefined)
      updates.lsh_scheduled_at = body.scheduledAt
        ? erpDatetime(body.scheduledAt)
        : null;
    if (body.addressLine !== undefined) updates.lsh_delivery_address = body.addressLine;
    if (body.city !== undefined) updates.lsh_delivery_city = body.city;
    if (body.notes !== undefined) updates.lsh_delivery_notes = body.notes;
    if (body.garmentSummary !== undefined) updates.lsh_garment_summary = body.garmentSummary;
    if (body.garmentCount !== undefined) updates.lsh_garment_count = body.garmentCount;
    if (body.carrier !== undefined) updates.lsh_carrier = body.carrier;
    if (body.trackingNumber !== undefined) updates.lsh_tracking_number = body.trackingNumber;
    if (body.trackingUrl !== undefined) updates.lsh_tracking_url = body.trackingUrl;
  }

  try {
    const updated = await erpUpdate<any>("LSH Delivery", docName, updates);
    if (!updated) return c.json({ error: { message: "Update failed" } }, 500);
    // Fire SMS notification (non-blocking)
    if (["out_for_delivery", "Out for Delivery"].includes(body.status ?? "")) {
      void notifyCustomer(updated, "out_for_delivery");
    }
    if (["ready_for_pickup", "ready", "Ready for Pickup"].includes(body.status ?? "")) {
      void notifyCustomer(updated, "ready_for_pickup");
    }
    return c.json({ data: serializeDelivery(updated) });
  } catch (err: any) {
    return c.json({ error: { message: err.message ?? "Update failed" } }, 500);
  }
});

// ── GET /api/deliveries/:id/proof-url ────────────────────────────────────────
// Returns photo and signature URLs stored in ERP for this delivery.
deliveriesRouter.get("/:id/proof-url", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  const photos: any[] = doc.lsh_photos ?? [];
  return c.json({
    data: {
      photo1: photos[0]?.photo_url ?? null,
      photo2: photos[1]?.photo_url ?? null,
      photo3: photos[2]?.photo_url ?? null,
      signature: doc.lsh_signature_image_url ?? null,
    },
  });
});

// ── PATCH /api/deliveries/:id/pod ─────────────────────────────────────────────
deliveriesRouter.patch("/:id/pod", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const existing = await erpGet<any>("LSH Delivery", id);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);

  // Access check
  if (user.role === "driver") {
    if (existing.lsh_courier_name !== user.name && existing.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (!["super_admin", "store_manager"].includes(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;
  const updates: Record<string, unknown> = {
    lsh_status: "Delivered",
    lsh_delivered_at: erpDatetime(),
  };

  // ERP Select options only — invalid values 500 the PUT
  const VALID_POD = new Set(["", "Photo Only", "Signature", "Signature + Photo"]);
  if (body.podMethod !== undefined) {
    const m = String(body.podMethod ?? "");
    updates.lsh_pod_method = VALID_POD.has(m) ? m : "";
  }
  // receivedBy is the common client field; signatureName is legacy alias
  const receivedBy = body.receivedBy ?? body.signatureName ?? body.pickup_confirmed_by;
  if (receivedBy !== undefined) updates.lsh_signature_name = receivedBy;
  if (body.signatureImageUrl !== undefined)
    updates.lsh_signature_image_url = body.signatureImageUrl;
  if (body.gpsLat !== undefined) updates.lsh_gps_lat = body.gpsLat;
  if (body.gpsLng !== undefined) updates.lsh_gps_lng = body.gpsLng;
  if (body.gpsAccuracy !== undefined) updates.lsh_gps_accuracy = body.gpsAccuracy;

  // Collect photo URLs — accepts either pre-uploaded public URLs or base64
  const incomingUrls: string[] = [];

  // Option A: frontend sends pre-uploaded public URLs (preferred)
  if (body.photoUrls && Array.isArray(body.photoUrls)) {
    incomingUrls.push(...body.photoUrls.filter(Boolean));
  } else if (body.photoUrl) {
    incomingUrls.push(body.photoUrl);
  }

  // Option B: legacy base64 upload (backend handles the upload via ERPNext)
  if (incomingUrls.length === 0 && body.photoBase64) {
    try {
      const buf = Buffer.from(body.photoBase64, "base64");
      const ext = body.photoMimeType === "image/png" ? "png" : "jpg";
      // No slash in filename — ERP public URLs flatten path separators
      const filename = `${id}-pod-${Date.now()}.${ext}`;
      const { fileUrl } = await uploadFile({
        file: buf,
        filename,
        contentType: body.photoMimeType ?? "image/jpeg",
        doctype: "LSH Delivery",
        docname: id,
        isPrivate: false,
      });
      incomingUrls.push(erpFileAbsoluteUrl(fileUrl));
    } catch (e) {
      console.warn("POD photo upload failed:", e);
    }
  }

  // Append all incoming photos to lsh_photos child table (strip system fields)
  if (incomingUrls.length > 0) {
    const existingPhotos: any[] = (existing.lsh_photos ?? []).map((p: any) => ({
      photo_url: p.photo_url,
      photo_type: p.photo_type || "proof",
      caption: p.caption || "",
      captured_at: p.captured_at || null,
      uploaded_by: p.uploaded_by || "",
    }));
    updates.lsh_photos = [
      ...existingPhotos,
      ...incomingUrls.map((url) => ({
        photo_url: url,
        photo_type: body.photoType ?? "proof",
        captured_at: erpDatetime(),
      })),
    ];
  }

  const actor = user.name ?? user.email ?? "Driver";
  updates.lsh_timeline = withTimeline(existing, buildTimelineEntry("Delivered", actor));

  try {
    const updated = await erpUpdate<any>("LSH Delivery", id, updates);
    if (!updated) return c.json({ error: { message: "Update failed" } }, 500);
    void notifyCustomer(updated, "delivered");
    return c.json({ data: serializeDelivery(updated) });
  } catch (err: any) {
    return c.json({ error: { message: err.message ?? "Update failed" } }, 500);
  }
});

// ── PATCH /api/deliveries/:id/status ─────────────────────────────────────────
deliveriesRouter.patch("/:id/status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;
  if (!body.status) return c.json({ error: { message: "status is required" } }, 400);

  const ALLOWED_STATUSES: Record<string, string> = {
    "queued": "Queued",
    "scheduled": "Queued",   // frontend uses "scheduled" for Queued deliveries
    "ready_for_pickup": "Ready for Pickup",
    "ready": "Ready for Pickup",
    "Ready for Pickup": "Ready for Pickup",
    "out_for_delivery": "Out for Delivery",
    "out for delivery": "Out for Delivery",
    "In Flight": "Out for Delivery",
    "delivered": "Delivered",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "Queued": "Queued",
    "Out for Delivery": "Out for Delivery",
    "Delivered": "Delivered",
    "Failed": "Failed",
    "Cancelled": "Cancelled",
  };
  const erpStatus = ALLOWED_STATUSES[body.status];
  if (!erpStatus) return c.json({ error: { message: `Invalid status. Allowed: queued, out_for_delivery, delivered, failed, cancelled` } }, 400);

  const updates: Record<string, unknown> = { lsh_status: erpStatus };

  if (erpStatus === "Delivered") updates.lsh_delivered_at = erpDatetime();
  if (erpStatus === "Out for Delivery") updates.lsh_dispatched_at = erpDatetime();

  try {
    const existing = await erpGet<any>("LSH Delivery", id);
    const actor = user.name ?? user.email ?? "Staff";
    updates.lsh_timeline = withTimeline(existing, buildTimelineEntry(erpStatus, actor));

    const updated = await erpUpdate<any>("LSH Delivery", id, updates);
    if (!updated) return c.json({ error: { message: "Update failed" } }, 500);
    if (erpStatus === "Ready for Pickup") void notifyCustomer(updated, "ready_for_pickup");
    if (erpStatus === "Out for Delivery") void notifyCustomer(updated, "out_for_delivery");
    if (erpStatus === "Delivered") void notifyCustomer(updated, "delivered");
    return c.json({ data: serializeDelivery(updated) });
  } catch (err: any) {
    return c.json({ error: { message: err.message ?? "Update failed" } }, 500);
  }
});

// ── GET /api/deliveries/:id/label ─────────────────────────────────────────────
deliveriesRouter.get("/:id/label", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const doc = await erpGet<any>("LSH Delivery", c.req.param("id"));
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  let items: { name: string; qty: number; desc?: string | null }[] = [];
  let order_ref: string | null = null;

  if (doc.lsh_sales_order) {
    order_ref = doc.lsh_sales_order;
    const so = await erpGet<any>("Sales Order", doc.lsh_sales_order).catch(() => null);
    if (so?.items) {
      items = so.items.map((i: any) => ({
        name: i.item_name || i.item_code,
        qty: i.qty || 1,
        desc: i.description?.replace(/<[^>]*>/g, "").slice(0, 60) || null,
      }));
    }
  } else if (doc.lsh_alteration_ticket) {
    order_ref = doc.lsh_alteration_ticket;
    const ticket = await erpGet<any>("Alteration Ticket", doc.lsh_alteration_ticket).catch(() => null);
    if (ticket?.lines) {
      items = ticket.lines.map((l: any) => ({
        name: l.preset_name || l.description || "Alteration",
        qty: 1,
        desc: l.description || null,
      }));
    }
  }

  return c.json({
    data: {
      id: doc.name,
      delivery_number: doc.name,
      delivery_no: doc.name,
      legacy_no: doc.lsh_supabase_delivery_no ?? null,
      qr_token: doc.lsh_qr_token,
      customer_name: doc.customer_name ?? "—",
      customer_phone: doc.customer_phone ?? null,
      delivery_address: doc.lsh_delivery_address,
      delivery_apt: doc.lsh_delivery_apt,
      delivery_building: doc.lsh_delivery_building,
      delivery_city: doc.lsh_delivery_city ?? "",
      delivery_state: doc.lsh_delivery_state ?? "",
      delivery_zip: doc.lsh_delivery_zip ?? "",
      garment_summary: doc.lsh_garment_summary,
      garment_count: doc.lsh_garment_count,
      method: doc.lsh_delivery_method,
      order_ref,
      items,
    },
  });
});

// ── POST /api/deliveries/:id/log-label-print ──────────────────────────────────
deliveriesRouter.post("/:id/log-label-print", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Best-effort: record the print timestamp in ERP
  try {
    await erpUpdate("LSH Delivery", c.req.param("id"), {
      lsh_label_printed_at: erpDatetime(),
      lsh_label_printed_by: user.name ?? user.email ?? user.id,
    });
  } catch {
    // Non-fatal — label may not have those fields yet
  }

  return c.json({ data: null });
});

// ── POST /api/deliveries/:id/generate-message ────────────────────────────────
deliveriesRouter.post("/:id/generate-message", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  if (user.role === "driver") {
    if (doc.lsh_courier_name !== user.name && doc.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && doc.lsh_origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  const body = await c.req.json() as { type: MessageType; channel: "sms" | "email"; customContext?: string };
  if (!body.type || !body.channel) return c.json({ error: { message: "type and channel are required" } }, 400);

  try {
    const message = await generateCustomerMessage(doc, body.type, body.channel, body.customContext);
    return c.json({ data: { deliveryId: id, message, type: body.type, channel: body.channel, model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:generate-message] error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "AI call failed" } }, 502);
  }
});

// ── GET /api/deliveries/:id/estimate-time ────────────────────────────────────
deliveriesRouter.get("/:id/estimate-time", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  if (user.role === "driver") {
    if (doc.lsh_courier_name !== user.name && doc.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && doc.lsh_origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  try {
    const result = await estimateDeliveryTime(doc);
    return c.json({ data: { deliveryId: id, ...result, model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:estimate-time] error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "AI call failed" } }, 502);
  }
});

// ── GET /api/deliveries/:id/suggest-status ───────────────────────────────────
deliveriesRouter.get("/:id/suggest-status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  if (user.role === "driver") {
    if (doc.lsh_courier_name !== user.name && doc.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && doc.lsh_origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  try {
    const result = await suggestDeliveryStatus(doc);
    return c.json({ data: { deliveryId: id, ...result, model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:suggest-status] error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "AI call failed" } }, 502);
  }
});

// ── GET /api/deliveries/:id/summarize-timeline ────────────────────────────────
deliveriesRouter.get("/:id/summarize-timeline", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  if (user.role === "driver") {
    if (doc.lsh_courier_name !== user.name && doc.lsh_courier_name !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && doc.lsh_origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  try {
    const summary = await summarizeDeliveryTimeline(doc);
    return c.json({ data: { deliveryId: id, summary, model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:summarize-timeline] error:", err?.message ?? err);
    return c.json({ error: { message: err?.message ?? "AI call failed" } }, 502);
  }
});

// ── GET /api/deliveries/:id/confirmation ─────────────────────────────────────
deliveriesRouter.get("/:id/confirmation", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");
  const erpRes = await erpPdf("LSH Delivery", id, "LSH Delivery Confirmation");
  if (!erpRes.ok) return c.json({ error: { message: "Could not generate PDF" } }, 502);
  const buf = await erpRes.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${id}-confirmation.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
