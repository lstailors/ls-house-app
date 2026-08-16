import type { DeliverySelection } from "./DeliveryBlock";

export type TicketDeliveryFields = {
  delivery_method?: string | null;
  delivery_address?: string | null;
  delivery_apt?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
  delivery_zip?: string | null;
  delivery_notes?: string | null;
  delivery_fee?: number | null;
  delivery_scheduled?: number | boolean | null;
  delivery_requested_date?: string | null;
  delivery_time_window?: string | null;
  due_date?: string | null;
};

/** Same three buttons as intake checkout. */
export function asFohDeliveryMethod(raw?: string | null): DeliverySelection["delivery_method"] {
  if (raw === "Hand Delivery" || raw === "Courier") return "Hand Delivery";
  if (
    raw === "Ship (FedEx)" ||
    raw === "Ship" ||
    raw === "FedEx" ||
    raw === "Ship Direct"
  ) {
    return "Ship (FedEx)";
  }
  return "Pickup";
}

export function deliveryFromTicket(t: TicketDeliveryFields): DeliverySelection {
  const method = asFohDeliveryMethod(t.delivery_method);
  return {
    delivery_method: method,
    delivery_scheduled: method !== "Pickup",
    delivery_address: t.delivery_address ?? "",
    delivery_apt: t.delivery_apt ?? "",
    delivery_city: t.delivery_city || "New York",
    delivery_state: t.delivery_state || "NY",
    delivery_zip: t.delivery_zip ?? "",
    delivery_notes: t.delivery_notes ?? "",
    delivery_fee: Number(t.delivery_fee ?? 0) || 0,
    delivery_requested_date: t.delivery_requested_date || t.due_date || undefined,
    delivery_time_window: t.delivery_time_window || "Anytime",
    _status: "idle",
    _fee: 0,
  };
}
