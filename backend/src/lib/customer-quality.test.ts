import { describe, expect, test } from "bun:test";
import { flagsForCustomer, isMarketingEmail, isWeirdName, safeDisplayName } from "./customer-quality";

describe("customer quality flags", () => {
  test("digit-only and dotted names", () => {
    expect(isWeirdName("36")).toBe(true);
    expect(isWeirdName("38")).toBe(true);
    expect(isWeirdName(". Marshall")).toBe(true);
    expect(isWeirdName(". Rosenkranz")).toBe(true);
    expect(isWeirdName("Michael Passaro")).toBe(false);
  });
  test("southwest marketing email", () => {
    expect(isMarketingEmail("rapidrewards@southwest.com")).toBe(true);
    expect(isMarketingEmail("carl@lstailors.com")).toBe(false);
  });
  test("missing both phone and email", () => {
    const flags = flagsForCustomer({ id: "x", name: "Jane Doe", email: null, phone: null });
    expect(flags).toContain("missing_contact");
  });
  test("display never shows a PAN", () => {
    const shown = safeDisplayName(`%B4111111111111111^DOE/JOHN^2512`);
    expect(shown.includes("411111")).toBe(false);
    expect(shown.toLowerCase()).toContain("review");
  });
});
