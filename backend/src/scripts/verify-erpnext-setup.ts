#!/usr/bin/env bun
/**
 * Verify ERPNext has all LSH DocTypes required by the app.
 * Run: bun run verify:erpnext
 * Requires ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
 *
 * BLOCKER: run only after `bench install-app lsh_house` on production.
 */
import "../load-env";
import { LSH_DOCTYPE_INVENTORY } from "../lib/erpnext/doctypes";

const REQUIRED = Object.entries(LSH_DOCTYPE_INVENTORY).flatMap(([module, doctypes]) =>
  doctypes.map((doctype) => ({ module, doctype })),
);

function creds() {
  return {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

async function checkDocType(doctype: string): Promise<{ ok: boolean; note: string }> {
  const { base, key, secret } = creds();
  const url = new URL(`${base}/api/resource/${encodeURIComponent(doctype)}`);
  url.searchParams.set("fields", JSON.stringify(["name"]));
  url.searchParams.set("limit_page_length", "1");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
  });
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

async function main() {
  const { base, key, secret } = creds();
  if (!base || !key || !secret) {
    console.error("Set ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET");
    process.exit(1);
  }

  console.log(`Checking ${REQUIRED.length} LSH-family DocTypes on ${base}\n`);

  let pass = 0;
  let fail = 0;
  for (const { module, doctype } of REQUIRED) {
    const r = await checkDocType(doctype);
    const icon = r.ok ? "✓" : "✗";
    console.log(`  ${icon} [${module}] ${doctype}${r.ok ? "" : ` — ${r.note}`}`);
    if (r.ok) pass++;
    else fail++;
  }

  console.log(`\n${pass} ok, ${fail} missing`);
  if (fail > 0) {
    console.log("\nInstall the lsh_house Frappe app — see backend/erpnext/INSTALL.md");
    process.exit(1);
  }
  console.log("\n✅ All LSH-family DocTypes present.");
}

main();
