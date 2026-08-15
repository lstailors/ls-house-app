/** Canonical MTM / make-order statuses — live ERPNext list. QC is #10. */
export const MTM_STATUSES = [
  { key: "Consultation", color: "gray" },
  { key: "Order Submitted", color: "blue" },
  { key: "Fabric PO Raised", color: "purple" },
  { key: "Fabric In Transit", color: "teal" },
  { key: "Received at Facility", color: "teal" },
  { key: "Cutting", color: "orange" },
  { key: "Production", color: "orange" },
  { key: "Shipped to Store", color: "brass" },
  { key: "Received at Store", color: "brass" },
  { key: "Quality Control", color: "rose" },
  { key: "Awaiting Fitting", color: "blue" },
  { key: "Awaiting Shipment", color: "blue" },
  { key: "Alterations", color: "purple" },
  { key: "Fitting", color: "green" },
  { key: "Delivered", color: "forest" },
  { key: "Cancelled", color: "red" },
] as const;

export type MtmStatus = (typeof MTM_STATUSES)[number]["key"];

export const QC_QUEUE_STATUSES = ["Quality Control", "Received at Store", "At QC"] as const;
export const QC_PASS_STATUSES = ["Awaiting Fitting", "Awaiting Shipment"] as const;
export const QC_FAIL_STATUS = "Alterations";

export type QcCheck = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  pass: boolean | null;
};

export const QC_CHECK_CATALOG: Array<Omit<QcCheck, "pass">> = [
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

export function blankChecks(): QcCheck[] {
  return QC_CHECK_CATALOG.map((c) => ({ ...c, pass: null }));
}

export function mergeChecks(raw: unknown): QcCheck[] {
  const incoming = Array.isArray(raw) ? raw : [];
  const byId = new Map<string, boolean | null>();
  for (const row of incoming) {
    if (row && typeof row === "object" && "id" in row) {
      const id = String((row as QcCheck).id);
      const pass = (row as QcCheck).pass;
      byId.set(id, pass === true || pass === false ? pass : null);
    }
  }
  return QC_CHECK_CATALOG.map((c) => ({
    ...c,
    pass: byId.has(c.id) ? byId.get(c.id)! : null,
  }));
}

export function checksSummary(checks: QcCheck[]) {
  const total = checks.length;
  const passed = checks.filter((c) => c.pass === true).length;
  const failed = checks.filter((c) => c.pass === false).length;
  const open = total - passed - failed;
  return { total, passed, failed, open };
}
