import { describe, expect, test } from "bun:test";
import { agingBucket, invoiceAgeDays } from "./invoiceAging";

describe("invoiceAging", () => {
  test("buckets", () => {
    expect(agingBucket(0)).toBe("0-30");
    expect(agingBucket(30)).toBe("0-30");
    expect(agingBucket(31)).toBe("31-60");
    expect(agingBucket(61)).toBe("61-90");
    expect(agingBucket(90)).toBe("61-90");
    expect(agingBucket(91)).toBe("90+");
    expect(agingBucket(null)).toBeNull();
  });

  test("age from posting date", () => {
    expect(invoiceAgeDays("2000-01-01")).toBeGreaterThan(90);
    expect(invoiceAgeDays(null, null)).toBeNull();
  });
});
