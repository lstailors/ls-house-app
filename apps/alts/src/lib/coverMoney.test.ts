import { describe, expect, test } from "bun:test";
import { isMoneyFigure, redactMoney } from "./coverMoney";

describe("coverMoney", () => {
  test("redacts compact and exact dollar amounts", () => {
    expect(redactMoney("Paid $1.5k · Invoice 4412")).toBe("Paid •• · Invoice 4412");
    expect(redactMoney("59 · $113k")).toBe("59 · ••");
    expect(redactMoney("Open $1,234.00")).toBe("Open ••");
  });

  test("leaves status ages alone", () => {
    expect(redactMoney("72d OPEN")).toBe("72d OPEN");
    expect(redactMoney("Ready · C. CRISTIANO")).toBe("Ready · C. CRISTIANO");
    expect(isMoneyFigure("$1.5k")).toBe(true);
    expect(isMoneyFigure("72d")).toBe(false);
  });
});
