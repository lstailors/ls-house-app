/**
 * Zone resolution + delivery fee helpers for intake.
 * SPEC Parts 5, 9, 10 — client never computes fee; hub is SoT when ERP method missing.
 */
import { Hono } from "hono";
import { erpList, erpGet } from "../lib/erp";
import { getAuthedUser } from "../lib/scope";
import { normalizeZip } from "../lib/delivery";

export const deliveryZonesRouter = new Hono();

type ZoneRow = {
  name: string;
  zone_code: string;
  zone_name: string;
  zone_price: number;
  zone_item: string;
  zip_codes: string;
  origin_location: string;
  is_active: number;
  zone_color?: string;
  zone_order?: number;
};

let zoneCache: { at: number; rows: ZoneRow[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

async function loadZones(origin: string): Promise<ZoneRow[]> {
  const now = Date.now();
  if (zoneCache && now - zoneCache.at < CACHE_MS) {
    return zoneCache.rows.filter((z) => z.origin_location === origin && z.is_active);
  }
  const rows = await erpList<ZoneRow>("LSH Delivery Zone", {
    filters: [
      ["is_active", "=", 1],
      ["origin_location", "=", origin],
    ] as unknown[],
    fields: [
      "name",
      "zone_code",
      "zone_name",
      "zone_price",
      "zone_item",
      "zip_codes",
      "origin_location",
      "is_active",
      "zone_color",
      "zone_order",
    ],
    limit: 50,
    order_by: "zone_order asc",
  });
  // Cache all origins when possible — for now just this origin's list
  zoneCache = { at: now, rows: rows || [] };
  return rows || [];
}

export function bustZoneCache() {
  zoneCache = null;
}

export async function resolveDeliveryZone(
  zipRaw: string,
  originLocation = "NYC",
): Promise<
  | { status: "in_zone"; zone: string; zone_name: string; fee: number; item_code: string; color?: string }
  | { status: "out_of_zone"; zip: string }
  | { status: "invalid"; zip: string }
> {
  const zip = normalizeZip(zipRaw);
  if (!zip) return { status: "invalid", zip: String(zipRaw || "") };

  const zones = await loadZones(originLocation);
  for (const z of zones) {
    const zips = String(z.zip_codes || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (zips.includes(zip)) {
      return {
        status: "in_zone",
        zone: z.zone_code || z.name,
        zone_name: z.zone_name,
        fee: Number(z.zone_price) || 0,
        item_code: z.zone_item,
        color: z.zone_color,
      };
    }
  }
  return { status: "out_of_zone", zip };
}

// GET /api/delivery-zones/resolve?zip=10065&origin=NYC
deliveryZonesRouter.get("/resolve", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const zip = c.req.query("zip") || "";
  const origin = c.req.query("origin") || "NYC";
  const result = await resolveDeliveryZone(zip, origin);
  return c.json({ data: result });
});

// GET /api/delivery-zones — list active zones
deliveryZonesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const origin = c.req.query("origin") || "NYC";
  const zones = await loadZones(origin);
  return c.json({
    data: zones.map((z) => ({
      code: z.zone_code || z.name,
      name: z.zone_name,
      price: Number(z.zone_price) || 0,
      item_code: z.zone_item,
      color: z.zone_color,
      order: z.zone_order,
      zips: String(z.zip_codes || "").split(",").filter(Boolean),
    })),
  });
});

export type DeliveryFeePlan = {
  method: "Pickup" | "Hand Delivery" | "Ship (FedEx)";
  scheduled: boolean;
  zone: string | null;
  zone_name: string | null;
  fee: number;
  item_code: string | null;
  free_custom: boolean;
};

/** Compute fee line plan for ticket + invoice (Parts 4.5, 9, 10). */
export async function planDeliveryFee(opts: {
  delivery_method?: string | null;
  delivery_scheduled?: number | boolean | null;
  delivery_zip?: string | null;
  delivery_fee_override?: number | boolean | null;
  delivery_fee?: number | null;
  included_in_custom?: number | boolean | null;
  billing_status?: string | null;
  linked_sales_order?: string | null;
  origin_location?: string | null;
}): Promise<DeliveryFeePlan> {
  const methodRaw = String(opts.delivery_method || "Pickup");
  const method: DeliveryFeePlan["method"] =
    methodRaw === "Ship (FedEx)" || methodRaw === "Ship"
      ? "Ship (FedEx)"
      : methodRaw === "Hand Delivery" || methodRaw === "Courier"
        ? "Hand Delivery"
        : "Pickup";

  const freeCustom = Boolean(
    opts.included_in_custom ||
      opts.billing_status === "Included in Custom Order" ||
      opts.linked_sales_order,
  );

  if (method === "Pickup") {
    return {
      method,
      scheduled: false,
      zone: null,
      zone_name: null,
      fee: 0,
      item_code: null,
      free_custom: freeCustom,
    };
  }

  const scheduled = Boolean(opts.delivery_scheduled) || method === "Ship (FedEx)" || method === "Hand Delivery";
  const origin = opts.origin_location === "HOU" ? "HOU" : "NYC";

  if (method === "Ship (FedEx)") {
    const fee = opts.delivery_fee_override
      ? Number(opts.delivery_fee) || 0
      : Number(opts.delivery_fee) || 0;
    return {
      method,
      scheduled,
      zone: null,
      zone_name: null,
      fee: freeCustom ? 0 : fee,
      item_code: freeCustom ? "DEL-CUSTOM-INCL" : "DEL-FEDEX",
      free_custom: freeCustom,
    };
  }

  // Hand delivery
  const resolved = await resolveDeliveryZone(String(opts.delivery_zip || ""), origin);
  if (resolved.status === "in_zone") {
    let fee = resolved.fee;
    if (opts.delivery_fee_override) fee = Number(opts.delivery_fee) || 0;
    if (freeCustom) fee = 0;
    return {
      method,
      scheduled,
      zone: resolved.zone,
      zone_name: resolved.zone_name,
      fee,
      item_code: freeCustom ? "DEL-CUSTOM-INCL" : resolved.item_code,
      free_custom: freeCustom,
    };
  }

  // Out of Manhattan zones: keep Hand Delivery (goes on our run). Fee is quoted, not FedEx.
  const fee = freeCustom ? 0 : Number(opts.delivery_fee) || 0;
  return {
    method,
    scheduled,
    zone: null,
    zone_name: null,
    fee,
    item_code: freeCustom ? "DEL-CUSTOM-INCL" : fee > 0 ? "DEL-FEDEX" : null,
    free_custom: freeCustom,
  };
}
