// Custom Made POS pricing. Total = fabric.price + construction labor for the
// garment type. A handful of premium style choices add small surcharges.
// All inputs are driven by data from /api/reference/fabrics and /api/reference/styles
// — nothing is hard-coded except the construction labor table (which would
// move to a "Workmanship" reference table in production).

import type { FabricPricing, GarmentType, StyleOption } from "@ls/types";

export const GARMENT_LABEL: Record<GarmentType, string> = {
  jacket: "Jacket",
  suit: "Two-Piece Suit",
  trousers: "Trousers",
  vest: "Waistcoat",
  overcoat: "Overcoat",
  shirt: "Shirt",
};

// Construction (cut, baste, fitting, hand-finishing) — house standard.
export const CONSTRUCTION_LABOR: Record<GarmentType, number> = {
  jacket: 2400,
  suit: 4400,
  trousers: 900,
  vest: 1100,
  overcoat: 3200,
  shirt: 380,
};

// Style options that carry an upcharge — by option name. Style Library would
// surface these explicitly in prod; for now this is a small surcharge table.
export const STYLE_UPCHARGE: Record<string, number> = {
  "Silk Twill": 280,
  "Mother of Pearl": 180,
  "Half-Canvas": 350,
  Peak: 80,
  Shawl: 140,
  "Double Vent": 60,
  French: 60,
};

export type SpecChoices = {
  fabricId?: string;
  lapel?: string;
  pockets?: string;
  vent?: string;
  lining?: string;
  buttons?: string;
  collar?: string;
  cuff?: string;
  placket?: string;
  notes?: string;
};

export function selectionUpcharges(spec: SpecChoices): { label: string; amount: number }[] {
  const out: { label: string; amount: number }[] = [];
  for (const key of ["lapel", "pockets", "vent", "lining", "buttons", "collar", "cuff", "placket"] as const) {
    const v = spec[key];
    if (v && STYLE_UPCHARGE[v]) out.push({ label: v, amount: STYLE_UPCHARGE[v] });
  }
  return out;
}

export interface PriceBreakdown {
  fabric: FabricPricing | undefined;
  fabricCost: number;
  laborLabel: string;
  laborCost: number;
  upcharges: { label: string; amount: number }[];
  upchargeTotal: number;
  subtotal: number;
}

export function computePrice(
  garment: GarmentType | undefined,
  fabric: FabricPricing | undefined,
  spec: SpecChoices,
): PriceBreakdown {
  const fabricCost = fabric?.price ?? 0;
  const laborCost = garment ? CONSTRUCTION_LABOR[garment] : 0;
  const laborLabel = garment ? `${GARMENT_LABEL[garment]} construction` : "Construction";
  const upcharges = selectionUpcharges(spec);
  const upchargeTotal = upcharges.reduce((s, x) => s + x.amount, 0);
  return {
    fabric,
    fabricCost,
    laborLabel,
    laborCost,
    upcharges,
    upchargeTotal,
    subtotal: fabricCost + laborCost + upchargeTotal,
  };
}

export function suggestedDeposit(subtotal: number): number {
  // House policy: 50% deposit, rounded to nearest $50.
  const raw = subtotal * 0.5;
  return Math.round(raw / 50) * 50;
}

export function groupStyles(styles: StyleOption[]): Record<string, StyleOption[]> {
  const out: Record<string, StyleOption[]> = {};
  for (const s of styles) {
    if (!out[s.category]) out[s.category] = [];
    out[s.category].push(s);
  }
  return out;
}

export const STYLE_GROUP_ORDER: { key: string; label: string; appliesTo: GarmentType[] }[] = [
  { key: "lapel", label: "Lapel", appliesTo: ["jacket", "suit", "overcoat"] },
  { key: "pocket", label: "Pockets", appliesTo: ["jacket", "suit", "overcoat"] },
  { key: "vent", label: "Vent", appliesTo: ["jacket", "suit", "overcoat"] },
  { key: "lining", label: "Lining", appliesTo: ["jacket", "suit", "overcoat", "vest"] },
  { key: "button", label: "Buttons", appliesTo: ["jacket", "suit", "vest", "overcoat", "shirt"] },
  { key: "collar", label: "Collar", appliesTo: ["shirt"] },
  { key: "cuff", label: "Cuff", appliesTo: ["shirt"] },
  { key: "placket", label: "Placket", appliesTo: ["shirt"] },
];

export const SPEC_KEY_BY_CATEGORY: Record<string, keyof SpecChoices> = {
  lapel: "lapel",
  pocket: "pockets",
  vent: "vent",
  lining: "lining",
  button: "buttons",
  collar: "collar",
  cuff: "cuff",
  placket: "placket",
};
