const KEY = "alts-show-test-data";

export function getShowTestData(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setShowTestData(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function showTestQuery(): string {
  return getShowTestData() ? "showTest=1" : "";
}

export function withShowTest(path: string): string {
  const flag = showTestQuery();
  if (!flag) return path;
  return path.includes("?") ? `${path}&${flag}` : `${path}?${flag}`;
}
