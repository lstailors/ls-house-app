import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LSH_TIMELINE_EVENTS, timelineEventType } from "./delivery";

describe("timelineEventType", () => {
  test("maps parent status Queued to the child Select value queued", () => {
    expect(timelineEventType("Queued")).toBe("queued");
    expect(timelineEventType("queued")).toBe("queued");
  });

  test("keeps the other ERP-allowed events", () => {
    expect(timelineEventType("created")).toBe("created");
    expect(timelineEventType("Out for Delivery")).toBe("Out for Delivery");
    expect(timelineEventType("Delivered")).toBe("Delivered");
    expect(timelineEventType("Cancelled")).toBe("Cancelled");
    expect(timelineEventType("Failed")).toBe("Failed");
    expect(LSH_TIMELINE_EVENTS).toContain("queued");
    expect(LSH_TIMELINE_EVENTS).not.toContain("Queued");
  });

  test("intake ticket create does not write capitalized Queued as a timeline event", () => {
    const src = readFileSync(join(import.meta.dir, "../routes/intake-alterations.ts"), "utf8");
    expect(src).not.toMatch(/event_type:\s*['"]Queued['"]/);
    expect(src).toContain("timelineEventType");
  });
});
