import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const paymentPlan = readFileSync(new URL("./IntakePaymentPlan.tsx", import.meta.url), "utf8");
const confirm = readFileSync(new URL("./IntakeConfirm.tsx", import.meta.url), "utf8");

describe("intake payment plan contract", () => {
  test("Review supports later, full, and partial amounts", () => {
    expect(paymentPlan).toContain("Payment today");
    expect(paymentPlan).toContain("Pay later");
    expect(paymentPlan).toContain("Pay in full");
    expect(paymentPlan).toContain("Partial payment");
  });

  test("Review lists every supported tender", () => {
    for (const label of [
      "Counter Terminal",
      "Mobile Terminal",
      "Card on file",
      "Cash",
      "Check",
      "Square handheld",
      "Pay link / QR",
    ]) {
      expect(paymentPlan).toContain(label);
    }
  });

  test("confirmation uses the real payment controls", () => {
    expect(confirm).toContain("ChargeTerminalButton");
    expect(confirm).toContain("ChargeCardOnFileButton");
    expect(confirm).toContain("OutsideTenderButtons");
    expect(confirm).toContain("Pay link / QR");
  });
});
