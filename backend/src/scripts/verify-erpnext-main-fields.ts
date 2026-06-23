#!/usr/bin/env bun
/**
 * Field-level audit: compare P0 LSH DocType fields the main app uses vs ERPNext meta.
 * Run after verify:erpnext-main passes. Requires same env vars.
 *
 *   cd backend && bun run verify:erpnext-fields
 */
import "../load-env";

type FieldSpec = {
  doctype: string;
  /** Fields the backend reads (list/get/filter/order). Missing = read failures. */
  read: string[];
  /** Fields the backend writes (create/update/nested child rows). Missing = write failures. */
  write: string[];
  /** Known aliases — app uses these names but ERP may use another (report only). */
  aliases?: Record<string, string>;
};

/** Consolidated from origin/main backend/src (June 2026). */
const P0_FIELD_SPECS: FieldSpec[] = [
  {
    doctype: "Alteration Ticket",
    read: [
      "name", "customer", "customer_name", "customer_phone", "origin_location",
      "workflow_state", "status", "ticket_date", "due_date", "promised_date",
      "ticket_total", "payment_status", "billing_status", "is_rush",
      "internal_notes", "customer_notes", "sales_invoice", "linked_sales_order",
      "included_in_custom", "delivery_method", "notified_ready_at", "picked_up_at",
      "modified", "creation", "assigned_tailor", "docstatus", "lines", "garments",
    ],
    write: [
      "customer", "customer_name", "origin_location", "ticket_date", "due_date",
      "promised_date", "is_rush", "internal_notes", "customer_notes", "delivery_method",
      "assigned_tailor", "workflow_state", "taxes_and_charges", "payment_method",
      "deposit_amount", "notified_ready_at", "lines", "garments",
    ],
    aliases: { status: "workflow_state" },
  },
  {
    doctype: "Alteration Ticket Garment",
    read: ["parent", "garment_type"],
    write: [],
  },
  {
    doctype: "LSH Delivery",
    read: [
      "name", "customer", "customer_name", "customer_phone", "lsh_status",
      "lsh_delivery_method", "lsh_origin_location", "origin_location",
      "lsh_scheduled_at", "lsh_delivered_at", "lsh_dispatched_at",
      "lsh_delivery_address", "lsh_delivery_apt", "lsh_delivery_building",
      "lsh_delivery_city", "lsh_delivery_state", "lsh_delivery_zip",
      "lsh_supabase_delivery_no", "lsh_qr_token", "lsh_courier_name",
      "lsh_courier_phone", "lsh_carrier", "lsh_tracking_number", "lsh_tracking_url",
      "lsh_garment_summary", "lsh_garment_count", "lsh_delivery_notes",
      "lsh_pod_method", "lsh_signature_name", "lsh_signature_image_url",
      "lsh_gps_lat", "lsh_gps_lng", "lsh_gps_accuracy", "lsh_notify_phone",
      "lsh_sales_order", "lsh_alteration_ticket", "lsh_photos", "lsh_timeline",
      "creation", "modified", "docstatus",
    ],
    write: [
      "naming_series", "customer", "customer_name", "customer_phone", "lsh_status",
      "lsh_delivery_method", "lsh_origin_location", "lsh_delivery_address",
      "lsh_delivery_apt", "lsh_delivery_building", "lsh_delivery_city",
      "lsh_delivery_state", "lsh_delivery_zip", "lsh_scheduled_at", "lsh_notify_phone",
      "lsh_qr_token", "lsh_queued_at", "lsh_garment_summary", "lsh_garment_count",
      "lsh_courier_name", "lsh_courier_phone", "lsh_delivery_notes", "lsh_sales_order",
      "lsh_alteration_ticket", "lsh_delivered_at", "lsh_dispatched_at", "lsh_pod_method",
      "lsh_signature_name", "lsh_signature_image_url", "lsh_gps_lat", "lsh_gps_lng",
      "lsh_gps_accuracy", "lsh_carrier", "lsh_tracking_number", "lsh_tracking_url",
      "lsh_timeline", "lsh_photos", "lsh_customer_notified_at", "lsh_label_printed_at",
      "lsh_label_printed_by", "lsh_supabase_delivery_no", "lsh_eta", "lsh_cancelled_at",
      "lsh_calcom_event_id", "lsh_internal_notes", "lsh_failure_reason", "lsh_attempt_notes",
    ],
    aliases: { origin_location: "lsh_origin_location" },
  },
  {
    doctype: "LSH Delivery Timeline",
    read: ["name", "event_type", "event_at", "actor_label", "message"],
    write: ["event_type", "event_at", "actor_label", "message", "gps_lat", "gps_lng", "lsh_metadata"],
  },
  {
    doctype: "LSH Delivery Photo",
    read: ["photo_url", "photo_type", "captured_at", "uploaded_by"],
    write: ["photo_url", "photo_type", "captured_at", "uploaded_by", "caption"],
  },
  {
    doctype: "LSH Notification Log",
    read: [],
    write: [
      "lsh_delivery", "channel", "recipient_phone", "template_id",
      "twilio_sid", "status", "sent_at", "error_message",
    ],
  },
];

function creds() {
  return {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

function authHeaders(key: string, secret: string): Record<string, string> {
  return { Authorization: `token ${key}:${secret}`, Accept: "application/json" };
}

async function fetchMetaFields(doctype: string): Promise<Set<string>> {
  const { base, key, secret } = creds();
  const res = await fetch(`${base}/api/method/frappe.client.get_meta`, {
    method: "POST",
    headers: { ...authHeaders(key, secret), "Content-Type": "application/json" },
    body: JSON.stringify({ doctype }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${doctype}: meta fetch HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message?: { fields?: { fieldname: string }[] } };
  const fields = json.message?.fields ?? [];
  return new Set(fields.map((f) => f.fieldname).filter(Boolean));
}

function diff(expected: string[], actual: Set<string>, aliases?: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const f of expected) {
    if (actual.has(f)) continue;
    const alias = aliases?.[f];
    if (alias && actual.has(alias)) continue;
    missing.push(f);
  }
  return missing;
}

async function main() {
  const { base, key, secret } = creds();
  if (!base || !key || !secret) {
    console.error("Set ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET");
    process.exit(1);
  }

  console.log("P0 field-level audit (main / clever-hellman path)");
  console.log(`Target: ${base}\n`);

  let totalMissing = 0;
  let p0Blockers = 0;

  for (const spec of P0_FIELD_SPECS) {
    console.log(`── ${spec.doctype} ──`);
    let actual: Set<string>;
    try {
      actual = await fetchMetaFields(spec.doctype);
    } catch (e: any) {
      console.log(`  ✗ Could not load meta: ${e.message}`);
      p0Blockers++;
      continue;
    }

    const missRead = diff(spec.read, actual, spec.aliases);
    const missWrite = diff(spec.write, actual, spec.aliases);

    if (missRead.length === 0 && missWrite.length === 0) {
      console.log(`  ✓ All ${spec.read.length + spec.write.length} referenced fields present (${actual.size} total on DocType)`);
    } else {
      if (missRead.length) {
        console.log(`  ✗ Missing READ fields (${missRead.length}): ${missRead.join(", ")}`);
        for (const f of missRead) {
          const alias = spec.aliases?.[f];
          if (alias && actual.has(alias)) {
            console.log(`      ↳ alias exists: ${alias} (code uses ${f})`);
          }
        }
      }
      if (missWrite.length) {
        console.log(`  ✗ Missing WRITE fields (${missWrite.length}): ${missWrite.join(", ")}`);
      }
      totalMissing += missRead.length + missWrite.length;
      if (missWrite.length > 0 || missRead.some((f) => !spec.aliases?.[f])) p0Blockers++;
    }

    // Table child fields on parent
    for (const tableField of ["lines", "garments", "lsh_timeline", "lsh_photos"]) {
      if (!spec.read.includes(tableField) && !spec.write.includes(tableField)) continue;
      if (actual.has(tableField)) {
        console.log(`  ✓ Table field "${tableField}" on parent`);
      } else if (spec.write.includes(tableField) || spec.read.includes(tableField)) {
        console.log(`  ✗ Table field "${tableField}" missing on parent`);
        p0Blockers++;
      }
    }
    console.log();
  }

  console.log("Known code inconsistencies to verify manually:");
  console.log("  • dashboard.ts filters LSH Delivery on origin_location; deliveries.ts uses lsh_origin_location");
  console.log("  • deliveries search-context reads Alteration Ticket.status — may be workflow_state on ERP\n");

  if (p0Blockers > 0) {
    console.log(`⛔ ${p0Blockers} DocType(s) with missing critical fields — review before merge.`);
    process.exit(1);
  }
  if (totalMissing > 0) {
    console.log(`⚠ ${totalMissing} field name(s) not found — check aliases above; may be non-blocking if alias exists.`);
    process.exit(1);
  }
  console.log("✅ P0 field schema matches what the backend expects.");
}

main();
