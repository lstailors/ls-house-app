/**
 * LIVE vs TEST operations mode.
 * LIVE: hide TEST-prefix operational records; SMS/email go to real clients.
 * TEST: show test records; outbound SMS/email only to the allowlist (else log/preview).
 */

export type OpsMode = "live" | "test";

const TEST_TITLE_RE = /^\s*TEST(\b|[-_:])/i;
const TEST_SMS_BODY_RE = /sent in error while we were testing/i;

export function opsMode(): OpsMode {
  const raw = String(process.env.OPS_MODE || process.env.LST_OPS_MODE || "")
    .trim()
    .toLowerCase();
  if (raw === "live" || raw === "prod" || raw === "production") return "live";
  if (raw === "test" || raw === "dev" || raw === "development") return "test";
  return process.env.NODE_ENV === "production" ? "live" : "test";
}

export function isLive(): boolean {
  return opsMode() === "live";
}

export function isTestTitle(value: string | null | undefined): boolean {
  return TEST_TITLE_RE.test(String(value ?? "").trim());
}

export function isTestSmsBody(value: string | null | undefined): boolean {
  return TEST_SMS_BODY_RE.test(String(value ?? ""));
}

export function isTestRecord(...labels: Array<string | null | undefined>): boolean {
  return labels.some((l) => isTestTitle(l));
}

/** Normalize to last 10 digits for US-centric allowlist match. */
export function phoneKey(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length > 10 ? d.slice(-10) : d;
}

export function smsAllowlist(): string[] {
  const extra = String(process.env.SMS_ALLOWLIST || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const owner = process.env.OWNER_MOBILE || "+16319260917";
  return [...new Set([owner, "+16319260917", ...extra].map(phoneKey).filter((p) => p.length >= 10))];
}

export function isSmsAllowlisted(to: string | null | undefined): boolean {
  const key = phoneKey(to);
  if (key.length < 10) return false;
  return smsAllowlist().includes(key);
}

export function canShowTestData(opts: { role?: string | null; showTest?: boolean }): boolean {
  if (!isLive()) return true;
  if (!opts.showTest) return false;
  return opts.role === "super_admin";
}

export function filterTestRows<T>(
  rows: T[],
  labels: (row: T) => Array<string | null | undefined>,
  opts: { role?: string | null; showTest?: boolean },
): T[] {
  if (canShowTestData(opts)) return rows;
  return rows.filter((r) => !isTestRecord(...labels(r)));
}
