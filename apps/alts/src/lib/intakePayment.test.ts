import { describe, expect, test } from "bun:test";
import { preferredTenderAmount, resolveIntakePaymentAmount } from "./intakePayment";

describe("resolveIntakePaymentAmount", () => {
  test("pay later schedules no charge", () => {
    expect(resolveIntakePaymentAmount("later", "999", 1000)).toEqual({ amount: 0, error: null });
  });

  test("full uses the ticket total rounded to cents", () => {
    expect(resolveIntakePaymentAmount("full", "", 1000.009)).toEqual({ amount: 1000.01, error: null });
  });

  test("partial accepts a positive amount below the ticket total", () => {
    expect(resolveIntakePaymentAmount("partial", "250", 1000)).toEqual({ amount: 250, error: null });
  });

  test("partial rejects zero, junk, and overpayment", () => {
    expect(resolveIntakePaymentAmount("partial", "0", 1000).error).toBe("Enter a partial payment above $0.00");
    expect(resolveIntakePaymentAmount("partial", "abc", 1000).error).toBe("Enter a valid partial payment amount");
    expect(resolveIntakePaymentAmount("partial", "1000.01", 1000).error).toBe("Partial payment cannot exceed $1,000.00");
  });
});

describe("preferredTenderAmount", () => {
  test("keeps a requested partial amount below live outstanding", () => {
    expect(preferredTenderAmount(250, 1000)).toBe(250);
  });

  test("clamps stale or overpayment requests to live outstanding", () => {
    expect(preferredTenderAmount(1250, 1000)).toBe(1000);
    expect(preferredTenderAmount(0, 1000)).toBe(1000);
  });
});
