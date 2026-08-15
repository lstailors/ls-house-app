import { describe, expect, test } from "bun:test";
import { isAutoAssignmentTodo } from "./todo-assign";

describe("isAutoAssignmentTodo", () => {
  test("matches ERP Assignment Rule titles", () => {
    expect(isAutoAssignmentTodo("Automatic Assignment")).toBe(true);
    expect(isAutoAssignmentTodo("<p>Automatic Assignment</p> HD Ticket 0094")).toBe(true);
  });
  test("leaves human tasks alone", () => {
    expect(isAutoAssignmentTodo("Call Michael about fitting")).toBe(false);
  });
});
