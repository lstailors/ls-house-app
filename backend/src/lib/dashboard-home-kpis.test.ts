import { expect, test } from "bun:test";
import {
  isMtmInProduction,
  isYzActive,
  monthStartYmd,
  pctChange,
  pickProductionCount,
  previousMonthStartYmd,
  sumInvoicesInRange,
} from "./dashboard-home-kpis";

test("month bounds use UTC year/month", () => {
  const now = new Date("2026-08-20T03:00:00.000Z");
  expect(monthStartYmd(now)).toBe("2026-08-01");
  expect(previousMonthStartYmd(now)).toBe("2026-07-01");
});

test("invoice MTD ignores cancelled and dates outside the window", () => {
  const invoices = [
    { posting_date: "2026-08-06", grand_total: 100, status: "Unpaid" },
    { posting_date: "2026-08-11", grand_total: 50, status: "Overdue" },
    { posting_date: "2026-08-12", grand_total: 20, status: "Cancelled" },
    { posting_date: "2026-07-31", grand_total: 999, status: "Paid" },
  ];
  expect(sumInvoicesInRange(invoices, "2026-08-01")).toBe(150);
  expect(sumInvoicesInRange(invoices, "2026-07-01", "2026-08-01")).toBe(999);
});

test("pct change treats a zero prior month as 100 when current has volume", () => {
  expect(pctChange(3202, 77049)).toBe(-96);
  expect(pctChange(0, 500)).toBe(-100);
  expect(pctChange(200, 0)).toBe(100);
  expect(pctChange(0, 0)).toBe(0);
});

test("production count prefers live MTM/YZ books over an empty garment table", () => {
  expect(pickProductionCount({
    lshGarments: 0,
    mtmInProduction: 182,
    yzActive: 42,
    salesOrdersInProduction: 101,
  })).toBe(182);
  expect(pickProductionCount({
    lshGarments: 0,
    mtmInProduction: 0,
    yzActive: 42,
    salesOrdersInProduction: 101,
  })).toBe(42);
  expect(isYzActive("In Production")).toBe(true);
  expect(isYzActive("")).toBe(true);
  expect(isYzActive("Shipped")).toBe(false);
  expect(isMtmInProduction("Order Submitted")).toBe(true);
  expect(isMtmInProduction("Delivered")).toBe(false);
});
