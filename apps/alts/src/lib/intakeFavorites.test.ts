import { afterEach, expect, test } from "bun:test";
import {
  INTAKE_FAVORITES_MAX,
  intakeFavoritesKey,
  loadFavoriteIds,
  normalizeGarmentType,
  readStoredFavoriteIds,
  reorderFavoriteIds,
  toggleFavoriteId,
  writeFavoriteIds,
} from "./intakeFavorites";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const seed = ["hem-shorten", "waist-in", "seat-out"];

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom-less */
  }
});

function withStorage() {
  const local = new MemoryStorage();
  Object.assign(globalThis, { localStorage: local });
  return local;
}

test("trousers and pants share one Trouser favorites list", () => {
  expect(normalizeGarmentType("pants")).toBe("Trouser");
  expect(intakeFavoritesKey("trousers")).toBe(intakeFavoritesKey("Trouser"));
});

test("unset storage uses ERP quick_pick seeds and does not write", () => {
  const local = withStorage();
  expect(readStoredFavoriteIds("Trouser")).toBeNull();
  expect(loadFavoriteIds("Trouser", seed)).toEqual(seed);
  expect(local.getItem(intakeFavoritesKey("Trouser"))).toBeNull();
});

test("first star persists seeds plus the new id", () => {
  withStorage();
  const result = toggleFavoriteId("Trouser", "cuff-original", seed);
  expect(result.added).toBe(true);
  expect(result.ids).toEqual([...seed, "cuff-original"]);
  expect(readStoredFavoriteIds("Trouser")).toEqual([...seed, "cuff-original"]);
});

test("unstar drops an ERP seed and writes the rest", () => {
  withStorage();
  const result = toggleFavoriteId("Trouser", "waist-in", seed);
  expect(result.added).toBe(false);
  expect(result.ids).toEqual(["hem-shorten", "seat-out"]);
});

test("cap of 8 refuses a ninth star", () => {
  withStorage();
  const eight = Array.from({ length: INTAKE_FAVORITES_MAX }, (_, i) => `work-${i}`);
  writeFavoriteIds("Trouser", eight);
  const result = toggleFavoriteId("Trouser", "work-extra", eight);
  expect(result.added).toBe(false);
  expect(result.atCap).toBe(true);
  expect(result.ids).toEqual(eight);
});

test("reorder writes the new order for that garment only", () => {
  const local = withStorage();
  writeFavoriteIds("Jacket", ["sleeve-shorten"]);
  const next = reorderFavoriteIds("Trouser", "seat-out", "hem-shorten", seed);
  expect(next).toEqual(["seat-out", "hem-shorten", "waist-in"]);
  expect(readStoredFavoriteIds("Jacket")).toEqual(["sleeve-shorten"]);
  expect(local.getItem(intakeFavoritesKey("Trouser"))).toContain("seat-out");
});
