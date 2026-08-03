/** Shared tailor tally types + formatters (SPEC 061). */

export type WorkLocation = "shop" | "home" | null;

export type TallyTailor = {
  workerId: string;
  workerName: string;
  pieces: number;
  minutes: number;
  hours: number;
  revenue: number;
  tickets: number;
  /** null until real work_location at complete — never invent */
  workLocation?: WorkLocation;
};

export type TallyGarment = {
  ticket: string;
  garmentId?: string;
  type?: string;
  workerId?: string;
  workerName: string;
  completedAt?: string;
  minutes: number;
  revenue: number;
  status?: string;
  workLocation?: WorkLocation;
};

export type TallyTotals = {
  pieces: number;
  minutes: number;
  hours: number;
  revenue: number;
  workers: number;
};

export type TallyDayBucket = {
  date: string;
  totals: TallyTotals;
  tailors: TallyTailor[];
};

export type TailorTally = {
  date: string | null;
  start?: string;
  end?: string;
  timezone?: string;
  totals: TallyTotals;
  tailors: TallyTailor[];
  garments?: TallyGarment[];
  byDay?: TallyDayBucket[];
};

export function money(n: number, maxFrac = 0) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: maxFrac,
  });
}

export function fmtMins(m: number) {
  if (!m || m < 0) return "0m";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** America/New_York calendar day YYYY-MM-DD */
export function nyToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`;
}

export function addDaysIso(iso: string, delta: number): string {
  const ms = Date.parse(`${iso}T12:00:00Z`) + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Mon–Sun week containing `iso` (NY store week uses calendar Mon start). */
export function weekRangeContaining(iso: string): { start: string; end: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const start = addDaysIso(iso, monOffset);
  const end = addDaysIso(start, 6);
  return { start, end };
}

export function formatWeekLabel(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const a = new Date(`${start}T12:00:00Z`).toLocaleDateString("en-US", opts);
  const b = new Date(`${end}T12:00:00Z`).toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  });
  return `Week of ${a} – ${b}`;
}

export function formatPieceTime(stamp?: string | null): string {
  if (!stamp) return "—";
  const s = String(stamp).trim();
  // ERP wall: "YYYY-MM-DD HH:mm:ss"
  const m = s.match(/(\d{2}):(\d{2})/);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    let h = Number(m[1]);
    const min = m[2];
    const ap = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${min} ${ap}`;
  }
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export type PaceKind = "above" | "avg" | "below";

/** Client pace vs day average minutes among active tailors. */
export function paceFor(minutes: number, dayAvgMinutes: number): { kind: PaceKind; label: string; pct: number } {
  if (!dayAvgMinutes || dayAvgMinutes <= 0) {
    return { kind: "avg", label: "on pace", pct: 50 };
  }
  const ratio = minutes / dayAvgMinutes;
  const pct = Math.max(8, Math.min(100, Math.round(ratio * 55)));
  if (ratio >= 1.15) return { kind: "above", label: "above day avg", pct };
  if (ratio <= 0.75) return { kind: "below", label: "light day", pct };
  return { kind: "avg", label: "on pace", pct };
}

export function dollarsPerHour(revenue: number, hours: number): number | null {
  if (!hours || hours <= 0) return null;
  return Math.round(revenue / hours);
}
