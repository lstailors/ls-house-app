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

export const MTM_STATUS_KEYS: readonly MtmStatus[] = MTM_STATUSES.map((s) => s.key);

export function isMtmStatus(value: string | null | undefined): value is MtmStatus {
  return !!value && MTM_STATUS_KEYS.includes(value as MtmStatus);
}

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

export type QcResult = "Pending" | "Pass" | "Fail";

export function qcResultOf(doc: Record<string, unknown> | null | undefined): QcResult {
  const raw = String(doc?.qc_result ?? doc?.result ?? doc?.status ?? "Pending").trim();
  if (/^pass$/i.test(raw)) return "Pass";
  if (/^fail$/i.test(raw)) return "Fail";
  return "Pending";
}

export function tabToQcResult(tab: string): QcResult | null {
  const t = tab.toLowerCase();
  if (t === "waiting" || t === "open") return "Pending";
  if (t === "passed" || t === "pass") return "Pass";
  if (t === "failed" || t === "fail") return "Fail";
  return null;
}

/** Six floor checks — match LSH QC Inspection groups. */
export const QC_SIX = [
  { id: "identity", group: "Identity", fields: ["identity", "check_identity", "identity_check", "identity_ok"] },
  { id: "measurements", group: "Measurements", fields: ["measurements", "check_measurements", "measurements_check"] },
  { id: "construction", group: "Construction", fields: ["construction", "check_construction", "construction_check"] },
  { id: "finish", group: "Finish", fields: ["finish", "check_finish", "finish_check"] },
  { id: "condition", group: "Condition", fields: ["condition", "check_condition", "condition_check"] },
  { id: "fit_ready", group: "Fit-ready", fields: ["fit_ready", "fit-ready", "check_fit_ready", "fit_ready_check"] },
] as const;

export function coercePass(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^(pass|yes|true|ok)$/i.test(s)) return true;
  if (/^(fail|no|false)$/i.test(s)) return false;
  return null;
}

export function checksFromDoc(doc: Record<string, unknown> | null | undefined): QcCheck[] {
  if (!doc) return blankChecks();
  const rawJson = doc.checks_json ?? doc.checks;
  if (rawJson) {
    try {
      const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
      if (Array.isArray(parsed) && parsed.length) return mergeChecks(parsed);
    } catch {
      /* fall through to field mapping */
    }
  }
  const byGroup = new Map<string, boolean | null>();
  let any = false;
  for (const six of QC_SIX) {
    for (const f of six.fields) {
      if (doc[f] != null && doc[f] !== "") {
        byGroup.set(six.group, coercePass(doc[f]));
        any = true;
        break;
      }
    }
  }
  if (!any) return blankChecks();
  return QC_CHECK_CATALOG.map((c) => ({
    ...c,
    pass: byGroup.has(c.group) ? byGroup.get(c.group)! : null,
  }));
}

export function checksToDocFields(checks: QcCheck[]): Record<string, unknown> {
  const out: Record<string, unknown> = { checks_json: JSON.stringify(mergeChecks(checks)) };
  for (const six of QC_SIX) {
    const group = checks.filter((c) => c.group === six.group);
    if (!group.length) continue;
    const failed = group.some((c) => c.pass === false);
    const allPass = group.every((c) => c.pass === true);
    if (!failed && !allPass) continue;
    const val = failed ? 0 : 1;
    out[six.id] = val;
    out[`check_${six.id}`] = val;
  }
  return out;
}

export function isQcInspectionName(name: unknown): boolean {
  return /^(LSH-QC-|QC-)/i.test(String(name || "").trim());
}

export function isSalesOrderName(name: unknown): boolean {
  return /^(LSTNY-SO|LSTX-SO|SO-|SAL-)/i.test(String(name || "").trim());
}

export function dedupeByInspectionName<T extends { name?: string | null; id?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = String(row.name || row.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Return YYYY-MM-DD for date_received; drop blanks and dates after today. */
export function dateReceivedLabel(raw: unknown, now = new Date()): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const iso = s.includes("T") ? s : /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (d.getTime() > end.getTime()) return null;
  return s.slice(0, 10);
}
