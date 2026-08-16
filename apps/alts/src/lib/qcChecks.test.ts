import { expect, test } from "bun:test";
import { blankQcChecks, isQcInspectionName, mergeQcChecks } from "./qcChecks";

test("blank QC checks include store arrival so the page is never empty", () => {
  const checks = blankQcChecks();
  expect(checks.filter((c) => c.group === "Store arrival").map((c) => c.label)).toEqual([
    "Contents match order",
    "Fabric/article correct",
    "Styling / visual OK",
    "No transit damage",
    "Labels/tags present",
  ]);
  expect(checks.every((c) => c.pass === null)).toBe(true);
  expect(checks.length).toBeGreaterThanOrEqual(25);
});

test("LSH-QC names open the form without waiting for ERPNext", () => {
  expect(isQcInspectionName("LSH-QC-2026-00006")).toBe(true);
  expect(isQcInspectionName("QC-2026-00006")).toBe(true);
  expect(isQcInspectionName("LSTNY-SO-2026-00485")).toBe(false);
});

test("merge keeps catalog rows when the API sends nothing", () => {
  expect(mergeQcChecks(undefined).map((c) => c.id)[0]).toBe("arrive-contents");
  expect(mergeQcChecks([{ id: "arrive-contents", pass: true }]).find((c) => c.id === "arrive-contents")?.pass).toBe(true);
});
