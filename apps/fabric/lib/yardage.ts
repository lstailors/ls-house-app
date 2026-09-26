// §3 yardage table — business rule, implemented exactly.
// Surcharges apply per garment; composite garments are summed.

export type SingleGarment = "Jacket" | "Trouser" | "Vest" | "Overcoat";
export type GarmentType = SingleGarment | "Two Piece" | "Three Piece";

export const GARMENT_TYPES: GarmentType[] = [
  "Jacket",
  "Trouser",
  "Vest",
  "Overcoat",
  "Two Piece",
  "Three Piece",
];

export const NARROW_WIDTH_IN = 57;

export interface YardageOptions {
  /** Fabric width in inches when known (ERPNext `custom_fabric_width_in`). */
  widthIn?: number | null;
  /** User toggle, only consulted when widthIn is unknown. */
  narrowCloth?: boolean;
  largeCheck?: boolean;
  stripeOrPlaid?: boolean;
  tall?: boolean;
}

export function expandGarment(type: GarmentType): SingleGarment[] {
  switch (type) {
    case "Two Piece":
      return ["Jacket", "Trouser"];
    case "Three Piece":
      return ["Jacket", "Trouser", "Vest"];
    default:
      return [type];
  }
}

export function knownWidth(widthIn: number | null | undefined): number | null {
  return typeof widthIn === "number" && widthIn > 0 ? widthIn : null;
}

export function isNarrow(opts: YardageOptions): boolean {
  const w = knownWidth(opts.widthIn);
  return w !== null ? w < NARROW_WIDTH_IN : !!opts.narrowCloth;
}

export function garmentYardage(garment: SingleGarment, opts: YardageOptions = {}): number {
  switch (garment) {
    case "Jacket":
      return 2.25 + (isNarrow(opts) ? 0.5 : 0) + (opts.largeCheck ? 0.25 : 0);
    case "Trouser":
      return 2.0 + (opts.tall ? 0.5 : 0);
    case "Vest":
      return 1.25 + (opts.stripeOrPlaid ? 0.25 : 0);
    case "Overcoat":
      return 3.0;
  }
}

export function yardageFor(
  type: GarmentType,
  opts: YardageOptions = {},
): { garment: SingleGarment; yardage: number }[] {
  return expandGarment(type).map((garment) => ({ garment, yardage: garmentYardage(garment, opts) }));
}

export function totalYardage(type: GarmentType, opts: YardageOptions = {}): number {
  return yardageFor(type, opts).reduce((sum, g) => sum + g.yardage, 0);
}
