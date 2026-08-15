import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  blankChecks,
  checksSummary,
  mergeChecks,
  MTM_STATUSES,
  QC_CHECK_CATALOG,
  QC_FAIL_STATUS,
  QC_PASS_STATUSES,
  QC_QUEUE_STATUSES,
} from "./qc";

describe("MTM QC catalog", () => {
  test("the live status list has Quality Control after Received at Store", () => {
    const keys = MTM_STATUSES.map((s) => s.key);
    expect(keys.indexOf("Received at Store")).toBeLessThan(keys.indexOf("Quality Control"));
    expect(keys.indexOf("Quality Control")).toBeLessThan(keys.indexOf("Awaiting Fitting"));
    expect(keys).toContain("Awaiting Shipment");
    expect(keys).not.toContain("Final QC");
  });

  test("queue / pass / fail follow the store-side gate", () => {
    expect([...QC_QUEUE_STATUSES]).toContain("Quality Control");
    expect([...QC_QUEUE_STATUSES]).toContain("Received at Store");
    expect([...QC_PASS_STATUSES]).toEqual(["Awaiting Fitting", "Awaiting Shipment"]);
    expect(QC_FAIL_STATUS).toBe("Alterations");
  });

  test("checks cover identity, measurements, construction, finish, condition, fit-ready", () => {
    const groups = new Set(QC_CHECK_CATALOG.map((c) => c.group));
    expect(groups).toEqual(
      new Set(["Identity", "Measurements", "Construction", "Finish", "Condition", "Fit-ready"]),
    );
    expect(QC_CHECK_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  test("mergeChecks keeps catalog order and known pass values", () => {
    const merged = mergeChecks([
      { id: "id-label", pass: true },
      { id: "cond-stain", pass: false },
      { id: "ghost", pass: true },
    ]);
    expect(merged[0]?.id).toBe("id-label");
    expect(merged[0]?.pass).toBe(true);
    expect(merged.find((c) => c.id === "cond-stain")?.pass).toBe(false);
    expect(merged.find((c) => c.id === "ghost")).toBeUndefined();
    expect(merged.every((c) => c.label)).toBe(true);
  });

  test("blank checks start open and summary counts them", () => {
    const checks = blankChecks();
    expect(checks.every((c) => c.pass === null)).toBe(true);
    expect(checksSummary(checks)).toEqual({
      total: checks.length,
      passed: 0,
      failed: 0,
      open: checks.length,
    });
  });
});

describe("QC routes are mounted", () => {
  test("app and index both serve /api/qc", () => {
    const app = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(app).toContain('app.route("/api/qc", qcRouter)');
    expect(index).toContain('app.route("/api/qc", qcRouter)');
    expect(existsSync(new URL("../routes/qc.ts", import.meta.url))).toBe(true);
  });
});
