const KEY = "lsh_docuseal_api_key";

export function rememberDocusealKey(key: string) {
  const v = key.trim();
  if (!v) return;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode */
  }
}

export function recalledDocusealKey(): string {
  try {
    return (localStorage.getItem(KEY) || "").trim();
  } catch {
    return "";
  }
}

export function forgetDocusealKey() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
