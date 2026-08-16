// Shared session cookie for app.lstailors.com + alts.lstailors.com SSO.
// HttpOnly + Secure + SameSite=Lax on Domain=.lstailors.com (prod).

import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export const SESSION_COOKIE = "lst_session";
export const ERP_SID_COOKIE = "lst_erp_sid";

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

export function setErpSidCookie(c: Context, sid: string, maxAge = ACCESS_TTL_SEC): void {
  setCookie(c, ERP_SID_COOKIE, sid, baseOpts(maxAge));
}

export function readErpSid(c: Context): string | null {
  return getCookie(c, ERP_SID_COOKIE) || null;
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
  for (const name of [SESSION_COOKIE, ERP_SID_COOKIE]) {
    expireCookie(c, name, domain);
    // Also drop a host-only copy from older deploys that omitted Domain.
    if (domain) expireCookie(c, name);
  }
}
