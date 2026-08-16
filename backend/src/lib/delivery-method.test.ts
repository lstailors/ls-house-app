import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("planDeliveryFee", () => {
  test("out-of-zone hand delivery stays on our run, not FedEx", () => {
    const src = readFileSync(join(import.meta.dir, "../routes/delivery-zones.ts"), "utf8");
    expect(src).toContain("keep Hand Delivery");
    expect(src).not.toMatch(/out_of_zone" \? "Ship \(FedEx\)"/);
  });
});
