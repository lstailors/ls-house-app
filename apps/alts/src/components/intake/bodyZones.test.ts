import { describe, expect, test } from "bun:test";
import { leavesForZone, zonesForGarment } from "./bodyZones";

describe("intake zone catalog", () => {
  test("Sleeves lists every sleeve quote line, not only a starred favorite", () => {
    const sleeves = zonesForGarment("Jacket").find((z) => z.id === "sleeves");
    expect(sleeves).toBeTruthy();
    const rows = leavesForZone(
      [
        { id: "fav", display_name: "Lengthen Sleeves (false cuffs)", quick_pick: 1 },
        { id: "short", display_name: "Shorten sleeves" },
        { id: "vent", display_name: "Sleeve vent" },
        { id: "folder", display_name: "Sleeves", is_group: 1 },
        { id: "kid", display_name: "Working cuff", parent_preset: "folder" },
        { id: "hem", display_name: "Shorten jacket hem" },
      ],
      sleeves!,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["fav", "kid", "short", "vent"]);
  });

  test("raw ERP cache rows without id still list every sleeve (offline clobber regression)", () => {
    const sleeves = zonesForGarment("Jacket").find((z) => z.id === "sleeves");
    expect(sleeves).toBeTruthy();
    // Shape from /api/offline/snapshot before normalize — name only, no id/price
    const rows = leavesForZone(
      [
        { name: "Jacket — Sleeves", display_name: "Sleeves", is_group: 1 },
        {
          name: "Jacket — Lengthen Sleeves (false cuffs)",
          display_name: "Lengthen Sleeves (false cuffs)",
          parent_preset: "Jacket — Sleeves",
        },
        {
          name: "Jacket — Shorten sleeves (original)",
          display_name: "Shorten sleeves (original)",
          parent_preset: "Jacket — Sleeves",
        },
        {
          name: "Jacket — Take In (take in sleeves)",
          display_name: "Take In (take in sleeves)",
          parent_preset: "Jacket — Sleeves",
        },
        { name: "Jacket — Shorten hem (original)", display_name: "Shorten hem (original)" },
      ],
      sleeves!,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Jacket — Lengthen Sleeves (false cuffs)",
      "Jacket — Shorten sleeves (original)",
      "Jacket — Take In (take in sleeves)",
    ]);
  });
});
