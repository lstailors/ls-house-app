/**
 * Fail-closed shared-secret helpers (HER-61 / HER-22 D8 pattern).
 * Never treat a missing env secret as "auth disabled".
 */
import type { Context } from "hono";

/** True only when expected is non-empty and matches provided (constant-time-ish). */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = (provided ?? "").trim();
  const b = (expected ?? "").trim();
  if (!b || !a) return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set
 * on the project. Also accept `x-cron-secret` for manual/ops callers.
 * Fail closed if CRON_SECRET env is unset or mismatch.
 */
export function requireCronSecret(c: Context): true | Response {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    return c.json(
      { error: { message: "CRON_SECRET not configured", code: "CRON_SECRET_UNSET" } },
      503,
    );
  }
  const auth = c.req.header("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const header = c.req.header("x-cron-secret") ?? "";
  if (secretsMatch(bearer, expected) || secretsMatch(header, expected)) return true;
  return c.json({ error: { message: "Unauthorized" } }, 401);
}

/** Fail-closed header secret check. Returns true or a Response. */
export function requireHeaderSecret(
  c: Context,
  opts: {
    envName: string;
    headerNames: string[];
    /** Also accept ?query= */
    queryNames?: string[];
  },
): true | Response {
  const expected = (process.env[opts.envName] ?? "").trim();
  if (!expected) {
    return c.json(
      {
        error: { message: `${opts.envName} not configured`, code: "SECRET_UNSET" },
      },
      503,
    );
  }
  let provided = "";
  for (const h of opts.headerNames) {
    const v = c.req.header(h);
    if (v) {
      provided = v;
      break;
    }
  }
  if (!provided && opts.queryNames) {
    for (const q of opts.queryNames) {
      const v = c.req.query(q);
      if (v) {
        provided = v;
        break;
      }
    }
  }
  if (!secretsMatch(provided, expected)) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }
  return true;
}
