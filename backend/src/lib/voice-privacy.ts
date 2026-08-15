/** Voice notes stay private unless matched to a client or order. */
export function isHouseVisibleVoice(row: {
  visibility?: string | null;
  customer?: string | null;
  reference_name?: string | null;
  tagged_garment_ids?: string | null;
  owner?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  const vis = String(row.visibility || "").toLowerCase();
  if (vis === "private") return false;
  if (vis === "house" || vis === "public") return true;
  if (row.customer) return true;
  if (row.reference_name) return true;
  const tags = String(row.tagged_garment_ids || "").trim();
  if (tags && tags !== "[]" && tags !== "null") return true;
  return false;
}

/** Shared inbox: house-visible only. Owner can still open their own private note. */
export function canReadVoiceNote(
  user: { email?: string | null } | null | undefined,
  row: Parameters<typeof isHouseVisibleVoice>[0],
): boolean {
  if (isHouseVisibleVoice(row)) return true;
  const owner = String(row?.owner || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return Boolean(owner && email && owner === email);
}
