import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { signToken, verifyToken } from "../lib/jwt";
import { enrichFromErp } from "../lib/scope";
import {
  ACCESS_TTL_SEC,
  REFRESH_IF_REMAINING_SEC,
  clearSessionCookie,
  readErpSid,
  readSessionToken,
  setErpSidCookie,
  setSessionCookie,
} from "../lib/session-cookie";

export const authRouter = new Hono();

const ERP_BASE = () => process.env.ERPNEXT_BASE_URL ?? "";

/** Browser UA required — bare fetch against erp.lstailors.com hits Cloudflare 1010. */
const ERP_UA = "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)";

authRouter.post(
  "/login",
  zValidator("json", z.object({ email: z.string().email(), password: z.string().min(1) })),
  async (c) => {
    const body = (c.req as any).valid("json") as { email: string; password: string };
    // Normalize — Frappe User name is lowercase email; Carl@… still works via name resolve
    const email = String(body.email || "").trim().toLowerCase();
    const password = body.password;
    const base = ERP_BASE();
    if (!base) return c.json({ error: { message: "Auth service unavailable" } }, 503);

    // Validate credentials against ERPNext
    const loginRes = await fetch(`${base}/api/method/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": ERP_UA,
      },
      body: JSON.stringify({ usr: email, pwd: password }),
    }).catch(() => null);

    if (!loginRes || !loginRes.ok) {
      return c.json({ error: { message: "Invalid email or password" } }, 401);
    }

    const loginJson = (await loginRes.json().catch(() => ({}))) as any;
    // ERPNext returns { message: "Logged In" } on success
    if (loginJson?.message !== "Logged In") {
      return c.json({ error: { message: "Invalid email or password" } }, 401);
    }

    const sidHeader =
      typeof loginRes.headers.getSetCookie === "function"
        ? loginRes.headers.getSetCookie().join(",")
        : loginRes.headers.get("set-cookie") || "";
    const sidMatch = sidHeader.match(/(?:^|,|\s)sid=([^;]+)/i);
    if (sidMatch?.[1]) setErpSidCookie(c, sidMatch[1], ACCESS_TTL_SEC);

    // Fetch full name from ERPNext User record (using admin API key)
    const key = process.env.ERPNEXT_API_KEY ?? "";
    const secret = process.env.ERPNEXT_API_SECRET ?? "";
    let fullName = email;
    if (key && secret) {
      const userRes = await fetch(
        `${base}/api/resource/User/${encodeURIComponent(email)}?fields=["full_name"]`,
        {
          headers: {
            Authorization: `token ${key}:${secret}`,
            Accept: "application/json",
            "User-Agent": ERP_UA,
          },
        },
      ).catch(() => null);
      if (userRes?.ok) {
        const userJson = (await userRes.json().catch(() => ({}))) as any;
        fullName = userJson?.data?.full_name ?? email;
      }
    }

    // Fetch role + location to embed in JWT (avoids ERPNext round-trip on every request)
    const enrichment = await enrichFromErp(email);

    let token: string;
    try {
      token = await signToken(
        {
          sub: email,
          name: fullName,
          role: enrichment.role,
          locationCode: enrichment.locationCode ?? undefined,
        },
        ACCESS_TTL_SEC,
      );
    } catch (err: any) {
      console.error("JWT sign error:", err?.message);
      return c.json({ error: { message: "Auth configuration error — JWT_SECRET missing" } }, 500);
    }

    // Shared SSO cookie (.lstailors.com in prod) — primary session transport
    setSessionCookie(c, token, ACCESS_TTL_SEC);

    // token still returned for dual-write transition (Bearer / localStorage fallback)
    return c.json({ data: { token, user: { email, name: fullName } } });
  },
);

authRouter.post("/logout", async (c) => {
  const sid = readErpSid(c);
  const base = ERP_BASE();
  if (sid && base) {
    await fetch(`${base}/api/method/logout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: `sid=${sid}`,
        "User-Agent": ERP_UA,
      },
    }).catch(() => null);
  }
  clearSessionCookie(c);
  return c.json({ data: { ok: true } });
});

/** Sliding refresh: valid session → fresh 8h JWT + cookie. */
authRouter.post("/refresh", async (c) => {
  const existing = readSessionToken(c);
  if (!existing) return c.json({ error: { message: "Unauthorized" } }, 401);

  const payload = await verifyToken(existing);
  if (!payload) return c.json({ error: { message: "Unauthorized" } }, 401);

  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;

  // Always re-mint on explicit refresh so clients can extend session proactively
  let token: string;
  try {
    token = await signToken(
      {
        sub: payload.sub,
        name: payload.name,
        role: payload.role,
        locationCode: payload.locationCode,
      },
      ACCESS_TTL_SEC,
    );
  } catch (err: any) {
    console.error("JWT refresh sign error:", err?.message);
    return c.json({ error: { message: "Auth configuration error" } }, 500);
  }

  setSessionCookie(c, token, ACCESS_TTL_SEC);
  const sid = readErpSid(c);
  if (sid) setErpSidCookie(c, sid, ACCESS_TTL_SEC);
  return c.json({
    data: {
      token,
      refreshed: true,
      previousRemainingSec: remaining,
      expiresInSec: ACCESS_TTL_SEC,
    },
  });
});

/** Used by middleware-style callers that want auto-slide without a dedicated hop. */
export async function maybeSlideSession(c: import("hono").Context, token: string, payload: {
  sub: string;
  name: string;
  role?: string;
  locationCode?: string;
  exp: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp - now > REFRESH_IF_REMAINING_SEC) return token;
  try {
    const next = await signToken(
      {
        sub: payload.sub,
        name: payload.name,
        role: payload.role,
        locationCode: payload.locationCode,
      },
      ACCESS_TTL_SEC,
    );
    setSessionCookie(c, next, ACCESS_TTL_SEC);
    const sid = readErpSid(c);
    if (sid) setErpSidCookie(c, sid, ACCESS_TTL_SEC);
    return next;
  } catch {
    return token;
  }
}
