/** Shop-local calendar helpers — America/New_York. */

export const SHOP_TZ = "America/New_York";

/** YYYY-MM-DD in America/New_York. */
export function nyTodayIso(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Add calendar days to a YYYY-MM-DD string (no TZ shift). */
export function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
