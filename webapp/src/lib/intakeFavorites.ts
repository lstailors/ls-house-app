/** Per-device starred Quick actions on the intake options picker. */

export const INTAKE_FAVORITES_PREFIX = "alts-intake-favorites:v1:";
export const INTAKE_FAVORITES_MAX = 8;

export function normalizeGarmentType(raw: string): string {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();
  if (lower === "trousers" || lower === "pants" || lower === "trouser") return "Trouser";
  if (lower === "suit jacket" || lower === "sport coat" || lower === "blazer") return "Jacket";
  if (lower === "overcoat" || lower === "topcoat") return "Coat";
  if (lower === "blouse") return "Shirt";
  if (lower.startsWith("suit")) return "Jacket";
  return s;
}

export function intakeFavoritesKey(garmentType: string): string {
  return `${INTAKE_FAVORITES_PREFIX}${normalizeGarmentType(garmentType)}`;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** `null` means this device has never starred, unstarred, or reordered. */
export function readStoredFavoriteIds(garmentType: string): string[] | null {
  try {
    const raw = localStorage.getItem(intakeFavoritesKey(garmentType));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { ids?: unknown }).ids)
        ? (parsed as { ids: unknown[] }).ids
        : null;
    if (!ids) return null;
    return uniqueIds(ids.map(String)).slice(0, INTAKE_FAVORITES_MAX);
  } catch {
    return null;
  }
}

export function writeFavoriteIds(garmentType: string, ids: string[]): string[] {
  const next = uniqueIds(ids).slice(0, INTAKE_FAVORITES_MAX);
  try {
    localStorage.setItem(intakeFavoritesKey(garmentType), JSON.stringify({ ids: next }));
  } catch {
    /* private mode / quota — still return the in-memory list */
  }
  return next;
}

/** Stored stars win. Until the tailor stars anything, ERP quick_pick seeds the row. */
export function loadFavoriteIds(garmentType: string, seedIds: string[]): string[] {
  const stored = readStoredFavoriteIds(garmentType);
  return uniqueIds(stored ?? seedIds).slice(0, INTAKE_FAVORITES_MAX);
}

export function toggleFavoriteId(
  garmentType: string,
  id: string,
  seedIds: string[],
): { ids: string[]; added: boolean; atCap: boolean } {
  const current = loadFavoriteIds(garmentType, seedIds);
  const want = String(id || "").trim();
  if (!want) return { ids: current, added: false, atCap: false };

  if (current.includes(want)) {
    return { ids: writeFavoriteIds(garmentType, current.filter((x) => x !== want)), added: false, atCap: false };
  }
  if (current.length >= INTAKE_FAVORITES_MAX) {
    return { ids: current, added: false, atCap: true };
  }
  return { ids: writeFavoriteIds(garmentType, [...current, want]), added: true, atCap: false };
}

export function reorderFavoriteIds(
  garmentType: string,
  fromId: string,
  toId: string,
  seedIds: string[],
): string[] {
  const current = loadFavoriteIds(garmentType, seedIds);
  const fi = current.indexOf(fromId);
  const ti = current.indexOf(toId);
  if (fi < 0 || ti < 0 || fi === ti) return current;
  const next = [...current];
  next.splice(fi, 1);
  next.splice(ti, 0, fromId);
  return writeFavoriteIds(garmentType, next);
}
