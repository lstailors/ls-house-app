import { describe, expect, test } from "bun:test";
import { pickupBagStats } from "./pickupBag";

describe("pickupBagStats", () => {
  test("counts invoices with ticketRef as tickets and reconciles paid vs due", () => {
    const stats = pickupBagStats([
      { kind: "invoice", ticketRef: "ALT-1", total: 2500, outstanding: 2500 },
      { kind: "invoice", ticketRef: "ALT-2", total: 2500, outstanding: 2500 },
      { kind: "invoice", ticketRef: "ALT-3", total: 1970, outstanding: 1430 },
    ]);
    expect(stats.ticketCount).toBe(3);
    expect(stats.invoiceCount).toBe(0);
    expect(stats.bagTotal).toBe(6970);
    expect(stats.bagDue).toBe(6430);
    expect(stats.bagPaid).toBe(540);
  });

  test("plain invoices stay invoices", () => {
    const stats = pickupBagStats([
      { kind: "ticket", total: 100, outstanding: 0 },
      { kind: "invoice", ticketRef: null, total: 50, outstanding: 50 },
    ]);
    expect(stats.ticketCount).toBe(1);
    expect(stats.invoiceCount).toBe(1);
    expect(stats.bagPaid).toBe(100);
  });
});
