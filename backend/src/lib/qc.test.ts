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
  storeArrivalToDocFields,
  frappeScrub,
  isPausedMtmStatus,
  shouldLiftPaused,
  liveStatusFromPaused,
  MTM_STATUSES,
  QC_CHECK_CATALOG,
  QC_FAIL_STATUS,
  QC_PASS_STATUSES,
  QC_QUEUE_STATUSES,
  qcResultOf,
  tabToQcResult,
} from "./qc";
import { maskKey, mergeDocusealSettings } from "./qc-settings";

describe("MTM QC catalog", () => {
  test("the live status list has Quality Control after Received at Store", () => {
    const keys = MTM_STATUSES.map((s) => s.key);
    expect(keys.indexOf("Received at Store")).toBeLessThan(keys.indexOf("Quality Control"));
    expect(keys.indexOf("Quality Control")).toBeLessThan(keys.indexOf("Awaiting Fitting"));
    expect(keys).toContain("Awaiting Shipment");
    expect(keys).not.toContain("Final QC");
  });

  test("Pause / Hold is lifted onto the live status list", () => {
    expect(isPausedMtmStatus("Pause / Hold")).toBe(true);
    expect(isPausedMtmStatus("On Pause")).toBe(true);
    expect(isPausedMtmStatus("Quality Control")).toBe(false);
    expect(liveStatusFromPaused("Pause / Hold")).toBe("Quality Control");
    expect(shouldLiftPaused({ order_status: "Quality Control" })).toBe(false);
    expect(shouldLiftPaused({ order_status: "Pause / Hold" })).toBe(true);
    expect(shouldLiftPaused({ notes: "on hold until fabric" })).toBe(false);
  });

  test("queue / pass / fail follow the store-side gate", () => {
    expect([...QC_QUEUE_STATUSES]).toContain("Quality Control");
    expect([...QC_QUEUE_STATUSES]).toContain("Received at Store");
    expect([...QC_PASS_STATUSES]).toEqual(["Awaiting Fitting", "Awaiting Shipment"]);
    expect(QC_FAIL_STATUS).toBe("Alterations");
  });

  test("checks cover store arrival plus the six floor groups", () => {
    const groups = new Set(QC_CHECK_CATALOG.map((c) => c.group));
    expect(groups).toEqual(
      new Set(["Store arrival", "Identity", "Measurements", "Construction", "Finish", "Condition", "Fit-ready"]),
    );
    expect(QC_CHECK_CATALOG.length).toBeGreaterThanOrEqual(25);
    expect(QC_CHECK_CATALOG.filter((c) => c.group === "Store arrival").map((c) => c.label)).toEqual([
      "Contents match order",
      "Fabric/article correct",
      "Styling / visual OK",
      "No transit damage",
      "Labels/tags present",
    ]);
  });

  test("mergeChecks keeps catalog order and known pass values", () => {
    const merged = mergeChecks([
      { id: "id-label", pass: true },
      { id: "cond-stain", pass: false },
      { id: "ghost", pass: true },
    ]);
    expect(merged[0]?.id).toBe("arrive-contents");
    expect(merged.find((c) => c.id === "id-label")?.pass).toBe(true);
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

  test("Pass writes the ERPNext store-arrival boxes", () => {
    const fields = storeArrivalToDocFields(undefined, null, { forcePass: true });
    expect(fields.contents_match_order).toBe(1);
    expect(fields.fabric_article_correct).toBe(1);
    expect(fields.styling_visual_ok).toBe(1);
    expect(fields.no_transit_damage).toBe(1);
    expect(fields.labels_tags_present).toBe(1);
    expect(frappeScrub("Styling / visual OK")).toBe("styling_visual_ok");
    expect(frappeScrub("Fabric/article correct")).toBe("fabric_article_correct");
    const fromTable = storeArrivalToDocFields(undefined, {
      store_arrival_checklist: [
        { name: "row-1", label: "Contents match order", checked: 0 },
        { name: "row-2", label: "Labels/tags present", checked: 0 },
      ],
    }, { forcePass: true });
    const rows = fromTable.store_arrival_checklist as Array<{ checked: number }>;
    expect(rows.every((r) => r.checked === 1)).toBe(true);
  });

  test("Pass uses DocType meta field names and child Check columns", () => {
    const fields = storeArrivalToDocFields(undefined, {
      receiving_items: [
        { name: "r1", check_item: "Contents match order", is_checked: 0 },
        { name: "r2", check_item: "No transit damage", is_checked: 0 },
      ],
    }, {
      forcePass: true,
      meta: {
        fields: [
          { fieldname: "sa_contents_ok", label: "Contents match order", fieldtype: "Check" },
          { fieldname: "receiving_items", label: "Store arrival", fieldtype: "Table", options: "LSH QC Arrival Item" },
        ],
        childFields: {
          receiving_items: [
            { fieldname: "check_item", label: "Item", fieldtype: "Data" },
            { fieldname: "is_checked", label: "Checked", fieldtype: "Check" },
          ],
        },
      },
    });
    expect(fields.sa_contents_ok).toBe(1);
    const rows = fields.receiving_items as Array<{ is_checked: number }>;
    expect(rows.every((r) => r.is_checked === 1)).toBe(true);
  });

  test("checksFromDoc reads ticked store-arrival child rows", () => {
    const checks = checksFromDoc({
      arrival_items: [
        { label: "Contents match order", is_checked: 1 },
        { label: "Fabric/article correct", checked: 1 },
      ],
    });
    expect(checks.find((c) => c.id === "arrive-contents")?.pass).toBe(true);
    expect(checks.find((c) => c.id === "arrive-fabric")?.pass).toBe(true);
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
      new Set(["Store arrival", "Identity", "Measurements", "Construction", "Finish", "Condition", "Fit-ready"]),
    );
    expect(checks.filter((c) => c.group === "Identity").every((c) => c.pass === true)).toBe(true);
    expect(checks.filter((c) => c.group === "Construction").every((c) => c.pass === false)).toBe(true);
    expect(checks.filter((c) => c.group === "Fit-ready").every((c) => c.pass === true)).toBe(true);
  });
});

describe("QC list helpers", () => {
  test("qc_result Pending / Pass / Fail maps the Waiting/Passed/Failed tabs", () => {
    expect(qcResultOf({ qc_result: "Pending" })).toBe("Pending");
    expect(qcResultOf({ qc_result: "Pass" })).toBe("Pass");
    expect(qcResultOf({ qc_result: "Fail" })).toBe("Fail");
    expect(tabToQcResult("waiting")).toBe("Pending");
    expect(tabToQcResult("open")).toBe("Pending");
    expect(tabToQcResult("passed")).toBe("Pass");
    expect(tabToQcResult("failed")).toBe("Fail");
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

  test("DocuSeal settings merge ERP over globals over env", () => {
    const merged = mergeDocusealSettings(
      { apiKey: "global-key", url: "https://from-global.example" },
      { apiKey: "erp-key" },
    );
    expect(merged.apiKey).toBe("erp-key");
    expect(merged.url).toBe("https://from-global.example");
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

  test("waiting list is inspections, not an unfiltered MTMPro dump", () => {
    const src = readFileSync(new URL("../routes/qc.ts", import.meta.url), "utf8");
    expect(src).not.toContain("listMtmInQueue");
    expect(src).not.toContain("need_by_date");
    expect(src).toContain("qc_result");
    expect(src).toContain("date_received");
    expect(src).toContain('qcRouter.get("/settings"');
    expect(src).toContain("requireAdmin");
    expect(src).toContain("dedupeByInspectionName");
    expect(src).not.toContain("setMtmStatus");
    expect(src).toContain("listInspectionsByResult");
    expect(src).toContain("listMakeOrdersInQcQueue");
    expect(src).toContain("DT.MTM_PRO_ORDER");
    expect(src).toContain('qcRouter.get("/:id/pdf"');
    expect(src).toContain("loadQcMeta");
    expect(src).toContain("frappe.client.set_value");
    expect(src).toContain("forcePass: true");
    expect(src).toContain("stubInspection");
    expect(src).toContain("raceMs");
    expect(src).toContain("liftPausedStatuses");
    expect(src).toContain("saveQcInspection");
    expect(src).toContain("pausedFieldsOf");
    const settings = readFileSync(new URL("./qc-settings.ts", import.meta.url), "utf8");
    expect(settings).toContain("persistGlobals");
    expect(settings).toContain("set_global_default");
    expect(settings).toContain("frappe.client.set_value");
    expect(settings.indexOf("await persistGlobals(next)")).toBeGreaterThan(settings.indexOf("await persistErpDoc"));
    expect(src).toContain('doctype === "Sales Order" && key === "status"');
  });

  test("live MTM pipeline routes are registered before /:id", () => {
    const src = readFileSync(new URL("../routes/qc.ts", import.meta.url), "utf8");
    expect(src.indexOf('qcRouter.get("/orders"')).toBeLessThan(src.indexOf('qcRouter.get("/:id"'));
    expect(src.indexOf('qcRouter.patch("/orders/:name/status"')).toBeLessThan(src.indexOf('qcRouter.patch("/:id"'));
    expect(src).toContain("setMtmOrderStatus");
    expect(src).toContain("listMtmPipeline");
    expect(src).toContain("DT.MTM_PRO_ORDER");
  });

  test("frontends ship the same 16 live MTM statuses, including Cancelled", () => {
    const keys = MTM_STATUSES.map((s) => s.key);
    expect(keys).toHaveLength(16);
    expect(keys).toContain("Cancelled");
    const alts = readFileSync(new URL("../../../apps/alts/src/lib/mtmStatus.ts", import.meta.url), "utf8");
    const web = readFileSync(new URL("../../../webapp/src/lib/mtmStatus.ts", import.meta.url), "utf8");
    for (const key of keys) {
      expect(alts).toContain(`"${key}"`);
      expect(web).toContain(`"${key}"`);
    }
  });

  test("settings is registered before /:id so it is not treated as an inspection", () => {
    const src = readFileSync(new URL("../routes/qc.ts", import.meta.url), "utf8");
    expect(src.indexOf('qcRouter.get("/settings"')).toBeLessThan(src.indexOf('qcRouter.get("/:id"'));
    expect(src.indexOf('qcRouter.patch("/settings"')).toBeLessThan(src.indexOf('qcRouter.patch("/:id"'));
    expect(src.indexOf('qcRouter.post("/settings/test"')).toBeLessThan(src.indexOf('qcRouter.post("/:id/sign"'));
    expect(src).not.toContain("submissions/pdf");
    expect(src).toContain("fileQcPassFail");
    expect(src).toContain("attachDocusealResultFiles");
    expect(src).toContain("buildQcResultPdf");
    expect(src).toContain("externalId");
  });
});
