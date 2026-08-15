import { describe, expect, test } from "bun:test";
import { shouldRestorePickupBag } from "./pickupBag";

describe("shouldRestorePickupBag", () => {
  test("fresh pickup stays empty", () => {
    expect(shouldRestorePickupBag(new URLSearchParams())).toBe(false);
  });
  test("scanner and deep links restore", () => {
    expect(shouldRestorePickupBag(new URLSearchParams("scanned=1"))).toBe(true);
    expect(shouldRestorePickupBag(new URLSearchParams("ticket=ALT-1"))).toBe(true);
    expect(shouldRestorePickupBag(new URLSearchParams("addInvoice=SINV-1"))).toBe(true);
  });
});
