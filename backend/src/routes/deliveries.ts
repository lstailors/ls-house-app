import { Hono } from "hono";
import { erpList, erpGet, erpCreate, erpUpdate } from "../lib/erp";

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
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, resolveLocationCode } from "../lib/scope";
import { sendSms } from "../lib/twilio";

// ── Delivery SMS notifications (fire-and-forget) ──────────────────────────────
async function notifyCustomer(doc: any, event: "out_for_delivery" | "delivered"): Promise<void> {
  const phone = doc.lsh_notify_phone ?? doc.customer_phone ?? null;
  if (!phone) return;
  const first = (doc.customer_name ?? "").split(" ")[0] || "there";
  const msg = event === "out_for_delivery"
    ? `Hi ${first}, your order from L&S Custom Tailors is on its way. Your driver is en route — we'll see you shortly!`
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
      if (s === "Queued") return "scheduled";
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
    addressLine:
      [doc.lsh_delivery_address, doc.lsh_delivery_apt].filter(Boolean).join(", ") || null,
    city: doc.lsh_delivery_city ?? null,
    scheduledAt: doc.lsh_scheduled_at ?? null,
    deliveredAt: doc.lsh_delivered_at ?? null,
    dispatchedAt: doc.lsh_dispatched_at ?? null,
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
    createdAt: doc.creation ?? null,
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
  "lsh_delivery_address",
  "lsh_delivery_city",
  "lsh_supabase_delivery_no",
  "lsh_qr_token",
  "lsh_courier_name",
  "lsh_garment_summary",
  "lsh_garment_count",
  "lsh_tracking_number",
  "lsh_sales_order",
  "creation",
  "modified",
];

// ── GET /api/deliveries ───────────────────────────────────────────────────────
deliveriesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const filters: unknown[] = [["docstatus", "!=", 2]];

  if (user.role === "driver") {
    filters.push(["lsh_courier_name", "=", user.name ?? user.email]);
  } else if (user.role !== "super_admin") {
    const locCode = resolveLocationCode(user, c.req.query("locationId"));
    if (locCode) filters.push(["lsh_origin_location", "=", locCode]);
  }

  const rows = await erpList("LSH Delivery", {
    filters,
    fields: LIST_FIELDS,
    limit: 100,
    order_by: "lsh_scheduled_at asc",
  });

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
      fields: ["name", "customer", "customer_name", "status", "delivery_method"],
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
    garmentSummary?: string | null;
    orderRef?: string | null;
    alterationTicket?: string | null;
  }> = [];

  if (customers.status === "fulfilled") {
    for (const c of customers.value as any[]) {
      results.push({
        type: "customer",
        id: c.name,
        label: c.customer_name ?? c.name,
        sublabel: c.mobile_no ?? c.email_id ?? undefined,
        customer: c.name,
        customerName: c.customer_name,
        phone: c.mobile_no ?? null,
      });
    }
  }

  if (alterations.status === "fulfilled") {
    for (const a of alterations.value as any[]) {
      results.push({
        type: "alteration",
        id: a.name,
        label: `${a.customer_name} — ${a.name}`,
        sublabel: `Alteration · ${a.status ?? ""}`,
        customer: a.customer,
        customerName: a.customer_name,
        orderRef: null,
        alterationTicket: a.name,
        garmentSummary: a.name,
      });
    }
  }

  if (salesOrders.status === "fulfilled") {
    for (const so of salesOrders.value as any[]) {
      results.push({
        type: "order",
        id: so.name,
        label: `${so.customer_name} — ${so.name}`,
        sublabel: `Sales Order · ${so.status ?? ""}`,
        customer: so.customer,
        customerName: so.customer_name,
        phone: so.contact_mobile ?? null,
        address: so.shipping_address ?? null,
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
  if (!["super_admin", "store_manager"].includes(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;
  if (!body.customerId && !body.customer) {
    return c.json({ error: { message: "customerId is required" } }, 400);
  }

  const token = generateToken();
  const locationId = body.locationId ?? "NYC";

  try {
    const doc = await erpCreate<any>("LSH Delivery", {
      naming_series: locationId === "HOU" ? "DN-HOU-.YYYY.-" : "DN-NYC-.YYYY.-",
      customer: body.customerId ?? body.customer,
      lsh_status: "Queued",
      lsh_delivery_method: body.method ?? "Hand Delivery",
      lsh_origin_location: locationId,
      lsh_delivery_address: body.addressLine ?? body.delivery_address ?? "",
      lsh_delivery_apt: body.apt ?? body.delivery_apt ?? null,
      lsh_delivery_building: body.building ?? body.delivery_building ?? null,
      lsh_delivery_city: body.city ?? body.delivery_city ?? "New York",
      lsh_scheduled_at: body.scheduledAt ?? null,
      lsh_notify_phone: body.notifyPhone ?? null,
      lsh_qr_token: token,
      lsh_queued_at: erpDatetime(),
      lsh_garment_summary: body.garmentSummary ?? null,
      lsh_garment_count: body.garmentCount ?? null,
      lsh_courier_name: body.courierName ?? body.driverName ?? null,
      lsh_delivery_notes: body.notes ?? null,
      lsh_sales_order: body.orderRef ?? null,
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
    erpDoc.lsh_pod_method = "In Person";
  }

  const doc = await erpCreate<any>("LSH Delivery", erpDoc);

  // If hand delivery, send confirmation SMS
  if (isHandDeliver && doc) void notifyCustomer(doc, "delivered");

  return c.json({ data: serializeDelivery(doc) });
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
    updates.lsh_status = body.status;
    if (["delivered", "Delivered"].includes(body.status))
      updates.lsh_delivered_at = erpDatetime();
    if (["out_for_delivery", "Out for Delivery", "In Flight"].includes(body.status))
      updates.lsh_dispatched_at = erpDatetime();
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

  if (body.podMethod !== undefined) updates.lsh_pod_method = body.podMethod;
  if (body.signatureName !== undefined) updates.lsh_signature_name = body.signatureName;
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

  // Option B: legacy base64 upload (backend handles the upload)
  if (incomingUrls.length === 0 && body.photoBase64 && supabaseAdmin) {
    try {
      const buf = Buffer.from(body.photoBase64, "base64");
      const ext = body.photoMimeType === "image/png" ? "png" : "jpg";
      const storagePath = `${id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("delivery-photos")
        .upload(storagePath, buf, { contentType: body.photoMimeType ?? "image/jpeg", upsert: false });
      if (!upErr) {
        const { data: pub } = supabaseAdmin.storage
          .from("delivery-photos")
          .getPublicUrl(storagePath);
        if (pub?.publicUrl) incomingUrls.push(pub.publicUrl);
      }
    } catch (e) {
      console.warn("POD photo upload failed:", e);
    }
  }

  // Append all incoming photos to lsh_photos child table
  if (incomingUrls.length > 0) {
    const existingPhotos: any[] = existing.lsh_photos ?? [];
    updates.lsh_photos = [
      ...existingPhotos,
      ...incomingUrls.map((url) => ({
        photo_url: url,
        photo_type: body.photoType ?? "proof",
        captured_at: erpDatetime(),
      })),
    ];
  }

  try {
    const updated = await erpUpdate<any>("LSH Delivery", id, updates);
    if (!updated) return c.json({ error: { message: "Update failed" } }, 500);
    // SMS delivery confirmation (non-blocking)
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
    const updated = await erpUpdate<any>("LSH Delivery", id, updates);
    if (!updated) return c.json({ error: { message: "Update failed" } }, 500);
    // Fire SMS notification (non-blocking)
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
      delivery_number: doc.lsh_supabase_delivery_no
        ? doc.lsh_supabase_delivery_no.replace("DLV-", "")
        : doc.name.slice(-6).toUpperCase(),
      delivery_no: doc.lsh_supabase_delivery_no ?? doc.name,
      qr_token: doc.lsh_qr_token,
      customer_name: doc.customer_name ?? "—",
      customer_phone: doc.customer_phone ?? null,
      delivery_address: doc.lsh_delivery_address,
      delivery_apt: doc.lsh_delivery_apt,
      delivery_building: doc.lsh_delivery_building,
      delivery_city: doc.lsh_delivery_city ?? "",
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
