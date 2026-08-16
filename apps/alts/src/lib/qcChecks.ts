/** Floor QC checklist — same labels as backend/src/lib/qc.ts. Shown before ERPNext answers. */

export type QcCheck = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  pass: boolean | null;
};

export const QC_CHECK_CATALOG: Array<Omit<QcCheck, "pass">> = [
  { id: "arrive-contents", group: "Store arrival", label: "Contents match order", hint: "Pieces on the order are in the bag" },
  { id: "arrive-fabric", group: "Store arrival", label: "Fabric/article correct", hint: "Cloth / article matches the ticket" },
  { id: "arrive-styling", group: "Store arrival", label: "Styling / visual OK", hint: "Looks like the ordered make" },
  { id: "arrive-damage", group: "Store arrival", label: "No transit damage", hint: "No crush, stain, or ship damage" },
  { id: "arrive-labels", group: "Store arrival", label: "Labels/tags present", hint: "Maker label and tags are on the garment" },
  { id: "id-label", group: "Identity", label: "Label / ticket matches the order", hint: "Name, SO, MTMPro #" },
  { id: "id-client", group: "Identity", label: "Client name on the garment is correct" },
  { id: "id-fabric", group: "Identity", label: "Cloth / mill matches the order" },
  { id: "id-pieces", group: "Identity", label: "All pieces on the order are here", hint: "Jacket, trouser, vest, extras" },
  { id: "meas-chest", group: "Measurements", label: "Chest / body is on spec" },
  { id: "meas-waist", group: "Measurements", label: "Waist / seat is on spec" },
  { id: "meas-sleeve", group: "Measurements", label: "Sleeve length is on spec" },
  { id: "meas-length", group: "Measurements", label: "Jacket / coat length is on spec" },
  { id: "meas-trouser", group: "Measurements", label: "Trouser length / break is on spec" },
  { id: "con-stitch", group: "Construction", label: "Stitching is clean — no skipped seams" },
  { id: "con-lining", group: "Construction", label: "Lining hangs clean, no puckers" },
  { id: "con-canvas", group: "Construction", label: "Chest canvas / roll is correct" },
  { id: "con-vents", group: "Construction", label: "Vents, pockets, and flaps sit square" },
  { id: "con-collar", group: "Construction", label: "Collar and gorge are balanced" },
  { id: "fin-buttons", group: "Finish", label: "Buttons, buttonholes, and shank are right" },
  { id: "fin-press", group: "Finish", label: "Press is clean — no shine or marks" },
  { id: "fin-threads", group: "Finish", label: "Loose threads clipped" },
  { id: "fin-hardware", group: "Finish", label: "Zippers, hooks, and hardware work" },
  { id: "cond-stain", group: "Condition", label: "No stains, spots, or soil" },
  { id: "cond-damage", group: "Condition", label: "No snags, holes, or crushed pile" },
  { id: "cond-steam", group: "Condition", label: "Steamed / ready to show the client" },
  { id: "ready-sym", group: "Fit-ready", label: "Left/right symmetry is acceptable" },
  { id: "ready-shoulders", group: "Fit-ready", label: "Shoulders sit clean" },
  { id: "ready-balance", group: "Fit-ready", label: "Front/back balance is acceptable" },
];

export function blankQcChecks(): QcCheck[] {
  return QC_CHECK_CATALOG.map((row) => ({ ...row, pass: null }));
}

export function mergeQcChecks(raw: unknown): QcCheck[] {
  const incoming = Array.isArray(raw) ? raw : [];
  const byId = new Map<string, boolean | null>();
  for (const row of incoming) {
    if (!row || typeof row !== "object" || !("id" in row)) continue;
    const id = String((row as QcCheck).id);
    const pass = (row as QcCheck).pass;
    byId.set(id, pass === true || pass === false ? pass : null);
  }
  return QC_CHECK_CATALOG.map((row) => ({
    ...row,
    pass: byId.has(row.id) ? byId.get(row.id)! : null,
  }));
}

export function isQcInspectionName(name: string | null | undefined): boolean {
  return /^(LSH-QC-|QC-)/i.test(String(name || "").trim());
}
