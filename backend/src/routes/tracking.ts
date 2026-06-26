/**
 * Public delivery tracking endpoints — used by the driver/customer
 * delivery tracking page at /d/:token (DeliveryTracking.tsx).
 *
 * These endpoints are intentionally unauthenticated so drivers can access
 * them without an ERPNext session. They are scoped to LSH Delivery only.
 */

import { Hono } from "hono";
import { erpList, erpGet, erpUpdate } from "../lib/erp";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";

function erpDatetime(d?: Date | string | null): string {
  const dt = d ? new Date(d) : new Date();
  return dt.toISOString().replace("T", " ").slice(0, 19);
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

// ── GET /api/scan/:token  — public delivery lookup ─────────────────────────

trackingRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  const doc = await findDeliveryByToken(token);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);

  const isDelivered = doc.lsh_status === "Delivered";

  const photos = (doc.lsh_photos ?? [])
    .map((p: any) => erpFileAbsoluteUrl(p.photo_url))
    .filter(Boolean);
  const proofUrls = {
    photo1:    photos[0] ?? null,
    photo2:    photos[1] ?? null,
    photo3:    photos[2] ?? null,
    signature: doc.lsh_signature_image_url
      ? erpFileAbsoluteUrl(doc.lsh_signature_image_url)
      : null,
  };

  return c.json({
    data: {
      id:               doc.name,
      delivery_no:      doc.lsh_supabase_delivery_no ?? doc.name,
      status:           doc.lsh_status,
      method:           doc.lsh_delivery_method,
      garment_summary:  doc.lsh_garment_summary ?? null,
      garment_count:    doc.lsh_garment_count ?? 0,
      scheduled_at:     doc.lsh_scheduled_at ?? null,
      scheduled_window: null,
      delivered_at:     doc.lsh_delivered_at ?? null,
      received_by:      doc.lsh_signature_name ?? null,
      pod_method:       doc.lsh_pod_method ?? null,
      driver_first_name: doc.lsh_courier_name ? doc.lsh_courier_name.split(" ")[0] : null,
      address: [
        doc.lsh_delivery_address,
        doc.lsh_delivery_apt,
        doc.lsh_delivery_city,
        doc.lsh_delivery_state,
        doc.lsh_delivery_zip,
      ].filter(Boolean).join(", ") || null,
      customer_name: doc.customer_name ?? null,
      proof_urls: isDelivered ? proofUrls : { photo1: null, photo2: null, photo3: null, signature: null },
      source: "erp",
    },
  });
});

// ── POST /api/scan/:token/pod  — driver proof of delivery ─────────────────

trackingRouter.post("/:token/pod", async (c) => {
  const token = c.req.param("token");
  let form: Record<string, any>;
  try { form = await c.req.parseBody({ all: true }); }
  catch { return c.json({ error: { message: "Bad form data" } }, 400); }

  const now        = Date.now();
  const deliveredAt = erpDatetime();
  const receivedBy  = String(form["received_by"] ?? "").trim() || null;
  const driverName  = String(form["driver_name"] ?? "").trim() || null;
  const lat         = form["lat"] ? parseFloat(String(form["lat"])) : null;
  const lng         = form["lng"] ? parseFloat(String(form["lng"])) : null;
  const accuracy    = form["accuracy"] ? parseFloat(String(form["accuracy"])) : null;

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const ALLOWED_MIME  = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  for (const key of ["photo_1", "photo_2", "photo_3", "signature"]) {
    const f    = form[key];
    const file = Array.isArray(f) ? f[0] : f;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_SIZE)
        return c.json({ error: { message: `${key} exceeds 10MB limit` } }, 400);
      if (!ALLOWED_MIME.includes(file.type))
        return c.json({ error: { message: `${key} must be an image (JPEG, PNG, WebP, HEIC)` } }, 400);
    }
  }

  const doc = await findDeliveryByToken(token);
  if (!doc) return c.json({ error: { message: "Not found" } }, 404);
  if (doc.lsh_status === "Delivered")
    return c.json({ error: { message: "Already delivered" } }, 409);

  const erpId      = doc.name;
  const photoUrls: string[] = [];

  for (let i = 0; i < 3; i++) {
    const f    = form[`photo_${i + 1}`];
    const file = Array.isArray(f) ? f[0] : f;
    if (file instanceof File && file.size > 0) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const { fileUrl } = await uploadFile({
          file:        buf,
          filename:    `${erpId}/photo_${i + 1}_${now}.jpg`,
          contentType: file.type || "image/jpeg",
          doctype:     "LSH Delivery",
          docname:     erpId,
          isPrivate:   false,
        });
        photoUrls.push(erpFileAbsoluteUrl(fileUrl));
      } catch (e) {
        console.warn(`POD photo ${i + 1} upload failed:`, e);
      }
    }
  }

  let signatureUrl: string | null = null;
  const sf      = form["signature"];
  const sigFile = Array.isArray(sf) ? sf[0] : sf;
  if (sigFile instanceof File && sigFile.size > 0) {
    try {
      const buf = new Uint8Array(await sigFile.arrayBuffer());
      const { fileUrl } = await uploadFile({
        file:        buf,
        filename:    `${erpId}/signature_${now}.png`,
        contentType: "image/png",
        doctype:     "LSH Delivery",
        docname:     erpId,
        isPrivate:   false,
      });
      signatureUrl = erpFileAbsoluteUrl(fileUrl);
    } catch (e) {
      console.warn("POD signature upload failed:", e);
    }
  }

  const hasPhotos = photoUrls.length > 0;
  const hasSig    = !!signatureUrl;
  let podMethod: string;
  if (hasPhotos && hasSig)      podMethod = "Signature + Photo";
  else if (hasPhotos)           podMethod = "Photo Only";
  else if (hasSig)              podMethod = "Signature";
  else                          podMethod = receivedBy ? "Verbal Confirmation" : "Left at Door";

  const photoRows      = photoUrls.map((url) => ({
    doctype:     "LSH Delivery Photo",
    photo_url:   url,
    photo_type:  "proof",
    captured_at: deliveredAt,
    uploaded_by: driverName ?? "driver",
  }));
  const existingPhotos = doc.lsh_photos ?? [];

  await erpUpdate("LSH Delivery", erpId, {
    lsh_status:               "Delivered",
    lsh_delivered_at:         deliveredAt,
    lsh_courier_name:         driverName || doc.lsh_courier_name,
    lsh_pod_method:           podMethod,
    lsh_signature_name:       receivedBy,
    lsh_signature_image_url:  signatureUrl,
    lsh_gps_lat:              isNaN(lat  as number) ? null : lat,
    lsh_gps_lng:              isNaN(lng  as number) ? null : lng,
    lsh_gps_accuracy:         isNaN(accuracy as number) ? null : accuracy,
    lsh_photos:               [...existingPhotos, ...photoRows],
  });

  return c.json({ data: { ok: true, source: "erp" } });
});
