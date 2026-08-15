/**
 * House-wide Alts dashboard metrics.
 *
 * Every integer here is an explicit ERPNext COUNT (`erpCount` →
 * frappe.client.get_count) except `invoices.unpaid_total`, which is a
 * paginated SUM of outstanding_amount (COUNT cannot sum).
 *
 * Never derive a badge from `erpList(...).length`.
 *
 * Canonical definitions: docs/data-flow.md
 */

import { erpCount, erpList } from "./erp";
import { DT } from "./erpnext/doctypes";
import { addDaysIso, hoursAgoNySql, nyTodayIso } from "./shop-time";
import type { AltsMetrics } from "../types";

export type ErpFilter = unknown[];

export const TERMINAL_TICKET_STATES = ["Picked Up", "Cancelled"] as const;

export type MetricFilterSet = {
  openAlterations: ErpFilter;
  overdue: ErpFilter;
  dueToday: ErpFilter;
  ready: ErpFilter;
  inProgress: ErpFilter;
  atHome: ErpFilter;
  stalled48h: ErpFilter;
  readyNotTexted: ErpFilter;
  invoices90: ErpFilter;
  tasksOpen: ErpFilter;
  tasksOverdue: ErpFilter;
  tasksCreatedToday: ErpFilter;
  tasksClosedToday: ErpFilter;
  qcWaiting: ErpFilter;
  qcPassed: ErpFilter;
  qcFailed: ErpFilter;
  invoicesUnpaid: ErpFilter;
  deliveriesQueued: ErpFilter;
  deliveriesOut: ErpFilter;
  deliveriesDeliveredToday: ErpFilter;
  deliveriesOnHold: ErpFilter;
  hdOpen: ErpFilter;
  messagesTexts: ErpFilter;
  messagesCalls: ErpFilter;
  messagesVoice: ErpFilter;
  messagesFittings: ErpFilter;
};

/** Frozen filter definitions — drift tests re-COUNT with these exact arrays. */
export function metricFilters(todayNy: string, now = new Date()): MetricFilterSet {
  const holdSince = addDaysIso(todayNy, -6);
  const stalledCutoff = hoursAgoNySql(48, now);
  const invoices90since = addDaysIso(todayNy, -90);
  return {
    openAlterations: [["workflow_state", "not in", [...TERMINAL_TICKET_STATES]]],
    overdue: [
      ["workflow_state", "not in", [...TERMINAL_TICKET_STATES]],
      ["due_date", "<", todayNy],
    ],
    dueToday: [
      ["workflow_state", "not in", [...TERMINAL_TICKET_STATES]],
      ["due_date", "=", todayNy],
    ],
    ready: [["workflow_state", "=", "Ready"]],
    inProgress: [["workflow_state", "=", "In Progress"]],
    atHome: [
      ["workflow_state", "not in", [...TERMINAL_TICKET_STATES, "Ready"]],
      ["assigned_tailor", "is", "set"],
    ],
    stalled48h: [
      ["workflow_state", "not in", [...TERMINAL_TICKET_STATES]],
      ["modified", "<", stalledCutoff],
    ],
    readyNotTexted: [
      ["workflow_state", "=", "Ready"],
      ["notified_ready_at", "is", "not set"],
    ],
    invoices90: [
      ["docstatus", "=", 1],
      ["outstanding_amount", ">", 0],
      ["posting_date", "<", invoices90since],
    ],
    tasksOpen: [["status", "=", "Open"]],
    tasksOverdue: [
      ["status", "=", "Open"],
      ["date", "<", todayNy],
    ],
    tasksCreatedToday: [["creation", ">=", `${todayNy} 00:00:00`]],
    tasksClosedToday: [
      ["status", "in", ["Closed", "Cancelled"]],
      ["modified", ">=", `${todayNy} 00:00:00`],
    ],
    qcWaiting: [["qc_result", "=", "Pending"]],
    qcPassed: [["qc_result", "=", "Pass"]],
    qcFailed: [["qc_result", "=", "Fail"]],
    invoicesUnpaid: [
      ["docstatus", "=", 1],
      ["outstanding_amount", ">", 0],
    ],
    deliveriesQueued: [["lsh_status", "=", "Queued"]],
    deliveriesOut: [["lsh_status", "=", "Out for Delivery"]],
    deliveriesDeliveredToday: [
      ["lsh_status", "=", "Delivered"],
      ["lsh_delivered_at", ">=", `${todayNy} 00:00:00`],
      ["lsh_delivered_at", "<=", `${todayNy} 23:59:59`],
    ],
    deliveriesOnHold: [
      ["lsh_status", "in", ["Failed", "Cancelled"]],
      ["modified", ">=", `${holdSince} 00:00:00`],
    ],
    hdOpen: [["status", "not in", ["Closed", "Resolved"]]],
    messagesTexts: [],
    messagesCalls: [],
    messagesVoice: [],
    messagesFittings: [
      ["scheduled_time", ">=", `${todayNy} 00:00:00`],
      ["scheduled_time", "<=", `${todayNy} 23:59:59`],
    ],
  };
}

const QC_RESULT_FIELDS = ["qc_result", "result"] as const;

/**
 * COUNT LSH QC Inspection by result. Tries `qc_result` then `result` so a
 * missing custom field does not silently report 0.
 */
export async function countQcByResult(
  result: "Pending" | "Pass" | "Fail",
  countFn: typeof erpCount = erpCount,
): Promise<number> {
  for (const field of QC_RESULT_FIELDS) {
    const n = await countFn(DT.QC_INSPECTION, [[field, "=", result]]);
    if (n > 0) return n;
  }
  return countFn(DT.QC_INSPECTION, [["qc_result", "=", result]]);
}

/** Paginated SUM of Sales Invoice outstanding_amount (not a COUNT). */
export async function sumUnpaidInvoices(
  filters: ErpFilter,
  listFn: typeof erpList = erpList,
): Promise<number> {
  let start = 0;
  let total = 0;
  const page = 500;
  for (let i = 0; i < 40; i++) {
    const rows = await listFn<{ outstanding_amount?: number }>("Sales Invoice", {
      filters,
      fields: ["outstanding_amount"],
      limit: page,
      start,
    });
    for (const r of rows) total += Number(r.outstanding_amount) || 0;
    if (rows.length < page) break;
    start += page;
  }
  return Math.round(total * 100) / 100;
}

export async function getAltsMetrics(opts?: {
  today?: string;
  countFn?: typeof erpCount;
  listFn?: typeof erpList;
}): Promise<AltsMetrics> {
  const today = opts?.today ?? nyTodayIso();
  const count = opts?.countFn ?? erpCount;
  const list = opts?.listFn ?? erpList;
  const f = metricFilters(today);

  const [
    open_alterations,
    overdue,
    due_today,
    ready,
    in_progress,
    at_home,
    stalled_48h,
    ready_not_texted,
    invoices_90,
    tasksOpen,
    tasksOverdue,
    tasksCreatedToday,
    tasksClosedToday,
    qcWaiting,
    qcPassed,
    qcFailed,
    unpaid_count,
    unpaid_total,
    queued,
    out,
    delivered_today,
    on_hold,
    hd_tickets_open,
    texts,
    calls,
    voice,
    fittings,
  ] = await Promise.all([
    count("Alteration Ticket", f.openAlterations),
    count("Alteration Ticket", f.overdue),
    count("Alteration Ticket", f.dueToday),
    count("Alteration Ticket", f.ready),
    count("Alteration Ticket", f.inProgress),
    count("Alteration Ticket", f.atHome),
    count("Alteration Ticket", f.stalled48h),
    count("Alteration Ticket", f.readyNotTexted),
    count("Sales Invoice", f.invoices90),
    count("ToDo", f.tasksOpen),
    count("ToDo", f.tasksOverdue),
    count("ToDo", f.tasksCreatedToday),
    count("ToDo", f.tasksClosedToday),
    countQcByResult("Pending", count),
    countQcByResult("Pass", count),
    countQcByResult("Fail", count),
    count("Sales Invoice", f.invoicesUnpaid),
    sumUnpaidInvoices(f.invoicesUnpaid, list),
    count("LSH Delivery", f.deliveriesQueued),
    count("LSH Delivery", f.deliveriesOut),
    count("LSH Delivery", f.deliveriesDeliveredToday),
    count("LSH Delivery", f.deliveriesOnHold),
    count("HD Ticket", f.hdOpen),
    count(DT.SMS_MESSAGE, f.messagesTexts),
    count(DT.CALL_LOG, f.messagesCalls),
    count(DT.PLAUD_CAPTURE, f.messagesVoice),
    count("Appointment", f.messagesFittings),
  ]);

  const other = 0;
  const all = texts + calls + voice + fittings + other;
  const yesterday_open = Math.max(0, tasksOpen - tasksCreatedToday + tasksClosedToday);
  const taskTrend: "up" | "down" | "flat" =
    tasksOpen > yesterday_open ? "up" : tasksOpen < yesterday_open ? "down" : "flat";

  return {
    generated_at: new Date().toISOString(),
    today,
    open_alterations,
    tasks: { open: tasksOpen, overdue: tasksOverdue, yesterday_open, trend: taskTrend },
    qc: {
      waiting: qcWaiting,
      open: qcWaiting,
      passed: qcPassed,
      failed: qcFailed,
    },
    invoices: { unpaid_count, unpaid_total },
    deliveries: { queued, out, delivered_today, on_hold },
    hd_tickets_open,
    messages: { texts, calls, voice, fittings, other, all },
    floor: {
      overdue,
      due_today,
      ready,
      in_progress,
      at_home,
      stalled_48h,
      ready_not_texted,
      invoices_90,
    },
  };
}
