import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canCancelQueuedDelivery,
  canMutateQueuedDelivery,
  lshCarrierForTicket,
  lshMethodForTicket,
  normalizeTicketDeliveryMethod,
  scheduledAtFrom,
  ticketDeliveryPatch,
  validateTicketDeliveryInput,
} from "./ticket-delivery";

describe("normalizeTicketDeliveryMethod", () => {
  test("maps intake labels and legacy aliases onto Pickup / Hand Delivery / Ship (FedEx)", () => {
    expect(normalizeTicketDeliveryMethod("Pickup")).toBe("Pickup");
    expect(normalizeTicketDeliveryMethod(null)).toBe("Pickup");
    expect(normalizeTicketDeliveryMethod("Hand Delivery")).toBe("Hand Delivery");
    expect(normalizeTicketDeliveryMethod("Courier")).toBe("Hand Delivery");
    expect(normalizeTicketDeliveryMethod("Ship (FedEx)")).toBe("Ship (FedEx)");
    expect(normalizeTicketDeliveryMethod("Ship")).toBe("Ship (FedEx)");
    expect(normalizeTicketDeliveryMethod("FedEx")).toBe("Ship (FedEx)");
    expect(normalizeTicketDeliveryMethod("Ship Direct")).toBe("Ship (FedEx)");
  });
});

describe("LSH mapping", () => {
  test("Pickup does not queue a house run", () => {
    expect(lshMethodForTicket("Pickup")).toBeNull();
    expect(lshCarrierForTicket("Pickup")).toBeNull();
  });

  test("Hand Delivery stays on our run (never FedEx)", () => {
    expect(lshMethodForTicket("Hand Delivery")).toBe("Hand Delivery");
    expect(lshCarrierForTicket("Hand Delivery")).toBeNull();
  });

  test("Ship (FedEx) becomes Ship Direct + FedEx carrier", () => {
    expect(lshMethodForTicket("Ship (FedEx)")).toBe("Ship Direct");
    expect(lshCarrierForTicket("Ship (FedEx)")).toBe("FedEx");
  });
});

describe("validateTicketDeliveryInput", () => {
  test("Pickup needs no address", () => {
    expect(validateTicketDeliveryInput({ method: "Pickup" })).toBeNull();
  });

  test("Hand Delivery and Ship require street + ZIP", () => {
    expect(
      validateTicketDeliveryInput({ method: "Hand Delivery", address: "12", zip: "100" }),
    ).toMatch(/street/i);
    expect(
      validateTicketDeliveryInput({
        method: "Ship (FedEx)",
        address: "782 Tanglewood Rd",
        zip: "117",
      }),
    ).toMatch(/ZIP/i);
    expect(
      validateTicketDeliveryInput({
        method: "Hand Delivery",
        address: "782 Tanglewood Rd",
        zip: "11795",
      }),
    ).toBeNull();
  });
});

describe("ticketDeliveryPatch", () => {
  test("Pickup clears the scheduled flag and fee", () => {
    const patch = ticketDeliveryPatch({ method: "Pickup", fee: 35 });
    expect(patch.delivery_method).toBe("Pickup");
    expect(patch.delivery_scheduled).toBe(0);
    expect(patch.delivery_fee).toBe(0);
  });

  test("Hand Delivery keeps address + ZIP", () => {
    const patch = ticketDeliveryPatch({
      method: "Hand Delivery",
      address: "782 Tanglewood Rd",
      zip: "11795-1234",
      city: "West Islip",
      state: "NY",
      fee: 0,
    });
    expect(patch.delivery_method).toBe("Hand Delivery");
    expect(patch.delivery_scheduled).toBe(1);
    expect(patch.delivery_zip).toBe("11795");
    expect(patch.delivery_address).toBe("782 Tanglewood Rd");
  });
});

describe("scheduledAtFrom", () => {
  test("folds the time window onto the requested date", () => {
    expect(scheduledAtFrom("2026-08-20", "Morning (9–12)")).toBe("2026-08-20 09:00:00");
    expect(scheduledAtFrom("bad", "Anytime")).toBeNull();
  });
});

describe("queued delivery gates", () => {
  test("can update or cancel Queued, but not once it is on the road", () => {
    expect(canMutateQueuedDelivery("Queued")).toBe(true);
    expect(canCancelQueuedDelivery("Queued")).toBe(true);
    expect(canMutateQueuedDelivery("Out for Delivery")).toBe(false);
    expect(canCancelQueuedDelivery("Out for Delivery")).toBe(false);
    expect(canMutateQueuedDelivery("Delivered")).toBe(false);
  });
});

describe("ticket details route wiring", () => {
  test("PATCH /tickets/:name/delivery uses queued timeline event + FOH methods", () => {
    const src = readFileSync(join(import.meta.dir, "../routes/intake-alterations.ts"), "utf8");
    expect(src).toContain("/tickets/:name/delivery");
    expect(src).toContain("normalizeTicketDeliveryMethod");
    expect(src).toContain("lshMethodForTicket");
    expect(src).toContain("lshCarrierForTicket");
    expect(src).toContain("timelineEventType('Queued')");
  });
});
