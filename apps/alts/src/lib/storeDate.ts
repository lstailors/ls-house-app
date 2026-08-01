/** Store-local calendar date helpers — NYC FOH only (America/New_York). */

export const STORE_ORIGIN = "NYC" as const;
export const STORE_TZ = "America/New_York";
export const STORE_ADDRESS_LINE = "138 East 61st Street · New York, NY 10065";
export const STORE_ADDRESS_SHORT = "138 East 61st Street · NYC";

/** YYYY-MM-DD in NYC store timezone. */
export function storeToday(_origin?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function storeTimeZone(_origin?: string | null): string {
  return STORE_TZ;
}
