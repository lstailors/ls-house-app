import { describe, expect, test } from "bun:test";
import { vendorForItem } from "./vendor-match";

const loroPiana = { vendor_code: "FAB-FW26", vendor_name: "Loro Piana" };
const retiredLp = { vendor_code: "FAB-LP", vendor_name: "Loro Piana" };

describe("Loro Piana vendor resolution", () => {
  test("active map FAB-FW26 matches FAB-FW26 items; the brand name is not a key", () => {
    const active = [loroPiana];
    expect(vendorForItem("FAB-FW26-N684001", active)).toEqual(loroPiana);
    expect(vendorForItem("FAB-LP-N684001", active)).toBeNull();
  });

  test("inactive FAB-LP is a different prefix and is not rewritten to FAB-FW26", () => {
    const both = [retiredLp, loroPiana];
    expect(vendorForItem("FAB-FW26-N684001", both)?.vendor_code).toBe("FAB-FW26");
    expect(vendorForItem("FAB-LP-OLD", both)?.vendor_code).toBe("FAB-LP");
  });
});
