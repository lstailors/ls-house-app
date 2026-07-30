/** Custom-order cart: SO lines → selectable garment pieces for alteration intake */

export type SoPiece = {
  id: string;
  /** Originating sales order (multi-SO carts) */
  soId?: string;
  soItemId: string;
  garmentType: string;
  label: string;
  sourceItem: string;
  description?: string;
  selected: boolean;
};

export type SoCartPayload = {
  /** Primary SO (first selected) — written to ticket.linked_sales_order */
  so: string;
  /** All selected SOs when multi-order cart */
  sos?: string[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  pieces: SoPiece[];
};

export const ALTS_SO_CART_KEY = "alts.soCart.v1";

type ApiSoItem = {
  id?: string;
  key?: string;
  item_code?: string;
  item_name?: string;
  description?: string;
  qty?: number;
  pieces?: Array<{ garmentType: string; label: string; sourceItem: string }>;
};

export function piecesFromSoDetail(items: ApiSoItem[], soId?: string): SoPiece[] {
  const out: SoPiece[] = [];
  let n = 0;
  const soPrefix = soId ? `${soId}::` : "";
  for (const it of items || []) {
    const soItemId = it.id || it.key || `item-${n}`;
    const pieces =
      it.pieces && it.pieces.length
        ? it.pieces
        : [{ garmentType: "Other", label: it.item_name || it.item_code || "Item", sourceItem: it.item_name || "" }];
    const qty = Math.max(1, Math.round(Number(it.qty) || 1));
    for (let q = 0; q < qty; q++) {
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p]!;
        n += 1;
        out.push({
          id: `${soPrefix}${soItemId}::${q}::${p}::${n}`,
          soId,
          soItemId,
          garmentType: piece.garmentType || "Other",
          label: qty > 1 ? `${piece.label} (${q + 1})` : piece.label,
          sourceItem: piece.sourceItem || it.item_name || "",
          description: it.description || "",
          selected: true,
        });
      }
    }
  }
  return out;
}

/** Merge pieces from several SOs; later SO wins on same id (shouldn't collide with so-prefix). */
export function mergeSoPieces(...lists: SoPiece[][]): SoPiece[] {
  const byId = new Map<string, SoPiece>();
  for (const list of lists) {
    for (const p of list) byId.set(p.id, p);
  }
  return Array.from(byId.values());
}

export function writeSoCart(payload: SoCartPayload) {
  try {
    const sos =
      payload.sos && payload.sos.length
        ? payload.sos
        : payload.so
          ? [payload.so]
          : [];
    sessionStorage.setItem(
      ALTS_SO_CART_KEY,
      JSON.stringify({
        ...payload,
        so: payload.so || sos[0] || "",
        sos,
      }),
    );
  } catch {
    /* */
  }
}

export function readSoCart(): SoCartPayload | null {
  try {
    const raw = sessionStorage.getItem(ALTS_SO_CART_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SoCartPayload;
  } catch {
    return null;
  }
}

export function clearSoCart() {
  try {
    sessionStorage.removeItem(ALTS_SO_CART_KEY);
  } catch {
    /* */
  }
}

export function soCartToGarments(cart: SoCartPayload) {
  return cart.pieces
    .filter((p) => p.selected)
    .map((p, i) => ({
      ref: `G${i + 1}`,
      garmentType: p.garmentType || "Other",
      color: "",
      notes: [p.soId && cart.sos && cart.sos.length > 1 ? p.soId : null, p.label, p.description]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 280),
      lines: [] as Array<{
        id: string;
        description: string;
        price: number;
        estMinutes?: number | null;
        presetId?: string;
        notes?: string;
      }>,
      soItemKey: p.soItemId,
      soItemName: p.sourceItem || p.label,
      linkedSo: p.soId || cart.so,
    }));
}
