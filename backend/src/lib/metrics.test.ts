import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { countQcByResult, getAltsMetrics, metricFilters } from "./metrics";

describe("metricFilters", () => {
  test("task overdue requires Open + date before today NY", () => {
    const f = metricFilters("2026-08-15");
    expect(f.tasksOpen).toEqual([["status", "=", "Open"]]);
    expect(f.tasksOverdue).toEqual([
      ["status", "=", "Open"],
      ["date", "<", "2026-08-15"],
    ]);
  });

  test("QC waiting is Pending on qc_result", () => {
    expect(metricFilters("2026-08-15").qcWaiting).toEqual([["qc_result", "=", "Pending"]]);
  });

  test("HD open excludes Closed and Resolved", () => {
    expect(metricFilters("2026-08-15").hdOpen).toEqual([
      ["status", "not in", ["Closed", "Resolved"]],
    ]);
  });

  test("delivered today is bounded to the NY calendar day", () => {
    const f = metricFilters("2026-08-15");
    expect(f.deliveriesDeliveredToday).toEqual([
      ["lsh_status", "=", "Delivered"],
      ["lsh_delivered_at", ">=", "2026-08-15 00:00:00"],
      ["lsh_delivered_at", "<=", "2026-08-15 23:59:59"],
    ]);
  });

  test("overdue is due_date before today and non-terminal", () => {
    const f = metricFilters("2026-08-15");
    expect(f.overdue).toEqual([
      ["workflow_state", "not in", ["Picked Up", "Cancelled"]],
      ["due_date", "<", "2026-08-15"],
    ]);
    expect(f.invoices90[2]).toEqual(["posting_date", "<", "2026-05-17"]);
  });
});

describe("getAltsMetrics", () => {
  test("every badge is an explicit COUNT and ALL equals the message buckets", async () => {
    const calls: Array<{ doctype: string; filters: unknown[] }> = [];
    const countFn = async (doctype: string, filters: unknown[] = []) => {
      calls.push({ doctype, filters });
      const key = `${doctype}:${JSON.stringify(filters)}`;
      const table: Record<string, number> = {
        'Alteration Ticket:[["workflow_state","not in",["Picked Up","Cancelled"]]]': 41,
        'ToDo:[["status","=","Open"]]': 312,
        'ToDo:[["status","=","Open"],["date","<","2026-08-15"]]': 40,
        'LSH QC Inspection:[["qc_result","=","Pending"]]': 7,
        'LSH QC Inspection:[["qc_result","=","Pass"]]': 12,
        'LSH QC Inspection:[["qc_result","=","Fail"]]': 2,
        'Sales Invoice:[["docstatus","=",1],["outstanding_amount",">",0]]': 9,
        'LSH Delivery:[["lsh_status","=","Queued"]]': 4,
        'LSH Delivery:[["lsh_status","=","Out for Delivery"]]': 3,
        'LSH Delivery:[["lsh_status","=","Delivered"],["lsh_delivered_at",">=","2026-08-15 00:00:00"],["lsh_delivered_at","<=","2026-08-15 23:59:59"]]': 2,
        'LSH Delivery:[["lsh_status","in",["Failed","Cancelled"]],["modified",">=","2026-08-09 00:00:00"]]': 1,
        'HD Ticket:[["status","not in",["Closed","Resolved"]]]': 370,
        "LSH SMS Message:[]": 106,
        "LSH Call Log:[]": 0,
        "LSH Plaud Capture:[]": 50,
        'Appointment:[["scheduled_time",">=","2026-08-15 00:00:00"],["scheduled_time","<=","2026-08-15 23:59:59"]]': 0,
      };
      return table[key] ?? 0;
    };
    const listFn = async () => [] as { outstanding_amount?: number }[];

    const metrics = await getAltsMetrics({
      today: "2026-08-15",
      countFn: countFn as any,
      listFn: listFn as any,
    });

    expect(metrics.tasks.open).toBe(312);
    expect(metrics.tasks.overdue).toBe(40);
    expect(metrics.qc.waiting).toBe(7);
    expect(metrics.qc.open).toBe(7);
    expect(metrics.hd_tickets_open).toBe(370);
    expect(metrics.messages.texts + metrics.messages.calls + metrics.messages.voice + metrics.messages.fittings + metrics.messages.other).toBe(
      metrics.messages.all,
    );
    expect(metrics.messages.all).toBe(156);
    expect(calls.every((c) => c.doctype)).toBe(true);
    expect(calls.some((c) => c.doctype === "ToDo")).toBe(true);
  });

  test("countQcByResult falls back to result when qc_result COUNTs 0", async () => {
    const countFn = async (_dt: string, filters: unknown[] = []) => {
      const field = (filters[0] as unknown[])?.[0];
      if (field === "qc_result") return 0;
      if (field === "result") return 7;
      return 0;
    };
    expect(await countQcByResult("Pending", countFn as any)).toBe(7);
  });
});

describe("metrics route", () => {
  test("app and index both serve /api/metrics", () => {
    const app = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(app).toContain('app.route("/api/metrics", metricsRouter)');
    expect(index).toContain('app.route("/api/metrics", metricsRouter)');
  });
});
