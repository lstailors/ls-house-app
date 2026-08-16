import { describe, expect, test } from "bun:test";
import { isMissingErpPrintModule, THERMAL_PRINT_METHODS } from "./thermal-print";

describe("thermal print method wiring", () => {
  test("prefers ls_alterations.api — the module ERP already loads for tickets", () => {
    expect(THERMAL_PRINT_METHODS.print_ticket[0]).toBe("ls_alterations.api.print_ticket");
    expect(THERMAL_PRINT_METHODS.print_ticket).toContain("ls_alterations.ls_thermal.api.print_ticket");
  });

  test("detects the Frappe missing-module error from print", () => {
    expect(
      isMissingErpPrintModule(
        new Error(
          `Failed to get method for command ls_alterations.ls_thermal.api.print_ticket with No module named 'ls_alterations.ls_thermal'`,
        ),
      ),
    ).toBe(true);
    expect(isMissingErpPrintModule(new Error("No printer IP / bridge configured"))).toBe(false);
  });
});

describe("frappe app wiring", () => {
  test("ls_thermal is a real package and print wrappers live on ls_alterations.api", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dir, "../../../frappe/ls_alterations/ls_alterations");
    const init = readFileSync(join(root, "ls_thermal/__init__.py"), "utf8").trim();
    expect(init.length).toBeGreaterThan(0);
    const api = readFileSync(join(root, "api.py"), "utf8");
    expect(api).toContain("def print_ticket(");
    expect(api).toContain("def _thermal_api(");
    expect(api).toContain("ls_alterations.ls_thermal.api");
  });
});
