import { expect, test } from "bun:test";
import { ALTS_INTAKE_DRAFT_KEY, readIntakeDraft } from "./intakeDraft";
import { ALTS_SO_CART_KEY } from "./soCart";
import { clearAltsPrivateStorage } from "./logoutPrivacy";

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

test("logout removes private Alts state without deleting device preferences", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });

  local.setItem(ALTS_INTAKE_DRAFT_KEY, JSON.stringify({ customer: { name: "Prior Client" } }));
  local.setItem("notify-ready-ALT-NYC-2026-00042", "true");
  local.setItem("lst_token", "private-bearer-token");
  session.setItem(ALTS_SO_CART_KEY, JSON.stringify({ customerName: "Prior Client" }));
  local.setItem("alts.espresso.open", "1");
  local.setItem("lsh.activeLocationId", "NYC");
  local.setItem("alts-intake-favorites:v1:Trouser", JSON.stringify({ ids: ["hem-shorten"] }));

  clearAltsPrivateStorage();

  expect(local.getItem(ALTS_INTAKE_DRAFT_KEY)).toBeNull();
  expect(session.getItem(ALTS_SO_CART_KEY)).toBeNull();
  expect(local.getItem("notify-ready-ALT-NYC-2026-00042")).toBeNull();
  expect(local.getItem("lst_token")).toBeNull();
  expect(local.getItem("alts.espresso.open")).toBe("1");
  expect(local.getItem("lsh.activeLocationId")).toBe("NYC");
  expect(local.getItem("alts-intake-favorites:v1:Trouser")).toBe(
    JSON.stringify({ ids: ["hem-shorten"] }),
  );
});

test("intake drafts expire after one day", () => {
  const local = new MemoryStorage();
  Object.assign(globalThis, { localStorage: local });
  local.setItem(
    ALTS_INTAKE_DRAFT_KEY,
    JSON.stringify({
      v: 1,
      savedAt: Date.now() - 25 * 60 * 60 * 1000,
      step: 1,
      garments: [],
      customer: { name: "Prior Client" },
    }),
  );

  expect(readIntakeDraft()).toBeNull();
  expect(local.getItem(ALTS_INTAKE_DRAFT_KEY)).toBeNull();
});

test("unreadable intake drafts are deleted instead of persisting private data", () => {
  const local = new MemoryStorage();
  Object.assign(globalThis, { localStorage: local });
  local.setItem(ALTS_INTAKE_DRAFT_KEY, '{"customer":{"name":"Prior Client"}');

  expect(readIntakeDraft()).toBeNull();
  expect(local.getItem(ALTS_INTAKE_DRAFT_KEY)).toBeNull();
});
