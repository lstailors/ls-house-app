/**
 * Public delivery tracking endpoints — used by the driver/customer
 * delivery tracking page at /d/:token (DeliveryTracking.tsx) on both
 * app.lstailors.com and delivered.lstailors.com (same ls-house-app deploy).
 *
 * ERPNext LSH Delivery is the only source of truth. No Supabase.
 * Intentionally unauthenticated so drivers can complete POD without a session.
 */

import { Hono } from "hono";
import { erpList, erpGet, erpUpdate, erpCreate } from "../lib/erp";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { sendSms } from "../lib/twilio";
import { erpDatetime, sanitizeGps, hasPod } from "../lib/delivery";

/** Fire-and-forget customer SMS — mirrors deliveries.ts notifyCustomer. */
async function notifyCustomer(
  doc: any,
  event: "out_for_delivery" | "delivered",
): Promise<void> {
  const phone = doc.lsh_notify_phone ?? doc.customer_phone ?? null;
  if (!phone) return;
  const first = (doc.customer_name ?? "").split(" ")[0] || "there";
  const msg =
    event === "out_for_delivery"
      ? `Hi ${first}, your order from L&S Custom Tailors is on its way. Your driver is en route — we'll see you shortly!`
      : `Hi ${first}, your garments from L&S Custom Tailors have been delivered. Thank you — enjoy!`;
  try {
    const sid = await sendSms(phone, msg, undefined, "tracking.notifyCustomer");
    if (sid && doc.name) {
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
  } catch {
    /* non-blocking */
  }
}

/** ERP Select options for lsh_pod_method — anything else 500s the update. */
const VALID_POD_METHODS = new Set(["", "Photo Only", "Signature", "Signature + Photo"]);

function safeNum(n: number | null): number | null {
  if (n === null || n === undefined) return null;
  return Number.isFinite(n) ? n : null;
}

function pickStr(form: Record<string, any>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = form[k];
    if (v === undefined || v === null) continue;
    const s = String(Array.isArray(v) ? v[0] : v).trim();
    if (s) return s;
  }
  return null;
}

function asFile(form: Record<string, any>, key: string): File | null {
  const f = form[key];
  const file = Array.isArray(f) ? f[0] : f;
  if (file instanceof File && file.size > 0) return file;
  return null;
}

/** Strip ERP child-table system fields so PUT replace does not fight row names. */
function photoRowForWrite(p: any) {
  return {
    photo_url: p.photo_url,
    photo_type: p.photo_type || "proof",
    caption: p.caption || "",
    captured_at: p.captured_at || null,
    uploaded_by: p.uploaded_by || "",
  };
}

export const trackingRouter = new Hono();

async function findDeliveryByToken(token: string): Promise<any | null> {
  try {
    const list = await erpList<any>("LSH Delivery", {
      filters: [["lsh_qr_token", "=", token]],
      fields: ["name"],
      limit: 1,
    });
    if (!list?.length) return null;
    return await erpGet<any>("LSH Delivery", list[0].name);
  } catch {
    return null;
  }
}

function serializePublic(doc: any, opts: { includeProof: boolean }) {
  const photos = (doc.lsh_photos ?? [])
    .map((p: any) => erpFileAbsoluteUrl(p.photo_url))
    .filter(Boolean);
  const proofUrls = {
    photo1: photos[0] ?? null,
    photo2: photos[1] ?? null,
    photo3: photos[2] ?? null,
    signature: doc.lsh_signature_image_url
      ? erpFileAbsoluteUrl(doc.lsh_signature_image_url)
      : null,
  };

  const delivery_address = doc.lsh_delivery_address ?? null;
  const delivery_apt = doc.lsh_delivery_apt ?? null;
  const delivery_city = doc.lsh_delivery_city ?? null;
  const delivery_state = doc.lsh_delivery_state ?? null;
  const delivery_zip = doc.lsh_delivery_zip ?? null;

  return {
    id: doc.name,
    delivery_no: doc.lsh_supabase_delivery_no ?? doc.name,
    status: doc.lsh_status,
    method: doc.lsh_delivery_method,
    garment_summary: doc.lsh_garment_summary ?? null,
    garment_count: doc.lsh_garment_count ?? 0,
    scheduled_at: doc.lsh_scheduled_at ?? null,
    scheduled_window: null,
    delivered_at: doc.lsh_delivered_at ?? null,
    received_by: doc.lsh_signature_name ?? null,
    signature_name: doc.lsh_signature_name ?? null,
    pod_method: doc.lsh_pod_method ?? null,
    driver_first_name: doc.lsh_courier_name ? String(doc.lsh_courier_name).split(" ")[0] : null,
    // Joined (DeliveryTracking.tsx) + individual (delivered.lstailors.com proxy)
    address: [delivery_address, delivery_apt, delivery_city, delivery_state, delivery_zip]
      .filter(Boolean)
      .join(", ") || null,
    delivery_address,
    delivery_apt,
    delivery_city,
    delivery_state,
    delivery_zip,
    customer_name: doc.customer_name ?? null,
    customer_phone: doc.customer_phone ?? doc.lsh_notify_phone ?? null,
    notes: doc.lsh_delivery_notes ?? null,
    carrier: doc.lsh_carrier ?? null,
    tracking_number: doc.lsh_tracking_number ?? null,
    tracking_url: doc.lsh_tracking_url ?? null,
    proof_urls: opts.includeProof
      ? proofUrls
      : { photo1: null, photo2: null, photo3: null, signature: null },
    source: "erp" as const,
  };
}

// ── GET /api/scan/:token  — public delivery lookup ─────────────────────────

trackingRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  const doc = await findDeliveryByToken(token);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  const isDelivered = doc.lsh_status === "Delivered" || doc.lsh_status === "Picked Up";
  return c.json({ data: serializePublic(doc, { includeProof: isDelivered }) });
});

// ── PATCH /api/scan/:token/pickup  — driver "I have the package" ───────────
// Queued → Out for Delivery. Proxied from delivered.lstailors.com.

trackingRouter.patch("/:token/pickup", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  const doc = await findDeliveryByToken(token);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  if (doc.lsh_status === "Queued") {
    try {
      await erpUpdate("LSH Delivery", doc.name, {
        lsh_status: "Out for Delivery",
        lsh_dispatched_at: erpDatetime(),
      });
      void notifyCustomer(doc, "out_for_delivery");
    } catch (e: any) {
      console.error("[scan/pickup] erp update failed:", e?.message ?? e);
      return c.json({ error: { message: e?.message ?? "Pickup update failed" } }, 500);
    }
  }
  return c.json({ data: { ok: true, source: "erp" } });
});

// ── POST /api/scan/:token/pod  — driver proof of delivery ─────────────────

trackingRouter.post("/:token/pod", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  let form: Record<string, any>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: { message: "Bad form data" } }, 400);
  }

  const now = Date.now();
  const deliveredAt = erpDatetime();
  // DriverCaptureWizard sends pickup_confirmed_by; DeliveryTracking sends received_by
  const receivedBy = pickStr(form, "received_by", "pickup_confirmed_by", "signature_name");
  const driverName = pickStr(form, "driver_name");
  const lat = form["lat"] ? parseFloat(String(form["lat"])) : null;
  const lng = form["lng"] ? parseFloat(String(form["lng"])) : null;
  const accuracy = form["accuracy"] ? parseFloat(String(form["accuracy"])) : null;

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const ALLOWED_MIME = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "", // some mobile browsers omit type
    "application/octet-stream",
  ]);

  for (const key of ["photo_1", "photo_2", "photo_3", "signature"]) {
    const file = asFile(form, key);
    if (!file) continue;
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: { message: `${key} exceeds 10MB limit` } }, 400);
    }
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return c.json(
        { error: { message: `${key} must be an image (JPEG, PNG, WebP, HEIC)` } },
        400,
      );
    }
  }

  const doc = await findDeliveryByToken(token);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  // Idempotent success if already delivered — driver double-tap / flaky wifi
  if (doc.lsh_status === "Delivered") {
    return c.json({ data: { ok: true, source: "erp", already: true } });
  }

  const erpId = doc.name;
  const photoUrls: string[] = [];
  const uploadErrors: string[] = [];

  for (let i = 0; i < 3; i++) {
    const file = asFile(form, `photo_${i + 1}`);
    if (!file) continue;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      // No slash in filename — ERP public URL flattens path separators
      const { fileUrl } = await uploadFile({
        file: buf,
        filename: `${erpId}-photo_${i + 1}_${now}.jpg`,
        contentType: file.type || "image/jpeg",
        doctype: "LSH Delivery",
        docname: erpId,
        isPrivate: false,
      });
      photoUrls.push(erpFileAbsoluteUrl(fileUrl));
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn(`POD photo ${i + 1} upload failed:`, msg);
      uploadErrors.push(`photo_${i + 1}: ${msg}`);
    }
  }

  let signatureUrl: string | null = null;
  const sigFile = asFile(form, "signature");
  if (sigFile) {
    try {
      const buf = new Uint8Array(await sigFile.arrayBuffer());
      const { fileUrl } = await uploadFile({
        file: buf,
        filename: `${erpId}-signature_${now}.png`,
        contentType: "image/png",
        doctype: "LSH Delivery",
        docname: erpId,
        isPrivate: false,
      });
      signatureUrl = erpFileAbsoluteUrl(fileUrl);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn("POD signature upload failed:", msg);
      uploadErrors.push(`signature: ${msg}`);
    }
  }

  const hasPhotos = photoUrls.length > 0;
  const hasSig = !!signatureUrl;
  // Only ERP-valid Select options — "Verbal Confirmation" / "Left at Door" 500 the PUT
  let podMethod = "";
  if (hasPhotos && hasSig) podMethod = "Signature + Photo";
  else if (hasPhotos) podMethod = "Photo Only";
  else if (hasSig) podMethod = "Signature";
  else podMethod = ""; // optional POD — still mark delivered

  if (!VALID_POD_METHODS.has(podMethod)) podMethod = "";

  const existingPhotos = (doc.lsh_photos ?? []).map(photoRowForWrite);
  const photoRows = photoUrls.map((url) => ({
    photo_url: url,
    photo_type: "proof",
    caption: "",
    captured_at: deliveredAt,
    uploaded_by: driverName ?? "driver",
  }));

  const updates: Record<string, unknown> = {
    lsh_status: "Delivered",
    lsh_delivered_at: deliveredAt,
    lsh_courier_name: driverName || doc.lsh_courier_name || null,
    lsh_pod_method: podMethod,
    lsh_signature_name: receivedBy,
    lsh_gps_lat: safeNum(lat),
    lsh_gps_lng: safeNum(lng),
    lsh_gps_accuracy: safeNum(accuracy),
  };
  if (signatureUrl) updates.lsh_signature_image_url = signatureUrl;
  if (photoRows.length > 0) {
    updates.lsh_photos = [...existingPhotos, ...photoRows];
  }

  try {
    await erpUpdate("LSH Delivery", erpId, updates);
  } catch (e: any) {
    const message = e?.message ?? "ERP update failed";
    console.error("[scan/pod] erp update failed:", message, { erpId, podMethod, uploadErrors });
    return c.json(
      {
        error: {
          message,
          uploadErrors: uploadErrors.length ? uploadErrors : undefined,
        },
      },
      500,
    );
  }

  // Customer SMS (same path as staff Mark Delivered)
  void notifyCustomer({ ...doc, ...updates, name: erpId }, "delivered");

  return c.json({
    data: {
      ok: true,
      source: "erp",
      pod_method: podMethod,
      photos: photoUrls.length,
      uploadErrors: uploadErrors.length ? uploadErrors : undefined,
    },
  });
});

// ── PATCH /api/scan/:token/attempted  — driver could not complete ─────────
// ERP Select has no "Attempted" — map to Failed + lsh_attempt_notes.

trackingRouter.patch("/:token/attempted", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  let form: Record<string, any>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: { message: "Bad form data" } }, 400);
  }

  const doc = await findDeliveryByToken(token);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  if (doc.lsh_status === "Delivered") {
    return c.json({ error: { message: "Already delivered" } }, 409);
  }
  if (doc.lsh_status === "Failed") {
    return c.json({ data: { ok: true, source: "erp", already: true } });
  }

  const driverName = pickStr(form, "driver_name");
  const attemptNotes = pickStr(form, "attempt_notes") ?? "";
  const lat = form["lat"] ? parseFloat(String(form["lat"])) : null;
  const lng = form["lng"] ? parseFloat(String(form["lng"])) : null;
  const accuracy = form["accuracy"] ? parseFloat(String(form["accuracy"])) : null;
  const now = Date.now();
  const attemptedAt = erpDatetime();

  let photoUrl: string | null = null;
  const photoFile = asFile(form, "photo_1");
  if (photoFile) {
    try {
      const buf = new Uint8Array(await photoFile.arrayBuffer());
      const { fileUrl } = await uploadFile({
        file: buf,
        filename: `${doc.name}-attempt_${now}.jpg`,
        contentType: photoFile.type || "image/jpeg",
        doctype: "LSH Delivery",
        docname: doc.name,
        isPrivate: false,
      });
      photoUrl = erpFileAbsoluteUrl(fileUrl);
    } catch (e: any) {
      console.warn("[scan/attempted] photo upload failed:", e?.message ?? e);
    }
  }

  const updates: Record<string, unknown> = {
    lsh_status: "Failed",
    lsh_courier_name: driverName || doc.lsh_courier_name || null,
    lsh_attempt_notes: attemptNotes,
    lsh_gps_lat: safeNum(lat),
    lsh_gps_lng: safeNum(lng),
    lsh_gps_accuracy: safeNum(accuracy),
  };

  if (photoUrl) {
    const existingPhotos = (doc.lsh_photos ?? []).map(photoRowForWrite);
    updates.lsh_photos = [
      ...existingPhotos,
      {
        photo_url: photoUrl,
        // ERP Select: proof | signature | package | other — no "attempt"
        photo_type: "other",
        caption: attemptNotes.slice(0, 140),
        captured_at: attemptedAt,
        uploaded_by: driverName ?? "driver",
      },
    ];
  }

  try {
    await erpUpdate("LSH Delivery", doc.name, updates);
  } catch (e: any) {
    const message = e?.message ?? "ERP update failed";
    console.error("[scan/attempted] erp update failed:", message);
    return c.json({ error: { message } }, 500);
  }

  return c.json({ data: { ok: true, source: "erp", status: "Failed" } });
});
