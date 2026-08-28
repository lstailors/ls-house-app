/**
 * Floor fulfillment label — where the garment is right now.
 * Shared by Shop Floor, Ticket detail, Invoice list, Pickup.
 */

export type FulfillmentKey =
  | "At Store"
  | "In Store"
  | "At Home Tailor"
  | "In Production"
  | "Ready Rack"
  | "Picked Up"
  | "Out for Delivery"
  | "Delivered"
  | "Cancelled"
  | "Custom Order";

export type FulfillmentInput = {
  workflow_state?: string | null;
  assigned_tailor?: string | null;
  assigned_tailor_name?: string | null;
  delivery_method?: string | null;
  origin_location?: string | null;
  delivery_status?: string | null;
  lsh_fulfillment?: string | null;
  lsh_where_detail?: string | null;
  lsh_origin_location?: string | null;
};

export type Fulfillment = {
  key: FulfillmentKey;
  label: string;
  detail: string;
  shop: "NYC" | "PB" | string;
  tone: "dim" | "brass" | "amber" | "green" | "violet" | "red";
};

function shopOf(origin?: string | null): "NYC" | "PB" | string {
  const o = String(origin || "NYC").toUpperCase();
  if (o === "PB" || o === "PALM BEACH") return "PB";
  return "NYC";
}

function normalizeKey(raw: string): FulfillmentKey | "" {
  const v = raw.trim();
  if (v === "In Store") return "At Store";
  return v as FulfillmentKey;
}

export function computeFulfillment(t: FulfillmentInput): Fulfillment {
  const stamped = normalizeKey(String(t.lsh_fulfillment || "").trim());
  if (stamped) {
    return {
      key: stamped,
      label: stamped,
      detail: String(t.lsh_where_detail || "").trim(),
      shop: shopOf(t.lsh_origin_location || t.origin_location),
      tone: toneFor(stamped),
    };
  }

  const state = String(t.workflow_state || "").trim();
  const tailor = String(t.assigned_tailor_name || t.assigned_tailor || "").trim();
  const method = String(t.delivery_method || "Pickup").trim();
  const dstat = String(t.delivery_status || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  const shop = shopOf(t.origin_location);

  let key: FulfillmentKey = "At Store";
  let detail = "";

  if (state === "Cancelled") {
    key = "Cancelled";
    detail = "Cancelled";
  } else if (["delivered", "complete", "completed"].includes(dstat)) {
    key = "Delivered";
    detail = "Delivered";
  } else if (["out_for_delivery", "dispatched", "in_transit", "on_route"].includes(dstat)) {
    key = "Out for Delivery";
    detail = method || "Out for delivery";
  } else if (state === "Picked Up") {
    key = "Picked Up";
    detail = method === "Pickup" ? "Picked up at store" : method;
  } else if (state === "Ready") {
    key = "Ready Rack";
    detail = method === "Pickup" ? "Ready for pickup" : `Ready · ${method}`;
  } else if (tailor && (state === "Received" || state === "In Progress" || !state)) {
    key = "At Home Tailor";
    detail = tailor;
  } else {
    key = "At Store";
    detail = tailor ? `At store · ${tailor}` : state || "At store";
  }

  return { key, label: key, detail, shop, tone: toneFor(key) };
}

function toneFor(key: FulfillmentKey): Fulfillment["tone"] {
  switch (key) {
    case "At Home Tailor":
      return "violet";
    case "Ready Rack":
    case "Out for Delivery":
      return "amber";
    case "Picked Up":
    case "Delivered":
      return "green";
    case "Cancelled":
      return "dim";
    case "Custom Order":
      return "brass";
    case "In Production":
    case "At Store":
    case "In Store":
    default:
      return "red";
  }
}

export function fulfillmentChipClass(tone: Fulfillment["tone"]): string {
  switch (tone) {
    case "green":
      return "border-signal-emerald/40 bg-signal-emerald/15 text-signal-emerald";
    case "amber":
      return "border-signal-amber/40 bg-signal-amber/15 text-signal-amber";
    case "violet":
      return "border-[rgba(155,139,196,0.45)] bg-[rgba(155,139,196,0.14)] text-[var(--vi,#9B8BC4)]";
    case "red":
      return "border-signal-rose/40 bg-signal-rose/15 text-signal-rose";
    case "dim":
      return "border-cream/20 bg-white/5 text-cream-dim";
    case "brass":
    default:
      return "border-brass/40 bg-brass/12 text-brass-light";
  }
}
