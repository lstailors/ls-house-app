import { describe, expect, test } from "bun:test";
import { localFirstList } from "./localFirst";

describe("localFirstList", () => {
  test("returns the network payload when the fetcher succeeds", async () => {
    const rows = await localFirstList("tickets", async () => [{ name: "ALT-1" }]);
    expect(rows[0]?.name).toBe("ALT-1");
  });
});
