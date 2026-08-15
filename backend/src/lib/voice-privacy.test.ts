import { describe, expect, test } from "bun:test";
import { isHouseVisibleVoice, canReadVoiceNote } from "./voice-privacy";

describe("voice privacy", () => {
  test("unmatched notes are private", () => {
    expect(isHouseVisibleVoice({ title: "legal meeting" } as any)).toBe(false);
  });
  test("linked client is house-visible", () => {
    expect(isHouseVisibleVoice({ customer: "CUST-1" })).toBe(true);
  });
  test("owner can read unmatched private notes; other staff cannot", () => {
    const row = { title: "legal meeting", owner: "carl@lstailors.com" };
    expect(canReadVoiceNote({ email: "carl@lstailors.com" }, row)).toBe(true);
    expect(canReadVoiceNote({ email: "kelvin@lstailors.com" }, row)).toBe(false);
    expect(isHouseVisibleVoice(row)).toBe(false);
  });
  test("explicit private wins", () => {
    expect(isHouseVisibleVoice({ customer: "CUST-1", visibility: "private" })).toBe(false);
  });
});
