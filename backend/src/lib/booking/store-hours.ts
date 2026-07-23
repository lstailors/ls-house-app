/**
 * Locked L&S store-hours rules (Mia / scheduling source of truth).
 * Used by public booking availability — never book outside these windows.
 *
 * Precedence (most-closing wins):
 *   August vacation & US holidays  >  weekly open-days mask
 * Season:
 *   Summer = first Saturday after July 4 → Labor Day (Mon–Fri open)
 *   Regular = Sep–Jun (Tue–Sat open)
 */

export type TimeRange = { startMin: number; endMin: number }; // minutes from midnight

export const TZ = "America/New_York";

/** Regular season open days (Tue–Sat). Values: 0=Sun … 6=Sat */
export const REGULAR_OPEN_DAYS = new Set([2, 3, 4, 5, 6]);

/** Summer open days (Mon–Fri) */
export const SUMMER_OPEN_DAYS = new Set([1, 2, 3, 4, 5]);

/** Default shop hours in minutes (local) */
export const DEFAULT_DAY_HOURS: TimeRange = { startMin: 9 * 60, endMin: 17 * 60 };
export const SATURDAY_HOURS: TimeRange = { startMin: 9 * 60, endMin: 15 * 60 };

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return { y, m, d };
}

export function ymdFromDate(dt: Date): string {
  // Format in America/New_York
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

export function weekdayNy(ymd: string): number {
  // noon UTC avoids DST edge when interpreting YMD as local NYC
  const { y, m, d } = parseYmd(ymd);
  // Construct a date that is noon in NYC for that calendar day
  const probe = new Date(`${ymd}T12:00:00-04:00`);
  // Use formatter to get weekday in NY
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(probe);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? new Date(y, m - 1, d).getDay();
}

/** First Saturday strictly after July 4 in year Y */
export function firstSaturdayAfterJuly4(year: number): string {
  // July 5 onward
  let day = 5;
  while (true) {
    const ymd = `${year}-07-${String(day).padStart(2, "0")}`;
    if (weekdayNy(ymd) === 6) return ymd;
    day += 1;
    if (day > 11) return `${year}-07-05`; // fallback
  }
}

/** Labor Day = first Monday of September */
export function laborDay(year: number): string {
  for (let day = 1; day <= 7; day++) {
    const ymd = `${year}-09-${String(day).padStart(2, "0")}`;
    if (weekdayNy(ymd) === 1) return ymd;
  }
  return `${year}-09-01`;
}

export function isSummerSeason(ymd: string): boolean {
  const { y } = parseYmd(ymd);
  const start = firstSaturdayAfterJuly4(y);
  const end = laborDay(y);
  return ymd >= start && ymd <= end;
}

/** First 2 weeks of August — always closed (store vacation) */
export function isAugustVacation(ymd: string): boolean {
  const { m, d } = parseYmd(ymd);
  return m === 8 && d >= 1 && d <= 14;
}

/**
 * US federal holidays (fixed + observed for weekend shifts — simplified).
 * Prefer ERP Holiday List when available; this is the offline fallback.
 */
export function usFederalHolidaySet(year: number): Set<string> {
  const set = new Set<string>();
  const add = (m: number, d: number) =>
    set.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

  add(1, 1); // New Year
  // MLK — 3rd Mon Jan
  addNthWeekday(set, year, 1, 1, 3);
  // Presidents — 3rd Mon Feb
  addNthWeekday(set, year, 2, 1, 3);
  // Memorial — last Mon May
  addLastWeekday(set, year, 5, 1);
  add(6, 19); // Juneteenth
  add(7, 4); // Independence
  // Labor — first Mon Sep
  addNthWeekday(set, year, 9, 1, 1);
  // Columbus — 2nd Mon Oct
  addNthWeekday(set, year, 10, 1, 2);
  add(11, 11); // Veterans
  // Thanksgiving — 4th Thu Nov
  addNthWeekday(set, year, 11, 4, 4);
  add(12, 25); // Christmas
  return set;
}

function addNthWeekday(set: Set<string>, year: number, month: number, weekday: number, n: number) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (Number.isNaN(Date.parse(`${ymd}T12:00:00Z`))) break;
    if (weekdayNy(ymd) === weekday) {
      count += 1;
      if (count === n) {
        set.add(ymd);
        return;
      }
    }
  }
}

function addLastWeekday(set: Set<string>, year: number, month: number, weekday: number) {
  for (let d = 31; d >= 1; d--) {
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (Number.isNaN(Date.parse(`${ymd}T12:00:00Z`))) continue;
    if (weekdayNy(ymd) === weekday) {
      set.add(ymd);
      return;
    }
  }
}

export type DayAvailability =
  | { open: false; reason: "august_vacation" | "holiday" | "closed_day" }
  | { open: true; ranges: TimeRange[]; season: "summer" | "regular" };

/**
 * Is the store open on this calendar day (NYC), and what hours?
 * @param holidayDates optional set of YMD strings from ERP Holiday List (overrides fallback)
 */
export function storeDayAvailability(ymd: string, holidayDates?: Set<string>): DayAvailability {
  if (isAugustVacation(ymd)) {
    return { open: false, reason: "august_vacation" };
  }

  const { y } = parseYmd(ymd);
  const holidays = holidayDates ?? usFederalHolidaySet(y);
  if (holidays.has(ymd)) {
    return { open: false, reason: "holiday" };
  }

  const summer = isSummerSeason(ymd);
  const wd = weekdayNy(ymd);
  const openDays = summer ? SUMMER_OPEN_DAYS : REGULAR_OPEN_DAYS;
  if (!openDays.has(wd)) {
    return { open: false, reason: "closed_day" };
  }

  // Saturday (regular only) ends at 15:00
  if (!summer && wd === 6) {
    return { open: true, ranges: [SATURDAY_HOURS], season: "regular" };
  }
  return {
    open: true,
    ranges: [DEFAULT_DAY_HOURS],
    season: summer ? "summer" : "regular",
  };
}

export function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMin(hhmm: string): number {
  const parts = hhmm.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return h * 60 + m;
}

/** Intersect two sorted lists of ranges */
export function intersectRanges(a: TimeRange[], b: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const ra of a) {
    for (const rb of b) {
      const start = Math.max(ra.startMin, rb.startMin);
      const end = Math.min(ra.endMin, rb.endMin);
      if (start < end) out.push({ startMin: start, endMin: end });
    }
  }
  return out;
}
