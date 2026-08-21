/** Match alteration list rows to the KPI tiles on the admin board. */

export type AlterationKpiFilterKey =
  | "active"
  | "dueToday"
  | "overdue"
  | "rush"
  | "unassigned"
  | "stellaWip"
  | "hugoWip"
  | "readyForPickup";

export type AlterationKpiTicket = {
  status?: string | null;
  dueDate?: string | null;
  tailorId?: string | null;
  tailor?: { name?: string | null } | null;
  isRush?: boolean;
  is_rush?: number | boolean;
};

const DONE = new Set(["picked_up", "delivered", "cancelled"]);

export function utcTodayYmd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dueDateYmd(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const ymd = dueDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function tailorName(ticket: AlterationKpiTicket): string {
  return (ticket.tailor?.name ?? "").trim().toLowerCase();
}

function isRush(ticket: AlterationKpiTicket): boolean {
  return ticket.isRush === true || ticket.is_rush === true || ticket.is_rush === 1;
}

function isAssigned(ticket: AlterationKpiTicket): boolean {
  return Boolean((ticket.tailorId ?? "").trim() || (ticket.tailor?.name ?? "").trim());
}

/** Same rules as GET /api/alterations/kpis so tile counts and the table agree. */
export function matchesAlterationKpiFilter(
  ticket: AlterationKpiTicket,
  key: string,
  today = utcTodayYmd(),
): boolean {
  const status = ticket.status ?? "";
  const due = dueDateYmd(ticket.dueDate);
  const name = tailorName(ticket);

  switch (key) {
    case "active":
      return status === "intake" || status === "in_progress";
    case "dueToday":
      return !DONE.has(status) && due === today;
    case "overdue":
      return !DONE.has(status) && status !== "ready" && Boolean(due) && due! < today;
    case "rush":
      return !DONE.has(status) && isRush(ticket);
    case "unassigned":
      return !DONE.has(status) && !isAssigned(ticket);
    case "stellaWip":
      return status === "in_progress" && name.includes("stella");
    case "hugoWip":
      return status === "in_progress" && name.includes("hugo");
    case "readyForPickup":
      return status === "ready";
    default:
      return true;
  }
}
