/**
 * migrate-deliveries-to-erp.ts
 *
 * Migrates delivery records from Supabase to ERPNext LSH Delivery DocType.
 *
 * Usage:
 *   bun run scripts/migrate-deliveries-to-erp.ts
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ERPNEXT_BASE_URL,
 *   ERPNEXT_API_KEY, ERPNEXT_API_SECRET
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ERPNEXT_BASE_URL = process.env.ERPNEXT_BASE_URL!;
const ERPNEXT_API_KEY = process.env.ERPNEXT_API_KEY!;
const ERPNEXT_API_SECRET = process.env.ERPNEXT_API_SECRET!;

const RATE_LIMIT_MS = 300;
const LOG_FILE = path.join(import.meta.dir, "migration_log.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function erpHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `token ${ERPNEXT_API_KEY}:${ERPNEXT_API_SECRET}`,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function namingSeries(origin: string | null): string {
  if (origin === "HOU") return "DN-HOU-.YYYY.-";
  return "DN-NYC-.YYYY.-";
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** Convert a datetime string (or null) into ERPNext-friendly format (no timezone suffix) */
function toErpDatetime(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return null;
  // ERPNext expects "YYYY-MM-DD HH:MM:SS"
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeliveryRow {
  id: string;
  delivery_no: string | null;
  qr_token: string | null;
  status: string | null;
  method: string | null;
  origin_location: string | null;
  garment_summary: string | null;
  garment_count: number | null;
  driver_name: string | null;
  courier_phone: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  delivery_address: string | null;
  delivery_apt: string | null;
  delivery_building: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_zip: string | null;
  scheduled_at: string | null;
  eta: string | null;
  queued_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  pod_method: string | null;
  signature_name: string | null;
  signature_image_path: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy_meters: number | null;
  notify_phone: string | null;
  customer_notified_at: string | null;
  calcom_event_id: string | null;
  delivery_notes: string | null;
  internal_notes: string | null;
  failure_reason: string | null;
  attempt_notes: string | null;
  label_printed_at: string | null;
  label_printed_by: string | null;
  lsh_erp_id: string | null;
  customers: {
    full_name: string | null;
    phone: string | null;
  } | null;
}

interface TimelineRow {
  delivery_id: string;
  event_type: string | null;
  event_at: string | null;
  actor_label: string | null;
  message: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  metadata: unknown;
}

interface PhotoRow {
  delivery_id: string;
  photo_url: string | null;
  photo_type: string | null;
  caption: string | null;
  captured_at: string | null;
}

interface NotificationLogRow {
  delivery_id: string;
  id: string;
  channel: string | null;
  recipient: string | null;
  message_body: string | null;
  status: string | null;
  sent_at: string | null;
  error_message: string | null;
  [key: string]: unknown;
}

interface MigrationResult {
  delivery_id: string;
  delivery_no: string | null;
  status: "skipped" | "success" | "error";
  erp_name?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ERP customer lookup (cached)
// ---------------------------------------------------------------------------

const customerCache = new Map<string, string>();

async function findErpCustomer(fullName: string | null): Promise<string | null> {
  if (!fullName) return null;
  if (customerCache.has(fullName)) return customerCache.get(fullName)!;

  try {
    const url = new URL(`${ERPNEXT_BASE_URL}/api/resource/Customer`);
    url.searchParams.set("filters", JSON.stringify([["customer_name", "=", fullName]]));
    url.searchParams.set("fields", JSON.stringify(["name", "customer_name"]));
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), { headers: erpHeaders() });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Array<{ name: string }> };
    const name = json.data?.[0]?.name ?? null;
    if (name) customerCache.set(fullName, name);
    return name;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create LSH Delivery in ERP
// ---------------------------------------------------------------------------

async function createErpDelivery(
  delivery: DeliveryRow,
  timeline: TimelineRow[],
  photos: PhotoRow[]
): Promise<string> {
  const customerName = await findErpCustomer(delivery.customers?.full_name ?? null);

  const payload: Record<string, unknown> = {
    doctype: "LSH Delivery",
    naming_series: namingSeries(delivery.origin_location),

    // Customer
    customer: customerName ?? undefined,

    // Core fields
    lsh_supabase_delivery_no: toStr(delivery.delivery_no),
    lsh_qr_token: toStr(delivery.qr_token),
    lsh_status: toStr(delivery.status),
    lsh_delivery_method: toStr(delivery.method),
    lsh_origin_location: toStr(delivery.origin_location),
    lsh_garment_summary: toStr(delivery.garment_summary),
    lsh_garment_count: toNum(delivery.garment_count),

    // Courier
    lsh_courier_name: toStr(delivery.driver_name),
    lsh_courier_phone: toStr(delivery.courier_phone),

    // Carrier / tracking
    lsh_carrier: toStr(delivery.carrier),
    lsh_tracking_number: toStr(delivery.tracking_number),
    lsh_tracking_url: toStr(delivery.tracking_url),

    // Address
    lsh_delivery_address: toStr(delivery.delivery_address),
    lsh_delivery_apt: toStr(delivery.delivery_apt),
    lsh_delivery_building: toStr(delivery.delivery_building),
    lsh_delivery_city: toStr(delivery.delivery_city),
    lsh_delivery_state: toStr(delivery.delivery_state),
    lsh_delivery_zip: toStr(delivery.delivery_zip),

    // Timestamps
    lsh_scheduled_at: toErpDatetime(delivery.scheduled_at),
    lsh_eta: toErpDatetime(delivery.eta),
    lsh_queued_at: toErpDatetime(delivery.queued_at),
    lsh_dispatched_at: toErpDatetime(delivery.dispatched_at),
    lsh_delivered_at: toErpDatetime(delivery.delivered_at),
    lsh_cancelled_at: toErpDatetime(delivery.cancelled_at),

    // Proof of delivery
    lsh_pod_method: toStr(delivery.pod_method),
    lsh_signature_name: toStr(delivery.signature_name),
    lsh_signature_image_url: toStr(delivery.signature_image_path),

    // GPS
    lsh_gps_lat: toNum(delivery.gps_latitude),
    lsh_gps_lng: toNum(delivery.gps_longitude),
    lsh_gps_accuracy: toNum(delivery.gps_accuracy_meters),

    // Notifications / contact
    lsh_notify_phone: toStr(delivery.notify_phone),
    lsh_customer_notified_at: toErpDatetime(delivery.customer_notified_at),

    // Misc
    lsh_calcom_event_id: toStr(delivery.calcom_event_id),
    lsh_delivery_notes: toStr(delivery.delivery_notes),
    lsh_internal_notes: toStr(delivery.internal_notes),
    lsh_failure_reason: toStr(delivery.failure_reason),
    lsh_attempt_notes: toStr(delivery.attempt_notes),
    lsh_label_printed_at: toErpDatetime(delivery.label_printed_at),
    lsh_label_printed_by: toStr(delivery.label_printed_by),

    // Child tables
    lsh_timeline: timeline.map((t) => ({
      doctype: "LSH Delivery Timeline",
      event_type: toStr(t.event_type),
      event_at: toErpDatetime(t.event_at),
      actor_label: toStr(t.actor_label),
      message: toStr(t.message),
      gps_lat: toNum(t.gps_lat),
      gps_lng: toNum(t.gps_lng),
      metadata: t.metadata ? JSON.stringify(t.metadata) : null,
    })),

    lsh_photos: photos.map((p) => ({
      doctype: "LSH Delivery Photo",
      photo_url: toStr(p.photo_url),
      photo_type: toStr(p.photo_type),
      caption: toStr(p.caption),
      captured_at: toErpDatetime(p.captured_at),
    })),
  };

  // Remove null/undefined values to keep payload clean
  for (const key of Object.keys(payload)) {
    if (payload[key] === null || payload[key] === undefined) {
      delete payload[key];
    }
  }

  const res = await fetch(`${ERPNEXT_BASE_URL}/api/resource/LSH Delivery`, {
    method: "POST",
    headers: erpHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ERP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { data: { name: string } };
  return json.data.name;
}

// ---------------------------------------------------------------------------
// Create LSH Notification Log records
// ---------------------------------------------------------------------------

async function createNotificationLogs(
  deliveryId: string,
  erpDeliveryName: string,
  logs: NotificationLogRow[]
): Promise<void> {
  for (const log of logs) {
    try {
      const payload = {
        doctype: "LSH Notification Log",
        lsh_delivery: erpDeliveryName,
        lsh_supabase_delivery_id: deliveryId,
        lsh_channel: toStr(log.channel),
        lsh_recipient: toStr(log.recipient),
        lsh_message_body: toStr(log.message_body),
        lsh_status: toStr(log.status),
        lsh_sent_at: toErpDatetime(log.sent_at),
        lsh_error_message: toStr(log.error_message),
      };

      const res = await fetch(`${ERPNEXT_BASE_URL}/api/resource/LSH Notification Log`, {
        method: "POST",
        headers: erpHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(`  ⚠ Notification log ${log.id} failed: ${res.status} ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`  ⚠ Notification log ${log.id} error:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Validate env
  for (const [k, v] of Object.entries({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    ERPNEXT_BASE_URL,
    ERPNEXT_API_KEY,
    ERPNEXT_API_SECRET,
  })) {
    if (!v) {
      console.error(`Missing env var: ${k}`);
      process.exit(1);
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("=== LSH Delivery Migration: Supabase → ERPNext ===\n");

  // Fetch all deliveries not yet migrated
  const { data: deliveries, error: deliveriesError } = await supabase
    .from("deliveries")
    .select(
      `
      *,
      customers (
        full_name,
        phone
      )
    `
    )
    .order("created_at", { ascending: true });

  if (deliveriesError) {
    console.error("Failed to fetch deliveries:", deliveriesError.message);
    process.exit(1);
  }

  const total = deliveries?.length ?? 0;
  console.log(`Fetched ${total} total delivery records from Supabase.\n`);

  // Pre-fetch related data
  const [
    { data: allTimeline, error: timelineError },
    { data: allPhotos, error: photosError },
    { data: allNotifLogs, error: notifError },
  ] = await Promise.all([
    supabase.from("delivery_timeline").select("*").order("event_at", { ascending: true }),
    supabase.from("delivery_photos").select("*").order("captured_at", { ascending: true }),
    supabase.from("delivery_notification_log").select("*").order("sent_at", { ascending: true }),
  ]);

  if (timelineError) console.warn("Warning: could not fetch delivery_timeline:", timelineError.message);
  if (photosError) console.warn("Warning: could not fetch delivery_photos:", photosError.message);
  if (notifError) console.warn("Warning: could not fetch delivery_notification_log:", notifError.message);

  // Group by delivery_id
  const timelineByDelivery = new Map<string, TimelineRow[]>();
  for (const row of (allTimeline as TimelineRow[]) ?? []) {
    const list = timelineByDelivery.get(row.delivery_id) ?? [];
    list.push(row);
    timelineByDelivery.set(row.delivery_id, list);
  }

  const photosByDelivery = new Map<string, PhotoRow[]>();
  for (const row of (allPhotos as PhotoRow[]) ?? []) {
    const list = photosByDelivery.get(row.delivery_id) ?? [];
    list.push(row);
    photosByDelivery.set(row.delivery_id, list);
  }

  const notifLogsByDelivery = new Map<string, NotificationLogRow[]>();
  for (const row of (allNotifLogs as NotificationLogRow[]) ?? []) {
    const list = notifLogsByDelivery.get(row.delivery_id) ?? [];
    list.push(row);
    notifLogsByDelivery.set(row.delivery_id, list);
  }

  const results: MigrationResult[] = [];
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < (deliveries ?? []).length; i++) {
    const delivery = (deliveries as DeliveryRow[])[i];
    const prefix = `[${i + 1}/${total}]`;

    // Idempotency check
    if (delivery.lsh_erp_id) {
      console.log(`${prefix} SKIP  ${delivery.delivery_no ?? delivery.id} (already migrated: ${delivery.lsh_erp_id})`);
      results.push({
        delivery_id: delivery.id,
        delivery_no: delivery.delivery_no,
        status: "skipped",
        erp_name: delivery.lsh_erp_id,
      });
      skipCount++;
      continue;
    }

    console.log(`${prefix} Processing  ${delivery.delivery_no ?? delivery.id}  [${delivery.status ?? "?"}]`);

    const timeline = timelineByDelivery.get(delivery.id) ?? [];
    const photos = photosByDelivery.get(delivery.id) ?? [];
    const notifLogs = notifLogsByDelivery.get(delivery.id) ?? [];

    try {
      const erpName = await createErpDelivery(delivery, timeline, photos);
      console.log(`  ✓ Created ERP record: ${erpName}`);

      // Update Supabase with ERP id
      const { error: updateError } = await supabase
        .from("deliveries")
        .update({ lsh_erp_id: erpName })
        .eq("id", delivery.id);

      if (updateError) {
        console.warn(`  ⚠ Could not write lsh_erp_id back to Supabase: ${updateError.message}`);
      }

      // Create notification logs
      if (notifLogs.length > 0) {
        console.log(`  ↪ Creating ${notifLogs.length} notification log(s)...`);
        await createNotificationLogs(delivery.id, erpName, notifLogs);
      }

      results.push({
        delivery_id: delivery.id,
        delivery_no: delivery.delivery_no,
        status: "success",
        erp_name: erpName,
      });
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR: ${message}`);
      results.push({
        delivery_id: delivery.id,
        delivery_no: delivery.delivery_no,
        status: "error",
        error: message,
      });
      errorCount++;
    }

    // Rate limit
    await sleep(RATE_LIMIT_MS);
  }

  // Write log
  const log = {
    run_at: new Date().toISOString(),
    total,
    success: successCount,
    skipped: skipCount,
    errors: errorCount,
    results,
  };

  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

  console.log(`\n=== Migration Complete ===`);
  console.log(`  Total:    ${total}`);
  console.log(`  Success:  ${successCount}`);
  console.log(`  Skipped:  ${skipCount}`);
  console.log(`  Errors:   ${errorCount}`);
  console.log(`  Log:      ${LOG_FILE}`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
