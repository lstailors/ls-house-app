import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("PromiseSchedule slots", () => {
  test("checkout promise time is only 10 AM or 4 PM, default 4 PM", () => {
    const src = readFileSync(new URL("./PromiseSchedule.tsx", import.meta.url), "utf8");
    expect(src).toContain('value: "10:00"');
    expect(src).toContain('value: "16:00"');
    expect(src).toContain('DEFAULT_PROMISE_TIME = "16:00"');
    expect(src).not.toContain('value: "11:00"');
    expect(src).not.toContain('value: "18:00"');
  });
});
