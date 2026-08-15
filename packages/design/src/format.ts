const SHOP_TZ = "America/New_York";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIDNIGHT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ]00:00(?::00)?(?:\.0+)?(Z|[+-]\d{2}:?\d{2})?$/;
const NAIVE_DT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

function padMd(year: number, month: number, day: number, withYear: boolean): string {
  const md = `${MONTHS[month - 1] ?? "Jan"} ${day}`;
  return withYear ? `${md}, ${year}` : md;
}

function clockLabel(hour: number, minute: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/** True when the source is a calendar date, not a real clock time. */
export function isDateOnlySource(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const s = String(iso).trim();
  return DATE_ONLY_RE.test(s) || MIDNIGHT_RE.test(s);
}

export function formatUSD(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && n >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function parseErpDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    let s = String(iso).trim();
    const dateOnly = DATE_ONLY_RE.exec(s) || MIDNIGHT_RE.exec(s);
    if (dateOnly) {
      // Noon UTC so the calendar day survives any local offset.
      return new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T12:00:00Z`);
    }
    // ERPNext often returns "YYYY-MM-DD HH:mm:ss" (no T, no zone).
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
      s = s.replace(" ", "T");
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

export function formatDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  try {
    const s = String(iso).trim();
    const dateOnly = DATE_ONLY_RE.exec(s) || MIDNIGHT_RE.exec(s);
    if (dateOnly) {
      return padMd(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), true);
    }
    const d = parseErpDate(iso);
    if (!d) return fallback;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: SHOP_TZ,
    }).format(d);
  } catch {
    return fallback;
  }
}

export function formatDateTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  try {
    const s = String(iso).trim();
    const dateOnly = DATE_ONLY_RE.exec(s) || MIDNIGHT_RE.exec(s);
    if (dateOnly) {
      return padMd(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), false);
    }

    const naive = NAIVE_DT_RE.exec(s);
    const hasZone = /Z|[+-]\d{2}:?\d{2}$/.test(s);
    if (naive && !hasZone) {
      const hour = Number(naive[4]);
      const minute = Number(naive[5]);
      const md = padMd(Number(naive[1]), Number(naive[2]), Number(naive[3]), false);
      if (hour === 0 && minute === 0) return md;
      return `${md}, ${clockLabel(hour, minute)}`;
    }

    const d = parseErpDate(iso);
    if (!d) return fallback;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SHOP_TZ,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const dayPeriod = get("dayPeriod");
    const md = `${get("month")} ${get("day")}`;
    // Fake midnights / UTC-date conversions (e.g. 07:00Z → 3:00 AM EDT).
    if (minute === 0 && (hour === 12 || hour === 3) && /^AM$/i.test(dayPeriod)) {
      return md;
    }
    return `${md}, ${hour}:${String(minute).padStart(2, "0")} ${dayPeriod}`;
  } catch {
    return fallback;
  }
}

export function statusToLabel(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseErpDate(iso);
  if (!d) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 0 && diff < 7) return `In ${diff} days`;
  if (diff < 0 && diff > -7) return `${Math.abs(diff)} days ago`;
  return formatDate(iso);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?"
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function garmentLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatRelative(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  try {
    const d = parseErpDate(iso);
    if (!d) return fallback;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 0) return "just now";
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return formatDate(iso);
  } catch {
    return fallback;
  }
}
