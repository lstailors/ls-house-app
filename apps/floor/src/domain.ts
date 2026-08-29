export const TIME_CHIPS = [15, 30, 45, 60, 75, 90, 120, 150, 180] as const;

export type GarmentStatus = "Open" | "Ready";
export type FloorView = "dashboard" | "scanner" | "garment" | "ticket" | "transfer" | "complete" | "submit";

export function parseScanToken(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Scan was empty");

  let token = raw;
  try {
    const url = new URL(raw);
    token = url.searchParams.get("token")?.trim() || raw;
  } catch {
    // Plain barcode/tag values are expected.
  }

  if (token.length > 256) throw new Error("Scan token is too long");
  return token;
}
