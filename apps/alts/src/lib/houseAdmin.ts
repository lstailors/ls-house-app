const APP_ORIGIN = "https://app.lstailors.com";

export function isAltsPublicHost(
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
): boolean {
  return hostname === "alts.lstailors.com" || hostname.endsWith(".alts.lstailors.com");
}

/** On alts.lstailors.com jump to the house app; on app. stay in-app. */
export function houseAdminHref(
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
): string {
  return isAltsPublicHost(hostname) ? `${APP_ORIGIN}/admin` : "/admin";
}

export function houseAdminIsExternal(
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
): boolean {
  return isAltsPublicHost(hostname);
}

/**
 * Reverse jump from alts.lstailors.com is super_admin only.
 * On app.lstailors.com, store managers can still open the in-app admin desk.
 */
export function canSeeHouseAdmin(
  role?: string | null,
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
): boolean {
  if (role === "super_admin") return true;
  if (role === "store_manager" && !isAltsPublicHost(hostname)) return true;
  return false;
}
