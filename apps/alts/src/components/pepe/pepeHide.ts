export function shouldHidePepeFab(pathname: string, search = ""): boolean {
  if (new URLSearchParams(search).get("kiosk") === "1") return true;
  if (/^\/login(\/|$)/i.test(pathname)) return true;
  if (/^\/(e-ticket|t|pay)\//i.test(pathname)) return true;
  if (/\/(tags|thermal|receipt|label)(\/|$)/i.test(pathname)) return true;
  return false;
}
