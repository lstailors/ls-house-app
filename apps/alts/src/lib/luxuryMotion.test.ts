import { describe, expect, test } from "bun:test";
import { LUX_MS } from "./luxuryMotion";

describe("luxuryMotion", () => {
  test("exit wait is long enough to finish the slide", () => {
    expect(LUX_MS).toBeGreaterThanOrEqual(360);
    expect(LUX_MS).toBeLessThanOrEqual(560);
  });
});
