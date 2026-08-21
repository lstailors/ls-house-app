import { expect, test } from "bun:test";
import { matchesAlterationKpiFilter } from "./alterationKpiFilter";

const today = "2026-08-20";

function ticket(partial: Record<string, unknown>) {
  return {
    status: "in_progress",
    dueDate: "2026-08-22",
    tailorId: "EMP-1",
    tailor: { name: "Hugo" },
    isRush: false,
    ...partial,
  };
}

test("active keeps intake and in progress only", () => {
  expect(matchesAlterationKpiFilter(ticket({ status: "intake" }), "active", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ status: "in_progress" }), "active", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ status: "ready" }), "active", today)).toBe(false);
  expect(matchesAlterationKpiFilter(ticket({ status: "picked_up" }), "active", today)).toBe(false);
});

test("due today ignores picked up and cancelled", () => {
  expect(matchesAlterationKpiFilter(ticket({ dueDate: today }), "dueToday", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: today, status: "ready" }), "dueToday", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: today, status: "picked_up" }), "dueToday", today)).toBe(false);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: "2026-08-19" }), "dueToday", today)).toBe(false);
});

test("overdue is past due and not ready or done", () => {
  expect(matchesAlterationKpiFilter(ticket({ dueDate: "2026-08-19" }), "overdue", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: "2026-08-19", status: "intake" }), "overdue", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: "2026-08-19", status: "ready" }), "overdue", today)).toBe(false);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: today }), "overdue", today)).toBe(false);
  expect(matchesAlterationKpiFilter(ticket({ dueDate: null }), "overdue", today)).toBe(false);
});

test("rush and unassigned skip finished tickets", () => {
  expect(matchesAlterationKpiFilter(ticket({ isRush: true }), "rush", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ isRush: true, status: "picked_up" }), "rush", today)).toBe(false);
  expect(matchesAlterationKpiFilter(ticket({ tailorId: null, tailor: null }), "unassigned", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ tailorId: "EMP-1" }), "unassigned", today)).toBe(false);
});

test("tailor WIP and ready tiles", () => {
  expect(matchesAlterationKpiFilter(ticket({ tailor: { name: "Stella" } }), "stellaWip", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ tailor: { name: "Hugo" } }), "hugoWip", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ status: "ready" }), "readyForPickup", today)).toBe(true);
  expect(matchesAlterationKpiFilter(ticket({ status: "in_progress" }), "readyForPickup", today)).toBe(false);
});
