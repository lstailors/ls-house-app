// First-party QR PNG endpoint.
// PUBLIC (no auth) — embedded by the ERPNext tag print template as an <img> src.
// Edge-safe: no `qrcode` npm (pulls Node stream/fs). Proxy a pure PNG generator.

import { Hono } from "hono";

export const qrRouter = new Hono();

// GET /api/qr?data=<string>&size=<number>
qrRouter.get("/", async (c) => {
  const data = c.req.query("data");
  if (!data) {
    return c.json({ error: { message: "Missing required query param: data" } }, 400);
  }

  const rawSize = Number(c.req.query("size"));
  const size =
    Number.isFinite(rawSize) && rawSize > 0
      ? Math.min(1024, Math.max(64, Math.round(rawSize)))
      : 140;

  // goqr.me API — PNG bytes, no Node deps on our function
  const upstream = new URL("https://api.qrserver.com/v1/create-qr-code/");
  upstream.searchParams.set("size", `${size}x${size}`);
  upstream.searchParams.set("data", data);
  upstream.searchParams.set("margin", "1");

  const res = await fetch(upstream.toString());
  if (!res.ok) {
    return c.json({ error: { message: `QR upstream ${res.status}` } }, 502);
  }
  const body = await res.arrayBuffer();

  return c.body(body, 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});
