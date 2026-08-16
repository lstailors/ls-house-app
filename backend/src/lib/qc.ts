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

/** Legacy desk values that are no longer on the Order Status select. */
const PAUSED_STATUS = /pause|hold/i;

export function isPausedMtmStatus(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw || isMtmStatus(raw)) return false;
  return PAUSED_STATUS.test(raw);
}

/** True when a status-like field on this doc is still Pause / Hold. */
export function shouldLiftPaused(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return false;
  for (const [key, value] of Object.entries(doc)) {
    if (value == null || typeof value === "object") continue;
    if (!/status|state/i.test(key)) continue;
    if (isPausedMtmStatus(value)) return true;
  }
  return false;
}

/** Lift a paused make onto the live list so ERPNext will accept a save. */
export function liveStatusFromPaused(value: unknown, fallback: MtmStatus = "Quality Control"): MtmStatus {
  const raw = String(value ?? "").trim();
  if (isMtmStatus(raw)) return raw;
  if (isPausedMtmStatus(value)) return fallback;
  return fallback;
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

/** ERPNext LSH QC Inspection store-arrival gate — Pass is blocked until these are checked. */
export const STORE_ARRIVAL_GROUP = "Store arrival";

export const STORE_ARRIVAL_CHECKS = [
  {
    id: "arrive-contents",
    group: STORE_ARRIVAL_GROUP,
    label: "Contents match order",
    hint: "Pieces on the order are in the bag",
    fields: ["contents_match_order", "contents_match", "custom_contents_match_order"],
  },
  {
    id: "arrive-fabric",
    group: STORE_ARRIVAL_GROUP,
    label: "Fabric/article correct",
    hint: "Cloth / article matches the ticket",
    fields: ["fabric_article_correct", "fabric_article", "custom_fabric_article_correct"],
  },
  {
    id: "arrive-styling",
    group: STORE_ARRIVAL_GROUP,
    label: "Styling / visual OK",
    hint: "Looks like the ordered make",
    fields: ["styling_visual_ok", "styling_visual", "custom_styling_visual_ok"],
  },
  {
    id: "arrive-damage",
    group: STORE_ARRIVAL_GROUP,
    label: "No transit damage",
    hint: "No crush, stain, or ship damage",
    fields: ["no_transit_damage", "transit_damage_ok", "custom_no_transit_damage"],
  },
  {
    id: "arrive-labels",
    group: STORE_ARRIVAL_GROUP,
    label: "Labels/tags present",
    hint: "Maker label and tags are on the garment",
    fields: ["labels_tags_present", "labels_tags", "custom_labels_tags_present"],
  },
] as const;

export const QC_CHECK_CATALOG: Array<Omit<QcCheck, "pass">> = [
  ...STORE_ARRIVAL_CHECKS.map(({ fields: _fields, ...row }) => row),
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

/** Frappe fieldname scrub — spaces, slashes, and punctuation become underscores. */
export function frappeScrub(text: string): string {
  return String(text || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

export type QcMetaField = {
  fieldname?: string;
  label?: string;
  fieldtype?: string;
  options?: string;
};

export type QcInspectionMeta = {
  fields?: QcMetaField[];
  childFields?: Record<string, QcMetaField[]>;
};

const ARRIVAL_CHILD_KEYS = [
  "store_arrival_checklist",
  "store_arrival_checks",
  "store_arrival_items",
  "store_arrival",
  "arrival_checklist",
  "arrival_checks",
  "arrival_items",
  "qc_checklist",
  "qc_checks",
  "checklist",
  "checklist_items",
  "inspection_checklist",
  "receiving_checklist",
  "store_checklist",
];

const ROW_LABEL_FIELDS = [
  "label",
  "item",
  "check_item",
  "description",
  "checklist_item",
  "item_name",
  "title",
  "checkpoint",
  "check_name",
  "name1",
  "subject",
];

const ROW_CHECK_FIELDS = [
  "checked",
  "check",
  "completed",
  "is_checked",
  "ok",
  "pass",
  "passed",
  "done",
  "tick",
];

function arrivalLabelsMatch(raw: string, wanted: string): boolean {
  const a = frappeScrub(raw);
  const b = frappeScrub(wanted);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function arrivalLabelOf(row: Record<string, unknown>, extraKeys: string[] = []): string {
  for (const key of [...extraKeys, ...ROW_LABEL_FIELDS]) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
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
  const byId = new Map<string, boolean | null>();
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
  for (const item of STORE_ARRIVAL_CHECKS) {
    for (const f of item.fields) {
      if (doc[f] != null && doc[f] !== "") {
        byId.set(item.id, coercePass(doc[f]));
        any = true;
        break;
      }
    }
  }
  for (const value of Object.values(doc)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const label = arrivalLabelOf(rec);
      const item = STORE_ARRIVAL_CHECKS.find((c) => arrivalLabelsMatch(label, c.label));
      if (!item) continue;
      const ticked = ROW_CHECK_FIELDS.some((field) => coercePass(rec[field]) === true);
      byId.set(item.id, ticked);
      any = true;
    }
  }
  if (!any) return blankChecks();
  return QC_CHECK_CATALOG.map((c) => ({
    ...c,
    pass: byId.has(c.id) ? byId.get(c.id)! : byGroup.has(c.group) ? byGroup.get(c.group)! : null,
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
  Object.assign(out, storeArrivalToDocFields(checks));
  return out;
}

export function storeArrivalOpen(checks: QcCheck[]): string[] {
  return STORE_ARRIVAL_CHECKS
    .filter((item) => {
      const row = checks.find((c) => c.id === item.id || c.label === item.label);
      return row?.pass !== true;
    })
    .map((item) => item.label);
}

function arrivalFieldAliases(item: (typeof STORE_ARRIVAL_CHECKS)[number]): string[] {
  const scrub = frappeScrub(item.label);
  return [...new Set([...item.fields, scrub, `custom_${scrub}`, `check_${scrub}`])];
}

function tickArrivalRow(row: Record<string, unknown>, checkFields: string[]): Record<string, unknown> {
  const next = { ...row };
  for (const field of checkFields.length ? checkFields : ROW_CHECK_FIELDS) next[field] = 1;
  return next;
}

function seedArrivalRows(labelField: string, checkFields: string[]): Record<string, unknown>[] {
  return STORE_ARRIVAL_CHECKS.map((item) => {
    const row: Record<string, unknown> = {};
    for (const key of ROW_LABEL_FIELDS) row[key] = item.label;
    if (labelField) row[labelField] = item.label;
    return tickArrivalRow(row, checkFields);
  });
}

function looksLikeArrivalTable(key: string, rows: unknown[], labelKeys: string[] = []): boolean {
  if (ARRIVAL_CHILD_KEYS.includes(key) || /arrival|checklist/.test(key)) return true;
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const label = arrivalLabelOf(row as Record<string, unknown>, labelKeys);
    return STORE_ARRIVAL_CHECKS.some((item) => arrivalLabelsMatch(label, item.label));
  });
}

function markStoreArrivalChildren(
  doc: Record<string, unknown>,
  force: boolean,
  meta?: QcInspectionMeta | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const childMeta = meta?.childFields || {};
  const seen = new Set<string>();

  const visit = (key: string, raw: unknown, fields?: QcMetaField[]) => {
    if (seen.has(key)) return;
    const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    const labelKeys = (fields || []).filter((f) => f.fieldname && f.fieldtype !== "Check").map((f) => String(f.fieldname));
    const checkFields = (fields || [])
      .filter((f) => f.fieldtype === "Check" && f.fieldname)
      .map((f) => String(f.fieldname));
    if (!looksLikeArrivalTable(key, rows, labelKeys)) return;
    seen.add(key);
    const next = rows.length
      ? rows.map((row) => {
          const label = arrivalLabelOf(row, labelKeys);
          const match = STORE_ARRIVAL_CHECKS.some((item) => arrivalLabelsMatch(label, item.label));
          if (!match && !force) return row;
          if (!match && !ARRIVAL_CHILD_KEYS.includes(key) && !/arrival/.test(key)) return row;
          return tickArrivalRow(row, checkFields);
        })
      : force
        ? seedArrivalRows(labelKeys[0] || "label", checkFields)
        : [];
    if (next.length) out[key] = next;
  };

  for (const [key, val] of Object.entries(doc)) {
    if (!Array.isArray(val)) continue;
    visit(key, val, childMeta[key]);
  }
  for (const [key, fields] of Object.entries(childMeta)) {
    if (seen.has(key)) continue;
    visit(key, doc[key], fields);
  }
  if (force) {
    for (const key of ARRIVAL_CHILD_KEYS) {
      if (out[key] || key in doc) continue;
      out[key] = seedArrivalRows("label", []);
    }
  }
  return out;
}

function tickArrivalChecksFromMeta(meta?: QcInspectionMeta | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of meta?.fields || []) {
    if (field.fieldtype !== "Check" || !field.fieldname) continue;
    const label = String(field.label || field.fieldname);
    if (STORE_ARRIVAL_CHECKS.some((item) => arrivalLabelsMatch(label, item.label) || arrivalLabelsMatch(field.fieldname!, item.label))) {
      out[field.fieldname] = 1;
    }
  }
  return out;
}

function tickArrivalChecksFromDoc(doc: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!doc) return out;
  const aliases = new Set(STORE_ARRIVAL_CHECKS.flatMap((item) => arrivalFieldAliases(item)));
  for (const key of Object.keys(doc)) {
    if (aliases.has(key) || STORE_ARRIVAL_CHECKS.some((item) => arrivalLabelsMatch(key, item.label))) {
      out[key] = 1;
    }
  }
  return out;
}

/** Tick the ERPNext store-arrival boxes (Check fields + any matching child table). */
export function storeArrivalToDocFields(
  checks: QcCheck[] | undefined,
  existing?: Record<string, unknown> | null,
  opts?: { forcePass?: boolean; meta?: QcInspectionMeta | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const force = Boolean(opts?.forcePass);
  for (const item of STORE_ARRIVAL_CHECKS) {
    const row = checks?.find((c) => c.id === item.id || c.label === item.label);
    const ok = force || row?.pass === true;
    if (!ok) continue;
    for (const field of arrivalFieldAliases(item)) out[field] = 1;
  }
  if (force) Object.assign(out, tickArrivalChecksFromMeta(opts?.meta), tickArrivalChecksFromDoc(existing));
  Object.assign(out, markStoreArrivalChildren(existing || {}, force, opts?.meta));
  for (const key of ["status", "order_status", "qc_result", "result", "name", "doctype"]) {
    delete out[key];
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
