// Pure buying-currency → USD helpers. No ERP calls.
// Live rate: Currency Exchange (see fx.ts). If that row is missing, env
// `{CCY}_USD_RATE`, then the static defaults below. Defaults and env are
// fallbacks — callers must set fx_fallback. They are not a live feed.

export interface FxRate {
  rate: number;
  fallback: boolean;
}

/** ~1/7.80 HKD peg. Static. Not a live quote. */
export const HKD_USD_FALLBACK = 0.128;

/**
 * ECB euro reference (Frankfurter), 2026-09-25: 1 EUR = 1.1403 USD.
 * Static snapshot for when Desk has no Currency Exchange row and
 * EUR_USD_RATE is unset. Not refreshed and not a live spot.
 */
export const EUR_USD_FALLBACK = 1.1403;

const FALLBACK_USD: Record<string, number> = {
  HKD: HKD_USD_FALLBACK,
  EUR: EUR_USD_FALLBACK,
};

export function envRate(from: string): number | null {
  const ccy = from.toUpperCase();
  const v = Number(process.env[`${ccy}_USD_RATE`]);
  if (Number.isFinite(v) && v > 0) return v;
  return FALLBACK_USD[ccy] ?? null;
}

/** Exchange row wins and is not a fallback. Env and static defaults are. USD is 1. */
export function resolveUsdRate(from: string, exchangeRate?: number | null): FxRate | null {
  if (from.toUpperCase() === "USD") return { rate: 1, fallback: false };
  if (exchangeRate && exchangeRate > 0) return { rate: exchangeRate, fallback: false };
  const fb = envRate(from);
  return fb ? { rate: fb, fallback: true } : null;
}

/** Metres → yards: a price per metre × 0.9144 = price per yard.
 *  Every Meter mill uses this (Drago, Tallia, Caccioppoli). */
export function perYard(rate: number, uom: string | null): number {
  return uom && /^(m|meter|metre)s?$/i.test(uom.trim()) ? rate * 0.9144 : rate;
}

/** Buying rate → USD per yard, same formula the estimator uses. */
export function usdPerYard(rate: number, uom: string | null, usdPerUnit: number): number {
  return perYard(rate, uom) * usdPerUnit;
}
