import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("DeliveryBlock", () => {
  test("out-of-zone ZIP must not flip the method to FedEx", () => {
    const src = readFileSync(new URL("./DeliveryBlock.tsx", import.meta.url), "utf8");
    expect(src).toContain("Stay on Hand Delivery");
    expect(src).toContain('id: "Pickup"');
    expect(src).toContain('id: "Hand Delivery"');
    expect(src).toContain('id: "Ship (FedEx)"');
    expect(src).not.toMatch(/_status === "out_of_zone"[\s\S]{0,280}delivery_method:\s*"Ship \(FedEx\)"/);
  });
});

describe("ticket details page", () => {
  test("order details can change Pickup / Hand delivery / Ship without checkout", () => {
    const page = readFileSync(new URL("../../pages/intake/TicketDetail.tsx", import.meta.url), "utf8");
    expect(page).toContain("TicketDeliverySection");
    const section = readFileSync(new URL("./TicketDeliverySection.tsx", import.meta.url), "utf8");
    expect(section).toContain("/api/intake-alterations/tickets/");
    expect(section).toContain("/delivery");
    expect(section).toContain("Save how it leaves");
  });
});
