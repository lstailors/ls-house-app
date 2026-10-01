import { describe, expect, test } from "bun:test";
import { unifiRouter } from "./unifi";

describe("UniFi sync cron", () => {
  test("GET /sync exists and rejects anonymous callers", async () => {
    const res = await unifiRouter.request("http://example.test/sync", { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("POST /sync still rejects anonymous callers", async () => {
    const res = await unifiRouter.request("http://example.test/sync", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("a Bearer token is 401 when CRON_SECRET is unset, not 503", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await unifiRouter.request("http://example.test/sync", {
        method: "GET",
        headers: { Authorization: "Bearer not-the-cron-secret" },
      });
      expect(res.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
