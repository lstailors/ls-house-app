/** Pure helpers for the house-home KPI strip. */

export function monthStartYmd(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function previousMonthStartYmd(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 12 : m;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

const SKIP_INVOICE = new Set(["Cancelled", "Credit Note Issued"]);

export function isCountableInvoice(status?: string | null): boolean {
  return !SKIP_INVOICE.has(status ?? "");
}

export function sumInvoicesInRange(
  invoices: Array<{ posting_date?: string | null; grand_total?: number | null; status?: string | null }>,
  startInclusive: string,
  endExclusive?: string,
): number {
  return invoices.reduce((sum, invoice) => {
    const date = invoice.posting_date ?? "";
    if (date < startInclusive) return sum;
    if (endExclusive && date >= endExclusive) return sum;
    if (!isCountableInvoice(invoice.status)) return sum;
    return sum + Number(invoice.grand_total ?? 0);
  }, 0);
}

export function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export const YZ_ACTIVE_STATUSES = new Set([
  "In Production",
  "Fabric Not Received",
  "On Pause",
  "Rush",
]);

export const MTM_DONE_STATUSES = new Set([
  "Delivered",
  "Cancelled",
  "Ready for Pickup",
]);

/** Factory / unfinished MTM statuses — not fitting-complete or delivered. */
export const MTM_IN_PRODUCTION_STATUSES = new Set([
  "Production",
  "In Production",
  "Order Submitted",
  "Submitted to Factory",
  "Fabric PO Raised",
  "Awaiting Shipment",
  "Quality Control",
  "Pause / Hold",
  "Alterations",
  "In Transit",
  "Shipping from Factory",
]);

export function pickProductionCount(sources: {
  lshGarments: number;
  mtmInProduction: number;
  yzActive: number;
  salesOrdersInProduction: number;
}): number {
  if (sources.lshGarments > 0) return sources.lshGarments;
  if (sources.mtmInProduction > 0) return sources.mtmInProduction;
  if (sources.yzActive > 0) return sources.yzActive;
  return sources.salesOrdersInProduction;
}

export function isYzActive(status?: string | null): boolean {
  const value = (status ?? "").trim();
  return !value || YZ_ACTIVE_STATUSES.has(value);
}

export function isMtmInProduction(status?: string | null): boolean {
  return MTM_IN_PRODUCTION_STATUSES.has((status ?? "").trim());
}
