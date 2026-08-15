import { describe, expect, test } from "bun:test";
import { formatDate, formatDateTime, isDateOnlySource } from "./format";

describe("date-only vs datetime rendering", () => {
  test("YYYY-MM-DD is date-only", () => {
    expect(isDateOnlySource("2026-07-02")).toBe(true);
    expect(formatDateTime("2026-07-02")).toBe("Jul 2");
    expect(formatDateTime("2026-07-02")).not.toMatch(/AM|PM/i);
    expect(formatDate("2026-07-02")).toBe("Jul 2, 2026");
  });

  test("midnight timestamps never show 12:00 AM", () => {
    expect(isDateOnlySource("2026-07-02T00:00:00")).toBe(true);
    expect(formatDateTime("2026-07-02 00:00:00")).toBe("Jul 2");
    expect(formatDateTime("2026-07-02T00:00:00Z")).toBe("Jul 2");
  });

  test("naive ERP datetimes keep the wall clock (not UTC→NY)", () => {
    expect(formatDateTime("2026-07-07 14:30:00")).toBe("Jul 7, 2:30 PM");
  });

  test("UTC morning that lands on 3:00 AM NY is treated as a date", () => {
    // 07:00 UTC in EDT is 3:00 AM — a date stored as UTC, not a night delivery.
    const label = formatDateTime("2026-07-07T07:00:00.000Z");
    expect(label).toBe("Jul 7");
    expect(label).not.toMatch(/3:00 AM/);
  });
});
