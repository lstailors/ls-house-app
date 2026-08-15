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

function nyParts(d = new Date()): Record<string, string> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(dtf.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

/** `YYYY-MM-DD HH:MM:SS` in America/New_York. */
export function nyDateTimeSql(d = new Date()): string {
  const p = nyParts(d);
  const hour = p.hour === "24" ? "00" : (p.hour ?? "00");
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}

/** ERP cutoff timestamp `hours` ago in shop time. */
export function hoursAgoNySql(hours: number, d = new Date()): string {
  return nyDateTimeSql(new Date(d.getTime() - hours * 3600_000));
}

/** Minutes from midnight in America/New_York (0–1439). */
export function nyMinutesFromMidnight(d = new Date()): number {
  const p = nyParts(d);
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return hour * 60 + Number(p.minute);
}

/** Monday of the ISO-ish shop week containing `iso` (YYYY-MM-DD). */
export function weekStartMonday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  const wd = dt.getUTCDay(); // 0 Sun
  const delta = wd === 0 ? -6 : 1 - wd;
  return addDaysIso(iso, delta);
}

/** Parse Frappe `YYYY-MM-DD HH:MM:SS` / ISO as epoch ms. */
export function parseErpDateMs(raw?: string | null): number {
  if (!raw) return 0;
  const s = String(raw).trim();
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const ms = Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** `4:32` shop-local clock from an ERP datetime. */
export function formatNyClock(raw?: string | null): string {
  const ms = parseErpDateMs(raw);
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(ms))
    .replace(/\s/g, "")
    .replace(/AM|PM/, (m) => m.toLowerCase());
}
