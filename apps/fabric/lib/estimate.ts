// Orchestrates §4 against live ERPNext data and shapes the browser response.
// The response never contains fabric_raw, fabric/shipping multipliers or the
// buying currency rate. Margin is included only for internal sessions.
import "server-only";
import {
  activeVendors,
  alterationsFees,
  cmtPrices,
  fabricBuyingPrice,
  getFabric,
  perYard,
  todayISO,
  vendorForItem,
} from "./catalog";
import { toUsdRate } from "./fx";
import { UserError } from "./http";
import { MAKE_LEVELS, type MakeLevel, MissingCmtError, type PricingResult, price } from "./pricing";
import { type Account, loadCustomer, termsFromCustomer } from "./session";
import { GARMENT_TYPES, type GarmentType, expandGarment } from "./yardage";

export interface EstimateInput {
  fabric_item: string;
  garment_type: GarmentType;
  make_level?: MakeLevel;
  discount_pct?: number;
  options: { narrow_cloth: boolean; large_check: boolean; stripe_plaid: boolean; tall: boolean };
  /** Internal sessions only: price as this trade account. */
  as_customer?: string;
}

export function parseEstimateInput(body: unknown): EstimateInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const o = (b.options ?? {}) as Record<string, unknown>;
  if (typeof b.fabric_item !== "string" || !b.fabric_item.trim())
    throw new UserError("Pick a fabric first", "bad_request");
  if (!GARMENT_TYPES.includes(b.garment_type as GarmentType)) throw new UserError("Pick a garment", "bad_request");
  if (b.make_level !== undefined && !MAKE_LEVELS.includes(b.make_level as MakeLevel))
    throw new UserError("Unknown make level", "bad_request");
  const discount = b.discount_pct === undefined || b.discount_pct === null ? undefined : Number(b.discount_pct);
  if (discount !== undefined && !Number.isFinite(discount)) throw new UserError("Bad discount", "bad_request");
  return {
    fabric_item: b.fabric_item.trim(),
    garment_type: b.garment_type as GarmentType,
    make_level: b.make_level as MakeLevel | undefined,
    discount_pct: discount,
    options: {
      narrow_cloth: o.narrow_cloth === true,
      large_check: o.large_check === true,
      stripe_plaid: o.stripe_plaid === true,
      tall: o.tall === true,
    },
    as_customer: typeof b.as_customer === "string" && b.as_customer ? b.as_customer : undefined,
  };
}

export interface EstimateResponse {
  account: { name: string };
  fabric: {
    item_code: string;
    item_name: string;
    composition: string | null;
    image: string | null;
    width_in: number | null;
    vendor_code: string;
    vendor_name: string;
  };
  garment_type: GarmentType;
  make_level: MakeLevel;
  garments: PricingResult["garments"];
  totals: PricingResult["totals"];
  retail: PricingResult["retail"] | null;
  flags: {
    stale_price: boolean;
    price_valid_upto: string | null;
    provisional_vendor: boolean;
    fx_fallback: boolean;
    width_assumed: boolean;
    out_of_stock: boolean;
  };
  margin?: PricingResult["margin"];
}

const NO_PRICING = "No pricing on file for this fabric — contact L&S";

async function effectiveTerms(account: Account, asCustomer?: string) {
  if (!asCustomer || asCustomer === account.customer) return account;
  // Enforced here, not in the UI: only internal sessions may price as another account.
  if (!account.isInternal) throw new UserError("Not permitted", "forbidden", 403);
  const doc = await loadCustomer(asCustomer);
  if (!doc) throw new UserError("Unknown account", "not_found", 404);
  return { ...account, customer: doc.name, ...termsFromCustomer(doc, false) };
}

export async function runEstimate(account: Account, input: EstimateInput): Promise<EstimateResponse> {
  const acct = await effectiveTerms(account, input.as_customer);
  if (!acct.priceList) throw new UserError("This account has no price list configured — contact L&S", "not_configured", 422);

  const today = todayISO();
  const vendors = await activeVendors();
  const vendor = vendorForItem(input.fabric_item, vendors);
  if (!vendor) throw new UserError("Unknown fabric vendor", "not_found", 404);

  const make = input.make_level ?? acct.defaultMake;
  const [fabric, buying, cmt, alts] = await Promise.all([
    getFabric(input.fabric_item),
    fabricBuyingPrice(input.fabric_item, vendor, today),
    cmtPrices(acct.priceList, make),
    alterationsFees(),
  ]);
  if (!fabric) throw new UserError("Fabric not found", "not_found", 404);
  if (!buying) throw new UserError(NO_PRICING, "no_pricing", 422);
  const fx = await toUsdRate(buying.currency, today);
  if (!fx) throw new UserError(NO_PRICING, "no_pricing", 422);

  let result: PricingResult;
  try {
    result = price({
      garmentType: input.garment_type,
      yardageOptions: {
        widthIn: fabric.width_in,
        narrowCloth: input.options.narrow_cloth,
        largeCheck: input.options.large_check,
        stripeOrPlaid: input.options.stripe_plaid,
        tall: input.options.tall,
      },
      fabricRawUsdPerYard: perYard(buying.rate, buying.uom) * fx.rate,
      cmt,
      alterationsFee: alts,
      terms: acct.terms,
      discountPct: input.discount_pct ?? acct.defaultDiscount,
    });
  } catch (e) {
    if (e instanceof MissingCmtError)
      throw new UserError(`No ${make} make price on file for ${e.garment} — contact L&S`, "no_pricing", 422);
    throw e;
  }
  if (!(result.totals.unit_cost > 0)) throw new UserError(NO_PRICING, "no_pricing", 422);

  const hasJacket = expandGarment(input.garment_type).includes("Jacket");
  const response: EstimateResponse = {
    account: { name: acct.customerName },
    fabric: {
      item_code: fabric.item_code,
      item_name: fabric.item_name,
      composition: fabric.composition,
      image: fabric.image,
      width_in: fabric.width_in,
      vendor_code: vendor.vendor_code,
      vendor_name: vendor.vendor_name,
    },
    garment_type: input.garment_type,
    make_level: make,
    garments: result.garments,
    totals: result.totals,
    retail: acct.terms.retailMultiplier > 0 ? result.retail : null,
    flags: {
      stale_price: buying.stale,
      price_valid_upto: buying.stale ? buying.valid_upto : null,
      provisional_vendor: vendor.provisional,
      fx_fallback: fx.fallback,
      width_assumed: hasJacket && fabric.width_in === null,
      out_of_stock: fabric.out_of_stock,
    },
  };
  if (account.isInternal) response.margin = result.margin;
  return response;
}
