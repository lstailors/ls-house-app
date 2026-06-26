// First-party QR PNG endpoint.
// PUBLIC (no auth) — embedded by the ERPNext tag print template as an <img> src.

import { Hono } from "hono";
import QRCode from "qrcode";

export const qrRouter = new Hono();

// GET /api/qr?data=<string>&size=<number>
qrRouter.get("/", async (c) => {
  const data = c.req.query("data");
  if (!data) {
    return c.json({ error: { message: "Missing required query param: data" } }, 400);
  }

  const rawSize = Number(c.req.query("size"));
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(1024, Math.max(64, Math.round(rawSize))) : 140;

  const buf = await QRCode.toBuffer(data, { width: size, margin: 1 });
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  return c.body(body, 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});
