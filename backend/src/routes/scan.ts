import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase.js";

export const scanRouter = new Hono();

// Public columns only — never return internal_notes, created_by, or raw GPS
const PUBLIC_COLS = [
  "id",
  "delivery_no",
  "qr_token",
  "status",
  "method",
  "garment_summary",
  "garment_count",
  "scheduled_at",
  "scheduled_date",
  "scheduled_window",
  "delivered_at",
  "received_by",
  "pod_method",
  "pod_photo_1_path",
  "pod_photo_2_path",
  "pod_photo_3_path",
  "signature_image_path",
  "driver_name",
  "delivery_address",
  "delivery_apt",
  "delivery_city",
  "delivery_state",
  "delivery_zip",
  "customer_id",
].join(",");

async function signedProofUrls(row: any): Promise<{
  photo1: string | null;
  photo2: string | null;
  photo3: string | null;
  signature: string | null;
}> {
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path || !supabaseAdmin) return null;
    const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  };
  return {
    photo1: await sign("delivery-proofs", row.pod_photo_1_path),
    photo2: await sign("delivery-proofs", row.pod_photo_2_path),
    photo3: await sign("delivery-proofs", row.pod_photo_3_path),
    signature: await sign("delivery-signatures", row.signature_image_path),
  };
}

// GET /api/scan/:token  — public, no auth
scanRouter.get("/:token", async (c) => {
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  const { data: rowRaw, error } = await supabaseAdmin
    .from("deliveries")
    .select(PUBLIC_COLS)
    .eq("qr_token", token)
    .single();

  if (error || !rowRaw) return c.json({ error: { message: "Not found" } }, 404);
  const row = rowRaw as any;

  // Increment scan count (fire-and-forget)
  void supabaseAdmin.rpc("increment_qr_scan", { p_token: token, p_scanned_by: "customer" });

  // Fetch customer name
  let customerName: string | null = null;
  if (row.customer_id) {
    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("full_name")
      .eq("id", row.customer_id)
      .single();
    customerName = cust?.full_name ?? null;
  }

  // Signed proof URLs (only when delivered)
  const isDelivered = row.status === "Delivered";
  const proofUrls = isDelivered ? await signedProofUrls(row) : { photo1: null, photo2: null, photo3: null, signature: null };

  return c.json({
    data: {
      id: row.id,
      delivery_no: row.delivery_no,
      status: row.status,
      method: row.method,
      garment_summary: row.garment_summary,
      garment_count: row.garment_count,
      scheduled_at: row.scheduled_at ?? (row.scheduled_date ? row.scheduled_date + "T09:00:00Z" : null),
      scheduled_window: row.scheduled_window,
      delivered_at: row.delivered_at,
      received_by: row.received_by,
      pod_method: row.pod_method,
      driver_first_name: row.driver_name ? row.driver_name.split(" ")[0] : null,
      address: [row.delivery_address, row.delivery_apt, row.delivery_city, row.delivery_state, row.delivery_zip]
        .filter(Boolean).join(", ") || null,
      customer_name: customerName,
      proof_urls: proofUrls,
    },
  });
});

// POST /api/scan/:token/pod  — driver submits proof of delivery (multipart form)
scanRouter.post("/:token/pod", async (c) => {
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
  const token = c.req.param("token");

  let form: Record<string, string | File | (string | File)[]>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: { message: "Bad form data" } }, 400);
  }

  // Look up delivery by qr_token directly
  const { data: row, error } = await supabaseAdmin
    .from("deliveries")
    .select("id, status, customer_id, delivery_no")
    .eq("qr_token", token)
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  if (row.status === "Delivered") return c.json({ error: { message: "Already delivered" } }, 409);

  const id = row.id as string;
  const now = Date.now();
  const deliveredAt = new Date().toISOString();

  // Upload photos to delivery-proofs
  const photoPaths: (string | null)[] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const f = form[`photo_${i + 1}`];
    const file = Array.isArray(f) ? f[0] : f;
    if (file instanceof File && file.size > 0) {
      const path = `${id}/photo_${i + 1}_${now}.jpg`;
      const buf = await file.arrayBuffer();
      const { error: up } = await supabaseAdmin.storage
        .from("delivery-proofs")
        .upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
      if (!up) photoPaths[i] = path;
    }
  }

  // Upload signature to delivery-signatures
  let signaturePath: string | null = null;
  const sf = form["signature"];
  const sigFile = Array.isArray(sf) ? sf[0] : sf;
  if (sigFile instanceof File && sigFile.size > 0) {
    const path = `${id}/signature_${now}.png`;
    const buf = await sigFile.arrayBuffer();
    const { error: up } = await supabaseAdmin.storage
      .from("delivery-signatures")
      .upload(path, buf, { contentType: "image/png", upsert: false });
    if (!up) signaturePath = path;
  }

  const hasPhotos = photoPaths.some(Boolean);
  const hasSig = !!signaturePath;
  const receivedBy = String(form["received_by"] ?? "").trim() || null;
  const driverName = String(form["driver_name"] ?? "").trim() || null;
  const lat = form["lat"] ? parseFloat(String(form["lat"])) : null;
  const lng = form["lng"] ? parseFloat(String(form["lng"])) : null;
  const accuracy = form["accuracy"] ? parseFloat(String(form["accuracy"])) : null;

  // Auto-determine pod_method
  let podMethod: string;
  if (hasPhotos && hasSig) podMethod = "Signature + Photo";
  else if (hasPhotos) podMethod = "Photo Only";
  else if (hasSig) podMethod = "Signature";
  else if ((receivedBy ?? "").toLowerCase().includes("doorman")) podMethod = "Left with Doorman";
  else podMethod = receivedBy ? "Verbal Confirmation" : "Left at Door";

  const { error: updateErr } = await supabaseAdmin
    .from("deliveries")
    .update({
      status: "Delivered",
      delivered_at: deliveredAt,
      driver_name: driverName,
      pod_method: podMethod,
      pod_photo_1_path: photoPaths[0],
      pod_photo_2_path: photoPaths[1],
      pod_photo_3_path: photoPaths[2],
      signature_image_path: signaturePath,
      signature_name: receivedBy,
      received_by: receivedBy,
      gps_latitude: isNaN(lat as number) ? null : lat,
      gps_longitude: isNaN(lng as number) ? null : lng,
      gps_accuracy_meters: isNaN(accuracy as number) ? null : accuracy,
    })
    .eq("id", id);

  if (updateErr) return c.json({ error: { message: updateErr.message } }, 500);

  // Insert delivery_photos rows
  const photoInserts = photoPaths
    .filter((p): p is string => p !== null)
    .map((storagePath) => ({
      delivery_id: id,
      photo_url: storagePath,
      photo_type: "proof",
      captured_at: deliveredAt,
    }));
  if (photoInserts.length > 0) {
    await supabaseAdmin.from("delivery_photos").insert(photoInserts).then().catch(() => {});
  }

  return c.json({ data: { ok: true } });
});
