// §4 pricing formula — pure, server-side only. Never import from a client component.
import { type GarmentType, type SingleGarment, type YardageOptions, yardageFor } from "./yardage";

export type MakeLevel = "Classico" | "Mezza Mano" | "Fatto a Mano";
export const MAKE_LEVELS: MakeLevel[] = ["Classico", "Mezza Mano", "Fatto a Mano"];
export const MAKE_CODE: Record<MakeLevel, "MC" | "HH" | "HM"> = {
  Classico: "MC",
  "Mezza Mano": "HH",
  "Fatto a Mano": "HM",
};
export const GARMENT_CODE: Record<SingleGarment, "JKT" | "TRS" | "VST" | "OVC"> = {
  Jacket: "JKT",
  Trouser: "TRS",
  Vest: "VST",
  Overcoat: "OVC",
};

export function cmtItemCode(make: MakeLevel, garment: SingleGarment): string {
  return `CMT-${MAKE_CODE[make]}-${GARMENT_CODE[garment]}`;
}

export interface AccountTerms {
  fabricMultiplier: number;
  shippingPctOfCmt: number;
  retailMultiplier: number;
}

export interface PricingInput {
  garmentType: GarmentType;
  yardageOptions: YardageOptions;
  /** Raw buying cost, USD per yard. Server-only. */
  fabricRawUsdPerYard: number;
  /** CMT price per single garment from the account's price list. */
  cmt: Record<SingleGarment, number | undefined>;
  alterationsFee: Record<SingleGarment, number>;
  terms: AccountTerms;
  discountPct: number;
}

export interface GarmentLine {
  type: SingleGarment;
  yardage: number;
  cmt: number;
  fabric: number;
  shipping: number;
  unit_cost: number;
  alterations_fee: number;
}

export interface MarginLine {
  type: SingleGarment;
  real_cost: number;
  billed: number;
  profit: number;
}

export interface PricingResult {
  garments: GarmentLine[];
  totals: Omit<GarmentLine, "type">;
  retail: { multiplier: number; list_price: number; discount_pct: number; retail_price: number };
  /** Internal only — stripped by the route unless the session is internal. */
  margin: { garments: MarginLine[]; totals: Omit<MarginLine, "type"> };
}

export class MissingCmtError extends Error {
  constructor(public garment: SingleGarment) {
    super(`No CMT price on file for ${garment}`);
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function clampDiscount(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

export function price(input: PricingInput): PricingResult {
  const { terms } = input;
  const discountPct = clampDiscount(input.discountPct);

  const raw = yardageFor(input.garmentType, input.yardageOptions).map(({ garment, yardage }) => {
    const cmt = input.cmt[garment];
    if (cmt === undefined || !(cmt > 0)) throw new MissingCmtError(garment);
    const fabricAtCost = input.fabricRawUsdPerYard * yardage;
    const fabric = fabricAtCost * terms.fabricMultiplier;
    const shipping = (cmt * terms.shippingPctOfCmt) / 100;
    const unit_cost = cmt + fabric + shipping;
    return {
      type: garment,
      yardage,
      cmt,
      fabric,
      shipping,
      unit_cost,
      alterations_fee: input.alterationsFee[garment] ?? 0,
      real_cost: cmt + fabricAtCost,
    };
  });

  const sum = (k: keyof (typeof raw)[number]) => raw.reduce((s, g) => s + (g[k] as number), 0);
  const unitCost = sum("unit_cost");
  const alterations = sum("alterations_fee");
  const realCost = sum("real_cost");

  // Retail multiplier applies to the garment portion only; the alterations fee
  // is added after discount and never multiplied (§4).
  const listPrice = unitCost * terms.retailMultiplier;
  const retailPrice = listPrice * (1 - discountPct / 100) + alterations;

  return {
    garments: raw.map((g) => ({
      type: g.type,
      yardage: g.yardage,
      cmt: r2(g.cmt),
      fabric: r2(g.fabric),
      shipping: r2(g.shipping),
      unit_cost: r2(g.unit_cost),
      alterations_fee: r2(g.alterations_fee),
    })),
    totals: {
      yardage: sum("yardage"),
      cmt: r2(sum("cmt")),
      fabric: r2(sum("fabric")),
      shipping: r2(sum("shipping")),
      unit_cost: r2(unitCost),
      alterations_fee: r2(alterations),
    },
    retail: {
      multiplier: terms.retailMultiplier,
      list_price: r2(listPrice),
      discount_pct: discountPct,
      retail_price: r2(retailPrice),
    },
    margin: {
      garments: raw.map((g) => ({
        type: g.type,
        real_cost: r2(g.real_cost),
        billed: r2(g.unit_cost),
        profit: r2(g.unit_cost - g.real_cost),
      })),
      totals: { real_cost: r2(realCost), billed: r2(unitCost), profit: r2(unitCost - realCost) },
    },
  };
}
