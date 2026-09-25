// HKD → USD conversion. ERPNext Currency Exchange first, env fallback second.
import "server-only";
import { serviceList } from "./erp";

export interface FxRate {
  rate: number;
  fallback: boolean;
}

export function envRate(from: string): number | null {
  const v = Number(process.env[`${from.toUpperCase()}_USD_RATE`]);
  if (Number.isFinite(v) && v > 0) return v;
  return from.toUpperCase() === "HKD" ? 0.128 : null;
}

export async function toUsdRate(from: string, today: string): Promise<FxRate | null> {
  if (from.toUpperCase() === "USD") return { rate: 1, fallback: false };
  const rows = await serviceList<{ exchange_rate: number }>("Currency Exchange", {
    filters: [
      ["from_currency", "=", from],
      ["to_currency", "=", "USD"],
      ["date", "<=", today],
    ],
    fields: ["exchange_rate"],
    order_by: "date desc",
    limit: 1,
  }).catch(() => []);
  const rate = rows[0]?.exchange_rate;
  if (rate && rate > 0) return { rate, fallback: false };
  const fb = envRate(from);
  return fb ? { rate: fb, fallback: true } : null;
}
