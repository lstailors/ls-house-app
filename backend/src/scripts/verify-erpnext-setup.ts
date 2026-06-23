#!/usr/bin/env bun
/**
 * Verify ERPNext has all LSH DocTypes required by the app.
 * Run: bun run src/scripts/verify-erpnext-setup.ts
 * Requires ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
 */
import "../load-env";
import { erpList } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";

const REQUIRED = Object.values(DT).filter((d) => !["Customer", "Address", "Employee", "File"].includes(d));

async function check(doctype: string): Promise<{ ok: boolean; note: string }> {
  try {
    await erpList(doctype, { fields: ["name"], limit: 1 });
    return { ok: true, note: "ok" };
  } catch (e: any) {
    return { ok: false, note: e?.message ?? "failed" };
  }
}

async function main() {
  const base = process.env.ERPNEXT_BASE_URL ?? "";
  if (!base) {
    console.error("ERPNEXT_BASE_URL not set");
    process.exit(1);
  }

  console.log(`Checking ${REQUIRED.length} LSH DocTypes on ${base}\n`);

  let pass = 0;
  let fail = 0;
  for (const dt of REQUIRED) {
    const r = await check(dt);
    const icon = r.ok ? "✓" : "✗";
    console.log(`  ${icon} ${dt}${r.ok ? "" : ` — ${r.note}`}`);
    if (r.ok) pass++;
    else fail++;
  }

  console.log(`\n${pass} ok, ${fail} missing`);
  if (fail > 0) {
    console.log("\nInstall the lsh_house Frappe app — see backend/erpnext/INSTALL.md");
    process.exit(1);
  }
}

main();
