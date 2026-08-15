/** Canonical USD display — always `$5,685.00`. */

export function formatMoney(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(0);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

/** Compact strip label (`$5.7k`) — not for receipts. */
export function formatCompactMoney(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0";
  if (Math.abs(v) >= 1000) {
    return `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return formatMoney(v);
}
