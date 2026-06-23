#!/usr/bin/env bun
/**
 * Verify ERPNext has every DocType referenced by the main-branch app.
 * For clever-hellman / main go-live — NOT the lsh_house Frappe app (PR #15).
 *
 * Run from backend/: bun run verify:erpnext-main
 * Requires ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
 */
import "../load-env";

type Tier = "P0" | "P1" | "P2";

type Check = {
  doctype: string;
  tier: Tier;
  feature: string;
  routes: string[];
};

/** DocTypes extracted from origin/main backend/src (June 2026). */
export const MAIN_ERP_DOCTYPES: Check[] = [
  // P0 — core tailoring ops
  { doctype: "Alteration Ticket", tier: "P0", feature: "Alterations pipeline", routes: ["alterations.ts", "intake-alterations.ts", "dashboard.ts"] },
  { doctype: "Alteration Ticket Garment", tier: "P0", feature: "Garment lines on tickets", routes: ["alterations-data.ts"] },
  { doctype: "LSH Delivery", tier: "P0", feature: "Deliveries", routes: ["deliveries.ts", "scan.ts", "dashboard.ts"] },
  { doctype: "LSH Delivery Timeline", tier: "P0", feature: "Delivery status history", routes: ["deliveries.ts", "mcp.ts"] },
  { doctype: "LSH Delivery Photo", tier: "P0", feature: "Proof-of-delivery photos", routes: ["scan.ts"] },
  { doctype: "LSH Notification Log", tier: "P0", feature: "Customer SMS/email log", routes: ["deliveries.ts"] },
  { doctype: "Customer", tier: "P0", feature: "Customer records", routes: ["customers.ts", "deliveries.ts", "intake-alterations.ts"] },
  { doctype: "User", tier: "P0", feature: "Staff auth / roles", routes: ["auth.ts", "me.ts", "scope.ts"] },

  // P1 — major product areas
  { doctype: "HD Ticket", tier: "P1", feature: "In-app Helpdesk", routes: ["helpdesk.ts", "notifications.ts"] },
  { doctype: "Communication", tier: "P1", feature: "Helpdesk threads + outbound comms", routes: ["helpdesk.ts", "comms.ts"] },
  { doctype: "Sales Order", tier: "P1", feature: "Custom orders + dashboard", routes: ["custom-orders.ts", "sales-orders.ts", "dashboard.ts"] },
  { doctype: "Sales Order Item", tier: "P1", feature: "SO line items (child)", routes: ["dashboard.ts"] },
  { doctype: "Sales Invoice", tier: "P1", feature: "Invoices + payments", routes: ["invoices.ts", "sofia.ts"] },
  { doctype: "Payment Entry", tier: "P1", feature: "Record invoice payments", routes: ["invoices.ts"] },
  { doctype: "Appointment", tier: "P1", feature: "Staff calendar", routes: ["appointments.ts"] },
  { doctype: "Event", tier: "P1", feature: "Calendar events", routes: ["appointments.ts"] },
  { doctype: "LSH Booking Agent", tier: "P1", feature: "Booking agent roster", routes: ["appointments.ts"] },
  { doctype: "LSH Appointment Type", tier: "P1", feature: "Appointment types", routes: ["appointments.ts"] },
  { doctype: "Tailor Transfer", tier: "P1", feature: "Inter-location transfers", routes: ["transfers.ts"] },
  { doctype: "Address", tier: "P1", feature: "Customer addresses", routes: ["customer.ts", "intake-alterations.ts"] },
  { doctype: "Contact", tier: "P1", feature: "Customer contacts / search", routes: ["search.ts", "intake-alterations.ts"] },
  { doctype: "Employee", tier: "P1", feature: "Tailor roster", routes: ["alterations-data.ts"] },

  // P2 — integrations & secondary flows
  { doctype: "ToDo", tier: "P2", feature: "Mission Control todos", routes: ["notifications.ts", "search.ts", "sofia.ts"] },
  { doctype: "Company", tier: "P2", feature: "Multi-company / locations", routes: ["locations.ts"] },
  { doctype: "Journal Entry", tier: "P2", feature: "Transfer accounting", routes: ["transfers.ts"] },
  { doctype: "MTMPro Order", tier: "P2", feature: "MTMPro factory orders", routes: ["sales-orders.ts"] },
  { doctype: "Alteration Preset", tier: "P2", feature: "Alteration presets", routes: ["intake-alterations.ts"] },
  { doctype: "Raven Channel", tier: "P2", feature: "Raven messaging", routes: ["raven.ts"] },
  { doctype: "Raven Message", tier: "P2", feature: "Raven DMs", routes: ["raven.ts", "sofia.ts"] },
  { doctype: "Raven User", tier: "P2", feature: "Raven user map", routes: ["raven.ts"] },
  { doctype: "Purchase Invoice", tier: "P2", feature: "Raven vendor bills", routes: ["raven.ts"] },
  { doctype: "Supplier", tier: "P2", feature: "Vendor master", routes: ["raven.ts"] },
];

export const MAIN_PRINT_FORMATS: { doctype: string; format: string; tier: Tier; feature: string }[] = [
  { doctype: "LSH Delivery", format: "LSH Delivery Confirmation", tier: "P0", feature: "Delivery PDF receipt" },
  { doctype: "Alteration Ticket", format: "LSH Alteration Receipt", tier: "P0", feature: "Alteration PDF receipt" },
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

async function checkDocType(doctype: string): Promise<{ ok: boolean; note: string }> {
  const { base, key, secret } = creds();
  const url = new URL(`${base}/api/resource/${encodeURIComponent(doctype)}`);
  url.searchParams.set("fields", JSON.stringify(["name"]));
  url.searchParams.set("limit_page_length", "1");

  const res = await fetch(url.toString(), { headers: authHeaders(key, secret) });
  if (res.ok) return { ok: true, note: "ok" };

  const body = await res.text();
  let note = `HTTP ${res.status}`;
  try {
    const json = JSON.parse(body) as { exception?: string; _server_messages?: string };
    note = json.exception ?? json._server_messages ?? note;
  } catch {
    if (body) note = body.slice(0, 120);
  }
  return { ok: false, note };
}

async function checkPrintFormat(doctype: string, format: string): Promise<{ ok: boolean; note: string }> {
  const { base, key, secret } = creds();
  const url = new URL(`${base}/api/resource/Print%20Format`);
  url.searchParams.set(
    "filters",
    JSON.stringify([
      ["doc_type", "=", doctype],
      ["name", "=", format],
    ]),
  );
  url.searchParams.set("fields", JSON.stringify(["name"]));
  url.searchParams.set("limit_page_length", "1");

  const res = await fetch(url.toString(), { headers: authHeaders(key, secret) });
  if (!res.ok) return { ok: false, note: `HTTP ${res.status}` };
  const json = (await res.json()) as { data?: unknown[] };
  if (json.data?.length) return { ok: true, note: "ok" };
  return { ok: false, note: "Print Format not found" };
}

function tierLabel(tier: Tier): string {
  return tier === "P0" ? "CRITICAL" : tier === "P1" ? "MAJOR" : "SECONDARY";
}

async function main() {
  const { base, key, secret } = creds();
  if (!base || !key || !secret) {
    console.error("Set ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET");
    process.exit(1);
  }

  console.log(`Main-branch ERPNext DocType audit`);
  console.log(`Target: ${base}`);
  console.log(`Branch strategy: existing live DocTypes (NOT lsh_house / PR #15)\n`);

  let pass = 0;
  let fail = 0;
  let p0Fail = 0;

  for (const check of MAIN_ERP_DOCTYPES) {
    const r = await checkDocType(check.doctype);
    const icon = r.ok ? "✓" : "✗";
    console.log(`  ${icon} [${check.tier} ${tierLabel(check.tier)}] ${check.doctype} — ${check.feature}`);
    if (!r.ok) console.log(`      ${r.note}`);
    if (r.ok) pass++;
    else {
      fail++;
      if (check.tier === "P0") p0Fail++;
    }
  }

  console.log("\nPrint formats:");
  for (const pf of MAIN_PRINT_FORMATS) {
    const r = await checkPrintFormat(pf.doctype, pf.format);
    const icon = r.ok ? "✓" : "✗";
    console.log(`  ${icon} [${pf.tier}] ${pf.doctype} → "${pf.format}"`);
    if (!r.ok) console.log(`      ${r.note}`);
    if (r.ok) pass++;
    else {
      fail++;
      if (pf.tier === "P0") p0Fail++;
    }
  }

  console.log(`\n${pass} ok, ${fail} missing`);
  if (p0Fail > 0) {
    console.log(`\n⛔ ${p0Fail} P0 (critical) check(s) failed — do not go live until fixed.`);
    process.exit(1);
  }
  if (fail > 0) {
    console.log(`\n⚠ ${fail} non-critical check(s) failed — review before enabling those features.`);
    process.exit(1);
  }
  console.log("\n✅ All main-branch ERPNext dependencies present.");
}

main();
