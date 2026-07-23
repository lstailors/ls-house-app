/** Pure time helpers for the availability engine (no I/O). */

export function normDt(s: string): string {
  return String(s).replace("T", " ").slice(0, 19);
}

export function addMinutes(dtStr: string, mins: number): string {
  const n = normDt(dtStr);
  const parts = n.split(" ");
  const dPart = parts[0] ?? "1970-01-01";
  const tPart = parts[1] ?? "00:00:00";
  const tp = tPart.split(":");
  const hh = Number(tp[0] ?? 0);
  const mm = Number(tp[1] ?? 0);
  const ss = Number(tp[2] ?? 0);
  const y = Number(dPart.slice(0, 4));
  const mo = Number(dPart.slice(5, 7));
  const da = Number(dPart.slice(8, 10));
  const base = Date.UTC(y, mo - 1, da, hh, mm, ss);
  const next = new Date(base + mins * 60_000);
  const yy = next.getUTCFullYear();
  const mon = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  const h = String(next.getUTCHours()).padStart(2, "0");
  const m = String(next.getUTCMinutes()).padStart(2, "0");
  const s = String(next.getUTCSeconds()).padStart(2, "0");
  return `${yy}-${mon}-${day} ${h}:${m}:${s}`;
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  // half-open: [start, end)
  return !(aEnd <= bStart || aStart >= bEnd);
}

/** YYYY-MM-DD → DayName index 0=Mon … 6=Sun (ISO). */
export function weekdayIndex(dateStr: string): number {
  const bits = dateStr.split("-").map(Number);
  const y = bits[0] ?? 1970;
  const m = bits[1] ?? 1;
  const d = bits[2] ?? 1;
  // JS: 0=Sun…6=Sat → convert to Mon=0
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 6 : js - 1;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addMinutes(`${cur} 00:00:00`, 24 * 60).slice(0, 10);
  }
  return out;
}

/** NYC "now" as YYYY-MM-DD HH:MM:SS (best-effort via Intl). */
export function nowInNyc(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}

export function intersectWindows(
  a: Array<{ fromMin: number; toMin: number }>,
  b: Array<{ fromMin: number; toMin: number }>,
): Array<{ fromMin: number; toMin: number }> {
  const out: Array<{ fromMin: number; toMin: number }> = [];
  for (const x of a) {
    for (const y of b) {
      const from = Math.max(x.fromMin, y.fromMin);
      const to = Math.min(x.toMin, y.toMin);
      if (from < to) out.push({ fromMin: from, toMin: to });
    }
  }
  return out;
}

/** First Saturday strictly after July 4 */
export function firstSaturdayAfterJuly4(year: number): string {
  for (let day = 5; day <= 11; day++) {
    const ymd = `${year}-07-${String(day).padStart(2, "0")}`;
    if (weekdayIndex(ymd) === 5 /* Sat in Mon=0 index */) return ymd;
  }
  return `${year}-07-05`;
}

/** Labor Day = first Monday of September */
export function laborDay(year: number): string {
  for (let day = 1; day <= 7; day++) {
    const ymd = `${year}-09-${String(day).padStart(2, "0")}`;
    if (weekdayIndex(ymd) === 0 /* Mon */) return ymd;
  }
  return `${year}-09-01`;
}

/** Summer = first Sat after Jul 4 … Labor Day inclusive */
export function isSummerSeason(ymd: string): boolean {
  const y = Number(ymd.slice(0, 4));
  const start = firstSaturdayAfterJuly4(y);
  const end = laborDay(y);
  return ymd >= start && ymd <= end;
}

/** First 2 weeks of August — store vacation, always closed */
export function isAugustVacation(ymd: string): boolean {
  return ymd.slice(5, 7) === "08" && Number(ymd.slice(8, 10)) >= 1 && Number(ymd.slice(8, 10)) <= 14;
}
