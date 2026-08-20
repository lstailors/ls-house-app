/** Frozen app.lstailors.com API (pre-Aug 15) has no /api/health. /api/me still does. */
export function isLegacyApiMissingHealth(status: number): boolean {
  return status === 404;
}

export function isShopApiReachable(status: number): boolean {
  return status === 200 || status === 401 || status === 403;
}

export async function probeShopApi(raw: (path: string) => Promise<Response>): Promise<boolean> {
  const health = await raw("/api/health");
  if (health.ok) return true;
  if (!isLegacyApiMissingHealth(health.status)) return false;
  const me = await raw("/api/me");
  return isShopApiReachable(me.status);
}
