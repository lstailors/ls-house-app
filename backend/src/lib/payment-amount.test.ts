import { describe, expect, test } from "bun:test";
import { selectPaymentAmount } from "./payment-amount";

describe("selectPaymentAmount", () => {
  test("defaults to the live outstanding balance", () => {
    expect(selectPaymentAmount(undefined, 1000.009)).toBe(1000.01);
  });

  test("accepts a cent-safe partial amount", () => {
    expect(selectPaymentAmount(250.005, 1000)).toBe(250.01);
  });

  test("rejects invalid and overpayment amounts", () => {
    expect(() => selectPaymentAmount(0, 1000)).toThrow("amount must be positive");
    expect(() => selectPaymentAmount(Number.NaN, 1000)).toThrow("amount must be a finite number");
    expect(() => selectPaymentAmount(1000.01, 1000)).toThrow("exceeds outstanding");
  });

  test("rejects payment when no balance remains", () => {
    expect(() => selectPaymentAmount(undefined, 0)).toThrow("nothing outstanding");
  });
});
