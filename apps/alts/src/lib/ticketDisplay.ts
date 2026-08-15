/** Shared FOH ticket display — shop floor + orders. */

export function daysLate(due?: string) {
  if (!due) return 0;
  const d = new Date(due + "T12:00:00");
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}

/** Closed / released work — never overdue. */
export function isTerminalStatus(status?: string | null): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
  return (
    s === "picked up" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "delivered" ||
    s === "closed" ||
    s === "completed" ||
    s === "paid"
  );
}

export function fmtDue(due?: string): { text: string; kind: "late" | "soon" | "ok"; label: string } {
  if (!due) return { text: "—", kind: "ok", label: "—" };
  const late = daysLate(due);
  const d = new Date(due + "T12:00:00");
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (late > 0) return { text: `OVERDUE · ${late}d`, kind: "late", label };
  if (late === 0) return { text: "Due today", kind: "soon", label };
  return { text: `Due ${label}`, kind: "ok", label };
}

export function fmtTime(raw?: string): string {
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2];
  if (!Number.isFinite(h)) return "";
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

export function isRush(t: { is_rush?: number | boolean | null }): boolean {
  return Number(t.is_rush) === 1;
}

export function clientInitials(name?: string | null): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function hoursLeft(due?: string, time?: string): string | null {
  if (!due) return null;
  const raw = String(time ?? "").trim();
  const clock = /^\d{1,2}:\d{2}/.test(raw) ? (raw.length === 5 ? `${raw}:00` : raw) : "17:00:00";
  const when = new Date(`${due}T${clock}`);
  const h = (when.getTime() - Date.now()) / 3_600_000;
  if (!Number.isFinite(h) || h < 0) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m left`;
  if (h <= 12) return `${Math.round(h)}h left`;
  return null;
}

export function storeHour(): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()),
    );
  } catch {
    return new Date().getHours();
  }
}

export function syncLabel(updatedAt?: number, fetching?: boolean): string {
  if (fetching) return "Syncing…";
  if (!updatedAt) return "Live";
  const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (s < 8) return "Live · just now";
  if (s < 60) return `Live · ${s}s ago`;
  return `Live · ${Math.floor(s / 60)}m ago`;
}

export function sortShopTickets<
  T extends {
    due_date?: string;
    due_time?: string;
    is_rush?: number;
    workflow_state?: string;
    status?: string;
  },
>(a: T, b: T) {
  const termA = isTerminalStatus(a.workflow_state || a.status);
  const termB = isTerminalStatus(b.workflow_state || b.status);
  if (termA !== termB) return termA ? 1 : -1;
  const lateA = !termA && daysLate(a.due_date) > 0;
  const lateB = !termB && daysLate(b.due_date) > 0;
  if (lateA !== lateB) return lateA ? -1 : 1;
  if (lateA && lateB) {
    const da = a.due_date || "9999-99-99";
    const db = b.due_date || "9999-99-99";
    if (da !== db) return da.localeCompare(db);
  }
  if (isRush(a) !== isRush(b)) return isRush(a) ? -1 : 1;
  const da = a.due_date || "9999-99-99";
  const db = b.due_date || "9999-99-99";
  if (da !== db) return da.localeCompare(db);
  return String(a.due_time || "99:99").localeCompare(String(b.due_time || "99:99"));
}
