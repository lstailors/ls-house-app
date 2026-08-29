import { describe, expect, test } from "bun:test";
import { parseScanToken } from "./domain";

describe("parseScanToken", () => {
  test("normalizes plain tags and extracts a token from a QR URL", () => {
    expect(parseScanToken("  ALT-NYC-2026-00412  ")).toBe("ALT-NYC-2026-00412");
    expect(parseScanToken("https://app.lstailors.com/floor/scan?token=GAR-00412-1")).toBe("GAR-00412-1");
  });

  test("rejects empty or implausibly long scan payloads", () => {
    expect(() => parseScanToken("   ")).toThrow("Scan was empty");
    expect(() => parseScanToken("x".repeat(257))).toThrow("Scan token is too long");
  });
});
