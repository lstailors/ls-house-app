import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  blankChecks,
  checksFromDoc,
  checksSummary,
  dateReceivedLabel,
  dedupeByInspectionName,
  isQcInspectionName,
  isSalesOrderName,
  mergeChecks,
  MTM_STATUSES,
  QC_CHECK_CATALOG,
  QC_FAIL_STATUS,
  QC_PASS_STATUSES,
  QC_QUEUE_STATUSES,
  qcResultOf,
  tabToQcResult,
} from "./qc";
import { maskKey } from "./qc-settings";

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

  test("six floor groups map from LSH QC Inspection fields", () => {
    const checks = checksFromDoc({
      identity: 1,
      measurements: 1,
      construction: 0,
      finish: 1,
      condition: 1,
      fit_ready: 1,
    });
    expect(new Set(checks.map((c) => c.group))).toEqual(
      new Set(["Identity", "Measurements", "Construction", "Finish", "Condition", "Fit-ready"]),
    );
    expect(checks.filter((c) => c.group === "Identity").every((c) => c.pass === true)).toBe(true);
    expect(checks.filter((c) => c.group === "Construction").every((c) => c.pass === false)).toBe(true);
    expect(checks.filter((c) => c.group === "Fit-ready").every((c) => c.pass === true)).toBe(true);
  });
});

describe("QC list helpers", () => {
  test("qc_result Pending / Pass / Fail maps the Open/Passed/Failed tabs", () => {
    expect(qcResultOf({ qc_result: "Pending" })).toBe("Pending");
    expect(qcResultOf({ qc_result: "Pass" })).toBe("Pass");
    expect(qcResultOf({ qc_result: "Fail" })).toBe("Fail");
    expect(tabToQcResult("open")).toBe("Pending");
    expect(tabToQcResult("passed")).toBe("Pass");
    expect(tabToQcResult("failed")).toBe("Fail");
    expect(tabToQcResult("waiting")).toBeNull();
  });

  test("dedupes on inspection name", () => {
    const rows = dedupeByInspectionName([
      { name: "LSH-QC-2026-00001", id: "a" },
      { name: "LSH-QC-2026-00001", id: "b" },
      { name: "LSH-QC-2026-00002", id: "c" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["LSH-QC-2026-00001", "LSH-QC-2026-00002"]);
  });

  test("date_received is used as-is and future dates are dropped", () => {
    const now = new Date("2026-08-15T12:00:00");
    expect(dateReceivedLabel("2026-08-12", now)).toBe("2026-08-12");
    expect(dateReceivedLabel("2026-08-18", now)).toBeNull();
    expect(dateReceivedLabel("", now)).toBeNull();
  });

  test("waiting cards key on LSH-QC names, not sales orders", () => {
    expect(isQcInspectionName("LSH-QC-2026-00008")).toBe(true);
    expect(isQcInspectionName("QC-2026-00008")).toBe(true);
    expect(isQcInspectionName("LSTNY-SO-2026-00485")).toBe(false);
    expect(isSalesOrderName("LSTNY-SO-2026-00485")).toBe(true);
    expect(isSalesOrderName("LSH-QC-2026-00008")).toBe(false);
  });

  test("DocuSeal keys are masked for the settings page", () => {
    expect(maskKey("")).toBe("");
    expect(maskKey("abcd1234efgh")).toBe("abcd…efgh");
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

  test("waiting list is inspections, not an MTMPro / sales-order dump", () => {
    const src = readFileSync(new URL("../routes/qc.ts", import.meta.url), "utf8");
    expect(src).not.toContain("listMtmInQueue");
    expect(src).not.toContain("DT.MTM_PRO_ORDER");
    expect(src).not.toContain("need_by_date");
    expect(src).toContain("qc_result");
    expect(src).toContain("date_received");
    expect(src).toContain('qcRouter.get("/settings"');
    expect(src).toContain("requireAdmin");
    expect(src).toContain("dedupeByInspectionName");
    expect(src).not.toContain("setMtmStatus");
  });

  test("settings is registered before /:id so it is not treated as an inspection", () => {
    const src = readFileSync(new URL("../routes/qc.ts", import.meta.url), "utf8");
    expect(src.indexOf('qcRouter.get("/settings"')).toBeLessThan(src.indexOf('qcRouter.get("/:id"'));
    expect(src.indexOf('qcRouter.patch("/settings"')).toBeLessThan(src.indexOf('qcRouter.patch("/:id"'));
  });
});
