import { describe, expect, test } from "bun:test";
import { isLegacyApiMissingHealth, isShopApiReachable, probeShopApi } from "./probe";

describe("shop API probe", () => {
  test("legacy /api/health 404 plus /api/me 401 is online", async () => {
    const raw = async (path: string) =>
      new Response(path === "/api/health" ? "404 Not Found" : JSON.stringify({ error: "Unauthorized" }), {
        status: path === "/api/health" ? 404 : 401,
        headers: { "Content-Type": path === "/api/health" ? "text/plain" : "application/json" },
      });
    expect(isLegacyApiMissingHealth(404)).toBe(true);
    expect(isShopApiReachable(401)).toBe(true);
    expect(await probeShopApi(raw)).toBe(true);
  });

  test("health 200 is online", async () => {
    const raw = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    expect(await probeShopApi(raw)).toBe(true);
  });

  test("health 500 is offline", async () => {
    const raw = async () => new Response("nope", { status: 500 });
    expect(await probeShopApi(raw)).toBe(false);
  });
});
