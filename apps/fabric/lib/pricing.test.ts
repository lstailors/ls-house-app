import { describe, expect, test } from "bun:test";
import { MissingCmtError, type PricingInput, cmtItemCode, price } from "./pricing";

const deCorato = { fabricMultiplier: 1.2, shippingPctOfCmt: 8, retailMultiplier: 3.2 };
const fattoAMano = { Jacket: 830, Trouser: 350, Vest: 250, Overcoat: 910 };
const altFees = { Jacket: 150, Trouser: 50, Vest: 75, Overcoat: 150 };

const base: PricingInput = {
  garmentType: "Two Piece",
  yardageOptions: { widthIn: 59 },
  fabricRawUsdPerYard: 118.1,
  cmt: fattoAMano,
  alterationsFee: altFees,
  terms: deCorato,
  discountPct: 20,
};

describe("§7 worked example — de Corato, Fatto a Mano, Two Piece, $118.10/yd, 59in", () => {
  // The brief's expected figures (fabric 460.6 = 118.10 × 3.25 × 1.2) assume 3.25 yd,
  // but its own §3 table gives a Two Piece 2.25 + 2.00 = 4.25 yd. The table is the
  // business rule we implement; both readings are pinned here so the conflict is visible.

  test("formula chain reproduces the brief's figures at the brief's 3.25 yd of fabric", () => {
    // Same fabric dollars as 3.25 yd @ $118.10, expressed over the table's 4.25 yd.
    const r = price({ ...base, fabricRawUsdPerYard: (118.1 * 3.25) / 4.25 });
    expect(r.totals.cmt).toBe(1180);
    expect(r.totals.fabric).toBeCloseTo(460.6, 1);
    expect(r.totals.shipping).toBeCloseTo(94.4, 2);
    expect(r.totals.unit_cost).toBeCloseTo(1735.0, 1);
    expect(r.totals.alterations_fee).toBe(200);
    expect(r.retail.list_price).toBeCloseTo(5552.0, 1);
    expect(r.retail.retail_price).toBeCloseTo(4641.6, 1);
  });

  test("with the §3 table yardage (4.25 yd) — what the app actually quotes", () => {
    const r = price(base);
    expect(r.totals.yardage).toBe(4.25);
    expect(r.totals.cmt).toBe(1180);
    expect(r.totals.fabric).toBeCloseTo(602.31, 2); // 118.10 × 4.25 × 1.2
    expect(r.totals.shipping).toBeCloseTo(94.4, 2);
    expect(r.totals.unit_cost).toBeCloseTo(1876.71, 2);
    expect(r.totals.alterations_fee).toBe(200);
    expect(r.retail.multiplier).toBe(3.2);
    expect(r.retail.list_price).toBeCloseTo(6005.47, 2);
    expect(r.retail.discount_pct).toBe(20);
    expect(r.retail.retail_price).toBeCloseTo(5004.38, 2); // 6005.47 × 0.8 + 200
  });

  test("per-garment lines", () => {
    const r = price(base);
    expect(r.garments.map((g) => g.type)).toEqual(["Jacket", "Trouser"]);
    expect(r.garments[0]).toMatchObject({ yardage: 2.25, cmt: 830, shipping: 66.4, alterations_fee: 150 });
    expect(r.garments[0].fabric).toBeCloseTo(318.87, 2);
    expect(r.garments[1]).toMatchObject({ yardage: 2.0, cmt: 350, shipping: 28, alterations_fee: 50 });
    expect(r.garments[1].fabric).toBeCloseTo(283.44, 2);
  });
});

describe("§4 rules", () => {
  test("alterations fee is never multiplied or discounted", () => {
    const a = price({ ...base, discountPct: 0 });
    const b = price({ ...base, discountPct: 0, alterationsFee: { ...altFees, Jacket: 0, Trouser: 0 } });
    expect(a.retail.list_price).toBe(b.retail.list_price);
    expect(a.retail.retail_price - b.retail.retail_price).toBeCloseTo(200, 6);
    expect(a.totals.unit_cost).toBe(b.totals.unit_cost);
  });

  test("alterations fee is not part of unit_cost", () => {
    const r = price(base);
    expect(r.totals.unit_cost).toBeCloseTo(r.totals.cmt + r.totals.fabric + r.totals.shipping, 1);
  });

  test("discount 0 and 100", () => {
    expect(price({ ...base, discountPct: 0 }).retail.retail_price).toBeCloseTo(6005.47 + 200, 2);
    expect(price({ ...base, discountPct: 100 }).retail.retail_price).toBe(200);
  });

  test("discount is clamped to 0–100", () => {
    expect(price({ ...base, discountPct: -10 }).retail.discount_pct).toBe(0);
    expect(price({ ...base, discountPct: 150 }).retail.discount_pct).toBe(100);
  });

  test("internal terms (1.0 / 0%) → billed equals real cost", () => {
    const r = price({ ...base, terms: { fabricMultiplier: 1, shippingPctOfCmt: 0, retailMultiplier: 1 } });
    expect(r.margin.totals.profit).toBe(0);
    expect(r.totals.fabric).toBeCloseTo(118.1 * 4.25, 2);
  });

  test("margin = billed − (cmt + fabric at cost)", () => {
    const r = price(base);
    expect(r.margin.totals.real_cost).toBeCloseTo(1180 + 118.1 * 4.25, 1);
    expect(r.margin.totals.profit).toBeCloseTo(118.1 * 4.25 * 0.2 + 94.4, 2);
  });

  test("single overcoat", () => {
    const r = price({ ...base, garmentType: "Overcoat", discountPct: 0 });
    expect(r.totals).toMatchObject({ yardage: 3, cmt: 910, alterations_fee: 150 });
    expect(r.totals.shipping).toBeCloseTo(72.8, 2);
  });

  test("missing CMT price throws rather than pricing at $0", () => {
    expect(() => price({ ...base, cmt: { ...fattoAMano, Trouser: undefined } })).toThrow(MissingCmtError);
    expect(() => price({ ...base, cmt: { ...fattoAMano, Jacket: 0 } })).toThrow(MissingCmtError);
  });

  test("CMT item codes", () => {
    expect(cmtItemCode("Classico", "Jacket")).toBe("CMT-MC-JKT");
    expect(cmtItemCode("Mezza Mano", "Trouser")).toBe("CMT-HH-TRS");
    expect(cmtItemCode("Fatto a Mano", "Overcoat")).toBe("CMT-HM-OVC");
  });
});
