import { erpGet, erpList, erpRunMethod, erpUpdate } from "./erp";
import { archiveCustomer } from "./erpnext/customers";
import { flagsForCustomer, phoneKey, safeDisplayName, type QualityFlag, type QualityRow } from "./customer-quality";
import { findPanHits } from "./pci-guard";

const PAGE = 200;
const CACHE_MS = 120_000;

let cache: { at: number; rows: QualityRow[]; counts: Record<string, number> } | null = null;

const SCAN_FIELDS = [
  "name",
  "customer_name",
  "mobile_no",
  "email_id",
  "customer_details",
  "disabled",
];

export async function collectQualityReport(force = false): Promise<{
  rows: QualityRow[];
  counts: Record<string, number>;
}> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const scanned: QualityRow[] = [];
  const phoneMap = new Map<string, string[]>();
  const meta = new Map<string, { name: string; email: string | null; phone: string | null }>();
  let start = 0;
  for (;;) {
    const rows = await erpList<any>("Customer", {
      fields: SCAN_FIELDS,
      filters: [["disabled", "=", 0]],
      limit: PAGE,
      start,
      order_by: "modified desc",
    });
    if (!rows.length) break;
    for (const row of rows) {
      meta.set(row.name, {
        name: row.customer_name ?? row.name,
        email: row.email_id ?? null,
        phone: row.mobile_no ?? null,
      });
      const flags = flagsForCustomer({
        id: row.name,
        customer_name: row.customer_name,
        email_id: row.email_id,
        mobile_no: row.mobile_no,
        customer_details: row.customer_details,
      });
      const pan = findPanHits(row.customer_name);
      const key = phoneKey(row.mobile_no);
      if (key) {
        const list = phoneMap.get(key) ?? [];
        list.push(row.name);
        phoneMap.set(key, list);
      }
      if (!flags.length && !pan.length) continue;
      scanned.push({
        id: row.name,
        name: row.customer_name ?? row.name,
        displayName: safeDisplayName(row.customer_name),
        email: row.email_id ?? null,
        phone: row.mobile_no ?? null,
        flags,
        panKind: pan[0]?.kind,
      });
    }
    if (rows.length < PAGE) break;
    start += PAGE;
  }

  const dupIds = new Set<string>();
  for (const ids of phoneMap.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) dupIds.add(id);
  }
  for (const row of scanned) {
    if (dupIds.has(row.id) && !row.flags.includes("duplicate_phone")) row.flags.push("duplicate_phone");
  }
  for (const id of dupIds) {
    if (scanned.some((r) => r.id === id)) continue;
    const m = meta.get(id);
    scanned.push({
      id,
      name: m?.name ?? id,
      displayName: safeDisplayName(m?.name ?? id),
      email: m?.email ?? null,
      phone: m?.phone ?? null,
      flags: ["duplicate_phone"],
    });
  }

  const counts: Record<string, number> = {
    total: scanned.length,
    track_or_pan: scanned.filter((r) => r.flags.includes("track_or_pan")).length,
    weird_name: scanned.filter((r) => r.flags.includes("weird_name")).length,
    marketing_email: scanned.filter((r) => r.flags.includes("marketing_email")).length,
    missing_contact: scanned.filter((r) => r.flags.includes("missing_contact")).length,
    duplicate_phone: scanned.filter((r) => r.flags.includes("duplicate_phone")).length,
  };
  cache = { at: Date.now(), rows: scanned, counts };
  return cache;
}

export function invalidateQualityCache() {
  cache = null;
}

export async function mergeCustomers(primaryId: string, duplicateId: string) {
  if (!primaryId || !duplicateId || primaryId === duplicateId) {
    throw new Error("Pick a primary and a different duplicate");
  }
  const [primary, dup] = await Promise.all([
    erpGet<any>("Customer", primaryId),
    erpGet<any>("Customer", duplicateId),
  ]);
  if (!primary || !dup) throw new Error("Customer not found");

  try {
    await erpRunMethod("frappe.rename_doc", {
      doctype: "Customer",
      old: duplicateId,
      new: primaryId,
      merge: 1,
    });
    invalidateQualityCache();
    return { primaryId, duplicateId, method: "rename_doc" as const };
  } catch {
    /* fall through to relink */
  }

  const relink = async (doctype: string, field = "customer") => {
    const rows = await erpList<any>(doctype, {
      filters: [[field, "=", duplicateId]],
      fields: ["name"],
      limit: 500,
    }).catch(() => []);
    for (const row of rows) {
      const patch: Record<string, unknown> = { [field]: primaryId };
      if (doctype === "Alteration Ticket") patch.customer_name = primary.customer_name;
      await erpUpdate(doctype, row.name, patch).catch(() => {});
    }
  };

  await relink("Alteration Ticket");
  await relink("Sales Invoice");
  await relink("Sales Order");
  await relink("HD Ticket");
  await relink("LSH Delivery");
  await archiveCustomer(duplicateId);
  invalidateQualityCache();
  return { primaryId, duplicateId, method: "relink" as const };
}

export type { QualityFlag, QualityRow };
