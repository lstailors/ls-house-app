const KEY = "alts.cover-money.v1";

export function readCoverMoney(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCoverMoney(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/** Strip dollar amounts so a customer glancing at the tablet cannot read sales. */
export function redactMoney(text: string): string {
  return text
    .replace(/\$[\d,.]+k?\b/gi, "••")
    .replace(/\b[\d,]+(?:\.\d{2})\b/g, "••");
}

export function isMoneyFigure(text: string): boolean {
  return /\$/.test(text);
}
