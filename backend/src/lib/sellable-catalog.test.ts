import { describe, expect, test } from "bun:test";
import {
  applySellableFilters,
  DENY_SELL_GROUPS,
  isDeniedGroup,
  isMtmSellGroup,
  isPreferredGroup,
  MTM_SELL_GROUPS,
  sortSellableItems,
  sellableKind,
} from "./sellable-catalog";

describe("MTM on the Walk-in sell catalog", () => {
  test("garment MTM groups are sellable, not denied", () => {
    for (const g of MTM_SELL_GROUPS) {
      expect(isMtmSellGroup(g)).toBe(true);
      expect(isDeniedGroup(g)).toBe(false);
      expect(isPreferredGroup(g)).toBe(true);
      expect(sellableKind(g)).toBe("mtm");
    }
  });

  test("wholesale MTM programs stay off the floor catalog", () => {
    expect(isMtmSellGroup("MTM Program - Jacket")).toBe(false);
    expect(isMtmSellGroup("Wholesale - MTM Program")).toBe(false);
    expect(isDeniedGroup("MTM Program - Jacket")).toBe(true);
    expect(isDeniedGroup("Wholesale - MTM Program")).toBe(true);
    expect(DENY_SELL_GROUPS).not.toContain("MTM Suit");
    expect(DENY_SELL_GROUPS).not.toContain("MTM Jacket");
  });

  test("bespoke and fabric stay denied", () => {
    expect(isDeniedGroup("Bespoke Suit")).toBe(true);
    expect(isDeniedGroup("Fabric")).toBe(true);
    expect(isDeniedGroup("Alteration Services")).toBe(true);
  });

  test("MTM tiles sort above Tramarossa / stock", () => {
    const sorted = sortSellableItems([
      {
        item_code: "TRA-1",
        item_name: "Tramarossa Jeans 5 Tasche",
        item_group: "Tramarossa Jeans",
        availability: "order" as const,
      },
      {
        item_code: "MTM-SUIT",
        item_name: "MTM Suit",
        item_group: "MTM Suit",
        availability: "order" as const,
        kind: "mtm" as const,
      },
      {
        item_code: "POLO",
        item_name: "Pique Polo",
        item_group: "RTW Shirt",
        availability: "in" as const,
      },
      {
        item_code: "MTM-TROU",
        item_name: "MTM Trouser",
        item_group: "MTM Trouser",
        availability: "order" as const,
      },
    ]);
    expect(sorted.map((d) => d.item_code)).toEqual(["MTM-SUIT", "MTM-TROU", "POLO", "TRA-1"]);
  });

  test("MTM filter is only MTM; Special order excludes MTM", () => {
    const items = [
      {
        item_code: "MTM-SUIT",
        item_name: "MTM Suit",
        item_group: "MTM Suit",
        availability: "order" as const,
        ui_group: "other" as const,
      },
      {
        item_code: "TRA-1",
        item_name: "Tramarossa Jeans",
        item_group: "Tramarossa Jeans",
        availability: "order" as const,
        ui_group: "bottoms" as const,
      },
    ];
    expect(applySellableFilters(items, { filter: "mtm" }).map((d) => d.item_code)).toEqual(["MTM-SUIT"]);
    expect(applySellableFilters(items, { filter: "order" }).map((d) => d.item_code)).toEqual(["TRA-1"]);
    expect(applySellableFilters(items, { filter: "all" })).toHaveLength(2);
  });
});
