/**
 * Pickup multi-select bag — survives camera scanner round-trips.
 * Keys: `t:ALT-…` | `i:SINV-…`
 */
export const PICKUP_BAG_STORAGE_KEY = "alts-pickup-bag-v1";

export function ticketBagKey(name: string) {
  return `t:${name}`;
}

export function invoiceBagKey(id: string) {
  return `i:${id}`;
}

export function readPickupBagKeys(): string[] {
  try {
    const raw = sessionStorage.getItem(PICKUP_BAG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string" && k.length > 2);
  } catch {
    return [];
  }
}

export function writePickupBagKeys(keys: string[]) {
  try {
    const uniq = Array.from(new Set(keys));
    sessionStorage.setItem(PICKUP_BAG_STORAGE_KEY, JSON.stringify(uniq));
  } catch {
    /* ignore quota / private mode */
  }
}

export function addPickupBagKey(key: string): { keys: string[]; added: boolean } {
  const prev = readPickupBagKeys();
  if (prev.includes(key)) return { keys: prev, added: false };
  const keys = [...prev, key];
  writePickupBagKeys(keys);
  return { keys, added: true };
}

export function clearPickupBag() {
  try {
    sessionStorage.removeItem(PICKUP_BAG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Restore the bag only after a scanner round-trip or an explicit add. */
export function shouldRestorePickupBag(params: URLSearchParams): boolean {
  return (
    params.get("scanned") === "1" ||
    !!params.get("addTicket") ||
    !!params.get("addInvoice") ||
    !!params.get("ticket") ||
    !!params.get("invoice")
  );
}
