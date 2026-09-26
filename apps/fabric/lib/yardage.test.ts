import { describe, expect, test } from "bun:test";
import { type GarmentType, garmentYardage, totalYardage, yardageFor } from "./yardage";

describe("§3 yardage — single garments", () => {
  test("jacket base 2.25", () => expect(garmentYardage("Jacket")).toBe(2.25));
  test("jacket narrow toggle +0.5", () => expect(garmentYardage("Jacket", { narrowCloth: true })).toBe(2.75));
  test("jacket large check +0.25", () => expect(garmentYardage("Jacket", { largeCheck: true })).toBe(2.5));
  test("jacket narrow + large check", () =>
    expect(garmentYardage("Jacket", { narrowCloth: true, largeCheck: true })).toBe(3.0));
  test("jacket ignores tall and stripe", () =>
    expect(garmentYardage("Jacket", { tall: true, stripeOrPlaid: true })).toBe(2.25));

  test("known width 54 → narrow automatically", () => expect(garmentYardage("Jacket", { widthIn: 54 })).toBe(2.75));
  test("known width 58 → standard", () => expect(garmentYardage("Jacket", { widthIn: 58 })).toBe(2.25));
  test("width exactly 57 is not narrow", () => expect(garmentYardage("Jacket", { widthIn: 57 })).toBe(2.25));
  test("known width overrides the narrow toggle", () =>
    expect(garmentYardage("Jacket", { widthIn: 59, narrowCloth: true })).toBe(2.25));
  test("width 0 is treated as unknown", () =>
    expect(garmentYardage("Jacket", { widthIn: 0, narrowCloth: true })).toBe(2.75));

  test("trouser base 2.0", () => expect(garmentYardage("Trouser")).toBe(2.0));
  test("trouser tall +0.5", () => expect(garmentYardage("Trouser", { tall: true })).toBe(2.5));
  test("trouser has no narrow/check/stripe surcharge", () =>
    expect(garmentYardage("Trouser", { widthIn: 50, narrowCloth: true, largeCheck: true, stripeOrPlaid: true })).toBe(2.0));

  test("vest base 1.25", () => expect(garmentYardage("Vest")).toBe(1.25));
  test("vest stripe/plaid +0.25", () => expect(garmentYardage("Vest", { stripeOrPlaid: true })).toBe(1.5));
  test("vest has no narrow/check/tall surcharge", () =>
    expect(garmentYardage("Vest", { widthIn: 50, largeCheck: true, tall: true })).toBe(1.25));

  test("overcoat always 3.0", () =>
    expect(
      garmentYardage("Overcoat", { widthIn: 50, narrowCloth: true, largeCheck: true, stripeOrPlaid: true, tall: true }),
    ).toBe(3.0));
});

describe("§3 yardage — composites sum per garment", () => {
  test("two piece = jacket + trouser", () => {
    expect(yardageFor("Two Piece").map((g) => g.garment)).toEqual(["Jacket", "Trouser"]);
    expect(totalYardage("Two Piece")).toBe(4.25);
  });
  test("three piece = jacket + trouser + vest", () => {
    expect(yardageFor("Three Piece").map((g) => g.garment)).toEqual(["Jacket", "Trouser", "Vest"]);
    expect(totalYardage("Three Piece")).toBe(5.5);
  });
  test("three piece, every surcharge", () =>
    expect(
      totalYardage("Three Piece", { narrowCloth: true, largeCheck: true, stripeOrPlaid: true, tall: true }),
    ).toBe(3.0 + 2.5 + 1.5));
  test("two piece narrow width applies to jacket only", () => {
    const lines = yardageFor("Two Piece", { widthIn: 54 });
    expect(lines).toEqual([
      { garment: "Jacket", yardage: 2.75 },
      { garment: "Trouser", yardage: 2.0 },
    ]);
  });

  // Exhaustive: every toggle combination for every garment type matches the table.
  const types: GarmentType[] = ["Jacket", "Trouser", "Vest", "Overcoat", "Two Piece", "Three Piece"];
  for (let mask = 0; mask < 16; mask++) {
    const o = { narrowCloth: !!(mask & 1), largeCheck: !!(mask & 2), stripeOrPlaid: !!(mask & 4), tall: !!(mask & 8) };
    const jkt = 2.25 + (o.narrowCloth ? 0.5 : 0) + (o.largeCheck ? 0.25 : 0);
    const trs = 2.0 + (o.tall ? 0.5 : 0);
    const vst = 1.25 + (o.stripeOrPlaid ? 0.25 : 0);
    const expected: Record<GarmentType, number> = {
      Jacket: jkt,
      Trouser: trs,
      Vest: vst,
      Overcoat: 3.0,
      "Two Piece": jkt + trs,
      "Three Piece": jkt + trs + vst,
    };
    for (const t of types)
      test(`${t} ${JSON.stringify(o)}`, () => expect(totalYardage(t, o)).toBeCloseTo(expected[t], 10));
  }
});
