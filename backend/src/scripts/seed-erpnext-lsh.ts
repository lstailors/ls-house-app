#!/usr/bin/env bun
/**
 * Seed baseline LSH Location + Agent rows in ERPNext (idempotent).
 * Run: bun run src/scripts/seed-erpnext-lsh.ts
 */
import "../load-env";
import { erpList, erpCreate, erpUpdate } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";

const LOCATIONS = [
  { location_code: "NYC", location_name: "New York", short_name: "NYC", is_active: 1, sort_order: 1, timezone: "America/New_York" },
  { location_code: "HOU", location_name: "Houston", short_name: "HOU", is_active: 1, sort_order: 2, timezone: "America/Chicago" },
];

const AGENTS = [
  { slug: "maestro", agent_name: "Maestro", role: "Orchestrator", description: "Chief of staff. Routes tasks, surfaces decisions.", model: "claude-sonnet-4", platform: "Hermes · Mac Studio", color: "brass", icon: "Crown", status: "offline", enabled: 1 },
  { slug: "sofia", agent_name: "Sofia", role: "Client Concierge", description: "All client SMS and voice.", model: "grok-3", platform: "House App · Twilio", color: "emerald", icon: "Phone", status: "offline", enabled: 1 },
  { slug: "mia", agent_name: "Mia", role: "Scheduling & Dossiers", description: "Calendar and client prep.", model: "claude-haiku-3-5", platform: "Mac Studio · Cal.com", color: "blue", icon: "Calendar", status: "offline", enabled: 1 },
  { slug: "rocco", agent_name: "Rocco", role: "Production & Delivery", description: "Floor to delivery pipeline.", model: "claude-sonnet-4", platform: "Mac Studio · MTMPro · ERPNext", color: "amber", icon: "Factory", status: "offline", enabled: 1 },
  { slug: "melena", agent_name: "Melena", role: "Accounting & Books", description: "Billing and reconciliation.", model: "claude-sonnet-4", platform: "Mac Studio · ERPNext · Square", color: "rose", icon: "DollarSign", status: "offline", enabled: 1 },
  { slug: "filo", agent_name: "Filo", role: "Ingestion & Intelligence", description: "Inbox and attachment parsing.", model: "llama3:8b (local)", platform: "Mac Studio · Ollama · IMAP", color: "purple", icon: "Brain", status: "offline", enabled: 1 },
];

async function upsertByField(doctype: string, field: string, doc: Record<string, unknown>) {
  const val = doc[field];
  const existing = await erpList<any>(doctype, {
    filters: [[field, "=", val]],
    fields: ["name"],
    limit: 1,
  });
  if (existing.length) {
    await erpUpdate(doctype, existing[0].name, doc);
    console.log(`  updated ${doctype} ${val}`);
  } else {
    await erpCreate(doctype, doc);
    console.log(`  created ${doctype} ${val}`);
  }
}

async function main() {
  if (!process.env.ERPNEXT_BASE_URL) {
    console.error("ERPNEXT_BASE_URL not set");
    process.exit(1);
  }

  console.log("Seeding LSH Locations...");
  for (const loc of LOCATIONS) {
    await upsertByField(DT.LOCATION, "location_code", loc);
  }

  console.log("Seeding LSH Agents...");
  for (const agent of AGENTS) {
    await upsertByField(DT.AGENT, "slug", agent);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
