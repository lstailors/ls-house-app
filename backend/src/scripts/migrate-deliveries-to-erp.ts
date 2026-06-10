// backend/src/scripts/migrate-deliveries-to-erp.ts
// One-time migration: reads all delivery data from Supabase, writes to ERPNext.
//
// ERPNext is the SSOT going forward. Supabase is retired for delivery data.
// Supabase Storage bucket (delivery-photos) is kept for binary photo storage.
//
// Run:
//   bun run src/scripts/migrate-deliveries-to-erp.ts
//
// Dry-run (no ERP writes):
//   DRY_RUN=1 bun run src/scripts/migrate-deliveries-to-erp.ts
//
// IDEMPOTENT: deliveries with lsh_erp_id already set in Supabase are skipped.

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";
const ERP_KEY = process.env.ERPNEXT_API_KEY!;
const ERP_SECRET = process.env.ERPNEXT_API_SECRET!;
const RATE_LIMIT_MS = 350;
const DRY_RUN = process.env.DRY_RUN === "1";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!ERP_KEY || !ERP_SECRET) {
  console.error("❌ Missing ERPNEXT_API_KEY or ERPNEXT_API_SECRET");
  process.exit(1);
}

if (DRY_RUN) console.log("🔵 DRY RUN MODE — no ERP writes\n");

// ─── Clients ──────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function erpHeaders(): HeadersInit {
  return {
    Authorization: `token ${ERP_KEY}:${ERP_SECRET}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function erpDatetime(val?: string | null): string | null {
  if (!val) return null;
  return new Date(val).toISOString().replace("T", " ").slice(0, 19);
}

// ─── ERP helpers ─────────────────────────────────────────────────────────────

async function findErpCustomer(fullName: string): Promise<string | null> {
  const params = new URLSearchParams({
    filters: JSON.stringify([["customer_name", "=", fullName]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const res = await fetch(`${ERP_BASE}/api/resource/Customer?${params}`, {
    headers: erpHeaders(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data: Array<{ name: string }> };
  return json.data?.[0]?.name ?? null;
}

async function createErpDelivery(doc: Record<string, unknown>): Promise<string> {
  if (DRY_RUN) return `DRY-${Date.now()}`;
  const res = await fetch(`${ERP_BASE}/api/resource/LSH%20Delivery`, {
    method: "POST",
    headers: erpHeaders(),
    body: JSON.stringify({ ...doc, doctype: "LSH Delivery" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ERP create failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data: { name: string } };
  return json.data.name;
}

async function createErpNotificationLog(doc: Record<string, unknown>): Promise<void> {
  if (DRY_RUN) return;
  const res = await fetch(`${ERP_BASE}/api/resource/LSH%20Notification%20Log`, {
    method: "POST",
    headers: erpHeaders(),
    body: JSON.stringify({ ...doc, doctype: "LSH Notification Log" }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.warn(`  ⚠ Notification log create failed: ${err}`);
  }
}

// ─── Value mappers ────────────────────────────────────────────────────────────

function mapStatus(s: string): string {
  const known = ["Queued", "Out for Delivery", "Delivered", "Cancelled", "Failed"];
  return known.includes(s) ? s : "Queued";
}

function mapMethod(m: string): string {
  const known = ["Hand Delivery", "Courier", "Ship Direct", "Pickup"];
  return known.includes(m) ? m : "Hand Delivery";
}

function mapPodMethod(p: string | null): string {
  if (!p) return "";
  const known = ["Photo Only", "Signature", "Signature + Photo", "In Person"];
  return known.includes(p) ? p : "Photo Only";
}

function namingSeries(location: string): string {
  return location === "HOU" ? "DN-HOU-.YYYY.-" : "DN-NYC-.YYYY.-";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface MigrationResult {
  delivery_no: string;
  erp_name?: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
  error?: string;
  customer?: string;
}

async function main() {
  console.log("🚀 LSH Delivery migration: Supabase → ERPNext\n");

  // 1. Fetch all deliveries with joined customer name
  const { data: deliveries, error: dErr } = await supabase
    .from("deliveries")
    .select(`
      *,
      customers!inner(full_name, phone)
    `)
    .order("created_at", { ascending: true });

  if (dErr || !deliveries) {
    console.error("❌ Supabase fetch failed:", dErr?.message);
    process.exit(1);
  }
  console.log(`Found ${deliveries.length} deliveries in Supabase\n`);

  // 2. Fetch related tables
  const { data: allTimeline } = await supabase.from("delivery_timeline").select("*");
  const { data: allPhotos } = await supabase.from("delivery_photos").select("*");
  const { data: allNotifications } = await supabase.from("delivery_notification_log").select("*");

  // Index by delivery_id
  type AnyRow = Record<string, unknown>;
  const byDelivery = (rows: AnyRow[] | null): Record<string, AnyRow[]> => {
    const map: Record<string, AnyRow[]> = {};
    for (const r of rows ?? []) {
      const id = r.delivery_id as string;
      if (!map[id]) map[id] = [];
      map[id].push(r);
    }
    return map;
  };

  const timelineMap = byDelivery(allTimeline as AnyRow[]);
  const photoMap = byDelivery(allPhotos as AnyRow[]);
  const notifMap = byDelivery(allNotifications as AnyRow[]);

  // Cache customer ERP lookups
  const customerCache: Record<string, string | null> = {};

  const log: MigrationResult[] = [];
  let okCount = 0, skipCount = 0, errCount = 0;

  // 3. Migrate each delivery
  for (const d of deliveries) {
    const record = d as AnyRow;
    const customer = record.customers as { full_name: string; phone: string } | null;
    const deliveryNo = (record.delivery_no as string) ?? "(no number)";
    const deliveryId = record.id as string;

    // Skip if already migrated
    if (record.lsh_erp_id) {
      console.log(`  ⏭  ${deliveryNo} → already migrated (${record.lsh_erp_id})`);
      log.push({ delivery_no: deliveryNo, erp_name: record.lsh_erp_id as string, status: "skipped", reason: "already_migrated" });
      skipCount++;
      continue;
    }

    const fullName = customer?.full_name ?? "";
    if (!fullName) {
      console.warn(`  ⚠  ${deliveryNo} — no customer name, skipping`);
      log.push({ delivery_no: deliveryNo, status: "skipped", reason: "no_customer_name" });
      skipCount++;
      continue;
    }

    // Customer lookup (cached)
    if (!(fullName in customerCache)) {
      customerCache[fullName] = await findErpCustomer(fullName);
    }
    const erpCustomer = customerCache[fullName];
    if (!erpCustomer) {
      console.warn(`  ⚠  ${deliveryNo} — no ERP match for "${fullName}", skipping`);
      log.push({ delivery_no: deliveryNo, status: "skipped", reason: `no_erp_customer: ${fullName}`, customer: fullName });
      skipCount++;
      continue;
    }

    const location = (record.origin_location as string) ?? "NYC";

    // Timeline child rows
    const timelineRows = (timelineMap[deliveryId] ?? []).map((t) => ({
      doctype: "LSH Delivery Timeline",
      event_type: t.event_type ?? "note_added",
      event_at: erpDatetime((t.event_at ?? t.created_at) as string),
      actor_label: t.actor_label ?? "migrated",
      message: t.message ?? "",
      gps_lat: t.gps_lat ?? null,
      gps_lng: t.gps_lng ?? null,
      lsh_metadata: t.metadata ? JSON.stringify(t.metadata) : null,
    }));

    // Photo child rows (binary stays in Supabase Storage; URL goes to ERP)
    const photoRows = (photoMap[deliveryId] ?? []).map((p) => ({
      doctype: "LSH Delivery Photo",
      photo_url: p.photo_url ?? "",
      photo_type: p.photo_type ?? "proof",
      caption: p.caption ?? "",
      captured_at: erpDatetime((p.captured_at ?? p.created_at) as string),
      uploaded_by: p.uploaded_by ?? "migrated",
    }));

    const erpDoc: Record<string, unknown> = {
      naming_series: namingSeries(location),
      customer: erpCustomer,
      customer_name: fullName,
      customer_phone: customer?.phone ?? "",
      lsh_status: mapStatus(record.status as string),
      lsh_delivery_method: mapMethod(record.method as string),
      lsh_origin_location: location,
      lsh_supabase_delivery_no: deliveryNo,
      lsh_qr_token: record.qr_token ?? "",
      lsh_garment_summary: record.garment_summary ?? "",
      lsh_garment_count: record.garment_count ?? 0,
      lsh_delivery_address: record.delivery_address ?? "",
      lsh_delivery_apt: record.delivery_apt ?? "",
      lsh_delivery_building: record.delivery_building ?? "",
      lsh_delivery_city: record.delivery_city ?? "",
      lsh_delivery_state: record.delivery_state ?? "",
      lsh_delivery_zip: record.delivery_zip ?? "",
      lsh_scheduled_at: erpDatetime(record.scheduled_at as string),
      lsh_eta: erpDatetime(record.eta as string),
      lsh_queued_at: erpDatetime(record.queued_at as string),
      lsh_dispatched_at: erpDatetime(record.dispatched_at as string),
      lsh_delivered_at: erpDatetime(record.delivered_at as string),
      lsh_cancelled_at: erpDatetime(record.cancelled_at as string),
      lsh_courier_name: record.driver_name ?? record.courier_name ?? "",
      lsh_courier_phone: record.courier_phone ?? "",
      lsh_carrier: record.carrier ?? "",
      lsh_tracking_number: record.tracking_number ?? "",
      lsh_tracking_url: record.tracking_url ?? "",
      lsh_pod_method: mapPodMethod(record.pod_method as string | null),
      lsh_signature_name: record.signature_name ?? "",
      lsh_signature_image_url: record.signature_image_path ?? record.signature_image_url ?? "",
      lsh_gps_lat: record.gps_latitude ?? record.gps_lat ?? null,
      lsh_gps_lng: record.gps_longitude ?? record.gps_lng ?? null,
      lsh_gps_accuracy: record.gps_accuracy_meters ?? null,
      lsh_notify_phone: record.notify_phone ?? "",
      lsh_customer_notified_at: erpDatetime(record.customer_notified_at as string),
      lsh_calcom_event_id: record.calcom_event_id ?? "",
      lsh_delivery_notes: record.delivery_notes ?? "",
      lsh_internal_notes: record.internal_notes ?? "",
      lsh_failure_reason: record.failure_reason ?? "",
      lsh_attempt_notes: record.attempt_notes ?? "",
      lsh_label_printed_at: erpDatetime(record.label_printed_at as string),
      lsh_label_printed_by: record.label_printed_by ?? "",
      lsh_timeline: timelineRows,
      lsh_photos: photoRows,
    };

    try {
      const erpName = await createErpDelivery(erpDoc);
      console.log(`  ✓  ${deliveryNo} → ${erpName} (${fullName})`);

      if (!DRY_RUN) {
        // Write ERP name back to Supabase (cross-reference only)
        await supabase
          .from("deliveries")
          .update({ lsh_erp_id: erpName })
          .eq("id", deliveryId);

        // Migrate notification logs
        for (const n of notifMap[deliveryId] ?? []) {
          await createErpNotificationLog({
            lsh_delivery: erpName,
            channel: n.channel ?? "SMS",
            recipient_phone: n.recipient_phone ?? "",
            template_id: n.template_id ?? "",
            twilio_sid: n.twilio_sid ?? "",
            status: n.status ?? "sent",
            sent_at: erpDatetime(n.sent_at as string),
            error_message: n.error_message ?? "",
          });
        }
      }

      log.push({ delivery_no: deliveryNo, erp_name: erpName, status: "ok", customer: fullName });
      okCount++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗  ${deliveryNo} FAILED: ${msg}`);
      log.push({ delivery_no: deliveryNo, status: "error", error: msg, customer: fullName });
      errCount++;
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  // Write log
  const logPath = path.join(process.cwd(), "migration_log.json");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Migration complete${DRY_RUN ? " (DRY RUN)" : ""}:`);
  console.log(`  ✓ OK:      ${okCount}`);
  console.log(`  ⏭ Skipped: ${skipCount}`);
  console.log(`  ✗ Errors:  ${errCount}`);
  console.log(`\nFull log → migration_log.json`);

  if (errCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
