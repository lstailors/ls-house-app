import { describe, expect, test } from "bun:test";
import { parseContextPhone, parseSofiaChatHistory } from "./sofia-chat";

describe("parseSofiaChatHistory", () => {
  test("returns empty for non-arrays", () => {
    expect(parseSofiaChatHistory(null)).toEqual([]);
    expect(parseSofiaChatHistory("nope")).toEqual([]);
  });

  test("maps staff/sofia aliases and keeps prior turns", () => {
    expect(
      parseSofiaChatHistory([
        { role: "staff", text: "who's on today?" },
        { role: "sofia", content: "Checking the book." },
        { role: "user", content: "  text Sal  " },
        { role: "system", content: "ignore" },
        { role: "assistant", content: "" },
      ]),
    ).toEqual([
      { role: "user", content: "who's on today?" },
      { role: "assistant", content: "Checking the book." },
      { role: "user", content: "text Sal" },
    ]);
  });

  test("keeps only the last N turns", () => {
    const raw = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const parsed = parseSofiaChatHistory(raw, 4);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]?.content).toBe("m21");
    expect(parsed[3]?.content).toBe("m24");
  });
});

describe("parseContextPhone", () => {
  test("accepts formatted US numbers", () => {
    expect(parseContextPhone("+1 (646) 555-1212")).toBe("+1 (646) 555-1212");
  });

  test("rejects short or empty values", () => {
    expect(parseContextPhone("")).toBeNull();
    expect(parseContextPhone("123")).toBeNull();
    expect(parseContextPhone(null)).toBeNull();
  });
});
