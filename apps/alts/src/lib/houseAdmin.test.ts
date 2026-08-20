import { describe, expect, test } from "bun:test";
import {
  canSeeHouseAdmin,
  houseAdminHref,
  houseAdminIsExternal,
  isAltsPublicHost,
} from "./houseAdmin";

describe("house admin reverse link", () => {
  test("alts.lstailors.com is the floor host", () => {
    expect(isAltsPublicHost("alts.lstailors.com")).toBe(true);
    expect(isAltsPublicHost("preview.alts.lstailors.com")).toBe(true);
    expect(isAltsPublicHost("app.lstailors.com")).toBe(false);
    expect(isAltsPublicHost("localhost")).toBe(false);
  });

  test("alts host sends super admin to app.lstailors.com/admin", () => {
    expect(houseAdminHref("alts.lstailors.com")).toBe("https://app.lstailors.com/admin");
    expect(houseAdminIsExternal("alts.lstailors.com")).toBe(true);
  });

  test("app host stays in-app", () => {
    expect(houseAdminHref("app.lstailors.com")).toBe("/admin");
    expect(houseAdminIsExternal("app.lstailors.com")).toBe(false);
  });

  test("only super admin sees Admin on alts", () => {
    expect(canSeeHouseAdmin("super_admin", "alts.lstailors.com")).toBe(true);
    expect(canSeeHouseAdmin("store_manager", "alts.lstailors.com")).toBe(false);
    expect(canSeeHouseAdmin("salesperson", "alts.lstailors.com")).toBe(false);
  });

  test("managers can still open in-app admin on app", () => {
    expect(canSeeHouseAdmin("store_manager", "app.lstailors.com")).toBe(true);
    expect(canSeeHouseAdmin("super_admin", "app.lstailors.com")).toBe(true);
    expect(canSeeHouseAdmin("salesperson", "app.lstailors.com")).toBe(false);
  });
});
