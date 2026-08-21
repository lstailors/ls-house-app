import { describe, expect, test } from "bun:test";
import { isAltsHome, shouldHidePepeFab } from "./pepeHide";

describe("shouldHidePepeFab", () => {
  test("hides on login and public surfaces", () => {
    expect(shouldHidePepeFab("/login")).toBe(true);
    expect(shouldHidePepeFab("/e-ticket/AT-1")).toBe(true);
    expect(shouldHidePepeFab("/pay/INV-1")).toBe(true);
    expect(shouldHidePepeFab("/d/token")).toBe(true);
    expect(shouldHidePepeFab("/home")).toBe(true);
    expect(shouldHidePepeFab("/profile")).toBe(true);
    expect(shouldHidePepeFab("/orders/alterations/AT-1/thermal")).toBe(true);
  });

  test("shows on Home, Intake, ticket detail, and another nested route", () => {
    expect(shouldHidePepeFab("/")).toBe(false);
    expect(shouldHidePepeFab("/intake/alterations")).toBe(false);
    expect(shouldHidePepeFab("/orders/alterations/AT-001")).toBe(false);
    expect(shouldHidePepeFab("/customers")).toBe(false);
  });
});

describe("isAltsHome", () => {
  test("home sits on the floor; nested pages do not", () => {
    expect(isAltsHome("/")).toBe(true);
    expect(isAltsHome("")).toBe(true);
    expect(isAltsHome("/intake")).toBe(false);
    expect(isAltsHome("/customers")).toBe(false);
  });
});
