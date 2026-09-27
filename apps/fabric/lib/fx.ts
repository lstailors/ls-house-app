// Buying currency → USD. ERPNext Currency Exchange first, then `{CCY}_USD_RATE`,
// then a documented static default (HKD, EUR). Defaults set fx_fallback — they
// are not a live spot.
import "server-only";
import { serviceList } from "./erp";
import { resolveUsdRate, type FxRate } from "./fx-rate";

export type { FxRate } from "./fx-rate";
export { envRate } from "./fx-rate";

export async function toUsdRate(from: string, today: string): Promise<FxRate | null> {
  if (from.toUpperCase() === "USD") return resolveUsdRate(from, null);
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
  return resolveUsdRate(from, rows[0]?.exchange_rate);
}
