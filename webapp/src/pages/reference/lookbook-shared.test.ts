import { describe, expect, test } from "bun:test";
import { formatLookbookUSD } from "./lookbook-shared";

describe("formatLookbookUSD", () => {
  test("keeps cents that house formatUSD would round away", () => {
    expect(formatLookbookUSD(192.3077)).toBe("$192.31");
    expect(formatLookbookUSD(56.4103)).toBe("$56.41");
    expect(formatLookbookUSD(90)).toBe("$90.00");
  });
});
