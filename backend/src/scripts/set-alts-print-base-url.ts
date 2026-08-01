#!/usr/bin/env bun
/**
 * Flip ERP LSH Print Settings.app_base_url → https://alts.lstailors.com
 *
 * Run on Mac Studio (has ~/ls-mcp/.env) or any host with ERPNEXT_* set:
 *   cd backend && bun run src/scripts/set-alts-print-base-url.ts
 *
 * Optional:
 *   TARGET_URL=https://alts.lstailors.com  (default)
 *   DRY_RUN=1                              (read + print only)
 */
import "../load-env";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DOCTYPE = "LSH Print Settings";
const NAME = "LSH Print Settings";
const TARGET = (process.env.TARGET_URL ?? "https://alts.lstailors.com").replace(/\/$/, "");
const DRY = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

function loadMcpEnv() {
  const candidates = [
    join(homedir(), "ls-mcp", ".env"),
    join(homedir(), "ls-house-app", "backend", ".env"),
    join(process.cwd(), ".env"),
  ];
  for (const path of candidates) {
    try {
      const content = readFileSync(path, "utf8");
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const key = t.slice(0, eq).trim();
        const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!key || process.env[key] !== undefined) continue;
        // Map common ls-mcp aliases
        if (key === "ERPNEXT_URL" && !process.env.ERPNEXT_BASE_URL) {
          process.env.ERPNEXT_BASE_URL = val;
        } else {
          process.env[key] = val;
        }
      }
      console.log(`Loaded env from ${path}`);
      return;
    } catch {
      /* try next */
    }
  }
}

loadMcpEnv();

function creds() {
  return {
    base: (process.env.ERPNEXT_BASE_URL ?? process.env.ERPNEXT_URL ?? "").replace(/\/$/, ""),
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

function headers(key: string, secret: string) {
  return {
    Authorization: `token ${key}:${secret}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
  };
}

async function main() {
  const { base, key, secret } = creds();
  if (!base || !key || !secret) {
    console.error("Missing ERPNEXT_BASE_URL / ERPNEXT_API_KEY / ERPNEXT_API_SECRET");
    console.error("On Mac Studio: ensure ~/ls-mcp/.env is present, or export the three vars.");
    process.exit(1);
  }

  const getRes = await fetch(`${base}/api/resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(NAME)}`, {
    headers: headers(key, secret),
  });
  if (!getRes.ok) {
    console.error(`GET failed HTTP ${getRes.status}:`, (await getRes.text()).slice(0, 400));
    process.exit(1);
  }
  const before = ((await getRes.json()) as { data?: { app_base_url?: string } }).data;
  const prev = String(before?.app_base_url ?? "").trim();
  console.log(`Current app_base_url: ${prev || "(empty)"}`);
  console.log(`Target:              ${TARGET}`);

  if (prev.replace(/\/$/, "") === TARGET) {
    console.log("Already correct — nothing to do.");
    process.exit(0);
  }

  if (DRY) {
    console.log("DRY_RUN=1 — not writing.");
    process.exit(0);
  }

  const putRes = await fetch(`${base}/api/resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(NAME)}`, {
    method: "PUT",
    headers: headers(key, secret),
    body: JSON.stringify({ app_base_url: TARGET }),
  });
  if (!putRes.ok) {
    // Fallback: set_value (some singles reject partial PUT)
    const setRes = await fetch(`${base}/api/method/frappe.client.set_value`, {
      method: "POST",
      headers: headers(key, secret),
      body: JSON.stringify({
        doctype: DOCTYPE,
        name: NAME,
        fieldname: "app_base_url",
        value: TARGET,
      }),
    });
    if (!setRes.ok) {
      console.error(`PUT failed HTTP ${putRes.status}:`, (await putRes.text()).slice(0, 400));
      console.error(`set_value failed HTTP ${setRes.status}:`, (await setRes.text()).slice(0, 400));
      process.exit(1);
    }
  }

  const verify = await fetch(`${base}/api/resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(NAME)}`, {
    headers: headers(key, secret),
  });
  const after = ((await verify.json()) as { data?: { app_base_url?: string } }).data;
  const now = String(after?.app_base_url ?? "").trim().replace(/\/$/, "");
  if (now !== TARGET) {
    console.error(`Write did not stick. Still: ${now || "(empty)"}`);
    process.exit(1);
  }
  console.log(`✓ LSH Print Settings.app_base_url → ${TARGET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
