/**
 * FOH delivery methods on an alteration ticket.
 * Intake checkout and the ticket details page share this mapping so
 * Pickup / Hand delivery / Ship (FedEx) are the same three choices everywhere.
 */

export const FOH_DELIVERY_METHODS = ["Pickup", "Hand Delivery", "Ship (FedEx)"] as const;
export type FohDeliveryMethod = (typeof FOH_DELIVERY_METHODS)[number];

const WINDOW_START: Record<string, string> = {
  "Morning (9–12)": "09:00:00",
  "Afternoon (12–4)": "12:00:00",
  "Evening (4–7)": "16:00:00",
  Anytime: "12:00:00",
};

/** Map any stored / legacy label onto the three FOH buttons. */
export function normalizeTicketDeliveryMethod(raw?: string | null): FohDeliveryMethod {
  const v = String(raw || "").trim();
  if (v === "Hand Delivery" || v === "Courier") return "Hand Delivery";
  if (
    v === "Ship (FedEx)" ||
    v === "Ship" ||
    v === "FedEx" ||
    v === "Ship Direct" ||
    v === "Courier Ship"
  ) {
    return "Ship (FedEx)";
  }
  return "Pickup";
}

/** LSH Delivery method. Pickup does not queue a house run. */
export function lshMethodForTicket(
  method: FohDeliveryMethod,
): "Hand Delivery" | "Ship Direct" | null {
  if (method === "Pickup") return null;
  if (method === "Ship (FedEx)") return "Ship Direct";
  return "Hand Delivery";
}

export function lshCarrierForTicket(method: FohDeliveryMethod): "FedEx" | null {
  return method === "Ship (FedEx)" ? "FedEx" : null;
}

export function zip5(raw?: string | null): string {
  return String(raw || "").replace(/\D/g, "").slice(0, 5);
}

export function validateTicketDeliveryInput(input: {
  method: FohDeliveryMethod;
  address?: string | null;
  zip?: string | null;
}): string | null {
  if (input.method === "Pickup") return null;
  const street = String(input.address || "").trim();
  const zip = zip5(input.zip);
  if (street.length < 3) return "Enter a street address for delivery or shipping";
  if (zip.length !== 5) return "Enter a 5-digit ZIP";
  return null;
}

export function scheduledAtFrom(
  date?: string | null,
  window?: string | null,
): string | null {
  const day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const tw = String(window || "Anytime");
  return `${day} ${WINDOW_START[tw] || "12:00:00"}`;
}

export function ticketDeliveryPatch(opts: {
  method: FohDeliveryMethod;
  address?: string | null;
  apt?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  requestedDate?: string | null;
  timeWindow?: string | null;
  fee?: number | null;
  zone?: string | null;
  feeOverride?: boolean;
  feeOverrideReason?: string | null;
}): Record<string, unknown> {
  const scheduled = opts.method !== "Pickup";
  const patch: Record<string, unknown> = {
    delivery_method: opts.method,
    delivery_scheduled: scheduled ? 1 : 0,
    delivery_fee: scheduled ? Number(opts.fee) || 0 : 0,
  };

  if (!scheduled) {
    patch.delivery_zone = null;
    return patch;
  }

  if (opts.address != null) patch.delivery_address = String(opts.address).trim();
  if (opts.apt != null) patch.delivery_apt = String(opts.apt).trim() || null;
  patch.delivery_city = String(opts.city || "New York").trim() || "New York";
  patch.delivery_state = String(opts.state || "NY").trim() || "NY";
  if (opts.zip != null) patch.delivery_zip = zip5(opts.zip) || null;
  if (opts.notes != null) patch.delivery_notes = String(opts.notes).trim() || null;
  if (opts.requestedDate) patch.delivery_requested_date = String(opts.requestedDate).slice(0, 10);
  if (opts.timeWindow) patch.delivery_time_window = opts.timeWindow;
  if (opts.zone) patch.delivery_zone = opts.zone;
  if (opts.feeOverride) {
    patch.delivery_fee_override = 1;
    if (opts.feeOverrideReason) patch.delivery_fee_override_reason = opts.feeOverrideReason;
  }
  return patch;
}

const LOCKED_LSH_STATUSES = new Set(["Out for Delivery", "Delivered"]);

export function canMutateQueuedDelivery(status?: string | null): boolean {
  const s = String(status || "Queued");
  return !LOCKED_LSH_STATUSES.has(s) && s !== "Cancelled";
}

export function canCancelQueuedDelivery(status?: string | null): boolean {
  const s = String(status || "");
  return s === "Queued" || s === "Scheduled" || s === "";
}
