import { describe, expect, test } from "bun:test";
import {
  humanizeSquareTerminalError,
  isMissingLsSquareModule,
} from "./square-checkout";

describe("isMissingLsSquareModule", () => {
  test("detects the live May bench error", () => {
    expect(
      isMissingLsSquareModule(
        new Error(
          "Failed to get method for command ls_alterations.ls_square.pos.create_checkout with No module named 'ls_alterations.ls_square'",
        ),
      ),
    ).toBe(true);
  });

  test("detects missing create_checkout attribute", () => {
    expect(
      isMissingLsSquareModule(
        new Error("module 'ls_alterations.ls_square.pos' has no attribute 'create_checkout'"),
      ),
    ).toBe(true);
  });

  test("does not swallow real Square / invoice errors", () => {
    expect(isMissingLsSquareModule(new Error("Invoice LSTNY-SINV-2026-01439 is cancelled"))).toBe(
      false,
    );
    expect(isMissingLsSquareModule(new Error("DEVICE_BUSY"))).toBe(false);
  });
});

describe("humanizeSquareTerminalError", () => {
  test("pairs device-not-found to a floor instruction", () => {
    expect(humanizeSquareTerminalError(new Error("DEVICE_NOT_FOUND"))).toMatch(/not paired/i);
  });

  test("pairs device-busy to cancel-and-retry", () => {
    expect(humanizeSquareTerminalError(new Error("DEVICE_BUSY"))).toMatch(/busy/i);
  });

  test("passes through unknown Square detail", () => {
    expect(humanizeSquareTerminalError(new Error("CARD_DECLINED"))).toBe("CARD_DECLINED");
  });
});
