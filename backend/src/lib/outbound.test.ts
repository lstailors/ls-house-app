import { afterEach, describe, expect, test } from "bun:test";
import { dispatchSms } from "./outbound";

const prev = process.env.OPS_MODE;

afterEach(() => {
  if (prev == null) delete process.env.OPS_MODE;
  else process.env.OPS_MODE = prev;
});

describe("dispatchSms TEST gate", () => {
  test("holds a non-allowlisted number in TEST mode", async () => {
    process.env.OPS_MODE = "test";
    const result = await dispatchSms({
      to: "+12125551212",
      body: "Hi, this is a test ping",
      source: "outbound.test",
    });
    expect(result.held).toBe(true);
    expect(result.reason).toBe("test_mode_not_allowlisted");
    expect(String(result.sid || "").startsWith("held_")).toBe(true);
  });

  test("allowlisted numbers are not held for allowlist reasons", async () => {
    process.env.OPS_MODE = "test";
    const result = await dispatchSms({
      to: "+16319260917",
      body: "Internal ping",
      source: "outbound.test",
    });
    expect(result.reason).not.toBe("test_mode_not_allowlisted");
  });
});
