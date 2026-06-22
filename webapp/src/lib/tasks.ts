// Shared task domain logic — types, helpers, grouping, and staff metadata.
// Single source of truth so the list view, board view, and cards stay in sync.

export interface Todo {
  name: string;
  description: string;
  status: "Open" | "Closed" | "Cancelled";
  priority: "High" | "Medium" | "Low";
  date: string | null;
  allocated_to: string | null;
  assigned_by: string | null;
  assigned_by_full_name: string | null;
  reference_type: string | null;
  reference_name: string | null;
  lsh_context?: string | null;
  lsh_agent?: string | null;
}

export type Priority = Todo["priority"];

// ── Text / date helpers ───────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html?.replace(/<[^>]*>/g, "").trim() ?? "";
}

export function isOverdue(date: string | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

export function isDueToday(date: string | null): boolean {
  if (!date) return false;
  return date === isoToday();
}

export function shortEmail(email: string | null): string {
  if (!email) return "—";
  return email.split("@")[0];
}

export function formatDate(date: string | null): string {
  if (!date) return "";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Local-time YYYY-MM-DD (not UTC) so "today"/"tomorrow" line up with the user.
export function isoDate(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

export function isoToday(): string {
  return isoDate(new Date());
}

export function isoShift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// Relative label for a due date, e.g. "2 days overdue", "in 3 days".
export function relativeDue(date: string | null): string {
  if (!date) return "No date";
  const ms = new Date(date + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime();
  const days = Math.round(ms / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}

// ── Staff roster + avatar colors ──────────────────────────────────────────────

export interface StaffMeta {
  email: string;
  label: string;
  initials: string;
  // Tailwind classes for the avatar chip.
  bg: string;
  text: string;
}

export const STAFF_ROSTER: StaffMeta[] = [
  { email: "carl@lstailors.com", label: "Carl", initials: "CC", bg: "bg-brass/20", text: "text-brass-light" },
  { email: "kelvin@lstailors.com", label: "Kelvin", initials: "KE", bg: "bg-signal-emerald/20", text: "text-signal-emerald" },
  { email: "gianna@lstailors.com", label: "Gianna", initials: "GI", bg: "bg-signal-rose/20", text: "text-signal-rose" },
  { email: "antonio@lstailors.com", label: "Antonio", initials: "AN", bg: "bg-signal-amber/20", text: "text-signal-amber" },
];

const FALLBACK_PALETTE = [
  { bg: "bg-brass/20", text: "text-brass-light" },
  { bg: "bg-signal-emerald/20", text: "text-signal-emerald" },
  { bg: "bg-signal-rose/20", text: "text-signal-rose" },
  { bg: "bg-signal-amber/20", text: "text-signal-amber" },
];

export function staffMeta(email: string | null): StaffMeta {
  if (!email) {
    return { email: "", label: "Unassigned", initials: "—", bg: "bg-white/5", text: "text-cream-dim" };
  }
  const known = STAFF_ROSTER.find((s) => s.email === email);
  if (known) return known;
  // Derive a stable label/initials/color for anyone not in the roster.
  const local = email.split("@")[0];
  const label = local.charAt(0).toUpperCase() + local.slice(1);
  const initials = local.slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash + email.charCodeAt(i)) % FALLBACK_PALETTE.length;
  return { email, label, initials, ...FALLBACK_PALETTE[hash] };
}

// ── Grouping ──────────────────────────────────────────────────────────────────

export type GroupKey = "overdue" | "today" | "upcoming" | "nodate" | "done";

export interface GroupDef {
  key: GroupKey;
  label: string;
  // Accent used by section headers / column rails.
  accent: "rose" | "amber" | "brass" | "dim";
}

export const LIST_GROUPS: GroupDef[] = [
  { key: "overdue", label: "Overdue", accent: "rose" },
  { key: "today", label: "Due Today", accent: "amber" },
  { key: "upcoming", label: "Upcoming", accent: "brass" },
  { key: "nodate", label: "No Date", accent: "dim" },
  { key: "done", label: "Done", accent: "dim" },
];

// Board folds "No Date" into Upcoming to keep columns tidy.
export const BOARD_COLUMNS: GroupDef[] = [
  { key: "overdue", label: "Overdue", accent: "rose" },
  { key: "today", label: "Today", accent: "amber" },
  { key: "upcoming", label: "Upcoming", accent: "brass" },
  { key: "done", label: "Done", accent: "dim" },
];

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

function bucketOf(t: Todo, foldNoDate: boolean): GroupKey {
  if (t.status === "Closed" || t.status === "Cancelled") return "done";
  if (!t.date) return foldNoDate ? "upcoming" : "nodate";
  if (isOverdue(t.date)) return "overdue";
  if (isDueToday(t.date)) return "today";
  return "upcoming";
}

function sortWithin(key: GroupKey, list: Todo[]): Todo[] {
  const copy = [...list];
  if (key === "done") {
    copy.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  } else if (key === "nodate") {
    copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  } else {
    copy.sort((a, b) => {
      const d = (a.date ?? "9999").localeCompare(b.date ?? "9999");
      return d !== 0 ? d : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
  }
  return copy;
}

// Group todos into ordered buckets. `foldNoDate` merges undated tasks into
// Upcoming (used by the board, where a No-Date column would be noise).
export function groupTasks(todos: Todo[], foldNoDate: boolean): Record<GroupKey, Todo[]> {
  const out: Record<GroupKey, Todo[]> = { overdue: [], today: [], upcoming: [], nodate: [], done: [] };
  for (const t of todos) out[bucketOf(t, foldNoDate)].push(t);
  (Object.keys(out) as GroupKey[]).forEach((k) => (out[k] = sortWithin(k, out[k])));
  return out;
}
