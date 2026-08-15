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
import { addDaysIso, nyTodayIso } from "./shop-time";
import type { AltsMetrics } from "../types";

export type ErpFilter = unknown[];

export type MetricFilterSet = {
  openAlterations: ErpFilter;
  tasksOpen: ErpFilter;
  tasksOverdue: ErpFilter;
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
export function metricFilters(todayNy: string): MetricFilterSet {
  const holdSince = addDaysIso(todayNy, -6);
  return {
    openAlterations: [["workflow_state", "not in", ["Picked Up", "Cancelled"]]],
    tasksOpen: [["status", "=", "Open"]],
    tasksOverdue: [
      ["status", "=", "Open"],
      ["date", "<", todayNy],
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
    tasksOpen,
    tasksOverdue,
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
    count("ToDo", f.tasksOpen),
    count("ToDo", f.tasksOverdue),
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

  return {
    generated_at: new Date().toISOString(),
    today,
    open_alterations,
    tasks: { open: tasksOpen, overdue: tasksOverdue },
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
  };
}
