import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { erpList, erpGet, erpUpdate } from "../lib/erp";

export const scanRouter = new Hono();

// ── ERPNext lookup by QR token ─────────────────────────────────────────────

async function findErpDelivery(token: string): Promise<any | null> {
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

// ── Supabase signed proof URLs (photo storage stays in Supabase) ───────────

async function signedProofUrls(row: any) {
  const sign = async (bucket: string, path: string | null): Promise<string | null> => {
    if (!path || !supabaseAdmin) return null;
    const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  };
  return {
    photo1: await sign("delivery-proofs", row.pod_photo_1_path ?? null),
    photo2: await sign("delivery-proofs", row.pod_photo_2_path ?? null),
    photo3: await sign("delivery-proofs", row.pod_photo_3_path ?? null),
    signature: await sign("delivery-signatures", row.signature_image_path ?? null),
  };
}

// ── GET /api/scan/:token  — public, no auth ────────────────────────────────

scanRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: { message: "Not found" } }, 404);

  // 1. Try ERPNext first (new deliveries)
  const erpDoc = await findErpDelivery(token);
  if (erpDoc) {
    const isDelivered = erpDoc.lsh_status === "Delivered";

    // ERP stores full public URLs directly — no signing needed
    const photos = (erpDoc.lsh_photos ?? []).map((p: any) => p.photo_url).filter(Boolean);
    const proofUrls = {
      photo1: photos[0] ?? null,
      photo2: photos[1] ?? null,
      photo3: photos[2] ?? null,
      signature: erpDoc.lsh_signature_image_url ?? null,
    };

    return c.json({
      data: {
        id: erpDoc.name,
        delivery_no: erpDoc.lsh_supabase_delivery_no ?? erpDoc.name,
        status: erpDoc.lsh_status,
        method: erpDoc.lsh_delivery_method,
        garment_summary: erpDoc.lsh_garment_summary ?? null,
        garment_count: erpDoc.lsh_garment_count ?? 0,
        scheduled_at: erpDoc.lsh_scheduled_at ?? null,
        scheduled_window: null,
        delivered_at: erpDoc.lsh_delivered_at ?? null,
        received_by: erpDoc.lsh_signature_name ?? null,
        pod_method: erpDoc.lsh_pod_method ?? null,
        driver_first_name: erpDoc.lsh_courier_name ? erpDoc.lsh_courier_name.split(" ")[0] : null,
        address: [erpDoc.lsh_delivery_address, erpDoc.lsh_delivery_apt, erpDoc.lsh_delivery_city, erpDoc.lsh_delivery_state, erpDoc.lsh_delivery_zip]
          .filter(Boolean).join(", ") || null,
        customer_name: erpDoc.customer_name ?? null,
        proof_urls: isDelivered ? proofUrls : { photo1: null, photo2: null, photo3: null, signature: null },
        source: "erp",
      },
    });
  }

  // 2. Fall back to Supabase (legacy deliveries not yet in ERP)
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const { data: row, error } = await supabaseAdmin
    .from("deliveries")
    .select("id,delivery_no,qr_token,status,method,garment_summary,garment_count,scheduled_at,scheduled_date,scheduled_window,delivered_at,received_by,pod_method,pod_photo_1_path,pod_photo_2_path,pod_photo_3_path,signature_image_path,driver_name,delivery_address,delivery_apt,delivery_city,delivery_state,delivery_zip,customer_id")
    .eq("qr_token", token)
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);

  void supabaseAdmin.rpc("increment_qr_scan", { p_token: token, p_scanned_by: "customer" });

  let customerName: string | null = null;
  if ((row as any).customer_id) {
    const { data: cust } = await supabaseAdmin.from("customers").select("full_name").eq("id", (row as any).customer_id).single();
    customerName = cust?.full_name ?? null;
  }

  const isDelivered = (row as any).status === "Delivered";
  const proofUrls = isDelivered ? await signedProofUrls(row) : { photo1: null, photo2: null, photo3: null, signature: null };

  return c.json({
    data: {
      id: (row as any).id,
      delivery_no: (row as any).delivery_no,
      status: (row as any).status,
      method: (row as any).method,
      garment_summary: (row as any).garment_summary,
      garment_count: (row as any).garment_count,
      scheduled_at: (row as any).scheduled_at ?? ((row as any).scheduled_date ? (row as any).scheduled_date + "T09:00:00Z" : null),
      scheduled_window: (row as any).scheduled_window,
      delivered_at: (row as any).delivered_at,
      received_by: (row as any).received_by,
      pod_method: (row as any).pod_method,
      driver_first_name: (row as any).driver_name ? (row as any).driver_name.split(" ")[0] : null,
      address: [(row as any).delivery_address, (row as any).delivery_apt, (row as any).delivery_city, (row as any).delivery_state, (row as any).delivery_zip].filter(Boolean).join(", ") || null,
      customer_name: customerName,
      proof_urls: proofUrls,
      source: "legacy",
    },
  });
});

// ── POST /api/scan/:token/pod  — driver submits proof of delivery ──────────

scanRouter.post("/:token/pod", async (c) => {
  const token = c.req.param("token");
  let form: Record<string, string | File | (string | File)[]>;
  try { form = await c.req.parseBody({ all: true }); }
  catch { return c.json({ error: { message: "Bad form data" } }, 400); }

  const now = Date.now();
  const deliveredAt = new Date().toISOString();
  const receivedBy = String(form["received_by"] ?? "").trim() || null;
  const driverName = String(form["driver_name"] ?? "").trim() || null;
  const lat = form["lat"] ? parseFloat(String(form["lat"])) : null;
  const lng = form["lng"] ? parseFloat(String(form["lng"])) : null;
  const accuracy = form["accuracy"] ? parseFloat(String(form["accuracy"])) : null;

  // ── Validate uploaded files ───────────────────────────────────────────────
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  for (const key of ["photo_1", "photo_2", "photo_3", "signature"]) {
    const f = form[key];
    const file = Array.isArray(f) ? f[0] : f;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_SIZE) return c.json({ error: { message: `${key} exceeds 10MB limit` } }, 400);
      if (!ALLOWED_MIME.includes(file.type)) return c.json({ error: { message: `${key} must be an image (JPEG, PNG, WebP, HEIC)` } }, 400);
    }
  }

  // ── Try ERPNext first ────────────────────────────────────────────────────
  const erpDoc = await findErpDelivery(token);
  if (erpDoc) {
    if (erpDoc.lsh_status === "Delivered") return c.json({ error: { message: "Already delivered" } }, 409);

    const erpId = erpDoc.name;
    const BUCKET = "delivery-photos"; // single bucket, public URLs stored in ERP
    const photoUrls: string[] = [];

    // Upload photos → get public URLs → store in ERP
    if (supabaseAdmin) {
      for (let i = 0; i < 3; i++) {
        const f = form[`photo_${i + 1}`];
        const file = Array.isArray(f) ? f[0] : f;
        if (file instanceof File && file.size > 0) {
          const path = `${erpId}/photo_${i + 1}_${now}.jpg`;
          const buf = await file.arrayBuffer();
          const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
          if (!up) {
            const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
            if (pub?.publicUrl) photoUrls.push(pub.publicUrl);
          }
        }
      }
    }

    let signatureUrl: string | null = null;
    if (supabaseAdmin) {
      const sf = form["signature"];
      const sigFile = Array.isArray(sf) ? sf[0] : sf;
      if (sigFile instanceof File && sigFile.size > 0) {
        const path = `${erpId}/signature_${now}.png`;
        const buf = await sigFile.arrayBuffer();
        const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: false });
        if (!up) {
          const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
          signatureUrl = pub?.publicUrl ?? null;
        }
      }
    }

    const hasPhotos = photoUrls.length > 0;
    const hasSig = !!signatureUrl;
    let podMethod: string;
    if (hasPhotos && hasSig) podMethod = "Signature + Photo";
    else if (hasPhotos) podMethod = "Photo Only";
    else if (hasSig) podMethod = "Signature";
    else podMethod = receivedBy ? "Verbal Confirmation" : "Left at Door";

    // Build photos child table rows with full public URLs
    const photoRows = photoUrls.map(url => ({
      doctype: "LSH Delivery Photo", photo_url: url, photo_type: "proof", captured_at: deliveredAt, uploaded_by: driverName ?? "driver",
    }));
    const existingPhotos = erpDoc.lsh_photos ?? [];

    await erpUpdate("LSH Delivery", erpId, {
      lsh_status: "Delivered",
      lsh_delivered_at: deliveredAt,
      lsh_courier_name: driverName || erpDoc.lsh_courier_name,
      lsh_pod_method: podMethod,
      lsh_signature_name: receivedBy,
      lsh_signature_image_url: signatureUrl,
      lsh_gps_lat: isNaN(lat as number) ? null : lat,
      lsh_gps_lng: isNaN(lng as number) ? null : lng,
      lsh_gps_accuracy: isNaN(accuracy as number) ? null : accuracy,
      lsh_photos: [...existingPhotos, ...photoRows],
    });

    return c.json({ data: { ok: true, source: "erp" } });
  }

  // ── Fall back to Supabase (legacy) ───────────────────────────────────────
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const { data: row, error } = await supabaseAdmin.from("deliveries").select("id,status,customer_id,delivery_no").eq("qr_token", token).single();
  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  if ((row as any).status === "Delivered") return c.json({ error: { message: "Already delivered" } }, 409);

  const id = (row as any).id as string;
  const photoPaths: (string | null)[] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const f = form[`photo_${i + 1}`];
    const file = Array.isArray(f) ? f[0] : f;
    if (file instanceof File && file.size > 0) {
      const path = `${id}/photo_${i + 1}_${now}.jpg`;
      const buf = await file.arrayBuffer();
      const { error: up } = await supabaseAdmin.storage.from("delivery-proofs").upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
      if (!up) photoPaths[i] = path;
    }
  }

  let signaturePath: string | null = null;
  const sf = form["signature"];
  const sigFile = Array.isArray(sf) ? sf[0] : sf;
  if (sigFile instanceof File && sigFile.size > 0) {
    const path = `${id}/signature_${now}.png`;
    const buf = await sigFile.arrayBuffer();
    const { error: up } = await supabaseAdmin.storage.from("delivery-signatures").upload(path, buf, { contentType: "image/png", upsert: false });
    if (!up) signaturePath = path;
  }

  const hasPhotos = photoPaths.some(Boolean);
  const hasSig = !!signaturePath;
  let podMethod: string;
  if (hasPhotos && hasSig) podMethod = "Signature + Photo";
  else if (hasPhotos) podMethod = "Photo Only";
  else if (hasSig) podMethod = "Signature";
  else if ((receivedBy ?? "").toLowerCase().includes("doorman")) podMethod = "Left with Doorman";
  else podMethod = receivedBy ? "Verbal Confirmation" : "Left at Door";

  const { error: updateErr } = await supabaseAdmin.from("deliveries").update({
    status: "Delivered", delivered_at: deliveredAt, driver_name: driverName,
    pod_method: podMethod, pod_photo_1_path: photoPaths[0], pod_photo_2_path: photoPaths[1],
    pod_photo_3_path: photoPaths[2], signature_image_path: signaturePath,
    signature_name: receivedBy, received_by: receivedBy,
    gps_latitude: isNaN(lat as number) ? null : lat,
    gps_longitude: isNaN(lng as number) ? null : lng,
    gps_accuracy_meters: isNaN(accuracy as number) ? null : accuracy,
  }).eq("id", id);

  if (updateErr) return c.json({ error: { message: updateErr.message } }, 500);

  const photoInserts = photoPaths.filter((p): p is string => p !== null).map(storagePath => ({
    delivery_id: id, photo_url: storagePath, photo_type: "proof", captured_at: deliveredAt,
  }));
  if (photoInserts.length > 0) {
    await supabaseAdmin.from("delivery_photos").insert(photoInserts).catch(() => {});
  }

  return c.json({ data: { ok: true, source: "legacy" } });
});
