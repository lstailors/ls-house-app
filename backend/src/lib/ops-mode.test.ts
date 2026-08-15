import { afterEach, describe, expect, test } from "bun:test";
import { filterTestRows, isSmsAllowlisted, isTestRecord, isTestSmsBody, isTestTitle, phoneKey } from "./ops-mode";

const prev = process.env.OPS_MODE;
afterEach(() => {
  if (prev == null) delete process.env.OPS_MODE;
  else process.env.OPS_MODE = prev;
});

describe("TEST-prefix detection", () => {
  test("matches house-order convention", () => {
    expect(isTestTitle("TEST - Carl auto-notify")).toBe(true);
    expect(isTestTitle("TEST: fitting SMS")).toBe(true);
    expect(isTestTitle("TEST_order")).toBe(true);
    expect(isTestRecord("SO-1", "TEST - Carl auto-notify")).toBe(true);
  });
  test("does not match real surnames", () => {
    expect(isTestTitle("Testa")).toBe(false);
    expect(isTestTitle("Testoni")).toBe(false);
    expect(isTestTitle("Michael Passaro")).toBe(false);
  });
  test("apology SMS body", () => {
    expect(isTestSmsBody("These messages were sent in error while we were testing.")).toBe(true);
  });
});

describe("allowlist", () => {
  test("matches last 10 digits", () => {
    expect(phoneKey("+16319260917")).toBe("6319260917");
    expect(isSmsAllowlisted("+16319260917")).toBe(true);
  });
});

describe("filterTestRows", () => {
  test("LIVE hides TEST titles unless admin toggle", () => {
    process.env.OPS_MODE = "live";
    const rows = [{ name: "SO-1" }, { name: "TEST - Carl auto-notify" }];
    const hidden = filterTestRows(rows, (r) => [r.name], { role: "salesperson", showTest: false });
    expect(hidden.map((r) => r.name)).toEqual(["SO-1"]);
    const shown = filterTestRows(rows, (r) => [r.name], { role: "super_admin", showTest: true });
    expect(shown.map((r) => r.name)).toEqual(["SO-1", "TEST - Carl auto-notify"]);
  });
});
