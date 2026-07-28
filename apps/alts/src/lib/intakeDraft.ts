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
 *  soItemKey, top-level notes) is fair game. Do NOT "fix" this by trying to
 *  persist photos — re-attach photos after a recovered draft instead.
 */

export const ALTS_INTAKE_DRAFT_KEY = "alts.intakeDraft.v1";

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

export type IntakeDraftPayload = {
  v: 1;
  savedAt: number;
  /** kind from URL when saved — walk_in | on_order | redo | null */
  kind: string | null;
  step: number;
  billing: "billable" | "on_order" | "redo";
  linkedSo: string | null;
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
  activeRef: string | null;
  notifyReady: boolean;
  ticketNote: string;
  ticketNoteKind: "internal" | "customer";
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

export function writeIntakeDraft(
  payload: Omit<IntakeDraftPayload, "v" | "savedAt" | "garments"> & {
    garments: Parameters<typeof stripGarmentsForDraft>[0];
  },
) {
  try {
    const full: IntakeDraftPayload = {
      ...payload,
      v: 1,
      savedAt: Date.now(),
      garments: stripGarmentsForDraft(payload.garments),
    };
    localStorage.setItem(ALTS_INTAKE_DRAFT_KEY, JSON.stringify(full));
  } catch {
    /* quota / private mode */
  }
}

export function readIntakeDraft(): IntakeDraftPayload | null {
  try {
    const raw = localStorage.getItem(ALTS_INTAKE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IntakeDraftPayload;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.garments)) return null;
    return parsed;
  } catch {
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

/** True if draft has anything worth restoring (customer or a garment) — see requirement #2. */
export function intakeDraftHasWork(d: IntakeDraftPayload | null | undefined): boolean {
  if (!d) return false;
  if (d.customer?.name) return true;
  if (d.garments?.length) return true;
  return false;
}
