import { describe, expect, test } from "bun:test";
import {
  agingBucket,
  daysOverdue,
  isTerminalStatus,
  rankExceptions,
  weekDeltaPct,
} from "./live-home";
import type { LiveException } from "../types";

function ex(partial: Partial<LiveException> & Pick<LiveException, "id" | "kind" | "severity">): LiveException {
  return {
    name: "Client",
    number: "1",
    icon: "•",
    href: "/",
    action: "open",
    rank: 0,
    ...partial,
  };
}

describe("live-home helpers", () => {
  test("terminal statuses match the floor definition", () => {
    expect(isTerminalStatus("Picked Up")).toBe(true);
    expect(isTerminalStatus("Cancelled")).toBe(true);
    expect(isTerminalStatus("In Progress")).toBe(false);
    expect(isTerminalStatus("Ready")).toBe(false);
  });

  test("days overdue is calendar days before today", () => {
    expect(daysOverdue("2026-08-10", "2026-08-15")).toBe(5);
    expect(daysOverdue("2026-08-15", "2026-08-15")).toBe(0);
  });

  test("aging buckets match invoice chips", () => {
    expect(agingBucket(12)).toBe("0-30");
    expect(agingBucket(45)).toBe("31-60");
    expect(agingBucket(80)).toBe("61-90");
    expect(agingBucket(120)).toBe("90+");
  });

  test("week delta is percent vs last week", () => {
    expect(weekDeltaPct(120, 100)).toBe(20);
    expect(weekDeltaPct(80, 100)).toBe(-20);
    expect(weekDeltaPct(50, 0)).toBe(100);
  });

  test("exception queue ranks urgent overdue first and caps at 8", () => {
    const items = [
      ex({ id: "s", kind: "stalled", severity: "attention", rank: 1 }),
      ex({ id: "o2", kind: "overdue", severity: "urgent", rank: -2 }),
      ex({ id: "o9", kind: "overdue", severity: "urgent", rank: -9 }),
      ex({ id: "q", kind: "qc_fail", severity: "urgent", rank: 0 }),
      ex({ id: "i", kind: "invoice_90", severity: "urgent", rank: -1 }),
      ex({ id: "t", kind: "unanswered_text", severity: "attention", rank: 0 }),
      ex({ id: "w", kind: "qc_wait", severity: "attention", rank: 0 }),
      ex({ id: "s2", kind: "stalled", severity: "attention", rank: 2 }),
      ex({ id: "o3", kind: "overdue", severity: "urgent", rank: -3 }),
    ];
    const ranked = rankExceptions(items, 8);
    expect(ranked).toHaveLength(8);
    expect(ranked[0]?.id).toBe("o9");
    expect(ranked[1]?.id).toBe("o3");
    expect(ranked.map((r) => r.kind)).toContain("invoice_90");
    expect(ranked[ranked.length - 1]?.severity).toBe("attention");
  });
});
