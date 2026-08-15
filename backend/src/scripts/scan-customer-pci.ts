#!/usr/bin/env bun
/**
 * Scan ERP Customer records for magstripe / PAN / garbage names.
 * Default: dry-run report (no writes). Pass --apply to rewrite confirmed track/PAN hits.
 *
 * Never prints a full PAN. Logs last-4 + extracted name only.
 *
 *   bun run src/scripts/scan-customer-pci.ts
 *   bun run src/scripts/scan-customer-pci.ts --apply
 */
import "../load-env";
import { erpDelete, erpGet, erpList, erpUpdate } from "../lib/erp";
import {
  containsPan,
  findPanHits,
  maskTrack,
  suggestedNameFromRecord,
  stripPan,
} from "../lib/pci-guard";
import { flagsForCustomer, isMarketingEmail, isWeirdName, type QualityFlag } from "../lib/customer-quality";

const APPLY = process.argv.includes("--apply");
const PAGE = 200;

const SCAN_FIELDS = [
  "name",
  "customer_name",
  "first_name",
  "last_name",
  "preferred_name",
  "mobile_no",
  "email_id",
  "customer_details",
  "disabled",
];

type ReportRow = {
  id: string;
  flags: QualityFlag[];
  display: string;
  suggestedName?: string;
  last4?: string;
  action?: "rewritten" | "dry_run" | "skipped";
};

function logSafe(event: string, payload: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...payload }));
}

async function pageCustomers(start: number) {
  return erpList<any>("Customer", {
    fields: SCAN_FIELDS,
    limit: PAGE,
    start,
    order_by: "creation asc",
  });
}

async function redactHistory(customerId: string) {
  const versions = await erpList<any>("Version", {
    filters: [
      ["ref_doctype", "=", "Customer"],
      ["docname", "=", customerId],
    ],
    fields: ["name", "data"],
    limit: 100,
  }).catch(() => []);
  for (const v of versions) {
    if (!containsPan(v.data)) continue;
    try {
      await erpUpdate("Version", v.name, { data: maskTrack(String(v.data || "")) });
    } catch {
      await erpDelete("Version", v.name).catch(() => {});
    }
    logSafe("pci.history_redacted", { doctype: "Version", customerId });
  }

  const comments = await erpList<any>("Comment", {
    filters: [
      ["reference_doctype", "=", "Customer"],
      ["reference_name", "=", customerId],
    ],
    fields: ["name", "content"],
    limit: 100,
  }).catch(() => []);
  for (const c of comments) {
    if (!containsPan(c.content)) continue;
    try {
      await erpUpdate("Comment", c.name, { content: stripPan(String(c.content || "")) || "[redacted]" });
    } catch {
      await erpDelete("Comment", c.name).catch(() => {});
    }
    logSafe("pci.history_redacted", { doctype: "Comment", customerId });
  }
}

async function rewrite(row: any): Promise<string> {
  const suggested = suggestedNameFromRecord({
    customer_name: row.customer_name,
    first_name: row.first_name,
    last_name: row.last_name,
    preferred_name: row.preferred_name,
  });
  const patch: Record<string, unknown> = {};
  for (const field of ["customer_name", "first_name", "last_name", "preferred_name", "customer_details", "mobile_no", "email_id"]) {
    const cur = row[field];
    if (typeof cur !== "string" || !containsPan(cur)) continue;
    if (field === "customer_name") patch.customer_name = suggested;
    else if (field === "preferred_name") patch.preferred_name = stripPan(cur) || suggested;
    else if (field === "first_name" || field === "last_name") patch[field] = stripPan(cur);
    else if (field === "customer_details") patch.customer_details = stripPan(cur);
    else if (field === "mobile_no" || field === "email_id") patch[field] = "";
  }
  if (!patch.customer_name && containsPan(row.customer_name)) patch.customer_name = suggested;
  if (Object.keys(patch).length === 0) return suggested;
  await erpUpdate("Customer", row.name, patch);
  await redactHistory(row.name);
  const check = await erpGet<any>("Customer", row.name);
  if (containsPan(check?.customer_name) || containsPan(check?.customer_details)) {
    throw new Error(`rewrite left residual PAN on ${row.name}`);
  }
  logSafe("pci.rewritten", {
    customerId: row.name,
    fields: Object.keys(patch),
    suggestedName: suggested,
    last4: findPanHits(row.customer_name).map((h) => h.last4)[0] ?? null,
  });
  return suggested;
}

async function main() {
  const report: ReportRow[] = [];
  let start = 0;
  let scanned = 0;
  for (;;) {
    const rows = await pageCustomers(start);
    if (!rows.length) break;
    scanned += rows.length;
    for (const row of rows) {
      const flags = flagsForCustomer({
        id: row.name,
        customer_name: row.customer_name,
        email_id: row.email_id,
        mobile_no: row.mobile_no,
        customer_details: row.customer_details,
      });
      const pan = findPanHits(
        [row.customer_name, row.preferred_name, row.first_name, row.last_name, row.customer_details, row.mobile_no, row.email_id]
          .filter(Boolean)
          .join(" "),
      );
      if (!flags.length && !pan.length) continue;
      if (!flags.includes("track_or_pan") && pan.length) flags.unshift("track_or_pan");
      const item: ReportRow = {
        id: row.name,
        flags,
        display: pan.length ? (suggestedNameFromRecord(row) || "Needs review") : String(row.customer_name || row.name),
        last4: pan[0]?.last4,
        suggestedName: pan.length ? suggestedNameFromRecord(row) : undefined,
      };
      if (pan.length && APPLY) {
        try {
          item.suggestedName = await rewrite(row);
          item.action = "rewritten";
        } catch (e) {
          item.action = "skipped";
          logSafe("pci.rewrite_failed", { customerId: row.name, error: (e as Error).message });
        }
      } else if (pan.length) {
        item.action = "dry_run";
      }
      report.push(item);
    }
    if (rows.length < PAGE) break;
    start += PAGE;
  }

  const panHits = report.filter((r) => r.flags.includes("track_or_pan"));
  const summary = {
    scanned,
    flagged: report.length,
    trackOrPan: panHits.length,
    weirdName: report.filter((r) => r.flags.includes("weird_name")).length,
    marketingEmail: report.filter((r) => r.flags.includes("marketing_email")).length,
    apply: APPLY,
  };
  logSafe("pci.scan_summary", summary);
  for (const row of report) {
    logSafe("pci.scan_row", {
      id: row.id,
      flags: row.flags,
      display: row.display,
      suggestedName: row.suggestedName ?? null,
      last4: row.last4 ?? null,
      action: row.action ?? null,
      weird: isWeirdName(row.display),
      marketing: isMarketingEmail(row.email_id),
    });
  }
  if (panHits.length && APPLY) {
    const leftover = panHits.filter((r) => r.action !== "rewritten");
    if (leftover.length) {
      console.error(JSON.stringify({ event: "pci.apply_incomplete", leftover: leftover.length }));
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "pci.scan_failed", error: (e as Error).message }));
  process.exit(1);
});
