/** Store-local calendar date helpers — avoid UTC day drift for NYC/HOU FOH. */

const STORE_TZ: Record<string, string> = {
  NYC: "America/New_York",
  HOU: "America/Chicago",
  NY: "America/New_York",
  TX: "America/Chicago",
};

export function storeTimeZone(origin?: string | null): string {
  const key = String(origin || "NYC").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  if (key.startsWith("HOU") || key === "TX") return STORE_TZ.HOU;
  return STORE_TZ.NYC;
}

/** YYYY-MM-DD in the store timezone (defaults NYC). */
export function storeToday(origin?: string | null): string {
  const tz = storeTimeZone(origin);
  try {
    // en-CA → YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
