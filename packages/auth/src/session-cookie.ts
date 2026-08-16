// Shared session cookie helpers (server-side, Hono).
// HttpOnly + Secure + SameSite=Lax on Domain=.lstailors.com (prod).
// Backend keeps a copy at backend/src/lib/session-cookie.ts for Edge bundle isolation;
// keep both in sync (HER-15).

import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export const SESSION_COOKIE = "lst_session";

/** Access JWT lifetime — 8 hours (was 30 days in localStorage era). */
export const ACCESS_TTL_SEC = 60 * 60 * 8;

/** If remaining life is under this, mint a fresh token (sliding refresh). */
export const REFRESH_IF_REMAINING_SEC = 60 * 60 * 2;

function cookieDomain(): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN;
  if (process.env.VERCEL_ENV === "production" || process.env.COOKIE_SSO === "1") {
    return ".lstailors.com";
  }
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

function expireCookie(c: Context, name: string, domain?: string): void {
  const secure =
    process.env.COOKIE_SECURE === "1" ||
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production";
  const opts = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    maxAge: 0,
    ...(domain ? { domain } : {}),
  };
  // Empty + maxAge 0 with the same flags the cookie was set with.
  setCookie(c, name, "", opts);
  deleteCookie(c, name, opts);
}

export function clearSessionCookie(c: Context): void {
  const domain = cookieDomain();
  expireCookie(c, SESSION_COOKIE, domain);
  // Also drop a host-only copy from older deploys that omitted Domain.
  if (domain) expireCookie(c, SESSION_COOKIE);
}
