import { useSearchParams } from "react-router-dom";

export function kioskFromSearch(search: string) {
  return new URLSearchParams(search).get("kiosk") === "1";
}

/** Wall-tablet mode: `?kiosk=1` hides shell chrome, search, and the scan FAB. */
export function useKioskMode() {
  const [params] = useSearchParams();
  return params.get("kiosk") === "1";
}
