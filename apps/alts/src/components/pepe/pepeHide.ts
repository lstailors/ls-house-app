export function shouldHidePepeFab(pathname: string, search = ""): boolean {
  if (new URLSearchParams(search).get("kiosk") === "1") return true;
  if (/^\/login(\/|$)/i.test(pathname)) return true;
  if (/^\/(e-ticket|t|pay)\//i.test(pathname)) return true;
  if (/\/(tags|thermal|receipt|label)(\/|$)/i.test(pathname)) return true;
  return false;
}

/** Home has no ScanFab — sit on the floor. Nested pages sit above the camera FAB. */
export function isAltsHome(pathname: string): boolean {
  return pathname === "/" || pathname === "";
}
