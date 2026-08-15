import { describe, expect, test } from "bun:test";
import { formatCompactMoney, formatMoney } from "./money";

describe("formatMoney", () => {
  test("always shows cents", () => {
    expect(formatMoney(5685)).toBe("$5,685.00");
    expect(formatMoney(12.5)).toBe("$12.50");
    expect(formatMoney(0)).toBe("$0.00");
  });
  test("treats junk as zero", () => {
    expect(formatMoney(null)).toBe("$0.00");
    expect(formatMoney("nope")).toBe("$0.00");
  });
});

describe("formatCompactMoney", () => {
  test("thousands collapse", () => {
    expect(formatCompactMoney(5685)).toBe("$5.7k");
  });
});
