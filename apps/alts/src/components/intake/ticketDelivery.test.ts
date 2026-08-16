import { describe, expect, test } from "bun:test";
import { asFohDeliveryMethod, deliveryFromTicket } from "./ticketDelivery";

describe("ticket details delivery mapping", () => {
  test("maps stored method onto Pickup / Hand delivery / Ship (FedEx)", () => {
    expect(asFohDeliveryMethod("Pickup")).toBe("Pickup");
    expect(asFohDeliveryMethod("Hand Delivery")).toBe("Hand Delivery");
    expect(asFohDeliveryMethod("Courier")).toBe("Hand Delivery");
    expect(asFohDeliveryMethod("Ship Direct")).toBe("Ship (FedEx)");
    expect(asFohDeliveryMethod("FedEx")).toBe("Ship (FedEx)");
  });

  test("seeds the picker from the ticket, not checkout-only defaults", () => {
    const d = deliveryFromTicket({
      delivery_method: "Hand Delivery",
      delivery_address: "782 Tanglewood Rd",
      delivery_zip: "11795",
      delivery_city: "West Islip",
      due_date: "2026-08-20",
    });
    expect(d.delivery_method).toBe("Hand Delivery");
    expect(d.delivery_address).toBe("782 Tanglewood Rd");
    expect(d.delivery_zip).toBe("11795");
    expect(d.delivery_requested_date).toBe("2026-08-20");
  });
});
