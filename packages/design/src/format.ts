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
    // ERPNext often returns "YYYY-MM-DD HH:mm:ss" (no T, no zone).
    // Safari/strict parsers treat that as Invalid Date — normalize first.
    let s = String(iso).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
      s = s.replace(" ", "T");
      // House ERP timestamps are America/New_York wall time; append offset-less
      // local parse is OK for relative ("3h ago"). Avoid forcing Z (UTC skew).
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
    const d = parseErpDate(iso);
    if (!d) return fallback;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return fallback;
  }
}

export function formatDateTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  try {
    const d = parseErpDate(iso);
    if (!d) return fallback;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
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
