/** Walk-in / mid-intake draft — survives refresh, crash, and wifi drops.
 *  Mirrors the soCart.ts pattern (same write/read/clear shape, try/catch
 *  guarded storage access) but uses `localStorage` instead of
 *  `sessionStorage` since a draft needs to outlive a single tab session.
 *
 *  IMPORTANT: photoFiles / photoPreviewUrls (File objects + blob: URLs) are
 *  NEVER included in the persisted payload. File objects cannot survive
 *  JSON.stringify/localStorage — attempting to serialize them throws or
 *  silently drops data, and blob: URLs are invalidated on reload anyway.
 *  Everything else (customer, garment type/color/notes/lines/prices/
 *  soItemKey, sell items, top-level notes) is fair game. Do NOT "fix" this by trying to
 *  persist photos — re-attach photos after a recovered draft instead.
 */

import type { IntakePaymentMethod, IntakePaymentTiming } from "./intakePayment";

export const ALTS_INTAKE_DRAFT_KEY = "alts.intakeDraft.v1";
export const ALTS_INTAKE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type IntakeDraftCustomer = {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  addressLine?: string;
};

/** Mirrors Line from IntakeStepped.tsx, minus photoFiles/photoPreviewUrls. */
export type IntakeDraftLine = {
  id: string;
  description: string;
  price: number;
  estMinutes?: number | null;
  presetId?: string;
  notes?: string;
};

/** Mirrors Garment from IntakeStepped.tsx, minus photoFiles/photoPreviewUrls. */
export type IntakeDraftGarment = {
  ref: string;
  garmentType: string;
  color: string;
  notes: string;
  lines: IntakeDraftLine[];
  soItemKey?: string;
  soItemName?: string;
};

/** SPEC 057 — sell lines on Walk-in cart */
export type IntakeDraftSellItem = {
  ref: string;
  item_code: string;
  item_name: string;
  color: string;
  size: string;
  qty: number;
  rate: number;
  availability: "in" | "order" | "out";
  eta?: string;
  source?: "erp" | "seed" | "house";
  kind?: "mtm" | "rtw";
};

export type IntakeDraftPayload = {
  v: 1;
  savedAt: number;
  /** kind from URL when saved — walk_in | on_order | redo | null */
  kind: string | null;
  step: number;
  billing: "billable" | "on_order" | "redo";
  linkedSo: string | null;
  /** Store origin — NYC FOH or PB (Palm Beach) */
  origin?: "NYC" | "PB";
  promiseDate?: string | null;
  promiseTime?: string | null;
  isRush?: boolean;
  customer: IntakeDraftCustomer | null;
  q: string;
  newName: string;
  newPhone: string;
  newEmail: string;
  newLine1: string;
  newLine2: string;
  newCity: string;
  newState: string;
  newZip: string;
  showNewForm: boolean;
  garments: IntakeDraftGarment[];
  /** SPEC 057 */
  sellItems?: IntakeDraftSellItem[];
  catalogMode?: "alter" | "sell";
  activeRef: string | null;
  notifyReady: boolean;
  ticketNote: string;
  ticketNoteKind: "internal" | "customer";
  paymentTiming?: IntakePaymentTiming;
  paymentMethod?: IntakePaymentMethod;
  partialPaymentAmount?: string;
  expectedGarments: number;
  parkLabel: string;
  parkNote: string;
  parkedCartId: string | null;
  customDesc: string;
  customPrice: string;
};

/** Strip File/blob fields off garments+lines before persisting (see header note). */
function stripGarmentsForDraft(
  garments: Array<{
    ref: string;
    garmentType: string;
    color: string;
    notes: string;
    lines: Array<{
      id: string;
      description: string;
      price: number;
      estMinutes?: number | null;
      presetId?: string;
      notes?: string;
      photoFiles?: File[];
      photoPreviewUrls?: string[];
    }>;
    soItemKey?: string;
    soItemName?: string;
    photoFiles?: File[];
    photoPreviewUrls?: string[];
  }>,
): IntakeDraftGarment[] {
  return garments.map((g) => ({
    ref: g.ref,
    garmentType: g.garmentType,
    color: g.color || "",
    notes: g.notes || "",
    soItemKey: g.soItemKey,
    soItemName: g.soItemName,
    lines: (g.lines || []).map((l) => ({
      id: l.id,
      description: l.description,
      price: Number(l.price) || 0,
      estMinutes: l.estMinutes ?? null,
      presetId: l.presetId,
      notes: l.notes,
    })),
  }));
}

function stripSellItemsForDraft(
  sellItems: IntakeDraftSellItem[] | undefined | null,
): IntakeDraftSellItem[] {
  if (!Array.isArray(sellItems)) return [];
  return sellItems.map((s) => ({
    ref: s.ref,
    item_code: s.item_code,
    item_name: s.item_name,
    color: s.color || "",
    size: s.size || "",
    qty: Math.max(1, Number(s.qty) || 1),
    rate: Number(s.rate) || 0,
    availability: s.availability || "in",
    eta: s.eta,
    source: s.source,
    kind: s.kind,
  }));
}

export function writeIntakeDraft(
  payload: Omit<IntakeDraftPayload, "v" | "savedAt" | "garments" | "sellItems"> & {
    garments: Parameters<typeof stripGarmentsForDraft>[0];
    sellItems?: IntakeDraftSellItem[];
  },
) {
  try {
    const full: IntakeDraftPayload = {
      ...payload,
      v: 1,
      savedAt: Date.now(),
      garments: stripGarmentsForDraft(payload.garments),
      sellItems: stripSellItemsForDraft(payload.sellItems),
    };
    localStorage.setItem(ALTS_INTAKE_DRAFT_KEY, JSON.stringify(full));
  } catch {
    /* quota / private mode */
  }
}

/**
 * SPEC 053 collapsed Work into Garments.
 * Old map: 0 Customer · 1 Garments · 2 Work · 3 Review
 * New map: 0 Customer · 1 Cart (catalog+cart+drawer) · 2 Review
 * Map parked/old drafts so they don't land on a missing screen.
 */
export function migrateIntakeStep(step: number): number {
  const n = Number(step);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n >= 3) return 2; // old Review
  if (n === 2) return 1; // old Work → combined Garments/Cart
  return Math.min(2, Math.max(0, Math.floor(n)));
}

export function readIntakeDraft(): IntakeDraftPayload | null {
  try {
    const raw = localStorage.getItem(ALTS_INTAKE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IntakeDraftPayload;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.garments)) {
      clearIntakeDraft();
      return null;
    }
    const savedAt = Number(parsed.savedAt);
    if (
      !Number.isFinite(savedAt) ||
      savedAt <= 0 ||
      Date.now() - savedAt > ALTS_INTAKE_DRAFT_TTL_MS
    ) {
      clearIntakeDraft();
      return null;
    }
    parsed.step = migrateIntakeStep(parsed.step);
    if (!Array.isArray(parsed.sellItems)) parsed.sellItems = [];
    return parsed;
  } catch {
    // A corrupt/unreadable draft can still contain private client data.
    clearIntakeDraft();
    return null;
  }
}

export function clearIntakeDraft() {
  try {
    localStorage.removeItem(ALTS_INTAKE_DRAFT_KEY);
  } catch {
    /* */
  }
}

/** True if draft has anything worth restoring (customer, garment, or sell item). */
export function intakeDraftHasWork(d: IntakeDraftPayload | null | undefined): boolean {
  if (!d) return false;
  if (d.customer?.name) return true;
  if (d.garments?.length) return true;
  if (d.sellItems?.length) return true;
  return false;
}
