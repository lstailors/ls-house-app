// Shared formatting + status helpers for the garment job card.

export function formatCurrency(amount?: number | null): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDueDate(d?: string | null): string {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(d?: string | null): string {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function isTruthyFlag(v?: boolean | number | null): boolean {
  return v === true || v === 1;
}

// Map a freeform garment status string to a StatusPill variant.
export type PillVariant = "emerald" | "amber" | "rose" | "brass" | "muted";

export function statusVariant(status?: string | null): PillVariant {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "muted";
  if (s.includes("ready") || s.includes("complete") || s.includes("done")) return "emerald";
  if (s.includes("progress")) return "amber";
  if (s.includes("cancel") || s.includes("hold")) return "rose";
  if (s.includes("pending") || s.includes("received") || s.includes("intake")) return "brass";
  return "muted";
}

export function isInProgress(status?: string | null): boolean {
  return (status ?? "").trim().toLowerCase().includes("progress");
}

export function isCompleted(status?: string | null): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s.includes("ready") || s.includes("complete") || s.includes("done");
}
