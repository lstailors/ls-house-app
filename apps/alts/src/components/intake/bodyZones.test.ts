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
});
