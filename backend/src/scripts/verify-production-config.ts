#!/usr/bin/env bun
/**
 * Pre-deploy production config check — Supabase + ERPNext + required env vars.
 *
 * Run from backend/ with production (or staging) credentials loaded:
 *   bun run verify:production
 *
 * Exit 0 = safe to deploy. Exit 1 = fix listed blockers first.
 */
import "../load-env";

const STORAGE_BUCKETS = [
  "garment-photos",
  "delivery-photos",
  "delivery-proofs",
  "delivery-signatures",
] as const;

const EDGE_FUNCTIONS = [
  "square-terminal-checkout",
  "square-capture-payment",
  "sofia-email-handler",
] as const;

const SUPABASE_TABLES = [
  { table: "locations", schema: "public" },
  { table: "profiles", schema: "public" },
  { table: "agents", schema: "lsh" },
] as const;

type Result = { ok: boolean; note: string };

function pass(note: string): Result {
  return { ok: true, note };
}
function fail(note: string): Result {
  return { ok: false, note };
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

async function checkEnvVars(): Promise<{ blockers: string[]; warnings: string[] }> {
  const required = [
    "ERPNEXT_BASE_URL",
    "ERPNEXT_API_KEY",
    "ERPNEXT_API_SECRET",
    "JWT_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const recommended = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "AI_GATEWAY_API_KEY"];
  const webapp = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const k of required) {
    if (!env(k)) blockers.push(`Missing ${k}`);
  }
  for (const k of recommended) {
    if (!env(k)) warnings.push(`Missing ${k} (some features disabled)`);
  }
  for (const k of webapp) {
    if (!env(k)) warnings.push(`Missing ${k} — set in Vercel webapp env for photo upload + Square terminal`);
  }

  return { blockers, warnings };
}

async function checkErpNext(): Promise<Result> {
  const base = env("ERPNEXT_BASE_URL");
  const key = env("ERPNEXT_API_KEY");
  const secret = env("ERPNEXT_API_SECRET");
  if (!base || !key || !secret) return fail("ERPNext env not set");

  const url = `${base}/api/resource/LSH%20Delivery?fields=${encodeURIComponent(JSON.stringify(["name"]))}&limit_page_length=1`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
  });
  if (!res.ok) return fail(`ERPNext API HTTP ${res.status}`);
  return pass("ERPNext reachable (LSH Delivery list OK)");
}

async function checkSupabaseTables(url: string, key: string): Promise<Result[]> {
  const results: Result[] = [];
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };

  for (const { table, schema } of SUPABASE_TABLES) {
    const basePath = schema === "public" ? `${url}/rest/v1/${table}` : `${url}/rest/v1/${table}`;
    const reqUrl = `${basePath}?select=*&limit=1`;
    const reqHeaders =
      schema === "lsh"
        ? { ...headers, "Accept-Profile": "lsh", "Content-Profile": "lsh" }
        : headers;

    const res = await fetch(reqUrl, { headers: reqHeaders });
    if (res.ok) {
      results.push(pass(`Table ${schema}.${table} readable`));
    } else {
      const body = await res.text();
      results.push(fail(`Table ${schema}.${table} — HTTP ${res.status}: ${body.slice(0, 80)}`));
    }
  }
  return results;
}

async function checkStorageBuckets(url: string, key: string): Promise<Result[]> {
  const results: Result[] = [];
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const listRes = await fetch(`${url}/storage/v1/bucket`, { headers });
  if (!listRes.ok) {
    return [fail(`Storage bucket list HTTP ${listRes.status}`)];
  }

  const buckets = (await listRes.json()) as { name?: string; id?: string }[];
  const names = new Set(buckets.map((b) => b.name ?? b.id ?? ""));

  for (const bucket of STORAGE_BUCKETS) {
    if (names.has(bucket)) results.push(pass(`Storage bucket "${bucket}" exists`));
    else results.push(fail(`Storage bucket "${bucket}" missing`));
  }
  return results;
}

async function checkEdgeFunctions(url: string, key: string): Promise<Result[]> {
  const results: Result[] = [];
  for (const fn of EDGE_FUNCTIONS) {
    const res = await fetch(`${url}/functions/v1/${fn}`, {
      method: "OPTIONS",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    // 404 = not deployed; 200/204/405 = exists
    if (res.status === 404) results.push(fail(`Edge function "${fn}" not found (404)`));
    else results.push(pass(`Edge function "${fn}" deployed (HTTP ${res.status})`));
  }
  return results;
}

async function main() {
  console.log("Production config check (main / clever-hellman hybrid deploy)\n");

  const { blockers: envBlockers, warnings } = await checkEnvVars();

  if (envBlockers.length) {
    console.log("⛔ Missing required env vars:");
    for (const b of envBlockers) console.log(`   ✗ ${b}`);
    console.log();
  } else {
    console.log("✓ Required backend env vars present\n");
  }

  if (warnings.length) {
    console.log("⚠ Warnings:");
    for (const w of warnings) console.log(`   • ${w}`);
    console.log();
  }

  let failures = envBlockers.length;

  if (env("ERPNEXT_BASE_URL")) {
    const erp = await checkErpNext();
    console.log(erp.ok ? `✓ ${erp.note}` : `✗ ${erp.note}`);
    if (!erp.ok) failures++;
  }

  const sbUrl = env("SUPABASE_URL");
  const sbKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (sbUrl && sbKey) {
    console.log("\nSupabase:");
    for (const r of await checkSupabaseTables(sbUrl, sbKey)) {
      console.log(r.ok ? `  ✓ ${r.note}` : `  ✗ ${r.note}`);
      if (!r.ok) failures++;
    }
    for (const r of await checkStorageBuckets(sbUrl, sbKey)) {
      console.log(r.ok ? `  ✓ ${r.note}` : `  ✗ ${r.note}`);
      if (!r.ok) failures++;
    }
    for (const r of await checkEdgeFunctions(sbUrl, sbKey)) {
      console.log(r.ok ? `  ✓ ${r.note}` : `  ✗ ${r.note}`);
      if (!r.ok) failures++;
    }
  }

  console.log("\nSmoke tests after deploy:");
  console.log("  1. Mission Control KPIs with location filter — deliveriesDue > 0");
  console.log("  2. Delivery search autocomplete — alteration tickets appear");
  console.log("  3. Intake photo upload — garment-photos bucket");
  console.log("  4. Square terminal — square-terminal-checkout function");

  if (failures > 0) {
    console.log(`\n⛔ ${failures} blocker(s) — fix before deploy.`);
    process.exit(1);
  }
  console.log("\n✅ Config check passed — safe to deploy.");
}

main();
