import { describe, expect, test } from "bun:test";
import {
  assertNoPanInCustomerFields,
  containsPan,
  findPanHits,
  luhnOk,
  maskPan,
  nameFromTrack1,
  PciFieldRejected,
  stripPan,
  suggestedNameFromRecord,
} from "./pci-guard";

/** Published Visa test PAN — never a live card. */
const TEST_PAN = "4111111111111111";
const TRACK = `%B${TEST_PAN}^PASSARO III/MICHAEL F^2512101`;

describe("luhnOk", () => {
  test("accepts the Visa test PAN", () => {
    expect(luhnOk(TEST_PAN)).toBe(true);
  });
  test("rejects a transposed digit", () => {
    expect(luhnOk("4111111111111112")).toBe(false);
  });
  test("rejects 10-digit phone numbers", () => {
    expect(luhnOk("2123084431")).toBe(false);
  });
});

describe("track / PAN detection", () => {
  test("finds Track 1", () => {
    const hits = findPanHits(TRACK);
    expect(hits.some((h) => h.kind === "track1")).toBe(true);
    expect(hits[0]?.last4).toBe("1111");
  });
  test("finds a bare Luhn PAN", () => {
    expect(containsPan(`client ${TEST_PAN} walk-in`)).toBe(true);
  });
  test("ignores names and short numbers", () => {
    expect(containsPan("Michael Passaro")).toBe(false);
    expect(containsPan("36")).toBe(false);
    expect(containsPan(". Marshall")).toBe(false);
  });
  test("mask never includes the full PAN", () => {
    expect(maskPan(TEST_PAN)).toBe("••••1111");
    expect(maskPan(TEST_PAN).includes("411111")).toBe(false);
  });
});

describe("nameFromTrack1", () => {
  test("PASSARO III/MICHAEL F → Michael F Passaro III", () => {
    expect(nameFromTrack1(TRACK)).toBe("Michael F Passaro III");
  });
});

describe("stripPan / suggested name", () => {
  test("strips track payload", () => {
    expect(containsPan(stripPan(TRACK))).toBe(false);
  });
  test("suggested name prefers track parse", () => {
    expect(suggestedNameFromRecord({ customer_name: TRACK })).toBe("Michael F Passaro III");
  });
});

describe("assertNoPanInCustomerFields", () => {
  test("rejects a name that is track data", () => {
    expect(() => assertNoPanInCustomerFields({ full_name: TRACK })).toThrow(PciFieldRejected);
  });
  test("allows a normal name", () => {
    expect(() => assertNoPanInCustomerFields({ full_name: "Michael Passaro" })).not.toThrow();
  });
});
