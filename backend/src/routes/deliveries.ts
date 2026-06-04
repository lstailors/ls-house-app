import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase.js";
import { getAuthedUser, resolveLocationCode } from "../lib/scope.js";

export const deliveriesRouter = new Hono();

// ── Status mappers ──────────────────────────────────────────────────────────
function normalizeDeliveryStatus(s: string): string {
  if (["Scheduled", "Queued", "scheduled"].includes(s)) return "scheduled";
  if (["Out for Delivery", "out_for_delivery", "In Flight"].includes(s)) return "out_for_delivery";
  if (["Delivered", "delivered", "Picked Up"].includes(s)) return "delivered";
  return "failed";
}

function toDbDeliveryStatus(s: string): string {
  const map: Record<string, string> = {
    scheduled: "Scheduled",
    Scheduled: "Scheduled",
    queued: "Queued",
    Queued: "Queued",
    out_for_delivery: "Out for Delivery",
    "Out for Delivery": "Out for Delivery",
    "In Flight": "In Flight",
    delivered: "Delivered",
    Delivered: "Delivered",
    failed: "Failed",
    Failed: "Failed",
    attempted: "Attempted",
    Attempted: "Attempted",
  };
  return map[s] ?? "Queued";
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function serializeCustomer(row: any) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    email: row.email,
    locationId: row.division,
    createdById: null,
    dossier: { vip: row.vip_tier !== "Standard", preferences: row.style_preferences || null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCustomerMap(ids: string[]): Promise<Map<string, any>> {
  if (!ids.length || !supabaseAdmin) return new Map();
  const { data } = await supabaseAdmin
    .from("customers")
    .select("id,full_name,phone,email,division,vip_tier,style_preferences,created_at,updated_at")
    .in("id", ids);
  return new Map((data ?? []).map((r: any) => [r.id, r]));
}

function serializeDelivery(d: any, customerRow?: any) {
  return {
    id: d.id,
    orderRef: d.order_id ?? null,
    customOrderId: d.order_id ?? null,
    customerId: d.customer_id,
    customer: customerRow ? serializeCustomer(customerRow) : undefined,
    locationId: d.origin_location,
    driverId: d.courier_user_id ?? null,
    driver: d.driver_name
      ? { id: null, name: d.driver_name, email: null, role: "driver", locationId: null, image: null, isActive: true }
      : null,
    status: normalizeDeliveryStatus(d.status),
    proofOfDeliveryUrl: d.pod_photo_1_path ?? null,
    scheduledAt: d.scheduled_at ?? (d.scheduled_date ? d.scheduled_date + "T09:00:00Z" : null),
    deliveredAt: d.delivered_at ?? null,
    addressLine: [d.delivery_address, d.delivery_city].filter(Boolean).join(", ") || null,
    notes: d.delivery_notes ?? d.garment_summary ?? null,
    erpnextSynced: false,
    createdAt: d.created_at,
    deliveryNo: d.delivery_no ?? null,
    qrToken: d.qr_token ?? null,
    podMethod: d.pod_method ?? null,
    receivedBy: d.received_by ?? null,
    signatureName: d.signature_name ?? null,
    hasSignature: !!d.signature_image_path,
    gpsLatitude: d.gps_latitude ?? null,
    gpsLongitude: d.gps_longitude ?? null,
    gpsAccuracy: d.gps_accuracy_meters ?? null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

deliveriesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  let q = supabaseAdmin.from("deliveries").select("*");

  if (user.role === "driver") {
    const ids = [user.id];
    if (user.supabaseProfileId && user.supabaseProfileId !== user.id) ids.push(user.supabaseProfileId);
    if (ids.length === 2) {
      q = q.or(`courier_user_id.eq.${ids[0]},courier_user_id.eq.${ids[1]}`);
    } else {
      q = q.eq("courier_user_id", ids[0]);
    }
  } else {
    const locCode = resolveLocationCode(user, c.req.query("locationId"));
    if (locCode) q = q.eq("origin_location", locCode);
  }

  const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) return c.json({ error: { message: error.message } }, 500);

  const customerIds = [...new Set((rows ?? []).map((r: any) => r.customer_id).filter(Boolean))] as string[];
  const customerMap = await fetchCustomerMap(customerIds);

  return c.json({ data: (rows ?? []).map((r: any) => serializeDelivery(r, customerMap.get(r.customer_id))) });
});

deliveriesRouter.get("/candidates", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  try {
    const { data, error } = await supabaseAdmin.rpc("rpc_get_delivery_candidates");
    if (error) {
      console.warn("rpc_get_delivery_candidates error:", error.message);
      return c.json({ data: [] });
    }
    return c.json({ data: data ?? [] });
  } catch (err) {
    console.warn("rpc_get_delivery_candidates exception:", err);
    return c.json({ data: [] });
  }
});

deliveriesRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!["super_admin", "store_manager"].includes(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = (await c.req.json()) as any;
  if (!body.customer_id) return c.json({ error: { message: "customer_id is required" } }, 400);

  const insert: any = {
    customer_id: body.customer_id,
    method: body.method ?? "Hand Delivery",
    status: "Queued",
    origin_location: body.origin_location ?? "NYC",
  };

  if (body.scheduled_at !== undefined) insert.scheduled_at = body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null;
  if (body.scheduled_date !== undefined) insert.scheduled_date = body.scheduled_date;
  if (body.scheduled_window !== undefined) insert.scheduled_window = body.scheduled_window;
  if (body.delivery_address !== undefined) insert.delivery_address = body.delivery_address;
  if (body.delivery_apt !== undefined) insert.delivery_apt = body.delivery_apt;
  if (body.delivery_building !== undefined) insert.delivery_building = body.delivery_building;
  if (body.delivery_city !== undefined) insert.delivery_city = body.delivery_city;
  if (body.delivery_state !== undefined) insert.delivery_state = body.delivery_state;
  if (body.delivery_zip !== undefined) insert.delivery_zip = body.delivery_zip;
  if (body.garment_summary !== undefined) insert.garment_summary = body.garment_summary;
  if (body.garment_count !== undefined) insert.garment_count = body.garment_count;
  if (body.driver_name !== undefined) insert.driver_name = body.driver_name;
  if (body.notify_phone !== undefined) insert.notify_phone = body.notify_phone;
  if (body.delivery_notes !== undefined) insert.delivery_notes = body.delivery_notes;

  const { data: inserted, error } = await supabaseAdmin
    .from("deliveries")
    .insert(insert)
    .select("*")
    .single();

  if (error || !inserted) return c.json({ error: { message: error?.message ?? "Insert failed" } }, 500);

  const customerMap = await fetchCustomerMap(inserted.customer_id ? [inserted.customer_id] : []);
  return c.json({ data: serializeDelivery(inserted, customerMap.get(inserted.customer_id)) }, 201);
});

deliveriesRouter.patch("/:id/pod", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const id = c.req.param("id");
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("deliveries")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) return c.json({ error: { message: "Not found" } }, 404);

  // Access check
  if (user.role === "driver") {
    if (existing.courier_user_id !== user.id && existing.courier_user_id !== user.supabaseProfileId) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (!["super_admin", "store_manager"].includes(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;
  const update: any = {
    status: "Delivered",
    delivered_at: new Date().toISOString(),
  };

  if (body.pod_method !== undefined) update.pod_method = body.pod_method;
  if (body.received_by !== undefined) update.received_by = body.received_by;
  if (body.signature_name !== undefined) update.signature_name = body.signature_name;
  if (body.pod_photo_1_path !== undefined) update.pod_photo_1_path = body.pod_photo_1_path;
  if (body.pod_photo_2_path !== undefined) update.pod_photo_2_path = body.pod_photo_2_path;
  if (body.pod_photo_3_path !== undefined) update.pod_photo_3_path = body.pod_photo_3_path;
  if (body.signature_image_path !== undefined) update.signature_image_path = body.signature_image_path;
  if (body.gps_latitude !== undefined) update.gps_latitude = body.gps_latitude;
  if (body.gps_longitude !== undefined) update.gps_longitude = body.gps_longitude;
  if (body.gps_accuracy_meters !== undefined) update.gps_accuracy_meters = body.gps_accuracy_meters;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("deliveries")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr || !updated) return c.json({ error: { message: updateErr?.message ?? "Update failed" } }, 500);

  const customerMap = await fetchCustomerMap(updated.customer_id ? [updated.customer_id] : []);
  return c.json({ data: serializeDelivery(updated, customerMap.get(updated.customer_id)) });
});

deliveriesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const { data: row, error } = await supabaseAdmin
    .from("deliveries")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);

  // Access check
  if (user.role === "driver") {
    if (row.courier_user_id !== user.id && row.courier_user_id !== user.supabaseProfileId) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin" && !user.canViewAllLocations) {
    const locCode = resolveLocationCode(user, null);
    if (locCode && row.origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  const customerMap = await fetchCustomerMap(row.customer_id ? [row.customer_id] : []);
  return c.json({ data: serializeDelivery(row, customerMap.get(row.customer_id)) });
});

deliveriesRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const id = c.req.param("id");
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("deliveries")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) return c.json({ error: { message: "Not found" } }, 404);

  // Write permission check
  if (user.role === "driver") {
    if (existing.courier_user_id !== user.id && existing.courier_user_id !== user.supabaseProfileId) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role === "store_manager") {
    const locCode = resolveLocationCode(user, null);
    if (locCode && existing.origin_location !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  } else if (user.role !== "super_admin") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;
  const update: any = {};

  if (body.status) {
    update.status = toDbDeliveryStatus(body.status);
    if (body.status === "delivered") update.delivered_at = new Date().toISOString();
  }
  if (body.proofOfDeliveryUrl !== undefined) update.pod_photo_1_path = body.proofOfDeliveryUrl;

  if (user.role === "super_admin" || user.role === "store_manager") {
    if (body.driverId !== undefined) update.courier_user_id = body.driverId;
    if (body.customerId !== undefined) update.customer_id = body.customerId;
    if (body.scheduledAt !== undefined) {
      update.scheduled_at = body.scheduledAt ? new Date(body.scheduledAt).toISOString() : null;
    }
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("deliveries")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr || !updated) return c.json({ error: { message: updateErr?.message ?? "Update failed" } }, 500);

  const customerMap = await fetchCustomerMap(updated.customer_id ? [updated.customer_id] : []);
  return c.json({ data: serializeDelivery(updated, customerMap.get(updated.customer_id)) });
});

// ── Signed URL for private POD/signature assets ──────────────────────────────
deliveriesRouter.get("/:id/proof-url", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const { data: row, error } = await supabaseAdmin
    .from("deliveries")
    .select("id, courier_user_id, pod_photo_1_path, pod_photo_2_path, pod_photo_3_path, signature_image_path")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);

  if (user.role === "driver") {
    if (row.courier_user_id !== user.id && row.courier_user_id !== user.supabaseProfileId) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
  }

  const EXPIRES = 3600;
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data: s } = await supabaseAdmin!.storage.from(bucket).createSignedUrl(path, EXPIRES);
    return s?.signedUrl ?? null;
  };

  return c.json({
    data: {
      photo1: await sign("delivery-proofs", row.pod_photo_1_path),
      photo2: await sign("delivery-proofs", row.pod_photo_2_path),
      photo3: await sign("delivery-proofs", row.pod_photo_3_path),
      signature: await sign("delivery-signatures", row.signature_image_path),
    },
  });
});

// ── Label data ────────────────────────────────────────────────────────────────
deliveriesRouter.get("/:id/label", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const { data: row, error } = await supabaseAdmin
    .from("deliveries")
    .select("id,delivery_no,qr_token,customer_id,delivery_address,delivery_apt,delivery_building,delivery_city,delivery_state,delivery_zip,garment_summary,garment_count,method,driver_name")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);

  let customerName: string | null = null;
  let customerPhone: string | null = null;
  if (row.customer_id) {
    const { data: cust } = await supabaseAdmin.from("customers").select("full_name,phone").eq("id", row.customer_id).single();
    customerName = cust?.full_name ?? null;
    customerPhone = cust?.phone ?? null;
  }

  return c.json({
    data: {
      id: row.id,
      delivery_number: row.delivery_no ? row.delivery_no.replace("DLV-", "") : row.id.slice(-6).toUpperCase(),
      delivery_no: row.delivery_no,
      qr_token: row.qr_token,
      customer_name: customerName ?? "—",
      customer_phone: customerPhone,
      delivery_address: row.delivery_address,
      delivery_apt: row.delivery_apt,
      delivery_building: row.delivery_building,
      delivery_city: row.delivery_city ?? "",
      delivery_state: row.delivery_state ?? "",
      delivery_zip: row.delivery_zip ?? "",
      garment_summary: row.garment_summary,
      garment_count: row.garment_count,
      method: row.method,
    },
  });
});

// ── Log label print ───────────────────────────────────────────────────────────
deliveriesRouter.post("/:id/log-label-print", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: null });

  await supabaseAdmin
    .from("deliveries")
    .update({ label_printed_at: new Date().toISOString(), label_printed_by: user.name ?? user.email ?? user.id })
    .eq("id", c.req.param("id"));

  return c.json({ data: null });
});
