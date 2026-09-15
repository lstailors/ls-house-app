import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkoutEdgeHandler } from "../api/[...path]";

const previousPins = process.env.CHECKOUT_STAFF_PINS;

beforeAll(() => {
  process.env.CHECKOUT_STAFF_PINS = "3825:Carl,1212:Gianna";
});

afterAll(() => {
  if (previousPins === undefined) delete process.env.CHECKOUT_STAFF_PINS;
  else process.env.CHECKOUT_STAFF_PINS = previousPins;
});

describe("standalone checkout Edge API", () => {
  test("serves checkout health locally", async () => {
    const response = await checkoutEdgeHandler(
      new Request("http://checkout.test/api/checkout/health"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, app: "checkout" });
  });

  test("accepts Carl and Gianna checkout PINs", async () => {
    for (const [pin, staff] of [
      ["3825", "Carl"],
      ["1212", "Gianna"],
    ]) {
      const response = await checkoutEdgeHandler(
        new Request("http://checkout.test/api/checkout/pin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Checkout-Device": `test-${staff}`,
          },
          body: JSON.stringify({ pin }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.staff).toBe(staff);
      expect(response.headers.get("set-cookie")).toContain("ls_checkout_session=");
    }
  });
});
