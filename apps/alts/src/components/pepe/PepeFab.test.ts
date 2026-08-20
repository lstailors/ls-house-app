import { describe, expect, test } from "bun:test";
import { shouldHidePepeFab } from "./pepeHide";

describe("shouldHidePepeFab", () => {
  test("hides on login and public surfaces", () => {
    expect(shouldHidePepeFab("/login")).toBe(true);
    expect(shouldHidePepeFab("/e-ticket/AT-1")).toBe(true);
    expect(shouldHidePepeFab("/pay/INV-1")).toBe(true);
    expect(shouldHidePepeFab("/orders/alterations/AT-1/thermal")).toBe(true);
  });

  test("shows on Home, Intake, ticket detail, and another nested route", () => {
    expect(shouldHidePepeFab("/")).toBe(false);
    expect(shouldHidePepeFab("/intake/alterations")).toBe(false);
    expect(shouldHidePepeFab("/orders/alterations/AT-001")).toBe(false);
    expect(shouldHidePepeFab("/customers")).toBe(false);
  });
});
