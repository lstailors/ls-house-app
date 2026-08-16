import { describe, expect, test } from "bun:test";
import { blankChecks } from "./qc";
import { qcDocusealFields } from "./docuseal";
import { buildQcResultPdf, formatQcChecksText, formatQcResultSummary } from "./qc-result-pdf";

describe("QC result PDF", () => {
  test("builds a Pass PDF from the floor checks", async () => {
    const checks = blankChecks().map((c) => ({ ...c, pass: true as boolean | null }));
    const bytes = await buildQcResultPdf({
      result: "Pass",
      inspection: "LSH-QC-2026-00001",
      customerName: "Ada West",
      salesOrder: "SAL-0001",
      customOrder: "LST-100",
      inspector: "Carl",
      notes: "Ready for fitting",
      checks,
    });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(800);
    expect(text).toContain("%%EOF");
  });

  test("summary and DocuSeal fields carry the pass/fail list", () => {
    const checks = blankChecks().map((c, i) => ({ ...c, pass: i === 0 ? false : true }));
    const summary = formatQcResultSummary({
      result: "Fail",
      inspection: "LSH-QC-2026-00002",
      customerName: "Ada West",
      checks,
      notes: "Hem",
    });
    expect(summary).toContain("Result: Fail");
    expect(summary).toContain("[FAIL] Contents match order");
    expect(formatQcChecksText(checks)).toContain("STORE ARRIVAL");
    const fields = qcDocusealFields({
      customerName: "Ada West",
      result: "Fail",
      inspection: "LSH-QC-2026-00002",
      checksText: summary,
    });
    expect(fields.find((f) => f.name === "Result")?.default_value).toBe("Fail");
    expect(fields.find((f) => f.name === "Checks")?.default_value).toContain("FAIL");
  });
});
