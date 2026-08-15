import { describe, expect, test } from "bun:test";
import {
  clientInitials,
  daysLate,
  fmtDue,
  fmtTime,
  hoursLeft,
  isRush,
  sortShopTickets,
  syncLabel,
} from "./ticketDisplay";

describe("ticketDisplay", () => {
  test("initials use first and last", () => {
    expect(clientInitials("Carl Sagan")).toBe("CS");
    expect(clientInitials("Stella")).toBe("ST");
    expect(clientInitials("")).toBe("•");
  });

  test("fmtTime is 12-hour", () => {
    expect(fmtTime("15:30:00")).toBe("3:30 PM");
    expect(fmtTime("09:05")).toBe("9:05 AM");
  });

  test("rush is a 1/0 check", () => {
    expect(isRush({ is_rush: 1 })).toBe(true);
    expect(isRush({ is_rush: 0 })).toBe(false);
  });

  test("daysLate is zero for today", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const iso = today.toISOString().slice(0, 10);
    expect(daysLate(iso)).toBe(0);
  });

  test("hoursLeft is null when already late", () => {
    expect(hoursLeft("2000-01-01", "09:00")).toBeNull();
  });

  test("fmtDue marks today and late", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const iso = today.toISOString().slice(0, 10);
    expect(fmtDue(iso).kind).toBe("soon");
    expect(fmtDue(iso).text).toBe("Due today");
    expect(fmtDue("2000-01-01").kind).toBe("late");
    expect(fmtDue().kind).toBe("ok");
  });

  test("sort puts late, then rush, then due date", () => {
    const late = { due_date: "2000-01-01", is_rush: 0 };
    const rush = { due_date: "2099-01-01", is_rush: 1 };
    const later = { due_date: "2099-12-01", is_rush: 0 };
    expect(sortShopTickets(late, rush)).toBe(-1);
    expect(sortShopTickets(rush, later)).toBe(-1);
    expect(sortShopTickets(later, rush)).toBe(1);
  });

  test("syncLabel tracks freshness", () => {
    expect(syncLabel(undefined, true)).toBe("Syncing…");
    expect(syncLabel(undefined, false)).toBe("Live");
    expect(syncLabel(Date.now(), false)).toBe("Live · just now");
  });
});
