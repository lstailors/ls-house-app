// Shared session cookie for app.lstailors.com + alts.lstailors.com SSO.
// HttpOnly + Secure + SameSite=Lax on Domain=.lstailors.com (prod).

import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export const SESSION_COOKIE = "lst_session";

/** Access JWT lifetime — 8 hours (was 30 days in localStorage era). */
export const ACCESS_TTL_SEC = 60 * 60 * 8;

/** If remaining life is under this, mint a fresh token (sliding refresh). */
export const REFRESH_IF_REMAINING_SEC = 60 * 60 * 2;

function cookieDomain(): string | undefined {
  // Explicit override wins. On Vercel prod default to parent domain so alts+app share.
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN;
  if (process.env.VERCEL_ENV === "production" || process.env.COOKIE_SSO === "1") {
    return ".lstailors.com";
  }
  // localhost / preview: host-only cookie (no Domain attribute)
  return undefined;
}

function baseOpts(maxAge: number) {
  const domain = cookieDomain();
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production";
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    maxAge,
    ...(domain ? { domain } : {}),
  };
}

export function readSessionToken(c: Context): string | null {
  const fromCookie = getCookie(c, SESSION_COOKIE);
  if (fromCookie) return fromCookie;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

export function setSessionCookie(c: Context, token: string, maxAge = ACCESS_TTL_SEC): void {
  setCookie(c, SESSION_COOKIE, token, baseOpts(maxAge));
}

export function clearSessionCookie(c: Context): void {
  // maxAge 0 + matching domain/path so browsers drop it
  deleteCookie(c, SESSION_COOKIE, {
    path: "/",
    ...(cookieDomain() ? { domain: cookieDomain() } : {}),
  });
}
