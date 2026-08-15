export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export const AGING_BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

export function invoiceAgeDays(postingDate?: string | null, dueDate?: string | null): number | null {
  const anchor = postingDate || dueDate;
  if (!anchor) return null;
  const ms = Date.parse(anchor.includes("T") ? anchor : `${anchor.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

export function agingBucket(days: number | null | undefined): AgingBucket | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}
