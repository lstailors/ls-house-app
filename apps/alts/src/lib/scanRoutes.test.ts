/**
 * Pure unit checks for scan route mapping (no DOM / camera).
 * Run: bun webapp/src/lib/scanRoutes.test.ts
 */
import {
  parseGarmentTagUrl,
  parseCustomerUrl,
  parseTicketUrl,
  parsePayUrl,
  parsePickupScanTarget,
  parseProgressScanTarget,
  parseQcUrl,
  parseStockUrl,
  routeForScannerResult,
  openPathForResult,
  routeFromRawScan,
} from "./scanRoutes";
import type { ScannerResult } from "@ls/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// garment path
const g = parseGarmentTagUrl("https://alts.lstailors.com/g/ALT-NYC-2026-00042/G1");
assert(g?.ticket === "ALT-NYC-2026-00042" && g?.garment === "G1", "garment url");
assert(parseGarmentTagUrl("/g/ALT-1/G2")?.garment === "G2", "garment path only");
assert(
  parseGarmentTagUrl("https://app.lstailors.com/g/ALT-NYC-2026-00042/G1")?.ticket ===
    "ALT-NYC-2026-00042",
  "legacy app host garment url",
);

// thermal ticket QR (what C photographed)
assert(
  parseTicketUrl("https://alts.lstailors.com/t/ALT-NYC-2026-00061") === "ALT-NYC-2026-00061",
  "thermal /t/ url",
);
assert(parseTicketUrl("https://alts.lstailors.com/e-ticket/ALT-NYC-1") === "ALT-NYC-1", "e-ticket");
assert(parseTicketUrl("ALT-NYC-2026-00061") === "ALT-NYC-2026-00061", "bare ALT");

// customer
assert(parseCustomerUrl("https://app.lstailors.com/customers/CUST-0001") === "CUST-0001", "customer url");
assert(parseCustomerUrl("/customers/new") === null, "customer new ignored");

// pay — app or alts host
assert(parsePayUrl("https://app.lstailors.com/pay/SINV-1") === "SINV-1", "pay url app");
assert(parsePayUrl("https://alts.lstailors.com/pay/SINV-2") === "SINV-2", "pay url alts");
assert(parsePayUrl("SINV-NYC-1") === "SINV-NYC-1", "bare sinv");
assert(parsePayUrl("LSTNY-SINV-2026-00165") === "LSTNY-SINV-2026-00165", "lstny sinv");

// MTM QC (not alteration tickets)
assert(parseQcUrl("https://alts.lstailors.com/qc/LSH-QC-2026-00008") === "LSH-QC-2026-00008", "lsh qc url");
assert(parseQcUrl("LSH-QC-2026-00008") === "LSH-QC-2026-00008", "bare LSH-QC");
assert(parseQcUrl("LST-122470-1") === "LST-122470-1", "mtmpro LST");
assert(parseQcUrl("ALT-NYC-2026-00061") === null, "alts ticket is not QC");
assert(parseStockUrl("https://alts.lstailors.com/stock/FSP-00934") === "FSP-00934", "stock url");
assert(parseStockUrl("FSP-00934") === "FSP-00934", "bare FSP");
const stockFast = routeFromRawScan("https://alts.lstailors.com/stock/FSP-00954");
assert(stockFast.kind === "path" && stockFast.path === "/stock/FSP-00954", "fast stock → /stock/");
const qcFast = routeFromRawScan("https://alts.lstailors.com/qc/LST-122470-1");
assert(qcFast.kind === "path" && qcFast.path === "/qc/LST-122470-1", "fast qc → /qc/");
const mtm: ScannerResult = {
  ok: true,
  type: "custom_order",
  name: "LST-122470-1",
  doctype: "MTMPro Order",
};
assert(
  routeForScannerResult(mtm).kind === "path" &&
    (routeForScannerResult(mtm) as { path: string }).path === "/qc/LST-122470-1",
  "mtmpro → qc",
);

// pickup scan target
assert(
  parsePickupScanTarget("https://alts.lstailors.com/g/ALT-NYC-1/G2")?.id === "ALT-NYC-1",
  "pickup garment → ticket",
);
assert(parsePickupScanTarget("ALT-NYC-2026-00061")?.kind === "ticket", "pickup bare ticket");
assert(
  parsePickupScanTarget("LSTNY-SINV-2026-00165")?.kind === "invoice",
  "pickup bare invoice",
);

// mark-progress scan target (piece-level only)
const prog = parseProgressScanTarget("https://alts.lstailors.com/g/ALT-NYC-1/G2");
assert(prog?.ticket === "ALT-NYC-1" && prog?.garment === "G2", "progress garment url");
assert(
  parseProgressScanTarget("ALT-NYC-2026-00061/G1")?.garment === "G1",
  "progress slash paste",
);
assert(parseProgressScanTarget("ALT-NYC-2026-00061") === null, "progress bare ticket rejected");

// garment fast route from raw scan (any host)
const gFast = routeFromRawScan("https://app.lstailors.com/g/ALT-NYC-1/G2");
assert(
  gFast.kind === "path" && gFast.path === "/g/ALT-NYC-1/G2",
  "fast garment → /g/ on alts",
);

// fast route from raw thermal scan → ticket detail (not public e-ticket)
const fast = routeFromRawScan("https://alts.lstailors.com/t/ALT-NYC-2026-00061");
assert(
  fast.kind === "path" && fast.path === "/orders/alterations/ALT-NYC-2026-00061",
  "fast thermal → TicketDetail",
);

// ticket auto-route
const ticket: ScannerResult = {
  ok: true,
  type: "alteration_ticket",
  name: "ALT-NYC-2026-00042",
  doctype: "Alteration Ticket",
};
const tNav = routeForScannerResult(ticket);
assert(tNav.kind === "path" && tNav.path.includes("orders/alterations/ALT-NYC"), "ticket path");

// invoice → ticket when ref present
const inv: ScannerResult = {
  ok: true,
  type: "sales_invoice",
  name: "SINV-1",
  doctype: "Sales Invoice",
  meta: { alteration_ticket_ref: "ALT-NYC-2026-00042" },
};
const iNav = routeForScannerResult(inv);
assert(iNav.kind === "path" && iNav.path.includes("ALT-NYC-2026-00042"), "invoice→ticket");

// invoice without ref → pay
const inv2: ScannerResult = {
  ok: true,
  type: "sales_invoice",
  name: "SINV-2",
  doctype: "Sales Invoice",
};
const i2 = routeForScannerResult(inv2);
assert(i2.kind === "path" && i2.path === "/pay/SINV-2", "invoice→pay");

// delivery
const d: ScannerResult = {
  ok: true,
  type: "lsh_delivery",
  name: "DN-NYC-2026-00001",
  doctype: "LSH Delivery",
};
assert(
  routeForScannerResult(d).kind === "path" &&
    (routeForScannerResult(d) as { path: string }).path.includes("deliveries"),
  "delivery",
);

// transfer stays on sheet
const tr: ScannerResult = {
  ok: true,
  type: "tailor_transfer",
  name: "TT-1",
  doctype: "Tailor Transfer",
};
assert(routeForScannerResult(tr).kind === "none", "transfer sheet");

// open fallback desk
const co: ScannerResult = {
  ok: true,
  type: "custom_order",
  name: "LST-1",
  doctype: "LSH Custom Order",
};
const open = openPathForResult(co);
assert(open.kind === "external" && open.url.includes("erp.lstailors.com"), "desk fallback");

// customer type
const cu: ScannerResult = {
  ok: true,
  type: "customer",
  name: "CUST-9",
  doctype: "Customer",
};
assert(
  routeForScannerResult(cu).kind === "path" &&
    (routeForScannerResult(cu) as { path: string }).path === "/customers/CUST-9",
  "customer path",
);

console.log("scanRoutes.test.ts — all assertions passed");
